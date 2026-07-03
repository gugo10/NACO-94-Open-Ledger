var MATCH_STATUS = {
  MATCHED: 'Matched',
  NEEDS_REVIEW: 'Needs Review',
  INTERNAL_TRANSFER: 'Internal Transfer'
};

var RECONCILIATION_STATUS = {
  DRAFT: 'Draft',
  READY_TO_PUBLISH: 'Ready to Publish',
  PUBLISHED: 'Published',
  LOCKED: 'Locked'
};

function getBankMatchingData() {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);

  return {
    accounts: getActiveAccounts_(),
    unmatchedBankLines: getUnmatchedBankLines_(),
    unmatchedTransactions: getUnmatchedPublishedTransactions_(),
    recentMatches: getRecentMatches_(),
    reconciliations: getRecentReconciliations_(),
    canPrepare: hasAnyRole(user.roles, [ROLES.FINANCE_OFFICER]),
    canPublish: hasAnyRole(user.roles, [ROLES.PUBLISHER, ROLES.REVIEWER])
  };
}

function getMatchSuggestions(bankLineId) {
  requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);

  var bankLine = findRecordByValue(getSheetByName('Bank Statement Lines'), 'Bank Line ID', bankLineId, false);
  if (!bankLine) {
    throw new Error('Bank line not found.');
  }

  return getUnmatchedPublishedTransactions_().map(function(transaction) {
    return {
      transaction: transaction,
      score: getMatchScore_(bankLine, transaction)
    };
  }).filter(function(item) {
    return item.score > 0;
  }).sort(function(a, b) {
    return b.score - a.score;
  }).slice(0, 5);
}

function matchBankLineToTransaction(bankLineId, transactionId, notes) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
  var bankLine = findRecordByValue(getSheetByName('Bank Statement Lines'), 'Bank Line ID', bankLineId, false);
  var transaction = findRecordByValue(getSheetByName('Transactions'), 'Transaction ID', transactionId, false);

  if (!bankLine) {
    throw new Error('Bank line not found.');
  }
  if (!transaction || transaction.Status !== TRANSACTION_STATUS.APPROVED) {
    throw new Error('Choose a published transaction.');
  }
  if (isBankLineMatched_(bankLineId)) {
    throw new Error('This bank line has already been matched.');
  }
  if (isTransactionMatched_(transactionId)) {
    throw new Error('This transaction has already been matched.');
  }

  var bankAmount = getBankLineSignedAmount_(bankLine);
  var txnAmount = transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN
    ? parseMoney_(transaction.Amount)
    : -parseMoney_(transaction.Amount);
  if (Math.abs(bankAmount - txnAmount) > 0.01) {
    throw new Error('The bank line amount and transaction amount are different.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var matchId = getNextId('Transaction Matches', 'MAT');
    getSheetByName('Transaction Matches').appendRow([
      matchId,
      bankLineId,
      transactionId,
      MATCH_STATUS.MATCHED,
      user.email,
      nowIso(),
      String(notes || '').trim()
    ]);
    updateRecordByHeaders(getSheetByName('Bank Statement Lines'), bankLine._rowNumber, {
      Status: MATCH_STATUS.MATCHED,
      'Updated At': nowIso()
    });
    updateRecordByHeaders(getSheetByName('Transactions'), transaction._rowNumber, {
      Status: TRANSACTION_STATUS.RECONCILED,
      'Updated At': nowIso()
    });
    writeAuditLog('Bank line matched', 'Transaction Match', matchId, '', { bankLineId: bankLineId, transactionId: transactionId }, 'Finance Officer matched bank line to transaction');
    return { ok: true, matchId: matchId };
  } finally {
    lock.releaseLock();
  }
}

function markBankLineNeedsReview(bankLineId, notes) {
  return markBankLineStatus_(bankLineId, MATCH_STATUS.NEEDS_REVIEW, notes);
}

function markBankLineInternalTransfer(bankLineId, notes) {
  return markBankLineStatus_(bankLineId, MATCH_STATUS.INTERNAL_TRANSFER, notes);
}

function createTransactionFromBankLine(bankLineId, details) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
  var bankLine = findRecordByValue(getSheetByName('Bank Statement Lines'), 'Bank Line ID', bankLineId, false);
  if (!bankLine) {
    throw new Error('Bank line not found.');
  }
  if (isBankLineMatched_(bankLineId)) {
    throw new Error('This bank line is already matched.');
  }

  details = details || {};
  var transactionType = parseMoney_(bankLine['Money In']) > 0 ? TRANSACTION_TYPES.MONEY_IN : TRANSACTION_TYPES.MONEY_OUT;
  var categoryId = String(details['Category ID'] || '').trim();
  if (!categoryId) {
    throw new Error('Category is required.');
  }

  var transaction = {
    Date: formatDateOnly_(bankLine['Statement Date']),
    Amount: transactionType === TRANSACTION_TYPES.MONEY_IN ? bankLine['Money In'] : bankLine['Money Out'],
    'Account ID': bankLine['Account ID'],
    'Payer or Payee': String(details['Payer or Payee'] || bankLine.Description || '').trim(),
    'Category ID': categoryId,
    Description: String(details.Description || bankLine.Description || '').trim(),
    'Reference Number': bankLine['Reference Number'],
    'Payment Method': 'Bank',
    'Fund ID': String(details['Fund ID'] || '').trim(),
    'Document ID': bankLine['Document ID'],
    Reason: 'Created from bank statement line ' + bankLineId
  };

  var result = transactionType === TRANSACTION_TYPES.MONEY_IN
    ? recordMoneyIn(transaction)
    : recordMoneyOut(transaction);

  writeAuditLog('Transaction created from bank line', 'Transaction', result.transactionId, '', {
    bankLineId: bankLineId,
    transactionType: transactionType
  }, 'Finance Officer created ledger entry from bank line');

  return result;
}

function prepareReconciliation(record) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
  var clean = cleanReconciliationRecord_(record || {});
  validateRequired_(clean, ['Account ID', 'Period Start', 'Period End', 'Opening Balance', 'Statement Closing Balance']);

  var summary = calculateReconciliationSummary_(clean['Account ID'], clean['Period Start'], clean['Period End'], clean['Opening Balance'], clean['Statement Closing Balance']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var reconciliationId = getNextId('Reconciliations', 'REC');
    getSheetByName('Reconciliations').appendRow([
      reconciliationId,
      clean['Account ID'],
      clean['Period Start'],
      clean['Period End'],
      summary.openingBalance,
      summary.moneyIn,
      summary.moneyOut,
      summary.expectedClosingBalance,
      summary.statementClosingBalance,
      summary.difference,
      summary.matchedItems,
      summary.unmatchedBankLines,
      summary.unmatchedLedgerTransactions,
      RECONCILIATION_STATUS.READY_TO_PUBLISH,
      user.email,
      '',
      '',
      clean['Document ID'],
      nowIso(),
      nowIso()
    ]);

    writeAuditLog('Reconciliation prepared', 'Reconciliation', reconciliationId, '', summary, 'Finance Officer prepared reconciliation');
    return { ok: true, reconciliationId: reconciliationId, summary: summary };
  } finally {
    lock.releaseLock();
  }
}

function publishReconciliation(reconciliationId, notes) {
  var user = requireAnyRole([ROLES.PUBLISHER, ROLES.REVIEWER]);
  var sheet = getSheetByName('Reconciliations');
  var reconciliation = findRecordByValue(sheet, 'Reconciliation ID', reconciliationId, false);
  if (!reconciliation) {
    throw new Error('Reconciliation not found.');
  }
  if (reconciliation.Status !== RECONCILIATION_STATUS.READY_TO_PUBLISH) {
    throw new Error('Only reconciliations ready to publish can be published.');
  }
  if (normalizeEmail(reconciliation['Prepared By']) === user.email) {
    throw new Error('You cannot publish a reconciliation you prepared.');
  }

  updateRecordByHeaders(sheet, reconciliation._rowNumber, {
    Status: RECONCILIATION_STATUS.LOCKED,
    'Approved By': user.email,
    'Date Completed': nowIso(),
    'Updated At': nowIso()
  });

  writeAuditLog('Reconciliation published and locked', 'Reconciliation', reconciliationId, reconciliation, {
    status: RECONCILIATION_STATUS.LOCKED,
    notes: notes || ''
  }, 'Publisher published reconciliation');

  return { ok: true, reconciliationId: reconciliationId, status: RECONCILIATION_STATUS.LOCKED };
}

function markBankLineStatus_(bankLineId, status, notes) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
  var sheet = getSheetByName('Bank Statement Lines');
  var bankLine = findRecordByValue(sheet, 'Bank Line ID', bankLineId, false);
  if (!bankLine) {
    throw new Error('Bank line not found.');
  }

  updateRecordByHeaders(sheet, bankLine._rowNumber, {
    Status: status,
    Notes: String(notes || '').trim(),
    'Updated At': nowIso()
  });
  writeAuditLog('Bank line marked ' + status.toLowerCase(), 'Bank Statement Line', bankLineId, bankLine, { status: status, notes: notes || '' }, 'Finance Officer updated bank line status');
  return { ok: true, bankLineId: bankLineId, status: status };
}

function getUnmatchedBankLines_() {
  var matched = getMatchedBankLineLookup_();
  return getSheetRecords(getSheetByName('Bank Statement Lines')).filter(function(line) {
    return !matched[line['Bank Line ID']] && [MATCH_STATUS.MATCHED, MATCH_STATUS.INTERNAL_TRANSFER].indexOf(line.Status) === -1;
  }).map(sanitizeBankLineForMatch_).slice(0, 100);
}

function getUnmatchedPublishedTransactions_() {
  var matched = getMatchedTransactionLookup_();
  return getSheetRecords(getSheetByName('Transactions')).filter(function(transaction) {
    return !matched[transaction['Transaction ID']] && transaction.Status === TRANSACTION_STATUS.APPROVED;
  }).map(sanitizeTransactionForDisplay_).slice(0, 100);
}

function getRecentMatches_() {
  return getSheetRecords(getSheetByName('Transaction Matches')).slice(-30).reverse().map(function(match) {
    return {
      matchId: match['Match ID'],
      bankLineId: match['Bank Line ID'],
      transactionId: match['Transaction ID'],
      matchStatus: match['Match Status'],
      matchedBy: match['Matched By'],
      matchedAt: match['Matched At'],
      notes: match.Notes
    };
  });
}

function getRecentReconciliations_() {
  return getSheetRecords(getSheetByName('Reconciliations')).slice(-20).reverse().map(function(record) {
    return {
      reconciliationId: record['Reconciliation ID'],
      accountId: record['Account ID'],
      periodStart: formatDateOnly_(record['Period Start']),
      periodEnd: formatDateOnly_(record['Period End']),
      expectedClosingBalance: parseMoney_(record['Expected Closing Balance']),
      statementClosingBalance: parseMoney_(record['Statement Closing Balance']),
      difference: parseMoney_(record.Difference),
      status: record.Status,
      preparedBy: record['Prepared By'],
      approvedBy: record['Approved By']
    };
  });
}

function sanitizeBankLineForMatch_(line) {
  return {
    bankLineId: line['Bank Line ID'],
    accountId: line['Account ID'],
    statementDate: formatDateOnly_(line['Statement Date']),
    description: line.Description,
    moneyIn: parseMoney_(line['Money In']),
    moneyOut: parseMoney_(line['Money Out']),
    runningBalance: parseMoney_(line['Running Balance']),
    referenceNumber: line['Reference Number'],
    status: line.Status,
    notes: line.Notes
  };
}

function getMatchedBankLineLookup_() {
  var lookup = {};
  getSheetRecords(getSheetByName('Transaction Matches')).forEach(function(match) {
    if (match['Match Status'] === MATCH_STATUS.MATCHED) {
      lookup[match['Bank Line ID']] = true;
    }
  });
  return lookup;
}

function getMatchedTransactionLookup_() {
  var lookup = {};
  getSheetRecords(getSheetByName('Transaction Matches')).forEach(function(match) {
    if (match['Match Status'] === MATCH_STATUS.MATCHED) {
      lookup[match['Transaction ID']] = true;
    }
  });
  return lookup;
}

function isBankLineMatched_(bankLineId) {
  return Boolean(getMatchedBankLineLookup_()[bankLineId]);
}

function isTransactionMatched_(transactionId) {
  return Boolean(getMatchedTransactionLookup_()[transactionId]);
}

function getBankLineSignedAmount_(bankLine) {
  return parseMoney_(bankLine['Money In']) - parseMoney_(bankLine['Money Out']);
}

function getMatchScore_(bankLine, transaction) {
  var score = 0;
  var bankAmount = getBankLineSignedAmount_(bankLine);
  var txnAmount = transaction.transactionType === TRANSACTION_TYPES.MONEY_IN
    ? transaction.amount
    : -transaction.amount;
  if (Math.abs(bankAmount - txnAmount) < 0.01) {
    score += 50;
  }
  if (bankLine['Reference Number'] && transaction.referenceNumber && String(bankLine['Reference Number']).toLowerCase() === String(transaction.referenceNumber).toLowerCase()) {
    score += 35;
  }
  if (daysBetween_(bankLine['Statement Date'], transaction.date) <= 3) {
    score += 10;
  }
  if (sharesWord_(bankLine.Description, transaction.description)) {
    score += 5;
  }
  return score;
}

function calculateReconciliationSummary_(accountId, periodStart, periodEnd, openingBalance, statementClosingBalance) {
  var start = new Date(periodStart);
  var end = new Date(periodEnd);
  var lines = getSheetRecords(getSheetByName('Bank Statement Lines')).filter(function(line) {
    var date = new Date(line['Statement Date']);
    return line['Account ID'] === accountId && date >= start && date <= end;
  });
  var transactions = getSheetRecords(getSheetByName('Transactions')).filter(function(transaction) {
    var date = new Date(transaction.Date);
    return transaction['Account ID'] === accountId && date >= start && date <= end && transaction.Status === TRANSACTION_STATUS.APPROVED;
  });

  var matchedBank = getMatchedBankLineLookup_();
  var matchedTxn = getMatchedTransactionLookup_();
  var moneyIn = 0;
  var moneyOut = 0;
  var matchedItems = 0;

  lines.forEach(function(line) {
    moneyIn += parseMoney_(line['Money In']);
    moneyOut += parseMoney_(line['Money Out']);
    if (matchedBank[line['Bank Line ID']]) {
      matchedItems++;
    }
  });

  var expected = parseMoney_(openingBalance) + moneyIn - moneyOut;
  var statement = parseMoney_(statementClosingBalance);

  return {
    openingBalance: parseMoney_(openingBalance),
    moneyIn: moneyIn,
    moneyOut: moneyOut,
    expectedClosingBalance: expected,
    statementClosingBalance: statement,
    difference: Math.round((statement - expected) * 100) / 100,
    matchedItems: matchedItems,
    unmatchedBankLines: lines.filter(function(line) { return !matchedBank[line['Bank Line ID']]; }).length,
    unmatchedLedgerTransactions: transactions.filter(function(transaction) { return !matchedTxn[transaction['Transaction ID']]; }).length
  };
}

function cleanReconciliationRecord_(record) {
  return {
    'Account ID': String(record['Account ID'] || '').trim(),
    'Period Start': normalizeDateInput_(record['Period Start']),
    'Period End': normalizeDateInput_(record['Period End']),
    'Opening Balance': String(record['Opening Balance'] || '').trim(),
    'Statement Closing Balance': String(record['Statement Closing Balance'] || '').trim(),
    'Document ID': String(record['Document ID'] || '').trim()
  };
}

function daysBetween_(a, b) {
  var first = new Date(a);
  var second = new Date(b);
  if (isNaN(first.getTime()) || isNaN(second.getTime())) {
    return 9999;
  }
  return Math.abs(Math.round((first.getTime() - second.getTime()) / (1000 * 60 * 60 * 24)));
}

function sharesWord_(a, b) {
  var words = {};
  String(a || '').toLowerCase().split(/\W+/).forEach(function(word) {
    if (word.length > 3) {
      words[word] = true;
    }
  });
  return String(b || '').toLowerCase().split(/\W+/).some(function(word) {
    return Boolean(words[word]);
  });
}

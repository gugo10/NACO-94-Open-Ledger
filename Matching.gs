var MATCH_STATUS = {
  MATCHED: 'Matched',
  NEEDS_REVIEW: 'Needs Review',
  INTERNAL_TRANSFER: 'Internal Transfer',
  READY_TO_PUBLISH: 'Ready to Publish'
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
    canPrepare: hasFinanceOfficerOrSystemAdmin(user.roles),
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
  var user = requireFinanceOfficerOrSystemAdmin();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var bankLine = findRecordByValue(getSheetByName('Bank Statement Lines'), 'Bank Line ID', bankLineId, false);
    var transaction = findRecordByValue(getSheetByName('Transactions'), 'Transaction ID', transactionId, false);
    if (!bankLine) {
      throw new Error('Bank line not found.');
    }
    if (!transaction || transaction.Status !== TRANSACTION_STATUS.APPROVED) {
      throw new Error('Choose a published transaction.');
    }
    if (bankLine.Status === MATCH_STATUS.READY_TO_PUBLISH || hasWaitingTransactionsForBankLine_(bankLineId)) {
      throw new Error('This bank line still has category records waiting for Publisher approval.');
    }
    if (isBankLineMatched_(bankLineId)) {
      throw new Error('This bank line has already been matched.');
    }
    if (isTransactionMatched_(transactionId)) {
      throw new Error('This transaction has already been matched.');
    }
    if (String(bankLine['Account ID']) !== String(transaction['Account ID'])) {
      throw new Error('The bank line and transaction must belong to the same account.');
    }
    var bankAmount = getBankLineSignedAmount_(bankLine);
    var txnAmount = isMoneyInType_(transaction['Transaction Type'])
      ? parseMoney_(transaction.Amount)
      : -parseMoney_(transaction.Amount);
    if (Math.abs(bankAmount - txnAmount) > 0.01) {
      throw new Error('The bank line amount and transaction amount are different.');
    }
    var matchId = getNextId_('Transaction Matches', 'MAT');
    appendSafeRow_(getSheetByName('Transaction Matches'), [
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
    safeWriteAuditLog_('Bank line matched', 'Transaction Match', matchId, '', { bankLineId: bankLineId, transactionId: transactionId }, 'Finance Officer matched bank line to transaction');
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
  var user = requireFinanceOfficerOrSystemAdmin();
  details = details || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var bankLineSheet = getSheetByName('Bank Statement Lines');
    var bankLine = findRecordByValue(bankLineSheet, 'Bank Line ID', bankLineId, false);
    if (!bankLine) {
      throw new Error('Bank line not found.');
    }
    if (isBankLineMatched_(bankLineId)
      || bankLine.Status === MATCH_STATUS.READY_TO_PUBLISH
      || hasWaitingTransactionsForBankLine_(bankLineId)) {
      throw new Error('This bank line has already been handled or is waiting for Publisher approval.');
    }
    var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', bankLine['Account ID'], false);
    if (!account || account.Status !== 'Active') {
      throw new Error('The bank line account is no longer active.');
    }
    assertAccountingPeriodOpen_(bankLine['Account ID'], bankLine['Statement Date']);
    var transactionType = parseMoney_(bankLine['Money In']) > 0 ? TRANSACTION_TYPES.MONEY_IN : TRANSACTION_TYPES.MONEY_OUT;
    var bankAmount = transactionType === TRANSACTION_TYPES.MONEY_IN ? parseMoney_(bankLine['Money In']) : parseMoney_(bankLine['Money Out']);
    var splits = cleanBankLineCategorySplits_(details, transactionType, bankAmount);
    var transactionSheet = getSheetByName('Transactions');
    var nextSequence = Number(getNextId_('Transactions', 'TXN').split('-')[1]);
    var now = nowIso();
    var transactionIds = [];
    var rows = splits.map(function(split, index) {
      var transactionId = makeId('TXN', nextSequence++);
      transactionIds.push(transactionId);
      var payerOrPayee = split.payerOrPayee || String(details['Payer or Payee'] || bankLine.Description || '').trim();
      if (transactionType === TRANSACTION_TYPES.MONEY_OUT && !payerOrPayee) {
        throw new Error('Each Money Out category needs a payee.');
      }
      return makeRowForHeaders_(transactionSheet, {
        'Transaction ID': transactionId,
        'Transaction Type': transactionType,
        Date: normalizeImportedDate_(bankLine['Statement Date']),
        Amount: split.amount,
        'Account ID': bankLine['Account ID'],
        'Payer or Payee': payerOrPayee,
        'Category ID': split.categoryId,
        Description: split.description || String(details.Description || bankLine.Description || '').trim(),
        'Reference Number': bankLine['Reference Number'],
        'Payment Method': 'Bank Statement',
        'Fund ID': split.fundId || String(details['Fund ID'] || '').trim(),
        'Document ID': bankLine['Document ID'],
        'Entered By': user.email,
        Status: TRANSACTION_STATUS.SUBMITTED,
        'Submitted At': now,
        Reason: 'Created from bank statement line ' + bankLineId + (splits.length > 1 ? ' split ' + (index + 1) + ' of ' + splits.length : ''),
        'Created At': now,
        'Updated At': now,
        'Source Bank Line ID': bankLineId
      });
    });
    transactionSheet.getRange(transactionSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    updateRecordByHeaders(bankLineSheet, bankLine._rowNumber, {
      Status: MATCH_STATUS.READY_TO_PUBLISH,
      Notes: 'Category records waiting for Publisher approval: ' + transactionIds.join(', '),
      'Updated At': now
    });
    safeWriteAuditLog_('Category records created from bank line', 'Bank Statement Line', bankLineId, '', {
      bankLineId: bankLineId,
      transactionType: transactionType,
      transactionIds: transactionIds,
      splitCount: splits.length
    }, 'Finance Officer categorised bank statement line');
    return { ok: true, transactionIds: transactionIds, transactionId: transactionIds[0], status: TRANSACTION_STATUS.SUBMITTED };
  } finally {
    lock.releaseLock();
  }
}

function prepareReconciliation(record) {
  var user = requireFinanceOfficerOrSystemAdmin();
  var clean = cleanReconciliationRecord_(record || {});
  validateRequired_(clean, ['Account ID', 'Period Start', 'Period End', 'Statement Closing Balance']);
  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', clean['Account ID'], false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Choose an active account.');
  }
  if (parseAppDate_(clean['Period Start']) > parseAppDate_(clean['Period End'])) {
    throw new Error('Period start cannot be after period end.');
  }
  var existingLockDate = getAccountingLockDate_(clean['Account ID']);
  if (existingLockDate && normalizeImportedDate_(clean['Period Start']) <= existingLockDate) {
    throw new Error('This account is already locked through ' + formatDisplayDate_(existingLockDate) + '. Start the next reconciliation after that date.');
  }
  if (!hasStatementEvidenceForReconciliation_(clean)) {
    throw new Error('A successfully imported bank statement must cover this account and the full reconciliation period.');
  }

  var summary = calculateReconciliationSummary_(clean['Account ID'], clean['Period Start'], clean['Period End'], '', clean['Statement Closing Balance']);
  if (countPendingLedgerTransactions_(clean['Account ID'], clean['Period Start'], clean['Period End']) > 0) {
    throw new Error('Publish or send back every pending transaction in this period before preparing the reconciliation.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    existingLockDate = getAccountingLockDate_(clean['Account ID']);
    if (existingLockDate && normalizeImportedDate_(clean['Period Start']) <= existingLockDate) {
      throw new Error('This account is already locked through ' + formatDisplayDate_(existingLockDate) + '. Start the next reconciliation after that date.');
    }
    if (!hasStatementEvidenceForReconciliation_(clean)) {
      throw new Error('The statement evidence changed or is no longer available. Refresh and try again.');
    }
    if (countPendingLedgerTransactions_(clean['Account ID'], clean['Period Start'], clean['Period End']) > 0) {
      throw new Error('Publish or send back every pending transaction in this period before preparing the reconciliation.');
    }
    summary = calculateReconciliationSummary_(clean['Account ID'], clean['Period Start'], clean['Period End'], '', clean['Statement Closing Balance']);
    var reconciliationId = getNextId_('Reconciliations', 'REC');
    appendSafeRow_(getSheetByName('Reconciliations'), [
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

    safeWriteAuditLog_('Reconciliation prepared', 'Reconciliation', reconciliationId, '', summary, 'Finance Officer prepared reconciliation');
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

  var currentSummary = calculateReconciliationSummary_(
    reconciliation['Account ID'],
    reconciliation['Period Start'],
    reconciliation['Period End'],
    reconciliation['Opening Balance'],
    reconciliation['Statement Closing Balance']
  );
  if (Math.abs(currentSummary.difference - parseMoney_(reconciliation.Difference)) > 0.01
    || currentSummary.unmatchedBankLines !== Number(reconciliation['Unmatched Bank Lines'] || 0)
    || currentSummary.unmatchedLedgerTransactions !== Number(reconciliation['Unmatched Ledger Transactions'] || 0)) {
    throw new Error('Bank or ledger records changed after this reconciliation was prepared. Prepare it again before publishing.');
  }
  if (Math.abs(currentSummary.difference) > 0.01) {
    throw new Error('This reconciliation cannot be locked because the difference is not zero.');
  }
  if (currentSummary.unmatchedBankLines > 0 || currentSummary.unmatchedLedgerTransactions > 0) {
    throw new Error('Resolve every unmatched bank line and ledger transaction before locking this reconciliation.');
  }
  if (countPendingLedgerTransactions_(reconciliation['Account ID'], reconciliation['Period Start'], reconciliation['Period End']) > 0) {
    throw new Error('Pending transactions now exist in this period. Publish or send them back, then prepare the reconciliation again.');
  }
  if (!hasStatementEvidenceForReconciliation_(reconciliation)) {
    throw new Error('A reviewed bank statement import must cover this account and period before reconciliation can be locked.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var current = findRecordByValue(sheet, 'Reconciliation ID', reconciliationId, false);
    if (!current || current.Status !== RECONCILIATION_STATUS.READY_TO_PUBLISH) {
      throw new Error('This reconciliation has already been handled.');
    }
    var currentLockDate = getAccountingLockDate_(current['Account ID']);
    if (currentLockDate && normalizeImportedDate_(current['Period End']) <= currentLockDate) {
      throw new Error('A later or equal period has already been locked for this account.');
    }
    var lockedSummary = calculateReconciliationSummary_(
      current['Account ID'], current['Period Start'], current['Period End'], current['Opening Balance'], current['Statement Closing Balance']
    );
    if (Math.abs(lockedSummary.difference) > 0.01 || lockedSummary.unmatchedBankLines > 0 || lockedSummary.unmatchedLedgerTransactions > 0) {
      throw new Error('Records changed while publishing. Prepare the reconciliation again.');
    }
    if (countPendingLedgerTransactions_(current['Account ID'], current['Period Start'], current['Period End']) > 0) {
      throw new Error('Pending transactions now exist in this period. Prepare the reconciliation again after they are handled.');
    }
    updateRecordByHeaders(sheet, current._rowNumber, {
      Status: RECONCILIATION_STATUS.LOCKED,
      'Approved By': user.email,
      'Date Completed': nowIso(),
      'Updated At': nowIso(),
      'Review Notes': String(notes || '').trim(),
      'Exception Approved': 'No'
    });
    setPersistentSetting_('ACCOUNTING_LOCK_DATE_' + current['Account ID'], normalizeImportedDate_(current['Period End']), 'Account locked by published reconciliation ' + reconciliationId, user.email);
  } finally {
    lock.releaseLock();
  }

  safeWriteAuditLog_('Reconciliation published and locked', 'Reconciliation', reconciliationId, reconciliation, {
    status: RECONCILIATION_STATUS.LOCKED,
    notes: notes || ''
  }, 'Publisher published reconciliation');

  return { ok: true, reconciliationId: reconciliationId, status: RECONCILIATION_STATUS.LOCKED };
}

function markBankLineStatus_(bankLineId, status, notes) {
  var user = requireFinanceOfficerOrSystemAdmin();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheetByName('Bank Statement Lines');
    var bankLine = findRecordByValue(sheet, 'Bank Line ID', bankLineId, false);
    if (!bankLine) {
      throw new Error('Bank line not found.');
    }
    if (isBankLineMatched_(bankLineId)
      || bankLine.Status === MATCH_STATUS.READY_TO_PUBLISH
      || hasWaitingTransactionsForBankLine_(bankLineId)) {
      throw new Error('This bank line has already been handled or is waiting for Publisher approval.');
    }
    updateRecordByHeaders(sheet, bankLine._rowNumber, {
      Status: status,
      Notes: String(notes || '').trim(),
      'Updated At': nowIso()
    });
    safeWriteAuditLog_('Bank line marked ' + status.toLowerCase(), 'Bank Statement Line', bankLineId, bankLine, { status: status, notes: notes || '' }, 'Finance Officer updated bank line status');
    return { ok: true, bankLineId: bankLineId, status: status };
  } finally {
    lock.releaseLock();
  }
}

function getUnmatchedBankLines_() {
  var matched = getMatchedBankLineLookup_();
  return getSheetRecords(getSheetByName('Bank Statement Lines')).filter(function(line) {
    return !matched[line['Bank Line ID']]
      && [MATCH_STATUS.MATCHED, MATCH_STATUS.INTERNAL_TRANSFER, MATCH_STATUS.READY_TO_PUBLISH, 'Duplicate Quarantined', 'Excluded'].indexOf(line.Status) === -1
      && !isYes_(line['Is Duplicate'])
      && (parseMoney_(line['Money In']) > 0 || parseMoney_(line['Money Out']) > 0);
  }).slice(-100).reverse().map(sanitizeBankLineForMatch_);
}

function getUnmatchedPublishedTransactions_() {
  var matched = getMatchedTransactionLookup_();
  return getSheetRecords(getSheetByName('Transactions')).filter(function(transaction) {
    return !matched[transaction['Transaction ID']] && transaction.Status === TRANSACTION_STATUS.APPROVED;
  }).slice(-100).reverse().map(sanitizeTransactionForDisplay_);
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
  getSheetRecords(getSheetByName('Bank Statement Lines')).forEach(function(line) {
    if (line.Status === MATCH_STATUS.MATCHED) {
      lookup[line['Bank Line ID']] = true;
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
  var txnAmount = isMoneyInType_(transaction.transactionType)
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
  var start = parseAppDate_(periodStart);
  var end = parseAppDate_(periodEnd);
  end.setHours(23, 59, 59, 999);
  var lines = getSheetRecords(getSheetByName('Bank Statement Lines')).filter(function(line) {
    var date = parseAppDate_(line['Statement Date']);
    return line['Account ID'] === accountId && date >= start && date <= end
      && line.Status !== 'Duplicate Quarantined' && line.Status !== 'Excluded' && !isYes_(line['Is Duplicate']);
  });
  var transactions = getSheetRecords(getSheetByName('Transactions')).filter(function(transaction) {
    var date = parseAppDate_(transaction.Date);
    return transaction['Account ID'] === accountId && date >= start && date <= end
      && (transaction.Status === TRANSACTION_STATUS.APPROVED || transaction.Status === TRANSACTION_STATUS.RECONCILED);
  });

  var matchedBank = getMatchedBankLineLookup_();
  var matchedTxn = getMatchedTransactionLookup_();
  var statementMoneyIn = 0;
  var statementMoneyOut = 0;
  var moneyIn = 0;
  var moneyOut = 0;
  var matchedItems = 0;

  lines.forEach(function(line) {
    statementMoneyIn += parseMoney_(line['Money In']);
    statementMoneyOut += parseMoney_(line['Money Out']);
    if (matchedBank[line['Bank Line ID']]) {
      matchedItems++;
    }
  });

  transactions.forEach(function(transaction) {
    var amount = parseMoney_(transaction.Amount);
    if (isMoneyInType_(transaction['Transaction Type'])) {
      moneyIn += amount;
    } else if (isMoneyOutType_(transaction['Transaction Type'])) {
      moneyOut += amount;
    }
  });

  var derivedOpeningBalance = calculateLedgerOpeningBalance_(accountId, start);
  var expected = derivedOpeningBalance + moneyIn - moneyOut;
  var statement = parseMoney_(statementClosingBalance);

  return {
    openingBalance: derivedOpeningBalance,
    moneyIn: moneyIn,
    moneyOut: moneyOut,
    statementMoneyIn: Math.round(statementMoneyIn * 100) / 100,
    statementMoneyOut: Math.round(statementMoneyOut * 100) / 100,
    expectedClosingBalance: expected,
    statementClosingBalance: statement,
    difference: Math.round((statement - expected) * 100) / 100,
    matchedItems: matchedItems,
    unmatchedBankLines: lines.filter(function(line) { return !matchedBank[line['Bank Line ID']]; }).length,
    unmatchedLedgerTransactions: transactions.filter(function(transaction) { return !matchedTxn[transaction['Transaction ID']]; }).length
  };
}

function calculateLedgerOpeningBalance_(accountId, periodStart) {
  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', accountId, false);
  if (!account) {
    throw new Error('Reconciliation account was not found.');
  }
  var start = Object.prototype.toString.call(periodStart) === '[object Date]' ? periodStart : parseAppDate_(periodStart);
  var balance = parseMoney_(account['Opening Balance']);
  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    if (transaction['Account ID'] !== accountId || !isPublishedTransactionStatus_(transaction.Status)) {
      return;
    }
    if (parseAppDate_(transaction.Date) >= start) {
      return;
    }
    var amount = parseMoney_(transaction.Amount);
    balance += isMoneyInType_(transaction['Transaction Type']) ? amount : -amount;
  });
  return Math.round(balance * 100) / 100;
}

function countPendingLedgerTransactions_(accountId, periodStart, periodEnd) {
  var start = parseAppDate_(periodStart);
  var end = parseAppDate_(periodEnd);
  end.setHours(23, 59, 59, 999);
  return getSheetRecords(getSheetByName('Transactions')).filter(function(transaction) {
    if (transaction['Account ID'] !== accountId || transaction.Status !== TRANSACTION_STATUS.SUBMITTED) {
      return false;
    }
    var date = parseAppDate_(transaction.Date);
    return date >= start && date <= end;
  }).length;
}

function cleanBankLineCategorySplits_(details, transactionType, bankAmount) {
  var rawSplits = details.Splits || details.splits || '';
  var splits = [];
  if (rawSplits) {
    if (typeof rawSplits === 'string') {
      try {
        rawSplits = JSON.parse(rawSplits);
      } catch (error) {
        throw new Error('Split category details could not be read.');
      }
    }
    if (!Array.isArray(rawSplits)) {
      throw new Error('Split category details should be a list.');
    }
    splits = rawSplits.map(function(split) {
      split = split || {};
      return {
        amount: parseMoney_(split.Amount),
        categoryId: String(split['Category ID'] || '').trim(),
        fundId: String(split['Fund ID'] || '').trim(),
        payerOrPayee: String(split['Payer or Payee'] || '').trim(),
        description: String(split.Description || '').trim()
      };
    }).filter(function(split) {
      return split.amount > 0 || split.categoryId || split.description;
    });
  }

  if (!splits.length) {
    splits = [{
      amount: bankAmount,
      categoryId: String(details['Category ID'] || '').trim(),
      fundId: String(details['Fund ID'] || '').trim(),
      payerOrPayee: String(details['Payer or Payee'] || '').trim(),
      description: String(details.Description || '').trim()
    }];
  }

  var total = 0;
  splits.forEach(function(split) {
    if (!split.categoryId) {
      throw new Error('Each split needs a category.');
    }
    if (split.amount <= 0) {
      throw new Error('Each split amount must be greater than zero.');
    }
    var category = findRecordByValue(getSheetByName('Categories'), 'Category ID', split.categoryId, false);
    if (!category || category.Status !== 'Active' || category['Category Type'] !== transactionType) {
      throw new Error('Each split must use a valid ' + transactionType + ' category.');
    }
    validateOptionalFund_(split.fundId);
    total += split.amount;
  });

  total = Math.round(total * 100) / 100;
  if (Math.abs(total - bankAmount) > 0.01) {
    throw new Error('Split amounts must add up to the bank amount of ' + bankAmount + '.');
  }
  return splits;
}

function getSourceBankLineIdFromTransaction_(transaction) {
  var explicitId = String(transaction['Source Bank Line ID'] || transaction.sourceBankLineId || '').trim();
  if (explicitId) {
    return explicitId;
  }
  var reason = String(transaction.Reason || '');
  var match = reason.match(/bank statement line (BANK-\d+)/i);
  return match ? match[1] : '';
}

function hasStatementEvidenceForReconciliation_(reconciliation) {
  var start = String(reconciliation['Period Start'] || '');
  var end = String(reconciliation['Period End'] || '');
  var requestedDocumentId = String(reconciliation['Document ID'] || '').trim();
  var requestedFileId = '';
  if (requestedDocumentId) {
    var document = findRecordByValue(getSheetByName('Documents'), 'Document ID', requestedDocumentId, false);
    if (!document || String(document['Document Type'] || '').toLowerCase().indexOf('bank statement') === -1) {
      return false;
    }
    requestedFileId = String(document['File ID'] || '').trim();
  }
  return getSheetRecords(getSheetByName('Bank Statement Imports')).some(function(statementImport) {
    var allowedStatus = [BANK_IMPORT_STATUS.IMPORTED, BANK_IMPORT_STATUS.DUPLICATE_WARNING, 'Recovered'].indexOf(statementImport['Import Status']) !== -1;
    if (statementImport['Account ID'] !== reconciliation['Account ID'] || !allowedStatus) {
      return false;
    }
    var fileId = String(statementImport['File ID'] || '').trim();
    if (!fileId || (requestedFileId && fileId !== requestedFileId)) {
      return false;
    }
    var importStart = String(statementImport['Statement Start'] || '');
    var importEnd = String(statementImport['Statement End'] || '');
    if (!importStart || !importEnd || importStart > start || importEnd < end) {
      return false;
    }
    try {
      DriveApp.getFileById(fileId).getName();
      return true;
    } catch (error) {
      return false;
    }
  });
}

function createInternalTransferFromBankLine(bankLineId, destinationAccountId, notes) {
  var user = requireFinanceOfficerOrSystemAdmin();
  requireCurrentSchema_();
  var lineSheet = getSheetByName('Bank Statement Lines');
  var bankLine = findRecordByValue(lineSheet, 'Bank Line ID', bankLineId, false);
  if (!bankLine) {
    throw new Error('Bank line not found.');
  }
  if (isBankLineMatched_(bankLineId) || bankLine.Status === MATCH_STATUS.READY_TO_PUBLISH) {
    throw new Error('This bank line has already been handled.');
  }
  destinationAccountId = String(destinationAccountId || '').trim();
  var destination = findRecordByValue(getSheetByName('Accounts'), 'Account ID', destinationAccountId, false);
  if (!destination || destination.Status !== 'Active') {
    throw new Error('Choose the other active association account.');
  }
  if (destinationAccountId === bankLine['Account ID']) {
    throw new Error('The transfer destination must be a different account.');
  }
  var moneyIn = parseMoney_(bankLine['Money In']);
  var moneyOut = parseMoney_(bankLine['Money Out']);
  if ((moneyIn > 0 && moneyOut > 0) || (moneyIn <= 0 && moneyOut <= 0)) {
    throw new Error('The bank line must contain one valid transfer amount.');
  }
  var amount = moneyIn > 0 ? moneyIn : moneyOut;
  assertAccountingPeriodOpen_(bankLine['Account ID'], bankLine['Statement Date']);
  assertAccountingPeriodOpen_(destinationAccountId, bankLine['Statement Date']);
  var sourceType = moneyIn > 0 ? TRANSACTION_TYPES.TRANSFER_IN : TRANSACTION_TYPES.TRANSFER_OUT;
  var otherType = moneyIn > 0 ? TRANSACTION_TYPES.TRANSFER_OUT : TRANSACTION_TYPES.TRANSFER_IN;
  var otherAccountId = destinationAccountId;
  var groupId = 'TRF-' + Utilities.getUuid().split('-')[0].toUpperCase();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    bankLine = findRecordByValue(lineSheet, 'Bank Line ID', bankLineId, false);
    if (!bankLine || isBankLineMatched_(bankLineId)
      || bankLine.Status === MATCH_STATUS.READY_TO_PUBLISH
      || hasWaitingTransactionsForBankLine_(bankLineId)) {
      throw new Error('This bank line has already been handled or is waiting for Publisher approval.');
    }
    assertAccountingPeriodOpen_(bankLine['Account ID'], bankLine['Statement Date']);
    assertAccountingPeriodOpen_(destinationAccountId, bankLine['Statement Date']);
    var transactionSheet = getSheetByName('Transactions');
    var nextSequence = Number(getNextId_('Transactions', 'TXN').split('-')[1]);
    var now = nowIso();
    var sourceTransactionId = makeId('TXN', nextSequence++);
    var otherTransactionId = makeId('TXN', nextSequence++);
    var base = {
      Date: normalizeImportedDate_(bankLine['Statement Date']),
      Amount: amount,
      'Payer or Payee': destination['Account Name'],
      Description: 'Internal transfer: ' + String(bankLine.Description || ''),
      'Reference Number': bankLine['Reference Number'],
      'Payment Method': 'Internal Bank Transfer',
      'Document ID': bankLine['Document ID'],
      'Entered By': user.email,
      Status: TRANSACTION_STATUS.SUBMITTED,
      'Submitted At': now,
      Reason: 'Internal transfer created from bank statement line ' + bankLineId + '. ' + String(notes || '').trim(),
      'Created At': now,
      'Updated At': now,
      'Transfer Group ID': groupId
    };
    var first = Object.assign({}, base, {
      'Transaction ID': sourceTransactionId,
      'Transaction Type': sourceType,
      'Account ID': bankLine['Account ID'],
      'Source Bank Line ID': bankLineId
    });
    var second = Object.assign({}, base, {
      'Transaction ID': otherTransactionId,
      'Transaction Type': otherType,
      'Account ID': otherAccountId,
      'Payer or Payee': findRecordByValue(getSheetByName('Accounts'), 'Account ID', bankLine['Account ID'], false)['Account Name'],
      Reason: 'Other side of internal transfer ' + groupId + '. Match to the corresponding bank line when it is imported.'
    });
    var rows = [makeRowForHeaders_(transactionSheet, first), makeRowForHeaders_(transactionSheet, second)];
    transactionSheet.getRange(transactionSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    updateRecordByHeaders(lineSheet, bankLine._rowNumber, {
      Status: MATCH_STATUS.READY_TO_PUBLISH,
      Notes: 'Internal transfer waiting for Publisher approval: ' + groupId,
      'Transfer Account ID': destinationAccountId,
      'Updated At': now
    });
    safeWriteAuditLog_('Internal transfer prepared', 'Bank Statement Line', bankLineId, '', {
      transferGroupId: groupId,
      transactionIds: [sourceTransactionId, otherTransactionId],
      destinationAccountId: destinationAccountId,
      amount: amount
    }, 'Finance Officer prepared both sides of an internal transfer');
    return { ok: true, transferGroupId: groupId, transactionIds: [sourceTransactionId, otherTransactionId] };
  } finally {
    lock.releaseLock();
  }
}

function finalizeBankLineMatchForPublishedTransaction_(transaction) {
  var bankLineId = getSourceBankLineIdFromTransaction_(transaction);
  if (!bankLineId || isTransactionMatched_(transaction['Transaction ID'])) {
    return;
  }

  var bankLineSheet = getSheetByName('Bank Statement Lines');
  var bankLine = findRecordByValue(bankLineSheet, 'Bank Line ID', bankLineId, false);
  if (!bankLine) {
    return;
  }

  var matchId = getNextId_('Transaction Matches', 'MAT');
  appendSafeRow_(getSheetByName('Transaction Matches'), [
    matchId,
    bankLineId,
    transaction['Transaction ID'],
    MATCH_STATUS.MATCHED,
    transaction['Reviewed By'],
    nowIso(),
    'Auto-matched after Publisher approval'
  ]);

  updateRecordByHeaders(getSheetByName('Transactions'), transaction._rowNumber, {
    Status: TRANSACTION_STATUS.RECONCILED,
    'Updated At': nowIso()
  });

  if (isBankLineFullyCategorised_(bankLineId, bankLine)) {
    updateRecordByHeaders(bankLineSheet, bankLine._rowNumber, {
      Status: MATCH_STATUS.MATCHED,
      Notes: 'Fully categorised and published.',
      'Updated At': nowIso()
    });
  }
}

function isBankLineFullyCategorised_(bankLineId, bankLine) {
  var bankAmount = Math.abs(getBankLineSignedAmount_(bankLine));
  var signedBankAmount = getBankLineSignedAmount_(bankLine);
  var total = 0;
  var hasWaitingRecord = false;

  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    if (getSourceBankLineIdFromTransaction_(transaction) !== bankLineId) {
      return;
    }
    if (transaction.Status === TRANSACTION_STATUS.SUBMITTED) {
      hasWaitingRecord = true;
      return;
    }
    if (transaction.Status === TRANSACTION_STATUS.APPROVED || transaction.Status === TRANSACTION_STATUS.RECONCILED) {
      total += parseMoney_(transaction.Amount);
    }
  });

  return !hasWaitingRecord && Math.abs(total - bankAmount) <= 0.01 && Math.abs(signedBankAmount) > 0;
}

function hasWaitingTransactionsForBankLine_(bankLineId) {
  return getSheetRecords(getSheetByName('Transactions')).some(function(transaction) {
    return getSourceBankLineIdFromTransaction_(transaction) === bankLineId
      && transaction.Status === TRANSACTION_STATUS.SUBMITTED;
  });
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
  var first;
  var second;
  try {
    first = parseAppDate_(a);
    second = parseAppDate_(b);
  } catch (error) {
    return 9999;
  }
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

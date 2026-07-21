var TRANSACTION_STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Ready to Publish',
  APPROVED: 'Published',
  REJECTED: 'Sent Back',
  RECONCILED: 'Reconciled',
  REVERSED: 'Reversed'
};

var TRANSACTION_TYPES = {
  MONEY_IN: 'Money In',
  MONEY_OUT: 'Money Out',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out'
};

function isPublishedTransactionStatus_(status) {
  return status === TRANSACTION_STATUS.APPROVED || status === 'Approved' || status === TRANSACTION_STATUS.RECONCILED;
}

function isMoneyInType_(transactionType) {
  return transactionType === TRANSACTION_TYPES.MONEY_IN || transactionType === TRANSACTION_TYPES.TRANSFER_IN;
}

function isMoneyOutType_(transactionType) {
  return transactionType === TRANSACTION_TYPES.MONEY_OUT || transactionType === TRANSACTION_TYPES.TRANSFER_OUT;
}

function isInternalTransferType_(transactionType) {
  return transactionType === TRANSACTION_TYPES.TRANSFER_IN || transactionType === TRANSACTION_TYPES.TRANSFER_OUT;
}

function getFinanceData() {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);
  var isFinanceUser = hasAnyRole(user.roles, [ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);
  var approvedTransactions = getApprovedTransactions_();

  return {
    accounts: getActiveAccounts_(),
    categories: getActiveCategories_(),
    funds: getActiveFunds_(),
    approvedTransactions: approvedTransactions.slice(-100).reverse(),
    approvedTransactionCount: approvedTransactions.length,
    pendingTransactions: isFinanceUser ? getPendingTransactions_() : [],
    summary: getFinancialSummary_(),
    canEnterFinance: hasFinanceOfficerOrSystemAdmin(user.roles),
    canPublishFinance: hasAnyRole(user.roles, [ROLES.PUBLISHER, ROLES.REVIEWER]),
    canManageFinanceSettings: hasAnyRole(user.roles, [ROLES.SYSTEM_ADMIN])
  };
}

function addAccount(record) {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var clean = cleanAccountRecord_(record || {});
  validateRequired_(clean, ['Account Name', 'Account Type', 'Opening Balance', 'Currency']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheetByName('Accounts');
    var accountId = getNextId_('Accounts', 'ACC');
    var opening = parseMoney_(clean['Opening Balance']);
    var now = nowIso();

    appendSafeRow_(sheet, [
      accountId,
      clean['Account Name'],
      clean['Account Type'],
      opening,
      opening,
      clean.Currency || 'NGN',
      clean.Status || 'Active',
      clean['Masked Bank Account Number'],
      clean.Notes,
      now,
      now
    ]);

    safeWriteAuditLog_('Account created', 'Account', accountId, '', clean, 'System Administrator added account');
    return { ok: true, accountId: accountId };
  } finally {
    lock.releaseLock();
  }
}

function addFundProject(record) {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var clean = {
    name: String((record || {}).name || '').trim(),
    type: String((record || {}).type || 'General Association Fund').trim(),
    notes: String((record || {}).notes || '').trim()
  };
  if (!clean.name) {
    throw new Error('Fund or project name is required.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheetByName('Funds and Projects');
    var fundId = getNextId_('Funds and Projects', 'FND');
    var now = nowIso();
    appendSafeRow_(sheet, [fundId, clean.name, clean.type, 'Active', clean.notes, now, now]);
    safeWriteAuditLog_('Fund or project created', 'Fund', fundId, '', clean, 'System Administrator added fund or project');
    return { ok: true, fundId: fundId };
  } finally {
    lock.releaseLock();
  }
}

function addFinanceCategory(record) {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  return createFinanceCategory_(record, user, false);
}

function addStatementClassification(record) {
  var user = requireFinanceOfficerOrSystemAdmin();
  return createFinanceCategory_(record, user, true);
}

function createFinanceCategory_(record, user, reuseExisting) {
  var clean = {
    categoryType: String((record || {}).categoryType || '').trim(),
    categoryName: String((record || {}).categoryName || '').trim()
  };

  if (['Money In', 'Money Out'].indexOf(clean.categoryType) === -1) {
    throw new Error('Choose Money In or Money Out.');
  }
  if (!clean.categoryName) {
    throw new Error('Category name is required.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheetByName('Categories');
    var duplicate = getSheetRecords(sheet).filter(function(category) {
      return category['Category Type'] === clean.categoryType
        && category.Status === 'Active'
        && String(category['Category Name'] || '').trim().toLowerCase() === clean.categoryName.toLowerCase();
    })[0];
    if (duplicate) {
      if (reuseExisting) {
        return {
          ok: true,
          categoryId: duplicate['Category ID'],
          categoryType: duplicate['Category Type'],
          categoryName: duplicate['Category Name'],
          created: false
        };
      }
      throw new Error('This category already exists.');
    }
    var categoryId = getNextId_('Categories', 'CAT');
    var now = nowIso();
    appendSafeRow_(sheet, [
      categoryId,
      clean.categoryType,
      clean.categoryName,
      'Active',
      now,
      now
    ]);

    safeWriteAuditLog_('Finance category created', 'Category', categoryId, '', clean, reuseExisting ? 'Finance Officer added classification during statement review' : 'System Administrator added finance category');
    return {
      ok: true,
      categoryId: categoryId,
      categoryType: clean.categoryType,
      categoryName: clean.categoryName,
      created: true
    };
  } finally {
    lock.releaseLock();
  }
}

function recordMoneyIn(record) {
  return createTransaction_(record, TRANSACTION_TYPES.MONEY_IN);
}

function recordMoneyOut(record) {
  return createTransaction_(record, TRANSACTION_TYPES.MONEY_OUT);
}

function publishTransaction(transactionId, decision, reason) {
  var user = requireAnyRole([ROLES.PUBLISHER, ROLES.REVIEWER]);
  var normalizedDecision = String(decision || '').trim();
  if (['Published', 'Sent Back'].indexOf(normalizedDecision) === -1) {
    throw new Error('Decision must be Published or Sent Back.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheetByName('Transactions');
    var transaction = findRecordByValue(sheet, 'Transaction ID', transactionId, false);
    if (!transaction) {
      throw new Error('Transaction not found.');
    }
    if (transaction.Status !== TRANSACTION_STATUS.SUBMITTED) {
      throw new Error('Only transactions ready to publish can be published or sent back.');
    }
    if (transaction['Correction Batch ID']) {
      throw new Error('This correction must be reviewed as one complete correction batch.');
    }
    if (transaction['Transfer Group ID']) {
      throw new Error('This internal transfer must be reviewed as one complete transfer group.');
    }
    if (normalizeEmail(transaction['Entered By']) === user.email) {
      throw new Error('You cannot publish a transaction you entered.');
    }
    if (normalizedDecision === TRANSACTION_STATUS.APPROVED) {
      assertAccountingPeriodOpen_(transaction['Account ID'], transaction.Date);
    }

    var publisherNote = String(reason || '').trim();
    var sourceBankLineId = getSourceBankLineIdFromTransaction_(transaction);
    var storedReason = sourceBankLineId
      ? String(transaction.Reason || '').trim() + (publisherNote ? ' | Publisher note: ' + publisherNote : '')
      : publisherNote;
    var updates = {
      Status: normalizedDecision,
      'Reviewed By': user.email,
      'Reviewed At': nowIso(),
      Reason: storedReason,
      'Updated At': nowIso()
    };
    updateRecordByHeaders(sheet, transaction._rowNumber, updates);

    if (normalizedDecision === TRANSACTION_STATUS.APPROVED) {
      transaction.Status = normalizedDecision;
      transaction['Reviewed By'] = user.email;
      transaction.Reason = storedReason;
      try {
        finalizeBankLineMatchForPublishedTransaction_(transaction);
      } catch (matchError) {
        console.error('Published transaction bank matching needs recovery: ' + matchError.message);
        markSourceBankLineNeedsReviewAfterSendBack_(transaction, 'Published, but automatic matching needs administrator review.');
      }
      applyTransactionToAccountBalance_(transaction);
      safeWriteAuditLog_('Transaction published', 'Transaction', transactionId, transaction, updates, reason || 'Publisher published transaction');
    } else {
      transaction.Reason = storedReason;
      markSourceBankLineNeedsReviewAfterSendBack_(transaction, reason);
      safeWriteAuditLog_('Transaction sent back', 'Transaction', transactionId, transaction, updates, reason || 'Publisher sent transaction back');
    }

    return { ok: true, transactionId: transactionId, status: normalizedDecision };
  } finally {
    lock.releaseLock();
  }
}

function markSourceBankLineNeedsReviewAfterSendBack_(transaction, reason) {
  var bankLineId = getSourceBankLineIdFromTransaction_(transaction);
  if (!bankLineId) {
    return;
  }
  var sheet = getSheetByName('Bank Statement Lines');
  var bankLine = findRecordByValue(sheet, 'Bank Line ID', bankLineId, false);
  if (!bankLine) {
    return;
  }
  updateRecordByHeaders(sheet, bankLine._rowNumber, {
    Status: MATCH_STATUS.NEEDS_REVIEW,
    Notes: 'Publisher sent back a category record. ' + String(reason || '').trim(),
    'Updated At': nowIso()
  });
}

function uploadFinanceDocument(fileData) {
  var user = requireFinanceOfficerOrSystemAdmin();
  fileData = fileData || {};

  var fileName = String(fileData.fileName || '').trim();
  var mimeType = String(fileData.mimeType || '').trim();
  var base64 = String(fileData.base64 || '');
  var visibility = String(fileData.visibility || 'Finance Only').trim();

  if (!fileName || !base64) {
    throw new Error('Please choose a receipt or proof file.');
  }
  if (['application/pdf', 'image/jpeg', 'image/png'].indexOf(mimeType) === -1) {
    throw new Error('Only PDF, JPG, and PNG files are allowed.');
  }
  if (['Finance Only', 'Members'].indexOf(visibility) === -1) {
    throw new Error('Document visibility is not valid.');
  }

  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error('File is too large. Maximum size is 5 MB.');
  }
  validateFinanceDocumentSignature_(fileName, mimeType, bytes);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var folder = DriveApp.getFolderById(getSettingValue_(SETTINGS_KEYS.RECEIPTS_FOLDER_ID));
    var blob = Utilities.newBlob(bytes, mimeType, fileName);
    var file = folder.createFile(blob);
    var documentId = getNextId_('Documents', 'DOC');

    appendSafeRow_(getSheetByName('Documents'), [
      documentId,
      file.getId(),
      fileName,
      'Receipt or Proof',
      visibility,
      '',
      '',
      user.email,
      nowIso(),
      ''
    ]);

    safeWriteAuditLog_('Document uploaded', 'Document', documentId, '', { fileName: fileName, visibility: visibility }, 'Finance document uploaded');
    return { ok: true, documentId: documentId, fileId: file.getId(), fileName: fileName };
  } finally {
    lock.releaseLock();
  }
}

function validateFinanceDocumentSignature_(fileName, mimeType, bytes) {
  var lower = String(fileName || '').toLowerCase();
  var unsigned = (bytes || []).slice(0, 16).map(function(value) { return value < 0 ? value + 256 : value; });
  if (mimeType === 'application/pdf') {
    if (!/\.pdf$/.test(lower) || !bytesContainAscii_((bytes || []).slice(0, 1024).map(function(value) { return value < 0 ? value + 256 : value; }), '%PDF')) {
      throw new Error('The selected file is not a valid PDF.');
    }
    return;
  }
  if (mimeType === 'image/jpeg') {
    if (!/\.(jpg|jpeg)$/.test(lower) || unsigned[0] !== 255 || unsigned[1] !== 216 || unsigned[2] !== 255) {
      throw new Error('The selected file is not a valid JPG image.');
    }
    return;
  }
  if (mimeType === 'image/png') {
    if (!/\.png$/.test(lower) || unsigned[0] !== 137 || unsigned[1] !== 80 || unsigned[2] !== 78 || unsigned[3] !== 71) {
      throw new Error('The selected file is not a valid PNG image.');
    }
  }
}

function createTransaction_(record, transactionType) {
  var user = requireFinanceOfficerOrSystemAdmin();
  var clean = cleanTransactionRecord_(record || {});
  var payerPayeeField = transactionType === TRANSACTION_TYPES.MONEY_IN ? 'Source or payer' : 'Payee';

  validateRequired_(clean, ['Date', 'Amount', 'Account ID', 'Category ID', 'Description']);
  if (transactionType === TRANSACTION_TYPES.MONEY_OUT && !clean['Payer or Payee']) {
    throw new Error('Payee is required.');
  }

  var amount = parseMoney_(clean.Amount);
  if (amount <= 0) {
    throw new Error('Amount must be greater than zero.');
  }

  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', clean['Account ID'], false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Please choose an active account.');
  }
  assertAccountingPeriodOpen_(clean['Account ID'], clean.Date);

  var category = findRecordByValue(getSheetByName('Categories'), 'Category ID', clean['Category ID'], false);
  if (!category || category.Status !== 'Active' || category['Category Type'] !== transactionType) {
    throw new Error('Please choose a valid category.');
  }
  validateOptionalFund_(clean['Fund ID']);
  validateOptionalDocument_(clean['Document ID']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    assertAccountingPeriodOpen_(clean['Account ID'], clean.Date);
    var sheet = getSheetByName('Transactions');
    var transactionId = getNextId_('Transactions', 'TXN');
    var now = nowIso();
    appendRecordByHeaders_(sheet, {
      'Transaction ID': transactionId,
      'Transaction Type': transactionType,
      Date: clean.Date,
      Amount: amount,
      'Account ID': clean['Account ID'],
      'Payer or Payee': clean['Payer or Payee'],
      'Category ID': clean['Category ID'],
      Description: clean.Description,
      'Reference Number': clean['Reference Number'],
      'Payment Method': clean['Payment Method'],
      'Fund ID': clean['Fund ID'],
      'Document ID': clean['Document ID'],
      'Entered By': user.email,
      Status: TRANSACTION_STATUS.SUBMITTED,
      'Submitted At': now,
      Reason: clean.Reason,
      'Created At': now,
      'Updated At': now
    });
    if (clean['Document ID']) {
      linkDocumentToRecord_(clean['Document ID'], 'Transaction', transactionId, 'Receipt or proof for ' + transactionId);
    }

    safeWriteAuditLog_('Transaction ready to publish', 'Transaction', transactionId, '', clean, payerPayeeField + ' transaction marked ready to publish');
    return { ok: true, transactionId: transactionId, status: TRANSACTION_STATUS.SUBMITTED };
  } finally {
    lock.releaseLock();
  }
}

function getFinancialSummary_() {
  var accounts = getActiveAccounts_();
  var approvedTransactions = getApprovedTransactions_();
  var now = new Date();
  var month = now.getMonth();
  var year = now.getFullYear();

  var summary = {
    totalFunds: 0,
    bankBalance: 0,
    cashAtHand: 0,
    moneyInThisMonth: 0,
    moneyOutThisMonth: 0,
    moneyInThisYear: 0,
    moneyOutThisYear: 0,
    lastUpdated: nowIso(),
    unclassifiedBankLines: 0,
    quarantinedDuplicates: 0,
    currencyTotals: {},
    mixedCurrencies: false
  };

  getSheetRecords(getSheetByName('Bank Statement Lines')).forEach(function(line) {
    if (line.Status === 'Duplicate Quarantined') {
      summary.quarantinedDuplicates++;
    } else if ([MATCH_STATUS.MATCHED, MATCH_STATUS.READY_TO_PUBLISH, MATCH_STATUS.INTERNAL_TRANSFER].indexOf(line.Status) === -1) {
      summary.unclassifiedBankLines++;
    }
  });

  accounts.forEach(function(account) {
    var balance = parseMoney_(account.currentBalance);
    var currency = account.currency || 'NGN';
    summary.currencyTotals[currency] = Math.round(((summary.currencyTotals[currency] || 0) + balance) * 100) / 100;
    summary.totalFunds += balance;
    if (account.accountType === 'Bank Account') {
      summary.bankBalance += balance;
    }
    if (account.accountType === 'Cash at Hand') {
      summary.cashAtHand += balance;
    }
  });
  summary.mixedCurrencies = Object.keys(summary.currencyTotals).length > 1;

  approvedTransactions.forEach(function(transaction) {
    var date = parseAppDate_(transaction.date);
    var amount = parseMoney_(transaction.amount);
    if (isInternalTransferType_(transaction.transactionType)) {
      return;
    }
    if (date.getFullYear() === year) {
      if (transaction.transactionType === TRANSACTION_TYPES.MONEY_IN) {
        summary.moneyInThisYear += amount;
      } else {
        summary.moneyOutThisYear += amount;
      }
    }
    if (date.getFullYear() === year && date.getMonth() === month) {
      if (transaction.transactionType === TRANSACTION_TYPES.MONEY_IN) {
        summary.moneyInThisMonth += amount;
      } else {
        summary.moneyOutThisMonth += amount;
      }
    }
  });

  return summary;
}

function getActiveAccounts_() {
  var transactionRecords = getSheetRecords(getSheetByName('Transactions'));
  return getSheetRecords(getSheetByName('Accounts'))
    .filter(function(account) {
      return account.Status === 'Active';
    })
    .map(function(account) {
      return {
        accountId: account['Account ID'],
        accountName: account['Account Name'],
        accountType: account['Account Type'],
        openingBalance: parseMoney_(account['Opening Balance']),
        currentBalance: calculateDerivedAccountBalance_(account['Account ID'], parseMoney_(account['Opening Balance']), transactionRecords),
        currency: account.Currency || 'NGN',
        maskedBankAccountNumber: account['Masked Bank Account Number'],
        notes: account.Notes || '',
        lockedThrough: getAccountingLockDate_(account['Account ID'])
      };
    });
}

function getActiveCategories_() {
  return getSheetRecords(getSheetByName('Categories'))
    .filter(function(category) {
      return category.Status === 'Active';
    })
    .map(function(category) {
      return {
        categoryId: category['Category ID'],
        categoryType: category['Category Type'],
        categoryName: category['Category Name']
      };
    });
}

function getActiveFunds_() {
  return getSheetRecords(getSheetByName('Funds and Projects'))
    .filter(function(fund) {
      return fund.Status === 'Active';
    })
    .map(function(fund) {
      return {
        fundId: fund['Fund ID'],
        fundName: fund['Fund or Project Name'],
        type: fund.Type
      };
    });
}

function getApprovedTransactions_() {
  return getSheetRecords(getSheetByName('Transactions'))
    .filter(function(transaction) {
      return isPublishedTransactionStatus_(transaction.Status);
    })
    .map(sanitizeTransactionForDisplay_);
}

function getPendingTransactions_() {
  var bankLines = {};
  getSheetRecords(getSheetByName('Bank Statement Lines')).forEach(function(line) { bankLines[line['Bank Line ID']] = line; });
  return getSheetRecords(getSheetByName('Transactions'))
    .filter(function(transaction) {
      return transaction.Status === TRANSACTION_STATUS.SUBMITTED || transaction.Status === 'Submitted for Review';
    })
    .map(function(transaction) {
      var clean = sanitizeTransactionForDisplay_(transaction);
      var sourceId = clean.sourceBankLineId;
      var line = bankLines[sourceId];
      if (line) {
        clean.sourceBankLine = {
          bankLineId: sourceId,
          description: line.Description,
          referenceNumber: line['Reference Number'],
          runningBalance: parseMoney_(line['Running Balance']),
          confidence: line['Extraction Confidence'],
          documentId: line['Document ID']
        };
      }
      return clean;
    });
}

function sanitizeTransactionForDisplay_(transaction) {
  return {
    transactionId: transaction['Transaction ID'],
    transactionType: transaction['Transaction Type'],
    date: formatDateOnly_(transaction.Date),
    amount: parseMoney_(transaction.Amount),
    accountId: transaction['Account ID'],
    payerOrPayee: transaction['Payer or Payee'],
    categoryId: transaction['Category ID'],
    description: transaction.Description,
    referenceNumber: transaction['Reference Number'],
    paymentMethod: transaction['Payment Method'],
    fundId: transaction['Fund ID'],
    documentId: transaction['Document ID'],
    enteredBy: transaction['Entered By'],
    status: transaction.Status,
    submittedAt: transaction['Submitted At'],
    reviewedBy: transaction['Reviewed By'],
    reviewedAt: transaction['Reviewed At'],
    sourceBankLineId: transaction['Source Bank Line ID'] || getSourceBankLineIdFromTransaction_(transaction),
    transferGroupId: transaction['Transfer Group ID'],
    correctionForTransactionId: transaction['Correction For Transaction ID'],
    correctionBatchId: transaction['Correction Batch ID'],
    correctionAction: transaction['Correction Action']
  };
}

function applyTransactionToAccountBalance_(transaction) {
  var accountsSheet = getSheetByName('Accounts');
  var account = findRecordByValue(accountsSheet, 'Account ID', transaction['Account ID'], false);
  if (!account) {
    throw new Error('Transaction account was not found.');
  }

  var nextBalance = calculateDerivedAccountBalance_(account['Account ID'], parseMoney_(account['Opening Balance']), getSheetRecords(getSheetByName('Transactions')));

  updateRecordByHeaders(accountsSheet, account._rowNumber, {
    'Current Balance': nextBalance,
    'Updated At': nowIso()
  });
}

function calculateDerivedAccountBalance_(accountId, openingBalance, transactionRecords) {
  var balance = parseMoney_(openingBalance);
  (transactionRecords || []).forEach(function(transaction) {
    if (transaction['Account ID'] !== accountId || !isPublishedTransactionStatus_(transaction.Status)) {
      return;
    }
    var amount = parseMoney_(transaction.Amount);
    if (isMoneyInType_(transaction['Transaction Type'])) {
      balance += amount;
    } else if (isMoneyOutType_(transaction['Transaction Type'])) {
      balance -= amount;
    }
  });
  return Math.round(balance * 100) / 100;
}

function rebuildAccountBalances() {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var accountsSheet = getSheetByName('Accounts');
    var transactions = getSheetRecords(getSheetByName('Transactions'));
    var updated = [];
    getSheetRecords(accountsSheet).forEach(function(account) {
      var balance = calculateDerivedAccountBalance_(account['Account ID'], account['Opening Balance'], transactions);
      updateRecordByHeaders(accountsSheet, account._rowNumber, { 'Current Balance': balance, 'Updated At': nowIso() });
      updated.push({ accountId: account['Account ID'], balance: balance });
    });
    safeWriteAuditLog_('Account balances rebuilt', 'System', 'ACCOUNTS', '', updated, 'System Administrator verified derived balances');
    return { ok: true, accounts: updated, rebuiltBy: user.email };
  } finally {
    lock.releaseLock();
  }
}

function prepareTransactionCorrection(transactionId, replacement, reason) {
  var user = requireFinanceOfficerOrSystemAdmin();
  requireCurrentSchema_();
  reason = String(reason || '').trim();
  if (!reason) {
    throw new Error('Explain why this published record needs correction.');
  }
  var sheet = getSheetByName('Transactions');
  var original = findRecordByValue(sheet, 'Transaction ID', transactionId, false);
  if (!original || !isPublishedTransactionStatus_(original.Status)) {
    throw new Error('Choose a published transaction to correct.');
  }
  if (isInternalTransferType_(original['Transaction Type'])) {
    throw new Error('Internal transfers must be corrected through their linked transfer records.');
  }
  var alreadyPending = getSheetRecords(sheet).some(function(transaction) {
    return transaction['Correction For Transaction ID'] === transactionId
      && transaction.Status === TRANSACTION_STATUS.SUBMITTED;
  });
  if (alreadyPending) {
    throw new Error('A correction for this transaction is already waiting for Publisher review.');
  }

  replacement = replacement || {};
  var replacementType = String(replacement['Transaction Type'] || original['Transaction Type']).trim();
  if ([TRANSACTION_TYPES.MONEY_IN, TRANSACTION_TYPES.MONEY_OUT].indexOf(replacementType) === -1) {
    throw new Error('Choose Money In or Money Out for the corrected record.');
  }
  var clean = cleanTransactionRecord_({
    Date: replacement.Date || formatDateOnly_(original.Date),
    Amount: replacement.Amount || original.Amount,
    'Account ID': replacement['Account ID'] || original['Account ID'],
    'Payer or Payee': Object.prototype.hasOwnProperty.call(replacement, 'Payer or Payee') ? replacement['Payer or Payee'] : original['Payer or Payee'],
    'Category ID': replacement['Category ID'] || original['Category ID'],
    Description: replacement.Description || original.Description,
    'Reference Number': Object.prototype.hasOwnProperty.call(replacement, 'Reference Number') ? replacement['Reference Number'] : original['Reference Number'],
    'Payment Method': replacement['Payment Method'] || original['Payment Method'],
    'Fund ID': Object.prototype.hasOwnProperty.call(replacement, 'Fund ID') ? replacement['Fund ID'] : original['Fund ID'],
    'Document ID': Object.prototype.hasOwnProperty.call(replacement, 'Document ID') ? replacement['Document ID'] : original['Document ID'],
    Reason: reason
  });
  validateRequired_(clean, ['Date', 'Amount', 'Account ID', 'Category ID', 'Description']);
  var amount = parseMoney_(clean.Amount);
  if (amount <= 0) {
    throw new Error('Corrected amount must be greater than zero.');
  }
  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', clean['Account ID'], false);
  var category = findRecordByValue(getSheetByName('Categories'), 'Category ID', clean['Category ID'], false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Choose an active account.');
  }
  assertAccountingPeriodOpen_(clean['Account ID'], clean.Date);
  if (!category || category.Status !== 'Active' || category['Category Type'] !== replacementType) {
    throw new Error('Choose a category that matches the corrected transaction type.');
  }
  validateOptionalFund_(clean['Fund ID']);
  validateOptionalDocument_(clean['Document ID']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    original = findRecordByValue(sheet, 'Transaction ID', transactionId, false);
    if (!original || !isPublishedTransactionStatus_(original.Status)) {
      throw new Error('The original transaction changed. Refresh and try again.');
    }
    if (getSheetRecords(sheet).some(function(transaction) {
      return transaction['Correction For Transaction ID'] === transactionId
        && transaction.Status === TRANSACTION_STATUS.SUBMITTED;
    })) {
      throw new Error('A correction for this transaction is already waiting for Publisher review.');
    }
    assertAccountingPeriodOpen_(original['Account ID'], clean.Date);
    assertAccountingPeriodOpen_(clean['Account ID'], clean.Date);
    var nextSequence = Number(getNextId_('Transactions', 'TXN').split('-')[1]);
    var reversalId = makeId('TXN', nextSequence++);
    var replacementId = makeId('TXN', nextSequence++);
    var batchId = 'COR-' + Utilities.getUuid().split('-')[0].toUpperCase();
    var now = nowIso();
    var reversalType = original['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN ? TRANSACTION_TYPES.MONEY_OUT : TRANSACTION_TYPES.MONEY_IN;
    var common = {
      'Account ID': original['Account ID'],
      'Payer or Payee': original['Payer or Payee'],
      'Reference Number': original['Reference Number'],
      'Payment Method': 'Correction',
      'Fund ID': original['Fund ID'],
      'Document ID': original['Document ID'],
      'Entered By': user.email,
      Status: TRANSACTION_STATUS.SUBMITTED,
      'Submitted At': now,
      'Correction For Transaction ID': transactionId,
      Reason: reason,
      'Created At': now,
      'Updated At': now,
      'Correction Batch ID': batchId
    };
    var reversal = Object.assign({}, common, {
      'Transaction ID': reversalId,
      'Transaction Type': reversalType,
      Date: clean.Date,
      Amount: parseMoney_(original.Amount),
      'Category ID': original['Category ID'],
      Description: 'Reversal of ' + transactionId + ': ' + original.Description,
      'Correction Action': 'Reversal'
    });
    var corrected = Object.assign({}, common, {
      'Transaction ID': replacementId,
      'Transaction Type': replacementType,
      Date: clean.Date,
      Amount: amount,
      'Account ID': clean['Account ID'],
      'Payer or Payee': clean['Payer or Payee'],
      'Category ID': clean['Category ID'],
      Description: clean.Description,
      'Reference Number': clean['Reference Number'],
      'Payment Method': clean['Payment Method'] || 'Correction',
      'Fund ID': clean['Fund ID'],
      'Document ID': clean['Document ID'],
      'Correction Action': 'Replacement'
    });
    var rows = [makeRowForHeaders_(sheet, reversal), makeRowForHeaders_(sheet, corrected)];
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    safeWriteAuditLog_('Transaction correction prepared', 'Correction Batch', batchId, original, {
      originalTransactionId: transactionId,
      reversalTransactionId: reversalId,
      replacementTransactionId: replacementId,
      reason: reason
    }, 'Finance Officer prepared a visible reversal and replacement');
    return { ok: true, correctionBatchId: batchId, transactionIds: [reversalId, replacementId] };
  } finally {
    lock.releaseLock();
  }
}

function publishCorrectionBatch(batchId, decision, reason) {
  var user = requireAnyRole([ROLES.PUBLISHER, ROLES.REVIEWER]);
  batchId = String(batchId || '').trim();
  decision = String(decision || '').trim();
  if (['Published', 'Sent Back'].indexOf(decision) === -1) {
    throw new Error('Decision must be Published or Sent Back.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheetByName('Transactions');
    var records = getSheetRecords(sheet).filter(function(transaction) {
      return transaction['Correction Batch ID'] === batchId;
    });
    if (records.length !== 2 || records.some(function(transaction) { return transaction.Status !== TRANSACTION_STATUS.SUBMITTED; })) {
      throw new Error('This correction batch is incomplete or has already been reviewed.');
    }
    if (records.some(function(transaction) { return normalizeEmail(transaction['Entered By']) === user.email; })) {
      throw new Error('You cannot publish a correction you prepared.');
    }
    if (decision === TRANSACTION_STATUS.APPROVED) {
      records.forEach(function(transaction) {
        assertAccountingPeriodOpen_(transaction['Account ID'], transaction.Date);
      });
    }
    var now = nowIso();
    records.forEach(function(transaction) {
      updateRecordByHeaders(sheet, transaction._rowNumber, {
        Status: decision,
        'Reviewed By': user.email,
        'Reviewed At': now,
        Reason: String(transaction.Reason || '') + (reason ? ' | Publisher note: ' + String(reason).trim() : ''),
        'Updated At': now
      });
    });
    if (decision === TRANSACTION_STATUS.APPROVED) {
      var accountIds = {};
      records.forEach(function(transaction) { accountIds[transaction['Account ID']] = true; });
      Object.keys(accountIds).forEach(function(accountId) {
        applyTransactionToAccountBalance_({ 'Account ID': accountId });
      });
    }
    safeWriteAuditLog_('Correction batch ' + decision.toLowerCase(), 'Correction Batch', batchId, records, {
      status: decision,
      reviewedBy: user.email
    }, reason || 'Publisher reviewed the complete correction');
    return { ok: true, correctionBatchId: batchId, status: decision };
  } finally {
    lock.releaseLock();
  }
}

function publishTransferGroup(groupId, decision, reason) {
  var user = requireAnyRole([ROLES.PUBLISHER, ROLES.REVIEWER]);
  groupId = String(groupId || '').trim();
  decision = String(decision || '').trim();
  if (['Published', 'Sent Back'].indexOf(decision) === -1) {
    throw new Error('Decision must be Published or Sent Back.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheetByName('Transactions');
    var records = getSheetRecords(sheet).filter(function(transaction) { return transaction['Transfer Group ID'] === groupId; });
    if (records.length !== 2 || records.some(function(transaction) { return transaction.Status !== TRANSACTION_STATUS.SUBMITTED; })) {
      throw new Error('This transfer group is incomplete or has already been reviewed.');
    }
    if (records.some(function(transaction) { return normalizeEmail(transaction['Entered By']) === user.email; })) {
      throw new Error('You cannot publish an internal transfer you prepared.');
    }
    if (decision === TRANSACTION_STATUS.APPROVED) {
      records.forEach(function(transaction) {
        assertAccountingPeriodOpen_(transaction['Account ID'], transaction.Date);
      });
    }
    var now = nowIso();
    records.forEach(function(transaction) {
      updateRecordByHeaders(sheet, transaction._rowNumber, {
        Status: decision,
        'Reviewed By': user.email,
        'Reviewed At': now,
        Reason: String(transaction.Reason || '') + (reason ? ' | Publisher note: ' + String(reason).trim() : ''),
        'Updated At': now
      });
      transaction.Status = decision;
      transaction['Reviewed By'] = user.email;
    });
    if (decision === TRANSACTION_STATUS.APPROVED) {
      records.forEach(function(transaction) {
        if (getSourceBankLineIdFromTransaction_(transaction)) {
          try {
            finalizeBankLineMatchForPublishedTransaction_(transaction);
          } catch (matchError) {
            console.error('Published transfer needs matching recovery: ' + matchError.message);
            markSourceBankLineNeedsReviewAfterSendBack_(transaction, 'Published, but automatic transfer matching needs administrator review.');
          }
        }
      });
      var accountIds = {};
      records.forEach(function(transaction) { accountIds[transaction['Account ID']] = true; });
      Object.keys(accountIds).forEach(function(accountId) { applyTransactionToAccountBalance_({ 'Account ID': accountId }); });
    } else {
      records.forEach(function(transaction) { markSourceBankLineNeedsReviewAfterSendBack_(transaction, reason); });
    }
    safeWriteAuditLog_('Internal transfer ' + decision.toLowerCase(), 'Transfer Group', groupId, records, {
      status: decision,
      reviewedBy: user.email
    }, reason || 'Publisher reviewed both sides of the internal transfer');
    return { ok: true, transferGroupId: groupId, status: decision };
  } finally {
    lock.releaseLock();
  }
}

function publishTransactionsBatch(transactionIds, decision, reason) {
  var user = requireAnyRole([ROLES.PUBLISHER, ROLES.REVIEWER]);
  transactionIds = Array.isArray(transactionIds) ? transactionIds.map(String) : [];
  decision = String(decision || '').trim();
  if (!transactionIds.length) {
    throw new Error('Select at least one ordinary transaction.');
  }
  if (transactionIds.length > 100) {
    throw new Error('Review no more than 100 transactions in one batch.');
  }
  if (['Published', 'Sent Back'].indexOf(decision) === -1) {
    throw new Error('Decision must be Published or Sent Back.');
  }
  var idLookup = {};
  transactionIds.forEach(function(id) { idLookup[id] = true; });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = getSheetByName('Transactions');
    var records = getSheetRecords(sheet).filter(function(transaction) { return idLookup[transaction['Transaction ID']]; });
    if (records.length !== Object.keys(idLookup).length) {
      throw new Error('One or more selected transactions could not be found. Refresh and try again.');
    }
    records.forEach(function(transaction) {
      if (transaction.Status !== TRANSACTION_STATUS.SUBMITTED) {
        throw new Error(transaction['Transaction ID'] + ' has already been reviewed.');
      }
      if (transaction['Correction Batch ID'] || transaction['Transfer Group ID']) {
        throw new Error(transaction['Transaction ID'] + ' belongs to a linked group and must be reviewed with that group.');
      }
      if (normalizeEmail(transaction['Entered By']) === user.email) {
        throw new Error('You cannot publish ' + transaction['Transaction ID'] + ' because you entered it.');
      }
      if (decision === TRANSACTION_STATUS.APPROVED) {
        assertAccountingPeriodOpen_(transaction['Account ID'], transaction.Date);
      }
    });
    var now = nowIso();
    var accountIds = {};
    records.forEach(function(transaction) {
      updateRecordByHeaders(sheet, transaction._rowNumber, {
        Status: decision,
        'Reviewed By': user.email,
        'Reviewed At': now,
        Reason: String(transaction.Reason || '') + (reason ? ' | Publisher batch note: ' + String(reason).trim() : ''),
        'Updated At': now
      });
      transaction.Status = decision;
      transaction['Reviewed By'] = user.email;
      if (decision === TRANSACTION_STATUS.APPROVED) {
        try {
          finalizeBankLineMatchForPublishedTransaction_(transaction);
        } catch (matchError) {
          console.error('Batch-published transaction needs matching recovery: ' + matchError.message);
          markSourceBankLineNeedsReviewAfterSendBack_(transaction, 'Published, but automatic matching needs administrator review.');
        }
        accountIds[transaction['Account ID']] = true;
      } else {
        markSourceBankLineNeedsReviewAfterSendBack_(transaction, reason);
      }
    });
    Object.keys(accountIds).forEach(function(accountId) { applyTransactionToAccountBalance_({ 'Account ID': accountId }); });
    safeWriteAuditLog_('Transactions batch ' + decision.toLowerCase(), 'Transaction Batch', 'BATCH-' + now, '', {
      transactionIds: transactionIds,
      status: decision,
      reviewedBy: user.email
    }, reason || 'Publisher reviewed selected transactions as a batch');
    return { ok: true, count: records.length, status: decision };
  } finally {
    lock.releaseLock();
  }
}

function cleanTransactionRecord_(record) {
  return {
    Date: normalizeDateInput_(record.Date),
    Amount: String(record.Amount || '').trim(),
    'Account ID': String(record['Account ID'] || '').trim(),
    'Payer or Payee': String(record['Payer or Payee'] || '').trim(),
    'Category ID': String(record['Category ID'] || '').trim(),
    Description: String(record.Description || '').trim(),
    'Reference Number': String(record['Reference Number'] || '').trim(),
    'Payment Method': String(record['Payment Method'] || '').trim(),
    'Fund ID': String(record['Fund ID'] || '').trim(),
    'Document ID': String(record['Document ID'] || '').trim(),
    Reason: String(record.Reason || '').trim()
  };
}

function cleanAccountRecord_(record) {
  return {
    'Account Name': String(record['Account Name'] || '').trim(),
    'Account Type': String(record['Account Type'] || '').trim(),
    'Opening Balance': String(record['Opening Balance'] || '').trim(),
    Currency: String(record.Currency || 'NGN').trim(),
    Status: String(record.Status || 'Active').trim(),
    'Masked Bank Account Number': String(record['Masked Bank Account Number'] || '').trim(),
    Notes: String(record.Notes || '').trim()
  };
}

function validateRequired_(record, fields) {
  fields.forEach(function(field) {
    if (record[field] === undefined || record[field] === null || String(record[field]).trim() === '') {
      throw new Error(field + ' is required.');
    }
  });
}

function validateOptionalFund_(fundId) {
  fundId = String(fundId || '').trim();
  if (!fundId) {
    return;
  }
  var fund = findRecordByValue(getSheetByName('Funds and Projects'), 'Fund ID', fundId, false);
  if (!fund || fund.Status !== 'Active') {
    throw new Error('Please choose an active fund or project.');
  }
}

function validateOptionalDocument_(documentId) {
  documentId = String(documentId || '').trim();
  if (!documentId) {
    return;
  }
  if (!findRecordByValue(getSheetByName('Documents'), 'Document ID', documentId, false)) {
    throw new Error('The selected receipt or proof document could not be found.');
  }
}

function parseMoney_(value) {
  if (typeof value === 'number') {
    if (!isFinite(value)) {
      throw new Error('Amount must be a valid number.');
    }
    return Math.round(value * 100) / 100;
  }
  var raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw || raw === '-') {
    return 0;
  }
  var negative = /^\(.*\)$/.test(raw) || /^-/.test(raw) || /\bDR$/i.test(raw);
  raw = raw
    .replace(/[()]/g, '')
    .replace(/\b(?:NGN|N)\b/gi, '')
    .replace(/\u20A6/g, '')
    .replace(/\b(?:DR|CR)$/i, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/^-/, '');
  var number = Number(raw);
  if (isNaN(number)) {
    throw new Error('Amount must be a valid number.');
  }
  return Math.round((negative ? -number : number) * 100) / 100;
}

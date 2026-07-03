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
  MONEY_OUT: 'Money Out'
};

function getFinanceData() {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);
  var isFinanceUser = hasAnyRole(user.roles, [ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);

  return {
    accounts: getActiveAccounts_(),
    categories: getActiveCategories_(),
    funds: getActiveFunds_(),
    approvedTransactions: getApprovedTransactions_().slice(0, 50),
    pendingTransactions: isFinanceUser ? getPendingTransactions_() : [],
    summary: getFinancialSummary_(),
    canEnterFinance: hasAnyRole(user.roles, [ROLES.FINANCE_OFFICER]),
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
    var accountId = getNextId('Accounts', 'ACC');
    var opening = parseMoney_(clean['Opening Balance']);
    var now = nowIso();

    sheet.appendRow([
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

    writeAuditLog('Account created', 'Account', accountId, '', clean, 'System Administrator added account');
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
    var fundId = getNextId('Funds and Projects', 'FND');
    var now = nowIso();
    sheet.appendRow([fundId, clean.name, clean.type, 'Active', clean.notes, now, now]);
    writeAuditLog('Fund or project created', 'Fund', fundId, '', clean, 'System Administrator added fund or project');
    return { ok: true, fundId: fundId };
  } finally {
    lock.releaseLock();
  }
}

function addFinanceCategory(record) {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
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

  var sheet = getSheetByName('Categories');
  var duplicate = getSheetRecords(sheet).some(function(category) {
    return category['Category Type'] === clean.categoryType
      && String(category['Category Name'] || '').trim().toLowerCase() === clean.categoryName.toLowerCase();
  });
  if (duplicate) {
    throw new Error('This category already exists.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var categoryId = getNextId('Categories', 'CAT');
    var now = nowIso();
    sheet.appendRow([
      categoryId,
      clean.categoryType,
      clean.categoryName,
      'Active',
      now,
      now
    ]);

    writeAuditLog('Finance category created', 'Category', categoryId, '', clean, 'System Administrator added finance category');
    return { ok: true, categoryId: categoryId };
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
    if (normalizeEmail(transaction['Entered By']) === user.email) {
      throw new Error('You cannot publish a transaction you entered.');
    }

    var updates = {
      Status: normalizedDecision,
      'Reviewed By': user.email,
      'Reviewed At': nowIso(),
      Reason: String(reason || '').trim(),
      'Updated At': nowIso()
    };
    updateRecordByHeaders(sheet, transaction._rowNumber, updates);

    if (normalizedDecision === TRANSACTION_STATUS.APPROVED) {
      applyTransactionToAccountBalance_(transaction);
      writeAuditLog('Transaction published', 'Transaction', transactionId, transaction, updates, reason || 'Publisher published transaction');
    } else {
      writeAuditLog('Transaction sent back', 'Transaction', transactionId, transaction, updates, reason || 'Publisher sent transaction back');
    }

    return { ok: true, transactionId: transactionId, status: normalizedDecision };
  } finally {
    lock.releaseLock();
  }
}

function uploadFinanceDocument(fileData) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
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

  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > 5 * 1024 * 1024) {
    throw new Error('File is too large. Maximum size is 5 MB.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var folder = DriveApp.getFolderById(getSettingValue(SETTINGS_KEYS.RECEIPTS_FOLDER_ID));
    var blob = Utilities.newBlob(bytes, mimeType, fileName);
    var file = folder.createFile(blob);
    var documentId = getNextId('Documents', 'DOC');

    getSheetByName('Documents').appendRow([
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

    writeAuditLog('Document uploaded', 'Document', documentId, '', { fileName: fileName, visibility: visibility }, 'Finance document uploaded');
    return { ok: true, documentId: documentId, fileId: file.getId(), fileName: fileName };
  } finally {
    lock.releaseLock();
  }
}

function createTransaction_(record, transactionType) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
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

  var category = findRecordByValue(getSheetByName('Categories'), 'Category ID', clean['Category ID'], false);
  if (!category || category.Status !== 'Active' || category['Category Type'] !== transactionType) {
    throw new Error('Please choose a valid category.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheetByName('Transactions');
    var transactionId = getNextId('Transactions', 'TXN');
    var now = nowIso();
    sheet.appendRow([
      transactionId,
      transactionType,
      clean.Date,
      amount,
      clean['Account ID'],
      clean['Payer or Payee'],
      clean['Category ID'],
      clean.Description,
      clean['Reference Number'],
      clean['Payment Method'],
      clean['Fund ID'],
      clean['Document ID'],
      user.email,
      TRANSACTION_STATUS.SUBMITTED,
      now,
      '',
      '',
      '',
      clean.Reason,
      now,
      now
    ]);

    writeAuditLog('Transaction ready to publish', 'Transaction', transactionId, '', clean, payerPayeeField + ' transaction marked ready to publish');
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
    lastUpdated: nowIso()
  };

  accounts.forEach(function(account) {
    var balance = parseMoney_(account.currentBalance);
    summary.totalFunds += balance;
    if (account.accountType === 'Bank Account') {
      summary.bankBalance += balance;
    }
    if (account.accountType === 'Cash at Hand') {
      summary.cashAtHand += balance;
    }
  });

  approvedTransactions.forEach(function(transaction) {
    var date = new Date(transaction.date);
    var amount = parseMoney_(transaction.amount);
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
        currentBalance: parseMoney_(account['Current Balance']),
        currency: account.Currency || 'NGN',
        maskedBankAccountNumber: account['Masked Bank Account Number'],
        notes: account.Notes || ''
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
      return transaction.Status === TRANSACTION_STATUS.APPROVED || transaction.Status === 'Approved' || transaction.Status === TRANSACTION_STATUS.RECONCILED;
    })
    .map(sanitizeTransactionForDisplay_);
}

function getPendingTransactions_() {
  return getSheetRecords(getSheetByName('Transactions'))
    .filter(function(transaction) {
      return transaction.Status === TRANSACTION_STATUS.SUBMITTED || transaction.Status === 'Submitted for Review';
    })
    .map(sanitizeTransactionForDisplay_);
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
    reviewedAt: transaction['Reviewed At']
  };
}

function applyTransactionToAccountBalance_(transaction) {
  var accountsSheet = getSheetByName('Accounts');
  var account = findRecordByValue(accountsSheet, 'Account ID', transaction['Account ID'], false);
  if (!account) {
    throw new Error('Transaction account was not found.');
  }

  var currentBalance = parseMoney_(account['Current Balance']);
  var amount = parseMoney_(transaction.Amount);
  var nextBalance = transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN
    ? currentBalance + amount
    : currentBalance - amount;

  updateRecordByHeaders(accountsSheet, account._rowNumber, {
    'Current Balance': nextBalance,
    'Updated At': nowIso()
  });
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

function parseMoney_(value) {
  var number = Number(String(value || '0').replace(/,/g, ''));
  if (isNaN(number)) {
    throw new Error('Amount must be a valid number.');
  }
  return Math.round(number * 100) / 100;
}

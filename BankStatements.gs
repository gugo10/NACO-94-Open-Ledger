var BANK_IMPORT_STATUS = {
  PREVIEWED: 'Previewed',
  IMPORTED: 'Imported',
  DUPLICATE_WARNING: 'Duplicate Warning'
};

function previewBankCsv(fileData) {
  requireFinanceOfficerOrSystemAdmin();
  fileData = fileData || {};

  var fileName = String(fileData.fileName || '').trim();
  var base64 = String(fileData.base64 || '');
  if (!fileName || !base64) {
    throw new Error('Please choose a CSV file.');
  }
  if (!fileName.toLowerCase().match(/\.csv$/)) {
    throw new Error('Only CSV files are accepted here.');
  }

  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > 10 * 1024 * 1024) {
    throw new Error('File is too large. Maximum size is 10 MB.');
  }
  validateStatementFileSignature_(fileName, bytes);
  var content = Utilities.newBlob(bytes).getDataAsString().replace(/^\uFEFF/, '');
  var rows = parseDelimitedStatement_(content);
  if (!rows.length || rows.length < 2) {
    throw new Error('CSV file has no statement lines.');
  }

  var headers = rows[0].map(function(header) {
    return String(header || '').trim();
  });
  var previewRows = rows.slice(1, 11);

  return {
    fileName: fileName,
    headers: headers,
    suggestedMapping: suggestCsvMapping_(headers),
    previewRows: previewRows,
    rowCount: rows.length - 1,
    rawBase64: base64
  };
}

function importBankCsv(payload) {
  var user = requireFinanceOfficerOrSystemAdmin();
  payload = payload || {};

  var accountId = String(payload.accountId || '').trim();
  var fileName = String(payload.fileName || '').trim();
  var base64 = String(payload.rawBase64 || '').trim();
  var mapping = payload.mapping || {};

  validateRequired_({
    'Account ID': accountId,
    'File Name': fileName,
    'CSV File': base64,
    'Date Column': mapping.date,
    'Description Column': mapping.description
  }, ['Account ID', 'File Name', 'CSV File', 'Date Column', 'Description Column']);

  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', accountId, false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Please choose an active account.');
  }

  var content = Utilities.newBlob(Utilities.base64Decode(base64)).getDataAsString();
  var rows = parseDelimitedStatement_(content);
  var headers = rows.shift().map(function(header) {
    return String(header || '').trim();
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var bankFolder = DriveApp.getFolderById(getSettingValue_(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID));
    var file = bankFolder.createFile(Utilities.newBlob(Utilities.base64Decode(base64), 'text/csv', fileName));
    var fileHash = makeSimpleHash_(content);
    var duplicateFile = Boolean(findRecordByValue(getSheetByName('Bank Statement Imports'), 'File Hash', fileHash, false));
    var importId = getNextId_('Bank Statement Imports', 'IMP');
    var documentId = createBankStatementDocument_(file, fileName, user.email, 'CSV Bank Statement');

    var importedRows = [];
    var duplicateLines = 0;
    var batchKeys = {};
    rows.forEach(function(row, rowIndex) {
      if (!row.some(String)) {
        return;
      }

      var line = mapCsvRowToBankLine_(headers, row, mapping);
      if (!line.description && !line.moneyIn && !line.moneyOut) {
        return;
      }
      if (!line.statementDate || !line.description || (line.moneyIn <= 0 && line.moneyOut <= 0)) {
        throw new Error('CSV row ' + (rowIndex + 2) + ' does not contain a complete date, description, and amount. Correct the column mapping or file.');
      }
      if (line.moneyIn > 0 && line.moneyOut > 0) {
        throw new Error('CSV row ' + (rowIndex + 2) + ' contains both Money In and Money Out.');
      }
      assertAccountingPeriodOpen_(accountId, line.statementDate);
      var lineKey = makeBankLineKey_(accountId, line);
      var duplicateLine = isDuplicateBankLine_(accountId, line) || Boolean(batchKeys[lineKey]);
      batchKeys[lineKey] = true;
      if (duplicateLine) {
        duplicateLines++;
      }
      importedRows.push([
        getNextIdForBatch_('BANK', importedRows.length + getSheetByName('Bank Statement Lines').getLastRow()),
        importId,
        accountId,
        line.statementDate,
        line.description,
        line.moneyIn,
        line.moneyOut,
        line.runningBalance,
        line.referenceNumber,
        duplicateLine ? 'Duplicate Quarantined' : 'Imported',
        line.notes,
        documentId,
        nowIso(),
        nowIso()
      ]);
    });

    if (!importedRows.length) {
      throw new Error('No usable bank statement lines were found.');
    }

    getSheetByName('Bank Statement Lines')
      .getRange(getSheetByName('Bank Statement Lines').getLastRow() + 1, 1, importedRows.length, importedRows[0].length)
      .setValues(importedRows.map(safeSheetRow_));

    appendSafeRow_(getSheetByName('Bank Statement Imports'), [
      importId,
      accountId,
      file.getId(),
      fileName,
      fileHash,
      duplicateFile || duplicateLines ? BANK_IMPORT_STATUS.DUPLICATE_WARNING : BANK_IMPORT_STATUS.IMPORTED,
      user.email,
      nowIso(),
      importedRows.length,
      duplicateFile || duplicateLines ? 'Possible duplicate file or bank lines found.' : ''
    ]);

    safeWriteAuditLog_('Bank CSV imported', 'Bank Statement Import', importId, '', {
      fileName: fileName,
      rowsImported: importedRows.length,
      duplicateLines: duplicateLines
    }, 'Finance Officer imported bank CSV');

    return {
      ok: true,
      importId: importId,
      rowsImported: importedRows.length,
      duplicateWarning: duplicateFile || duplicateLines > 0
    };
  } finally {
    lock.releaseLock();
  }
}

function uploadBankStatementPdf(fileData) {
  var user = requireFinanceOfficerOrSystemAdmin();
  fileData = fileData || {};

  var fileName = String(fileData.fileName || '').trim();
  var base64 = String(fileData.base64 || '').trim();
  var mimeType = String(fileData.mimeType || '').trim();
  if (!fileName || !base64) {
    throw new Error('Please choose a bank statement file.');
  }
  if (!fileName.toLowerCase().match(/\.(pdf|xls|xlsx|csv)$/)) {
    throw new Error('Only PDF, Excel, or CSV statement files are accepted here.');
  }

  var bytes = Utilities.base64Decode(base64);
  validateStatementFileSignature_(fileName, bytes);
  if (bytes.length > 10 * 1024 * 1024) {
    throw new Error('File is too large. Maximum size is 10 MB.');
  }

  var folder = DriveApp.getFolderById(getSettingValue_(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID));
  var file = folder.createFile(Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName));
  var documentId = createBankStatementDocument_(file, fileName, user.email, 'Bank Statement File');

  safeWriteAuditLog_('Bank statement file uploaded', 'Document', documentId, '', { fileName: fileName }, 'Statement file stored as evidence');
  return { ok: true, documentId: documentId, fileId: file.getId(), fileName: fileName };
}

function previewBankPdf(fileData) {
  var user = requireFinanceOfficerOrSystemAdmin();
  fileData = fileData || {};

  var fileName = String(fileData.fileName || '').trim();
  var base64 = String(fileData.base64 || '').trim();
  if (!fileName || !base64) {
    throw new Error('Please choose a PDF bank statement.');
  }
  if (!fileName.toLowerCase().match(/\.pdf$/)) {
    throw new Error('Only PDF files can be extracted here.');
  }

  var bytes = Utilities.base64Decode(base64);
  validateStatementFileSignature_(fileName, bytes);
  if (bytes.length > 10 * 1024 * 1024) {
    throw new Error('File is too large. Maximum size is 10 MB.');
  }

  ensurePdfExtractionAvailable_();

  var folder = DriveApp.getFolderById(getSettingValue_(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID));
  var blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  var file = folder.createFile(blob);
  var documentId = createBankStatementDocument_(file, fileName, user.email, 'PDF Bank Statement');
  var extractedText = extractPdfTextWithDriveOcr_(blob, fileName, folder.getId());
  var parseResult = parseBankStatementText_(extractedText);
  var rows = parseResult.rows;
  var extractedLines = getCleanPdfTextLines_(extractedText);

  safeWriteAuditLog_('Bank PDF extracted for review', 'Document', documentId, '', {
    fileName: fileName,
    rowsFound: rows.length
  }, 'Finance Officer extracted PDF bank statement for review');

  return {
    fileName: fileName,
    fileId: file.getId(),
    documentId: documentId,
    fileHash: makeSimpleHash_(Utilities.base64Encode(bytes)),
    parserProfile: parseResult.profile,
    openingBalance: parseResult.openingBalance,
    closingBalance: parseResult.closingBalance,
    balanceBreakCount: parseResult.balanceBreakCount,
    rowCount: rows.length,
    highConfidenceCount: rows.filter(function(row) { return row.confidence === 'High'; }).length,
    reviewCount: rows.filter(function(row) { return row.confidence !== 'High'; }).length,
    previewRows: rows.slice(0, 25),
    rows: rows,
    extractedTextPreview: extractedLines.slice(0, 80),
    needsManualReview: rows.length === 0
  };
}

function importBankPdfRows(payload) {
  var user = requireFinanceOfficerOrSystemAdmin();
  payload = payload || {};

  var accountId = String(payload.accountId || '').trim();
  var fileName = String(payload.fileName || '').trim();
  var fileId = String(payload.fileId || '').trim();
  var documentId = String(payload.documentId || '').trim();
  var fileHash = String(payload.fileHash || '').trim();
  var rows = payload.rows || [];

  validateRequired_({
    'Account ID': accountId,
    'File Name': fileName,
    'File ID': fileId,
    'Document ID': documentId
  }, ['Account ID', 'File Name', 'File ID', 'Document ID']);

  if (!rows.length) {
    throw new Error('There are no reviewed PDF rows to import.');
  }

  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', accountId, false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Please choose an active account.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var duplicateFile = fileHash ? Boolean(findRecordByValue(getSheetByName('Bank Statement Imports'), 'File Hash', fileHash, false)) : false;
    var importId = getNextId_('Bank Statement Imports', 'IMP');
    var importedRows = [];
    var duplicateLines = 0;
    var batchKeys = {};

    rows.forEach(function(row) {
      var clean = cleanPdfBankLineRow_(row || {});
      if (!clean.statementDate && !clean.description && !clean.moneyIn && !clean.moneyOut) {
        return;
      }
      if (!clean.statementDate || !clean.description) {
        return;
      }
      if (clean.moneyIn <= 0 && clean.moneyOut <= 0) {
        return;
      }
      if (clean.moneyIn > 0 && clean.moneyOut > 0) {
        throw new Error('A PDF row cannot contain both Money In and Money Out. Correct the row before importing.');
      }
      assertAccountingPeriodOpen_(accountId, clean.statementDate);

      var lineKey = makeBankLineKey_(accountId, clean);
      var duplicateLine = isDuplicateBankLine_(accountId, clean) || Boolean(batchKeys[lineKey]);
      batchKeys[lineKey] = true;
      if (duplicateLine) {
        duplicateLines++;
      }
      importedRows.push([
        getNextIdForBatch_('BANK', importedRows.length + getSheetByName('Bank Statement Lines').getLastRow()),
        importId,
        accountId,
        clean.statementDate,
        clean.description,
        clean.moneyIn,
        clean.moneyOut,
        clean.runningBalance,
        clean.referenceNumber,
        duplicateLine ? 'Duplicate Quarantined' : 'Imported',
        clean.notes,
        documentId,
        nowIso(),
        nowIso()
      ]);
    });

    if (!importedRows.length) {
      throw new Error('No usable reviewed PDF rows were found. Check the dates, descriptions, and amounts.');
    }

    getSheetByName('Bank Statement Lines')
      .getRange(getSheetByName('Bank Statement Lines').getLastRow() + 1, 1, importedRows.length, importedRows[0].length)
      .setValues(importedRows.map(safeSheetRow_));

    appendSafeRow_(getSheetByName('Bank Statement Imports'), [
      importId,
      accountId,
      fileId,
      fileName,
      fileHash,
      duplicateFile || duplicateLines ? BANK_IMPORT_STATUS.DUPLICATE_WARNING : BANK_IMPORT_STATUS.IMPORTED,
      user.email,
      nowIso(),
      importedRows.length,
      duplicateFile || duplicateLines ? 'Possible duplicate PDF file or bank lines found.' : 'Imported after PDF extraction review.'
    ]);

    safeWriteAuditLog_('Bank PDF rows imported', 'Bank Statement Import', importId, '', {
      fileName: fileName,
      rowsImported: importedRows.length,
      duplicateLines: duplicateLines
    }, 'Finance Officer reviewed and imported PDF bank statement rows');

    return {
      ok: true,
      importId: importId,
      rowsImported: importedRows.length,
      duplicateWarning: duplicateFile || duplicateLines > 0
    };
  } finally {
    lock.releaseLock();
  }
}

function addManualBankStatementLine(record) {
  var user = requireFinanceOfficerOrSystemAdmin();
  record = record || {};
  var clean = cleanBankLineRecord_(record || {});
  validateRequired_(clean, ['Account ID', 'Statement Date', 'Description']);

  var moneyIn = parseMoney_(clean['Money In']);
  var moneyOut = parseMoney_(clean['Money Out']);
  if (moneyIn <= 0 && moneyOut <= 0) {
    throw new Error('Enter either Money In or Money Out.');
  }
  if (moneyIn > 0 && moneyOut > 0) {
    throw new Error('Use either Money In or Money Out, not both.');
  }

  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', clean['Account ID'], false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Please choose an active account.');
  }
  assertAccountingPeriodOpen_(clean['Account ID'], clean['Statement Date']);
  var categoryId = String(record['Category ID'] || '').trim();
  var fundId = String(record['Fund ID'] || '').trim();
  var counterparty = String(record.Counterparty || record['Payer or Payee'] || '').trim();
  validateOptionalFund_(fundId);
  validateOptionalDocument_(clean['Document ID']);
  var transactionType = moneyIn > 0 ? TRANSACTION_TYPES.MONEY_IN : TRANSACTION_TYPES.MONEY_OUT;
  if (categoryId) {
    var category = findRecordByValue(getSheetByName('Categories'), 'Category ID', categoryId, false);
    if (!category || category.Status !== 'Active' || category['Category Type'] !== transactionType) {
      throw new Error('Choose a classification that matches Money In or Money Out.');
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var duplicate = isDuplicateBankLine_(clean['Account ID'], {
      statementDate: clean['Statement Date'],
      description: clean.Description,
      moneyIn: moneyIn,
      moneyOut: moneyOut,
      referenceNumber: clean['Reference Number']
    });
    var bankLineId = getNextId_('Bank Statement Lines', 'BANK');
    var now = nowIso();
    var lineStatus = duplicate ? 'Duplicate Quarantined' : (categoryId ? MATCH_STATUS.READY_TO_PUBLISH : 'Manual Entry');
    appendRecordByHeaders_(getSheetByName('Bank Statement Lines'), {
      'Bank Line ID': bankLineId,
      'Account ID': clean['Account ID'],
      'Statement Date': clean['Statement Date'],
      Description: clean.Description,
      'Money In': moneyIn,
      'Money Out': moneyOut,
      'Running Balance': parseMoney_(clean['Running Balance']),
      'Reference Number': clean['Reference Number'],
      Status: lineStatus,
      Notes: clean.Notes,
      'Document ID': clean['Document ID'],
      'Created At': now,
      'Updated At': now,
      'Extraction Confidence': 'Manual',
      'Category ID': categoryId,
      'Fund ID': fundId,
      Counterparty: counterparty,
      'Review Status': duplicate ? 'Duplicate Quarantined' : (categoryId ? 'Classified' : 'Needs Classification'),
      'Is Duplicate': duplicate ? 'Yes' : 'No'
    });
    var transactionId = '';
    if (categoryId && !duplicate) {
      transactionId = getNextId_('Transactions', 'TXN');
      appendRecordByHeaders_(getSheetByName('Transactions'), {
        'Transaction ID': transactionId,
        'Transaction Type': transactionType,
        Date: clean['Statement Date'],
        Amount: moneyIn > 0 ? moneyIn : moneyOut,
        'Account ID': clean['Account ID'],
        'Payer or Payee': counterparty || clean.Description,
        'Category ID': categoryId,
        Description: clean.Description,
        'Reference Number': clean['Reference Number'],
        'Payment Method': 'Manual Bank Statement',
        'Fund ID': fundId,
        'Document ID': clean['Document ID'],
        'Entered By': user.email,
        Status: TRANSACTION_STATUS.SUBMITTED,
        'Submitted At': now,
        Reason: 'Created from bank statement line ' + bankLineId + (clean.Notes ? '. Note: ' + clean.Notes : ''),
        'Created At': now,
        'Updated At': now,
        'Source Bank Line ID': bankLineId
      });
    }
    if (clean['Document ID']) {
      linkDocumentToRecord_(
        clean['Document ID'],
        transactionId ? 'Transaction' : 'Bank Statement Line',
        transactionId || bankLineId,
        'Optional evidence for manually entered bank item'
      );
    }

    safeWriteAuditLog_('Manual bank statement line entered', 'Bank Statement Line', bankLineId, '', clean, 'Finance Officer entered bank line manually');
    return { ok: true, bankLineId: bankLineId, transactionId: transactionId, duplicateWarning: duplicate };
  } finally {
    lock.releaseLock();
  }
}

function getBankStatementData() {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);

  var importRecords = getSheetRecords(getSheetByName('Bank Statement Imports'));
  return {
    canManageBankStatements: hasFinanceOfficerOrSystemAdmin(user.roles),
    accounts: getActiveAccounts_(),
    imports: importRecords.filter(function(item) { return item['Review Status'] !== 'Draft'; }).slice(-20).reverse().map(function(item) {
      return {
        importId: item['Import ID'],
        accountId: item['Account ID'],
        fileName: item['File Name'],
        importStatus: item['Import Status'],
        importedBy: item['Imported By'],
        importedAt: item['Imported At'],
        rowsImported: item['Rows Imported'],
        duplicateWarning: item['Duplicate Warning']
      };
    }),
    drafts: importRecords.filter(function(item) {
      return item['Review Status'] === 'Draft' && canManageStatementDraft_(item, user);
    }).slice(-10).reverse().map(function(item) {
      return {
        draftId: item['Import ID'],
        accountId: item['Account ID'],
        fileName: item['File Name'],
        sourceFormat: item['Source Format'],
        savedBy: item['Imported By'],
        savedAt: item['Imported At']
      };
    }),
    lines: getSheetRecords(getSheetByName('Bank Statement Lines')).slice(-50).reverse().map(function(line) {
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
        notes: line.Notes,
        confidence: line['Extraction Confidence'] || '',
        reviewStatus: line['Review Status'] || '',
        isDuplicate: isYes_(line['Is Duplicate']) || line.Status === 'Duplicate Quarantined'
      };
    })
  };
}

function queryBankStatementLines(filters) {
  requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);
  filters = filters || {};
  var page = Math.max(1, Number(filters.page || 1));
  var pageSize = Math.min(100, Math.max(10, Number(filters.pageSize || 25)));
  var accountId = String(filters.accountId || '').trim();
  var status = String(filters.status || '').trim();
  var search = String(filters.search || '').trim().toLowerCase();
  var startDate = filters.startDate ? normalizeImportedDate_(filters.startDate) : '';
  var endDate = filters.endDate ? normalizeImportedDate_(filters.endDate) : '';
  var records = getSheetRecords(getSheetByName('Bank Statement Lines')).filter(function(line) {
    var lineDate = '';
    try { lineDate = normalizeImportedDate_(line['Statement Date']); } catch (error) { lineDate = String(line['Statement Date'] || ''); }
    if (accountId && line['Account ID'] !== accountId) { return false; }
    if (status && line.Status !== status) { return false; }
    if (startDate && lineDate < startDate) { return false; }
    if (endDate && lineDate > endDate) { return false; }
    if (search) {
      var haystack = [line.Description, line['Reference Number'], line.Notes, line['Bank Line ID']].join(' ').toLowerCase();
      if (haystack.indexOf(search) === -1) { return false; }
    }
    return true;
  }).reverse();
  var total = records.length;
  var pageCount = Math.max(1, Math.ceil(total / pageSize));
  page = Math.min(page, pageCount);
  var start = (page - 1) * pageSize;
  return {
    page: page,
    pageSize: pageSize,
    pageCount: pageCount,
    total: total,
    lines: records.slice(start, start + pageSize).map(function(line) {
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
        confidence: line['Extraction Confidence'],
        notes: line.Notes
      };
    })
  };
}

function resolveDuplicateBankLine(bankLineId, decision, notes) {
  var user = requireFinanceOfficerOrSystemAdmin();
  decision = String(decision || '').trim();
  if (['Confirm Duplicate', 'Accept As Unique'].indexOf(decision) === -1) {
    throw new Error('Choose Confirm Duplicate or Accept As Unique.');
  }
  var sheet = getSheetByName('Bank Statement Lines');
  var line = findRecordByValue(sheet, 'Bank Line ID', String(bankLineId || '').trim(), false);
  if (!line || line.Status !== 'Duplicate Quarantined') {
    throw new Error('This bank line is not awaiting duplicate review.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    updateRecordByHeaders(sheet, line._rowNumber, {
      Status: decision === 'Confirm Duplicate' ? 'Excluded' : MATCH_STATUS.NEEDS_REVIEW,
      'Review Status': decision === 'Confirm Duplicate' ? 'Confirmed Duplicate' : 'Accepted As Unique - Needs Classification',
      'Is Duplicate': decision === 'Confirm Duplicate' ? 'Yes' : 'No',
      Notes: String(notes || '').trim(),
      'Updated At': nowIso()
    });
  } finally {
    lock.releaseLock();
  }
  safeWriteAuditLog_('Duplicate bank line resolved', 'Bank Statement Line', line['Bank Line ID'], line, {
    decision: decision,
    notes: notes || '',
    resolvedBy: user.email
  }, 'Finance Officer explicitly resolved a quarantined duplicate');
  return { ok: true, bankLineId: line['Bank Line ID'], decision: decision };
}

function suggestCsvMapping_(headers) {
  return {
    date: findFirstHeader_(headers, ['date', 'transaction date', 'value date']),
    description: findFirstHeader_(headers, ['description', 'narration', 'details', 'remark', 'remarks']),
    moneyIn: findFirstHeader_(headers, ['credit', 'money in', 'deposit', 'paid in']),
    moneyOut: findFirstHeader_(headers, ['debit', 'money out', 'withdrawal', 'paid out']),
    amount: findFirstHeader_(headers, ['amount']),
    balance: findFirstHeader_(headers, ['balance', 'running balance']),
    reference: findFirstHeader_(headers, ['reference', 'transaction id', 'ref'])
  };
}

function findFirstHeader_(headers, options) {
  var lookup = {};
  headers.forEach(function(header) {
    lookup[String(header).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ')] = header;
  });

  for (var i = 0; i < options.length; i++) {
    var normalizedOption = options[i].replace(/[^a-z0-9]+/g, ' ');
    if (lookup[normalizedOption]) {
      return lookup[normalizedOption];
    }
  }
  for (var j = 0; j < options.length; j++) {
    var optionText = options[j].replace(/[^a-z0-9]+/g, ' ');
    var matchingHeader = Object.keys(lookup).filter(function(headerText) {
      return headerText.indexOf(optionText) !== -1;
    })[0];
    if (matchingHeader) {
      return lookup[matchingHeader];
    }
  }
  return '';
}

function mapCsvRowToBankLine_(headers, row, mapping) {
  function valueFor(headerName) {
    var index = headers.indexOf(headerName);
    return index === -1 ? '' : row[index];
  }

  var moneyIn = Math.abs(parseMoney_(valueFor(mapping.moneyIn)));
  var moneyOut = Math.abs(parseMoney_(valueFor(mapping.moneyOut)));
  var amount = parseMoney_(valueFor(mapping.amount));
  if (!moneyIn && !moneyOut && amount) {
    if (amount > 0) {
      moneyIn = amount;
    } else {
      moneyOut = Math.abs(amount);
    }
  }

  return {
    statementDate: normalizeImportedDate_(valueFor(mapping.date)),
    description: String(valueFor(mapping.description) || '').trim(),
    moneyIn: moneyIn,
    moneyOut: moneyOut,
    runningBalance: parseMoney_(valueFor(mapping.balance)),
    referenceNumber: String(valueFor(mapping.reference) || '').trim(),
    notes: ''
  };
}

function mapStatementTableRows_(headers, rawRows, mapping) {
  headers = Array.isArray(headers) ? headers : [];
  rawRows = Array.isArray(rawRows) ? rawRows : [];
  mapping = mapping || {};
  if (!mapping.date) {
    throw new Error('Choose the column containing the transaction date.');
  }
  if (!mapping.description) {
    throw new Error('Choose the column containing the bank description.');
  }
  if (!mapping.amount && !mapping.moneyIn && !mapping.moneyOut) {
    throw new Error('Choose a Money In, Money Out, or single Amount column.');
  }
  var dateIndex = headers.indexOf(mapping.date);
  if (dateIndex === -1) {
    throw new Error('The selected transaction-date column could not be found.');
  }

  return rawRows.reduce(function(mappedRows, row, index) {
    if (!Array.isArray(row) || !row.some(function(value) { return String(value || '').trim(); })) {
      return mappedRows;
    }
    if (!String(row[dateIndex] || '').trim()) {
      return mappedRows;
    }
    try {
      mappedRows.push(mapCsvRowToBankLine_(headers, row, mapping));
    } catch (error) {
      throw new Error('Statement row ' + (index + 2) + ': ' + error.message);
    }
    return mappedRows;
  }, []);
}

function extractPdfTextWithDriveOcr_(blob, fileName, folderId) {
  ensurePdfExtractionAvailable_();

  var text = '';
  var firstError = null;

  try {
    text = extractPdfTextWithDriveConversion_(blob, fileName, folderId, false);
  } catch (error) {
    firstError = error;
  }

  if (String(text || '').trim()) {
    return text;
  }

  try {
    text = extractPdfTextWithDriveConversion_(blob, fileName, folderId, true);
  } catch (error) {
    var message = String(error && error.message ? error.message : error);
    if (message.indexOf('OCR not supported') !== -1 && firstError) {
      throw new Error('Google could not extract readable text from this PDF. Please ask the bank for CSV/Excel, or enter the statement lines manually.');
    }
    throw error;
  }

  if (!String(text || '').trim()) {
    throw new Error('Google could not find readable text in this PDF. Please ask the bank for CSV/Excel, or enter the statement lines manually.');
  }
  return text;
}

function extractPdfTextWithDriveConversion_(blob, fileName, folderId, useOcr) {
  var resource = {
    title: fileName.replace(/\.pdf$/i, '') + (useOcr ? ' - OCR text' : ' - extracted text'),
    mimeType: 'application/vnd.google-apps.document',
    parents: [{ id: folderId }]
  };
  var options = {
    convert: true
  };
  if (useOcr) {
    options.ocr = true;
    options.ocrLanguage = 'en';
  }

  var extractedFile = Drive.Files.insert(resource, blob, options);

  try {
    return DocumentApp.openById(extractedFile.id).getBody().getText();
  } finally {
    try {
      DriveApp.getFileById(extractedFile.id).setTrashed(true);
    } catch (error) {
      // The PDF evidence remains stored even if the temporary extraction file cannot be trashed.
    }
  }
}

function ensurePdfExtractionAvailable_() {
  if (typeof Drive === 'undefined' || !Drive.Files) {
    throw new Error('PDF extraction needs the Advanced Drive Service. In Apps Script, click Services, add Drive API, save, then deploy again.');
  }
}

function parsePdfStatementText_(text) {
  return parseBankStatementText_(text).rows;
}

function parseBankStatementText_(text) {
  var candidates = [
    {
      profile: 'Polaris Bank column layout',
      rows: validateStatementBalanceChain_(parsePolarisStatementText_(text))
    },
    {
      profile: 'Generic statement layout',
      rows: validateStatementBalanceChain_(parseGenericStatementText_(text))
    }
  ].map(function(candidate) {
    candidate.score = scoreParsedStatementRows_(candidate.rows);
    return candidate;
  }).sort(function(a, b) {
    return b.score - a.score;
  });

  var best = candidates[0] || { profile: 'Manual review', rows: [], score: 0 };
  if (!best.rows.length) {
    return {
      profile: 'Manual review',
      rows: []
    };
  }
  var transactionRows = best.rows.filter(function(row) { return !row.isOpeningBalance; });
  var balanceRows = best.rows.filter(function(row) { return row.runningBalance || row.runningBalance === 0; });
  return {
    profile: best.profile,
    rows: transactionRows,
    openingBalance: best.rows.length && best.rows[0].isOpeningBalance ? best.rows[0].runningBalance : '',
    closingBalance: balanceRows.length ? balanceRows[balanceRows.length - 1].runningBalance : '',
    balanceBreakCount: transactionRows.filter(function(row) { return row.balanceCheck === 'Break'; }).length
  };
}

function parseGenericStatementText_(text) {
  var lines = getCleanPdfTextLines_(text);
  var rows = [];

  lines.forEach(function(line) {
    var parsed = parsePdfStatementLine_(line);
    if (parsed) {
      rows.push(parsed);
    }
  });

  rows = rows.concat(parseCombinedPdfStatementLines_(lines));

  var seen = {};
  rows = rows.filter(function(row) {
    var key = [
      row.statementDate,
      row.description,
      row.moneyIn,
      row.moneyOut,
      row.runningBalance
    ].join('|');
    if (seen[key]) {
      return false;
    }
    seen[key] = true;
    return true;
  });

  return rows;
}

function scoreParsedStatementRows_(rows) {
  return (rows || []).reduce(function(score, row) {
    var rowScore = row.isOpeningBalance ? 1 : 0;
    if (row.confidence === 'High') {
      rowScore += 8;
    }
    if (row.statementDate && row.description && (row.moneyIn > 0 || row.moneyOut > 0)) {
      rowScore += 2;
    } else if (!row.isOpeningBalance) {
      rowScore -= 5;
    }
    if (row.runningBalance || row.runningBalance === 0) {
      rowScore += 1;
    }
    if (row.balanceCheck === 'Break') {
      rowScore -= 6;
    }
    if (row.moneyIn > 0 && row.moneyOut > 0) {
      rowScore -= 10;
    }
    return score + rowScore;
  }, 0);
}

function parsePolarisStatementText_(text) {
  var lines = getRawPdfTextLines_(text);
  var rows = [];
  var seen = {};

  for (var i = 0; i < lines.length; i++) {
    var line = cleanPdfControlCharacters_(lines[i]).trim();
    if (!line || !/^(\d{1,2}-[A-Z]{3}-\d{2})\b/i.test(line)) {
      continue;
    }

    var row = parsePolarisStatementLine_(line);
    if (!row) {
      var combined = line;
      for (var j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        var nextLine = cleanPdfControlCharacters_(lines[j]).trim();
        if (!nextLine) {
          break;
        }
        if (/^(\d{1,2}-[A-Z]{3}-\d{2})\b/i.test(nextLine)) {
          break;
        }
        if (/^\d+$/.test(nextLine) || /^(POLARIS|EntryDate|Totals|End of Report)/i.test(nextLine)) {
          break;
        }
        combined += ' ' + nextLine;
        row = parsePolarisStatementLine_(combined);
        if (row) {
          break;
        }
      }
    }

    if (!row) {
      continue;
    }
    var key = [
      row.statementDate,
      row.description,
      row.moneyIn,
      row.moneyOut,
      row.runningBalance
    ].join('|');
    if (!seen[key]) {
      seen[key] = true;
      rows.push(row);
    }
  }

  return rows;
}

function parsePolarisStatementLine_(line) {
  var normalized = cleanPdfControlCharacters_(line).replace(/\s+/g, ' ').trim();
  var match = normalized.match(/^(\d{1,2}-[A-Z]{3}-\d{2})\s+(.+)$/i);
  if (!match) {
    return null;
  }

  var statementDate = normalizePdfStatementDate_(match[1]);
  if (!statementDate) {
    return null;
  }

  var rest = match[2];
  var valueDateMatch = rest.match(/\b(\d{1,2}-[A-Z]{3}-\d{2})\b/i);
  if (!valueDateMatch) {
    return null;
  }

  var valueDateIndex = valueDateMatch.index;
  var description = rest.slice(0, valueDateIndex).trim();
  var amountText = rest.slice(valueDateIndex + valueDateMatch[0].length).trim();
  var amountMatches = getPdfAmountMatches_(amountText);
  if (amountMatches.length < 2 || !description || /^Balance B\/F/i.test(description)) {
    return null;
  }

  var values = amountMatches.map(function(item) {
    return item.value;
  });
  var runningBalance = values.length >= 3 ? parsePdfMoney_(values[2]) : parsePdfMoney_(values[values.length - 1]);
  var debit = 0;
  var credit = 0;

  if (values.length >= 3) {
    debit = parsePdfMoney_(values[0]);
    credit = parsePdfMoney_(values[1]);
  } else {
    var amount = parsePdfMoney_(values[0]);
    if (amount <= 0) {
      return null;
    }
    if (isLikelyPolarisDebit_(description)) {
      debit = amount;
    } else {
      credit = amount;
    }
  }

  if (debit <= 0 && credit <= 0) {
    return null;
  }

  return {
    statementDate: statementDate,
    description: description,
    moneyIn: credit,
    moneyOut: debit,
    runningBalance: runningBalance,
    referenceNumber: extractPolarisReference_(description),
    notes: 'Auto-detected from Polaris PDF. Review before importing.',
    sourceText: normalized,
    confidence: values.length === 3 ? 'High' : 'Review'
  };
}

function isLikelyPolarisDebit_(description) {
  return /\b(FEE|VAT|CHARGE|CHARGED|LEVY|EMTL|STAMP DUTY|WITHOLDING|WITHHOLDING|TAX|SMS SERVICE|BRANCHTELLER)\b/i.test(String(description || ''));
}

function extractPolarisReference_(description) {
  var raw = String(description || '');
  var colonRef = raw.match(/:([0-9]{12,})\b/);
  if (colonRef) {
    return colonRef[1];
  }
  var longRef = raw.match(/\b([A-Z0-9]{10,})\b/);
  return longRef ? longRef[1] : '';
}

function parsePdfStatementLine_(line) {
  var dateMatch = line.match(/(?:^|\s)(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-[A-Z]{3}-\d{2,4})(?:\s|$)(.*)$/i);
  if (!dateMatch) {
    return null;
  }

  var statementDate = normalizePdfStatementDate_(dateMatch[1]);
  if (!statementDate) {
    return null;
  }

  var rest = String(dateMatch[2] || '').trim();
  var amountMatches = getPdfAmountMatches_(rest);
  if (!amountMatches.length) {
    return null;
  }

  var tailAmounts = amountMatches.slice(-3);
  var firstTailIndex = tailAmounts[0].index;
  var description = rest.slice(0, firstTailIndex).replace(/\s+/g, ' ').trim();
  if (!description) {
    description = rest.replace(amountMatches.map(function(match) {
      return match.value;
    }).join(' '), '').trim();
  }

  var moneyIn = 0;
  var moneyOut = 0;
  var runningBalance = 0;
  if (tailAmounts.length >= 3) {
    moneyOut = parsePdfMoney_(tailAmounts[0].value);
    moneyIn = parsePdfMoney_(tailAmounts[1].value);
    runningBalance = parsePdfMoney_(tailAmounts[2].value);
  } else if (tailAmounts.length === 2) {
    var amount = parsePdfMoney_(tailAmounts[0].value);
    runningBalance = parsePdfMoney_(tailAmounts[1].value);
    if (amount < 0 || /\b(dr|debit|withdrawal|charge|fee)\b/i.test(rest)) {
      moneyOut = Math.abs(amount);
    } else {
      moneyIn = Math.abs(amount);
    }
  } else {
    var singleAmount = parsePdfMoney_(tailAmounts[0].value);
    if (singleAmount < 0 || /\b(dr|debit|withdrawal|charge|fee)\b/i.test(rest)) {
      moneyOut = Math.abs(singleAmount);
    } else {
      moneyIn = Math.abs(singleAmount);
    }
  }

  return {
    statementDate: statementDate,
    description: description,
    moneyIn: moneyIn,
    moneyOut: moneyOut,
    runningBalance: runningBalance,
    referenceNumber: '',
    notes: 'Extracted from PDF. Review before relying on this row.',
    sourceText: line
  };
}

function getPdfAmountMatches_(text) {
  var regex = /\(?-?(?:0|\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})\)?/g;
  var matches = [];
  var match;
  while ((match = regex.exec(String(text || ''))) !== null) {
    var before = match.index > 0 ? String(text).charAt(match.index - 1) : '';
    var after = String(text).charAt(match.index + match[0].length);
    if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) {
      continue;
    }
    matches.push({
      value: match[0],
      index: match.index
    });
  }
  return matches;
}

function parseCombinedPdfStatementLines_(lines) {
  var rows = [];
  for (var i = 0; i < lines.length; i++) {
    if (!containsPdfDate_(lines[i])) {
      continue;
    }
    var combined = lines[i];
    for (var j = i + 1; j < Math.min(lines.length, i + 5); j++) {
      if (containsPdfDate_(lines[j])) {
        break;
      }
      combined += ' ' + lines[j];
      var parsed = parsePdfStatementLine_(combined);
      if (parsed) {
        rows.push(parsed);
        break;
      }
    }
  }
  return rows;
}

function getCleanPdfTextLines_(text) {
  return getRawPdfTextLines_(text)
    .map(function(line) {
      return line.replace(/\s+/g, ' ').trim();
    })
    .filter(Boolean);
}

function getRawPdfTextLines_(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(function(line) {
      return cleanPdfControlCharacters_(line).replace(/\s+$/g, '');
    })
    .filter(function(line) {
      return String(line || '').trim() !== '';
    });
}

function cleanPdfControlCharacters_(value) {
  return String(value || '').replace(/\f/g, '');
}

function containsPdfDate_(line) {
  return /(?:^|\s)(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-[A-Z]{3}-\d{2,4})(?:\s|$)/i.test(String(line || ''));
}

function normalizePdfStatementDate_(value) {
  var raw = String(value || '').trim();
  var iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return normalizeDateInput_(iso[1] + '-' + String(iso[2]).padStart(2, '0') + '-' + String(iso[3]).padStart(2, '0'));
  }

  var textDate = raw.match(/^(\d{1,2})-([A-Z]{3})-(\d{2,4})$/i);
  if (textDate) {
    var monthLookup = {
      JAN: 1,
      FEB: 2,
      MAR: 3,
      APR: 4,
      MAY: 5,
      JUN: 6,
      JUL: 7,
      AUG: 8,
      SEP: 9,
      OCT: 10,
      NOV: 11,
      DEC: 12
    };
    var textYear = Number(textDate[3]);
    if (textYear < 100) {
      textYear += 2000;
    }
    var textMonth = monthLookup[textDate[2].toUpperCase()];
    var textDay = Number(textDate[1]);
    if (textMonth && isValidDateParts_(textYear, textMonth, textDay)) {
      return String(textYear) + '-' + String(textMonth).padStart(2, '0') + '-' + String(textDay).padStart(2, '0');
    }
  }

  var parts = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!parts) {
    return '';
  }
  var year = Number(parts[3]);
  if (year < 100) {
    year += 2000;
  }
  var day = Number(parts[1]);
  var month = Number(parts[2]);
  if (!isValidDateParts_(year, month, day)) {
    return '';
  }
  return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function parsePdfMoney_(value) {
  var raw = String(value || '0').trim();
  var negative = raw.indexOf('(') === 0 || raw.indexOf('-') === 0;
  var number = Number(raw.replace(/[(),]/g, '').replace(/-/g, ''));
  if (isNaN(number)) {
    return 0;
  }
  return Math.round((negative ? -number : number) * 100) / 100;
}

function cleanPdfBankLineRow_(row) {
  return {
    statementDate: normalizeDateInput_(row.statementDate || row['Statement Date']),
    description: String(row.description || row.Description || '').trim(),
    moneyIn: parseMoney_(row.moneyIn || row['Money In']),
    moneyOut: parseMoney_(row.moneyOut || row['Money Out']),
    runningBalance: parseMoney_(row.runningBalance || row['Running Balance']),
    referenceNumber: String(row.referenceNumber || row['Reference Number'] || '').trim(),
    notes: String(row.notes || row.Notes || '').trim()
  };
}

function cleanBankLineRecord_(record) {
  return {
    'Account ID': String(record['Account ID'] || '').trim(),
    'Statement Date': normalizeDateInput_(record['Statement Date']),
    Description: String(record.Description || '').trim(),
    'Money In': String(record['Money In'] || '').trim(),
    'Money Out': String(record['Money Out'] || '').trim(),
    'Running Balance': String(record['Running Balance'] || '').trim(),
    'Reference Number': String(record['Reference Number'] || '').trim(),
    Notes: String(record.Notes || '').trim(),
    'Document ID': String(record['Document ID'] || '').trim()
  };
}

function isDuplicateBankLine_(accountId, line) {
  var records = getSheetRecords(getSheetByName('Bank Statement Lines'));
  var key = makeBankLineKey_(accountId, line);
  return records.some(function(record) {
    return makeBankLineKey_(record['Account ID'], {
      statementDate: record['Statement Date'],
      description: record.Description,
      moneyIn: record['Money In'],
      moneyOut: record['Money Out'],
      referenceNumber: record['Reference Number']
    }) === key;
  });
}

function makeBankLineKey_(accountId, line) {
  var rawDate = line.statementDate || line['Statement Date'] || '';
  var normalizedDate = '';
  try {
    normalizedDate = normalizeImportedDate_(rawDate);
  } catch (error) {
    normalizedDate = String(rawDate || '').trim();
  }
  return [
    String(accountId || '').trim(),
    normalizedDate,
    String(line.referenceNumber || '').trim().toLowerCase(),
    String(line.description || '').trim().toLowerCase(),
    parseMoney_(line.moneyIn),
    parseMoney_(line.moneyOut)
  ].join('|');
}

function makeSimpleHash_(value) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value);
  return digest.map(function(byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ('0' + value.toString(16)).slice(-2);
  }).join('');
}

function getNextIdForBatch_(prefix, sequenceNumber) {
  return makeId(prefix, Math.max(1, sequenceNumber));
}

function createBankStatementDocument_(file, fileName, userEmail, documentType) {
  var documentId = 'DOC-' + Utilities.getUuid().split('-')[0].toUpperCase();
  appendSafeRow_(getSheetByName('Documents'), [
    documentId,
    file.getId(),
    fileName,
    documentType,
    'Finance Only',
    '',
    '',
    userEmail,
    nowIso(),
    ''
  ]);
  return documentId;
}

function parseDelimitedStatement_(content) {
  var clean = String(content || '').replace(/^\uFEFF/, '');
  var firstLine = clean.split(/\r?\n/, 1)[0] || '';
  var commaCount = (firstLine.match(/,/g) || []).length;
  var semicolonCount = (firstLine.match(/;/g) || []).length;
  if (semicolonCount > commaCount) {
    return Utilities.parseCsv(clean, ';');
  }
  return Utilities.parseCsv(clean);
}

function validateStatementBalanceChain_(rows) {
  var previousBalance = null;
  return (rows || []).map(function(original, index) {
    var row = Object.assign({}, original);
    row.rowNumber = index + 1;
    row.isOpeningBalance = /^\s*(balance\s+b\/f|opening\s+balance)/i.test(String(row.description || ''));
    row.balanceCheck = 'Unavailable';
    row.balanceDifference = '';

    var moneyIn = parseMoney_(row.moneyIn);
    var moneyOut = parseMoney_(row.moneyOut);
    var hasAmount = moneyIn > 0 || moneyOut > 0;
    var hasBalance = row.runningBalance !== '' && row.runningBalance !== null && row.runningBalance !== undefined;
    var runningBalance = hasBalance ? parseMoney_(row.runningBalance) : null;

    if (row.isOpeningBalance && hasBalance) {
      previousBalance = runningBalance;
      row.confidence = 'Opening Balance';
      row.balanceCheck = 'Opening';
      return row;
    }

    if (moneyIn > 0 && moneyOut > 0) {
      row.confidence = 'Review';
      row.balanceCheck = 'Break';
      row.reviewReason = 'Both Money In and Money Out were detected.';
    } else if (previousBalance !== null && hasBalance && hasAmount) {
      var expected = Math.round((previousBalance + moneyIn - moneyOut) * 100) / 100;
      var difference = Math.round((runningBalance - expected) * 100) / 100;
      row.balanceDifference = difference;
      if (Math.abs(difference) <= 0.01) {
        row.confidence = 'High';
        row.balanceCheck = 'Pass';
        row.reviewReason = '';
      } else {
        row.confidence = 'Review';
        row.balanceCheck = 'Break';
        row.reviewReason = 'Running balance differs by ' + difference + '. A row may be missing or misread.';
      }
    } else {
      row.confidence = 'Review';
      row.reviewReason = !hasAmount ? 'No complete transaction amount was detected.' : 'The running balance could not be verified.';
    }

    if (hasBalance && runningBalance !== 0) {
      previousBalance = runningBalance;
    }
    return row;
  });
}

function previewBankStatement(fileData) {
  var user = requireFinanceOfficerOrSystemAdmin();
  requireCurrentSchema_();
  fileData = fileData || {};
  var accountId = String(fileData.accountId || fileData['Account ID'] || '').trim();
  var fileName = String(fileData.fileName || '').trim();
  var base64 = String(fileData.base64 || '').trim();
  var mimeType = String(fileData.mimeType || '').trim();
  validateRequired_({ 'Account ID': accountId, 'File Name': fileName, File: base64 }, ['Account ID', 'File Name', 'File']);
  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', accountId, false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Please choose an active account.');
  }
  if (!/\.(pdf|csv|xls|xlsx)$/i.test(fileName)) {
    throw new Error('Choose a PDF, Excel, or CSV bank statement.');
  }
  var bytes = Utilities.base64Decode(base64);
  validateStatementFileSignature_(fileName, bytes);
  if (bytes.length > 10 * 1024 * 1024) {
    throw new Error('File is too large. Maximum size is 10 MB.');
  }
  var incomingFileHash = makeSimpleHash_(Utilities.base64Encode(bytes));
  var duplicateFile = Boolean(findRecordByValue(getSheetByName('Bank Statement Imports'), 'File Hash', incomingFileHash, false));

  if (/\.pdf$/i.test(fileName)) {
    var pdfResult = previewBankPdf({ fileName: fileName, base64: base64, mimeType: 'application/pdf' });
    linkDocumentToRecord_(pdfResult.documentId, 'Account', accountId, 'Statement preview for ' + accountId);
    pdfResult.sourceFormat = 'PDF';
    pdfResult.accountId = accountId;
    pdfResult.duplicateFile = duplicateFile;
    pdfResult.rows = addStatementCategorySuggestions_(pdfResult.rows);
    return pdfResult;
  }

  var evidence = storeStatementEvidence_(bytes, mimeType, fileName, user.email, accountId);
  var table = /\.csv$/i.test(fileName)
    ? parseDelimitedStatement_(Utilities.newBlob(bytes).getDataAsString())
    : extractExcelStatementRows_(bytes, mimeType, fileName);
  if (!table || table.length < 2) {
    throw new Error('No statement rows were found in this file.');
  }
  var headers = table.shift().map(function(header) { return String(header || '').trim(); });
  var mapping = suggestCsvMapping_(headers);
  return {
    accountId: accountId,
    fileName: fileName,
    fileId: evidence.fileId,
    documentId: evidence.documentId,
    fileHash: evidence.fileHash,
    duplicateFile: duplicateFile,
    sourceFormat: /\.csv$/i.test(fileName) ? 'CSV' : 'Excel',
    parserProfile: 'Officer-confirmed column mapping',
    headers: headers,
    suggestedMapping: mapping,
    rawRows: table.slice(0, 2000),
    needsMapping: true,
    rowCount: table.length,
    highConfidenceCount: 0,
    reviewCount: 0,
    rows: []
  };
}

function previewMappedBankStatement(payload) {
  requireFinanceOfficerOrSystemAdmin();
  payload = payload || {};
  var headers = payload.headers || [];
  var rawRows = payload.rawRows || [];
  var mapping = payload.mapping || {};
  var rows = mapStatementTableRows_(headers, rawRows, mapping);
  if (!rows.length) {
    throw new Error('No dated statement transactions were found with those column choices. Check the mapping and try again.');
  }
  return addStatementCategorySuggestions_(validateStatementBalanceChain_(rows));
}

function extractExcelStatementRows_(bytes, mimeType, fileName) {
  ensurePdfExtractionAvailable_();
  var blob = Utilities.newBlob(bytes, mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);
  var resource = {
    title: fileName.replace(/\.(xlsx?|XLSX?)$/, '') + ' - temporary import',
    mimeType: 'application/vnd.google-apps.spreadsheet'
  };
  var converted = Drive.Files.insert(resource, blob, { convert: true });
  try {
    var spreadsheet = SpreadsheetApp.openById(converted.id);
    var sheet = spreadsheet.getSheets()[0];
    return sheet.getDataRange().getDisplayValues();
  } finally {
    try {
      DriveApp.getFileById(converted.id).setTrashed(true);
    } catch (error) {
      console.error('Temporary Excel conversion could not be removed: ' + error.message);
    }
  }
}

function storeStatementEvidence_(bytes, mimeType, fileName, userEmail, accountId) {
  var folder = DriveApp.getFolderById(getSettingValue_(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID));
  var file = folder.createFile(Utilities.newBlob(bytes, mimeType || 'application/octet-stream', fileName));
  var documentId = createBankStatementDocument_(file, fileName, userEmail, 'Bank Statement File');
  linkDocumentToRecord_(documentId, 'Account', accountId, 'Original statement evidence');
  return {
    fileId: file.getId(),
    documentId: documentId,
    fileHash: makeSimpleHash_(Utilities.base64Encode(bytes))
  };
}

function linkDocumentToRecord_(documentId, recordType, recordId, notes) {
  var sheet = getSheetByName('Documents');
  var document = findRecordByValue(sheet, 'Document ID', documentId, false);
  if (document) {
    updateRecordByHeaders(sheet, document._rowNumber, {
      'Related Record Type': recordType,
      'Related Record ID': recordId,
      Notes: String(notes || document.Notes || '').trim()
    });
  }
}

function addStatementCategorySuggestions_(rows) {
  var categories = getActiveCategories_();
  var learned = {};
  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    if (!isPublishedTransactionStatus_(transaction.Status) || !transaction['Category ID']) {
      return;
    }
    var key = transaction['Transaction Type'] + '|' + makeDescriptionRuleKey_(transaction.Description);
    if (key.split('|')[1]) {
      learned[key] = transaction['Category ID'];
    }
  });
  return (rows || []).map(function(row) {
    var transactionType = row.moneyIn > 0 ? TRANSACTION_TYPES.MONEY_IN : TRANSACTION_TYPES.MONEY_OUT;
    row.suggestedCategoryId = suggestCategoryForDescription_(row.description, transactionType, categories)
      || learned[transactionType + '|' + makeDescriptionRuleKey_(row.description)]
      || '';
    return row;
  });
}

function makeDescriptionRuleKey_(description) {
  return String(description || '')
    .toLowerCase()
    .replace(/\b\d{5,}\b/g, '')
    .replace(/[^a-z]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join(' ');
}

function suggestCategoryForDescription_(description, transactionType, categories) {
  var text = String(description || '').toLowerCase();
  var desiredName = '';
  if (/emtl|electronic money transfer levy|sms service|bank charge|service charge|withholding tax|witholding tax|\bfee\b|\bvat\b/.test(text)) {
    desiredName = transactionType === TRANSACTION_TYPES.MONEY_OUT ? 'Banking Charges' : '';
  } else if (/credit interest|interest capitalized|interest received/.test(text)) {
    desiredName = 'Interest Received';
  } else if (/membership dues|annual dues|monthly dues|\bdues\b/.test(text)) {
    desiredName = 'Membership Dues';
  } else if (/burial|condolence|welfare/.test(text)) {
    desiredName = transactionType === TRANSACTION_TYPES.MONEY_IN ? 'Welfare Contributions' : 'Welfare Support';
  }
  var match = (categories || []).filter(function(category) {
    return category.categoryType === transactionType && category.categoryName.toLowerCase() === desiredName.toLowerCase();
  })[0];
  return match ? match.categoryId : '';
}

function commitStatementWorkbench(payload) {
  var user = requireFinanceOfficerOrSystemAdmin();
  requireCurrentSchema_();
  payload = payload || {};
  var accountId = String(payload.accountId || '').trim();
  var fileName = String(payload.fileName || '').trim();
  var fileId = String(payload.fileId || '').trim();
  var documentId = String(payload.documentId || '').trim();
  var fileHash = String(payload.fileHash || '').trim();
  var sourceFormat = String(payload.sourceFormat || '').trim();
  var parserProfile = String(payload.parserProfile || '').trim();
  var rows = Array.isArray(payload.rows) ? payload.rows : [];

  validateRequired_({ 'Account ID': accountId, 'File Name': fileName, 'File ID': fileId, 'Document ID': documentId }, ['Account ID', 'File Name', 'File ID', 'Document ID']);
  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', accountId, false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Please choose an active account.');
  }
  var document = findRecordByValue(getSheetByName('Documents'), 'Document ID', documentId, false);
  if (!document
    || String(document['File ID']) !== fileId
    || String(document['Document Type'] || '').toLowerCase().indexOf('bank statement') === -1) {
    throw new Error('The stored statement evidence could not be verified. Preview the file again.');
  }
  if (payload.draftId) {
    var sourceDraft = findRecordByValue(getSheetByName('Bank Statement Imports'), 'Import ID', String(payload.draftId), false);
    if (!sourceDraft || sourceDraft['Review Status'] !== 'Draft' || !canManageStatementDraft_(sourceDraft, user)) {
      throw new Error('The saved statement review is not available to this officer.');
    }
  }

  var selected = rows.filter(function(row) { return row && row.include !== false && row.Include !== false; });
  if (!selected.length) {
    throw new Error('Select at least one statement row.');
  }
  var cleaned = selected.map(function(row, index) {
    var clean = cleanPdfBankLineRow_(row);
    clean.statementDate = normalizeImportedDate_(row.statementDate || row['Statement Date']);
    if (!clean.description) {
      throw new Error('Row ' + (index + 1) + ' needs a description.');
    }
    if (clean.moneyIn <= 0 && clean.moneyOut <= 0) {
      throw new Error('Row ' + (index + 1) + ' needs either Money In or Money Out.');
    }
    if (clean.moneyIn > 0 && clean.moneyOut > 0) {
      throw new Error('Row ' + (index + 1) + ' cannot contain both Money In and Money Out.');
    }
    clean.rowNumber = Number(row.rowNumber || index + 1);
    clean.sourceText = String(row.sourceText || row['Raw Source Text'] || '').trim();
    clean.confidence = String(row.confidence || 'Manual').trim();
    clean.balanceCheck = String(row.balanceCheck || '').trim();
    clean.reviewReason = String(row.reviewReason || '').trim();
    clean.categoryId = String(row.categoryId || row['Category ID'] || '').trim();
    clean.fundId = String(row.fundId || row['Fund ID'] || '').trim();
    clean.counterparty = String(row.counterparty || row['Payer or Payee'] || '').trim();
    clean.evidenceDocumentId = String(row.evidenceDocumentId || row['Evidence Document ID'] || '').trim();
    clean.resolution = String(row.resolution || 'Classify').trim();
    clean.splits = Array.isArray(row.splits) && row.splits.length
      ? cleanBankLineCategorySplits_({ Splits: row.splits }, clean.moneyIn > 0 ? TRANSACTION_TYPES.MONEY_IN : TRANSACTION_TYPES.MONEY_OUT, clean.moneyIn > 0 ? clean.moneyIn : clean.moneyOut)
      : [];
    validateOptionalDocument_(clean.evidenceDocumentId);
    assertAccountingPeriodOpen_(accountId, clean.statementDate);
    return clean;
  });

  var categories = {};
  getSheetRecords(getSheetByName('Categories')).forEach(function(category) { categories[category['Category ID']] = category; });
  cleaned.forEach(function(row, index) {
    validateOptionalFund_(row.fundId);
    if (row.splits.length || !row.categoryId || row.resolution === 'Needs Review') {
      return;
    }
    var expectedType = row.moneyIn > 0 ? TRANSACTION_TYPES.MONEY_IN : TRANSACTION_TYPES.MONEY_OUT;
    var category = categories[row.categoryId];
    if (!category || category.Status !== 'Active' || category['Category Type'] !== expectedType) {
      throw new Error('Row ' + (index + 1) + ' has an invalid category for ' + expectedType + '.');
    }
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    cleaned.forEach(function(row) {
      assertAccountingPeriodOpen_(accountId, row.statementDate);
    });
    var importSheet = getSheetByName('Bank Statement Imports');
    var lineSheet = getSheetByName('Bank Statement Lines');
    var transactionSheet = getSheetByName('Transactions');
    var importId = getNextId_('Bank Statement Imports', 'IMP');
    var bankSequence = Number(getNextId_('Bank Statement Lines', 'BANK').split('-')[1]);
    var transactionSequence = Number(getNextId_('Transactions', 'TXN').split('-')[1]);
    var existingKeys = {};
    getSheetRecords(lineSheet).forEach(function(line) {
      existingKeys[makeBankLineKey_(line['Account ID'], {
        statementDate: line['Statement Date'], description: line.Description, moneyIn: line['Money In'], moneyOut: line['Money Out'], referenceNumber: line['Reference Number']
      })] = true;
    });
    var batchKeys = {};
    var lineRows = [];
    var transactionRows = [];
    var transactionEvidenceLinks = [];
    var duplicateCount = 0;
    var reviewCount = 0;
    var now = nowIso();

    cleaned.forEach(function(row) {
      var bankLineId = makeId('BANK', bankSequence++);
      var key = makeBankLineKey_(accountId, row);
      var duplicate = Boolean(existingKeys[key] || batchKeys[key]);
      batchKeys[key] = true;
      var needsReview = row.resolution === 'Needs Review' || (!row.categoryId && !row.splits.length);
      var status = duplicate ? 'Duplicate Quarantined' : (needsReview ? MATCH_STATUS.NEEDS_REVIEW : MATCH_STATUS.READY_TO_PUBLISH);
      var lineCategoryId = row.splits.length === 1 ? row.splits[0].categoryId : row.categoryId;
      var lineFundId = row.splits.length === 1 ? row.splits[0].fundId : row.fundId;
      if (duplicate) { duplicateCount++; }
      if (needsReview) { reviewCount++; }
      lineRows.push(makeRowForHeaders_(lineSheet, {
        'Bank Line ID': bankLineId,
        'Import ID': importId,
        'Account ID': accountId,
        'Statement Date': row.statementDate,
        Description: row.description,
        'Money In': row.moneyIn,
        'Money Out': row.moneyOut,
        'Running Balance': row.runningBalance,
        'Reference Number': row.referenceNumber,
        Status: status,
        Notes: (row.notes || row.reviewReason) + (row.splits.length > 1 ? ((row.notes || row.reviewReason) ? ' ' : '') + 'Split into ' + row.splits.length + ' classifications.' : ''),
        'Document ID': documentId,
        'Created At': now,
        'Updated At': now,
        'Row Number': row.rowNumber,
        'Raw Source Text': row.sourceText,
        'Extraction Confidence': row.confidence,
        'Category ID': lineCategoryId,
        'Fund ID': lineFundId,
        Counterparty: row.counterparty,
        'Review Status': duplicate ? 'Duplicate Quarantined' : (needsReview ? 'Needs Review' : 'Classified'),
        'Source File Hash': fileHash,
        'Is Duplicate': duplicate ? 'Yes' : 'No'
      }));

      if (!duplicate && !needsReview) {
        var transactionType = row.moneyIn > 0 ? TRANSACTION_TYPES.MONEY_IN : TRANSACTION_TYPES.MONEY_OUT;
        var preparedSplits = row.splits.length ? row.splits : [{
          amount: row.moneyIn > 0 ? row.moneyIn : row.moneyOut,
          categoryId: row.categoryId,
          fundId: row.fundId,
          payerOrPayee: row.counterparty,
          description: row.description
        }];
        var preparedTransactionIds = [];
        preparedSplits.forEach(function(split, splitIndex) {
          var transactionId = makeId('TXN', transactionSequence++);
          preparedTransactionIds.push(transactionId);
          transactionRows.push(makeRowForHeaders_(transactionSheet, {
            'Transaction ID': transactionId,
            'Transaction Type': transactionType,
            Date: row.statementDate,
            Amount: split.amount,
            'Account ID': accountId,
            'Payer or Payee': split.payerOrPayee || row.counterparty || row.description,
            'Category ID': split.categoryId,
            Description: split.description || row.description,
            'Reference Number': row.referenceNumber,
            'Payment Method': 'Bank Statement',
            'Fund ID': split.fundId || '',
            'Document ID': row.evidenceDocumentId || documentId,
            'Entered By': user.email,
            Status: TRANSACTION_STATUS.SUBMITTED,
            'Submitted At': now,
            Reason: 'Created from bank statement line ' + bankLineId + (preparedSplits.length > 1 ? ' split ' + (splitIndex + 1) + ' of ' + preparedSplits.length : '') + (row.notes ? '. Note: ' + row.notes : ''),
            'Created At': now,
            'Updated At': now,
            'Source Bank Line ID': bankLineId
          }));
        });
      }
      if (row.evidenceDocumentId) {
        transactionEvidenceLinks.push({
          documentId: row.evidenceDocumentId,
          recordType: preparedTransactionIds && preparedTransactionIds.length === 1 ? 'Transaction' : 'Bank Statement Line',
          recordId: preparedTransactionIds && preparedTransactionIds.length === 1 ? preparedTransactionIds[0] : bankLineId
        });
      }
    });

    var statementDates = cleaned.map(function(row) { return row.statementDate; }).sort();
    appendRecordByHeaders_(importSheet, {
      'Import ID': importId,
      'Account ID': accountId,
      'File ID': fileId,
      'File Name': fileName,
      'File Hash': fileHash,
      'Import Status': 'Processing',
      'Imported By': user.email,
      'Imported At': now,
      'Rows Imported': 0,
      'Source Format': sourceFormat,
      'Parser Profile': parserProfile,
      'Statement Start': statementDates[0],
      'Statement End': statementDates[statementDates.length - 1],
      'Review Status': 'Processing'
    });
    var processingImport = findRecordByValue(importSheet, 'Import ID', importId, false);
    try {
      if (lineRows.length) {
        lineSheet.getRange(lineSheet.getLastRow() + 1, 1, lineRows.length, lineRows[0].length).setValues(lineRows);
      }
      if (transactionRows.length) {
        transactionSheet.getRange(transactionSheet.getLastRow() + 1, 1, transactionRows.length, transactionRows[0].length).setValues(transactionRows);
      }
      transactionEvidenceLinks.forEach(function(link) {
        linkDocumentToRecord_(link.documentId, link.recordType, link.recordId, 'Optional evidence attached during statement review');
      });
      organizeStatementFileByYear_(fileId, statementDates[0]);
      updateRecordByHeaders(importSheet, processingImport._rowNumber, {
        'Import Status': duplicateCount ? BANK_IMPORT_STATUS.DUPLICATE_WARNING : BANK_IMPORT_STATUS.IMPORTED,
        'Rows Imported': lineRows.length,
        'Duplicate Warning': duplicateCount ? duplicateCount + ' duplicate row(s) quarantined.' : '',
        'Review Status': reviewCount ? 'Needs Review' : 'Classified'
      });
    } catch (writeError) {
      updateRecordByHeaders(importSheet, processingImport._rowNumber, {
        'Import Status': 'Failed - recovery required',
        'Review Status': 'Recovery Required',
        'Error Details': String(writeError && writeError.message ? writeError.message : writeError)
      });
      throw writeError;
    }
    linkDocumentToRecord_(documentId, 'Bank Statement Import', importId, 'Original evidence for ' + importId);
    safeWriteAuditLog_('Statement workbench committed', 'Bank Statement Import', importId, '', {
      sourceFormat: sourceFormat,
      rows: lineRows.length,
      transactionsPrepared: transactionRows.length,
      duplicatesQuarantined: duplicateCount,
      needsReview: reviewCount
    }, 'Finance Officer reviewed and classified statement rows');
    if (payload.draftId) {
      completeStatementDraft_(String(payload.draftId), importId, user);
    }
    return {
      ok: true,
      importId: importId,
      rowsImported: lineRows.length,
      transactionsPrepared: transactionRows.length,
      duplicateCount: duplicateCount,
      reviewCount: reviewCount
    };
  } finally {
    lock.releaseLock();
  }
}

function validateStatementFileSignature_(fileName, bytes) {
  var lower = String(fileName || '').toLowerCase();
  var unsigned = (bytes || []).slice(0, 1024).map(function(value) { return value < 0 ? value + 256 : value; });
  if (/\.pdf$/.test(lower) && !bytesContainAscii_(unsigned, '%PDF')) {
    throw new Error('This file is named as a PDF but does not contain a valid PDF header.');
  }
  if (/\.xlsx$/.test(lower) && !(unsigned[0] === 80 && unsigned[1] === 75)) {
    throw new Error('This file is named as Excel XLSX but does not contain a valid XLSX package.');
  }
  if (/\.xls$/.test(lower) && !(unsigned[0] === 208 && unsigned[1] === 207 && unsigned[2] === 17 && unsigned[3] === 224)) {
    throw new Error('This file is named as Excel XLS but does not contain a valid XLS workbook.');
  }
  if (/\.csv$/.test(lower) && unsigned.some(function(value) { return value === 0; })) {
    throw new Error('This CSV appears to be a binary file. Export it as CSV and try again.');
  }
}

function bytesContainAscii_(bytes, text) {
  var expected = String(text || '').split('').map(function(character) { return character.charCodeAt(0); });
  for (var i = 0; i <= bytes.length - expected.length; i++) {
    var matches = true;
    for (var j = 0; j < expected.length; j++) {
      if (bytes[i + j] !== expected[j]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }
  return false;
}

function organizeStatementFileByYear_(fileId, statementDate) {
  try {
    var year = String(statementDate || '').slice(0, 4);
    if (!/^\d{4}$/.test(year)) {
      return;
    }
    var root = DriveApp.getFolderById(getSettingValue_(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID));
    var yearFolder = getOrCreateFolder_(root, year);
    DriveApp.getFileById(fileId).moveTo(yearFolder);
  } catch (error) {
    console.error('Statement evidence could not be moved into its year folder: ' + error.message);
  }
}

function saveStatementReviewDraft(payload) {
  var user = requireFinanceOfficerOrSystemAdmin();
  requireCurrentSchema_();
  payload = payload || {};
  var accountId = String(payload.accountId || '').trim();
  var documentId = String(payload.documentId || '').trim();
  var fileId = String(payload.fileId || '').trim();
  var rows = Array.isArray(payload.rows) ? payload.rows : [];
  validateRequired_({ 'Account ID': accountId, 'Document ID': documentId, 'File ID': fileId, Rows: rows.length }, ['Account ID', 'Document ID', 'File ID', 'Rows']);
  if (!rows.length) {
    throw new Error('There are no statement rows to save.');
  }
  var document = findRecordByValue(getSheetByName('Documents'), 'Document ID', documentId, false);
  if (!document || String(document['File ID']) !== fileId) {
    throw new Error('The original statement evidence could not be verified.');
  }
  var requestedDraftId = String(payload.draftId || '').trim();
  var draftId = requestedDraftId || ('DRF-' + Utilities.getUuid().split('-')[0].toUpperCase());
  var draftPayload = {
    draftId: draftId,
    accountId: accountId,
    fileName: String(payload.fileName || ''),
    fileId: fileId,
    documentId: documentId,
    fileHash: String(payload.fileHash || ''),
    sourceFormat: String(payload.sourceFormat || ''),
    parserProfile: String(payload.parserProfile || ''),
    duplicateFile: Boolean(payload.duplicateFile),
    rows: rows,
    savedAt: nowIso(),
    savedBy: user.email
  };
  var folder = DriveApp.getFolderById(getSettingValue_(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID));
  if (requestedDraftId) {
    var existingDraft = findRecordByValue(getSheetByName('Bank Statement Imports'), 'Import ID', requestedDraftId, false);
    if (!existingDraft || existingDraft['Review Status'] !== 'Draft' || !existingDraft['Draft File ID']) {
      throw new Error('The statement draft can no longer be updated. Save it as a new review.');
    }
    if (!canManageStatementDraft_(existingDraft, user)) {
      throw new Error('Only the officer who saved this draft or a System Administrator can update it.');
    }
    DriveApp.getFileById(existingDraft['Draft File ID']).setContent(JSON.stringify(draftPayload));
    updateRecordByHeaders(getSheetByName('Bank Statement Imports'), existingDraft._rowNumber, {
      'Imported At': draftPayload.savedAt,
      'Imported By': user.email,
      'Parser Profile': draftPayload.parserProfile
    });
    safeWriteAuditLog_('Statement review draft updated', 'Bank Statement Import', draftId, '', { rowCount: rows.length }, 'Finance Officer updated a saved statement review');
    return { ok: true, draftId: draftId };
  }
  var draftFile = folder.createFile(Utilities.newBlob(JSON.stringify(draftPayload), 'application/json', draftId + '-statement-review.json'));
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    appendRecordByHeaders_(getSheetByName('Bank Statement Imports'), {
      'Import ID': draftId,
      'Account ID': accountId,
      'File ID': fileId,
      'File Name': draftPayload.fileName,
      'File Hash': draftPayload.fileHash,
      'Import Status': BANK_IMPORT_STATUS.PREVIEWED,
      'Imported By': user.email,
      'Imported At': draftPayload.savedAt,
      'Rows Imported': 0,
      'Source Format': draftPayload.sourceFormat,
      'Parser Profile': draftPayload.parserProfile,
      'Review Status': 'Draft',
      'Draft File ID': draftFile.getId()
    });
  } finally {
    lock.releaseLock();
  }
  safeWriteAuditLog_('Statement review draft saved', 'Bank Statement Import', draftId, '', {
    fileName: draftPayload.fileName,
    rowCount: rows.length
  }, 'Finance Officer saved a statement review to resume later');
  return { ok: true, draftId: draftId };
}

function resumeStatementReviewDraft(draftId) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.SYSTEM_ADMIN]);
  var draft = findRecordByValue(getSheetByName('Bank Statement Imports'), 'Import ID', String(draftId || '').trim(), false);
  if (!draft || draft['Review Status'] !== 'Draft' || !draft['Draft File ID']) {
    throw new Error('Statement review draft not found.');
  }
  if (!canManageStatementDraft_(draft, user)) {
    throw new Error('Only the officer who saved this draft or a System Administrator can open it.');
  }
  try {
    return JSON.parse(DriveApp.getFileById(draft['Draft File ID']).getBlob().getDataAsString());
  } catch (error) {
    throw new Error('The saved statement draft could not be read. Ask the System Administrator to check the draft file.');
  }
}

function getStatementEvidenceForReview(documentId) {
  requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);
  var document = findRecordByValue(getSheetByName('Documents'), 'Document ID', String(documentId || '').trim(), false);
  if (!document || !document['File ID']) {
    throw new Error('Statement evidence not found.');
  }
  var blob = DriveApp.getFileById(document['File ID']).getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > 10 * 1024 * 1024) {
    throw new Error('Statement evidence is too large to display inside the app.');
  }
  return {
    fileName: document['File Name'],
    mimeType: blob.getContentType() || 'application/pdf',
    base64: Utilities.base64Encode(bytes)
  };
}

function discardStatementReviewDraft(draftId) {
  var user = requireFinanceOfficerOrSystemAdmin();
  var sheet = getSheetByName('Bank Statement Imports');
  var draft = findRecordByValue(sheet, 'Import ID', String(draftId || '').trim(), false);
  if (!draft || draft['Review Status'] !== 'Draft') {
    throw new Error('Statement review draft not found.');
  }
  if (!canManageStatementDraft_(draft, user)) {
    throw new Error('Only the officer who saved this draft or a System Administrator can discard it.');
  }
  if (draft['Draft File ID']) {
    try { DriveApp.getFileById(draft['Draft File ID']).setTrashed(true); } catch (error) { console.error(error.message); }
  }
  updateRecordByHeaders(sheet, draft._rowNumber, {
    'Import Status': 'Discarded',
    'Review Status': 'Discarded',
    'Error Details': 'Discarded by ' + user.email + ' at ' + nowIso()
  });
  safeWriteAuditLog_('Statement review draft discarded', 'Bank Statement Import', draft['Import ID'], draft, { status: 'Discarded' }, 'Finance Officer discarded a saved review draft');
  return { ok: true, draftId: draft['Import ID'] };
}

function completeStatementDraft_(draftId, completedImportId, user) {
  var sheet = getSheetByName('Bank Statement Imports');
  var draft = findRecordByValue(sheet, 'Import ID', draftId, false);
  if (!draft || draft['Review Status'] !== 'Draft') {
    return;
  }
  if (!canManageStatementDraft_(draft, user)) {
    throw new Error('Only the officer who saved this draft or a System Administrator can complete it.');
  }
  if (draft['Draft File ID']) {
    try { DriveApp.getFileById(draft['Draft File ID']).setTrashed(true); } catch (error) { console.error(error.message); }
  }
  updateRecordByHeaders(sheet, draft._rowNumber, {
    'Import Status': 'Completed as ' + completedImportId,
    'Review Status': 'Completed',
    'Error Details': 'Completed as ' + completedImportId
  });
}

function canManageStatementDraft_(draft, user) {
  return hasAnyRole(user.roles, [ROLES.SYSTEM_ADMIN])
    || normalizeEmail(draft['Imported By']) === normalizeEmail(user.email);
}

function repairFailedStatementImport(importId) {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var importSheet = getSheetByName('Bank Statement Imports');
  var statementImport = findRecordByValue(importSheet, 'Import ID', String(importId || '').trim(), false);
  if (!statementImport || statementImport['Review Status'] !== 'Recovery Required') {
    throw new Error('This statement import is not marked for recovery.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var lineRecords = getSheetRecords(getSheetByName('Bank Statement Lines')).filter(function(line) { return line['Import ID'] === statementImport['Import ID']; });
    var transactionSheet = getSheetByName('Transactions');
    var existingSources = {};
    getSheetRecords(transactionSheet).forEach(function(transaction) {
      var sourceId = getSourceBankLineIdFromTransaction_(transaction);
      if (sourceId) { existingSources[sourceId] = true; }
    });
    var nextSequence = Number(getNextId_('Transactions', 'TXN').split('-')[1]);
    var now = nowIso();
    var transactionRows = [];
    var needsReview = 0;
    lineRecords.forEach(function(line) {
      if (line.Status !== MATCH_STATUS.READY_TO_PUBLISH || existingSources[line['Bank Line ID']]) {
        if (line.Status === MATCH_STATUS.NEEDS_REVIEW) { needsReview++; }
        return;
      }
      var moneyIn = parseMoney_(line['Money In']);
      var moneyOut = parseMoney_(line['Money Out']);
      var transactionType = moneyIn > 0 ? TRANSACTION_TYPES.MONEY_IN : TRANSACTION_TYPES.MONEY_OUT;
      var category = findRecordByValue(getSheetByName('Categories'), 'Category ID', line['Category ID'], false);
      if (!category || category.Status !== 'Active' || category['Category Type'] !== transactionType) {
        updateRecordByHeaders(getSheetByName('Bank Statement Lines'), line._rowNumber, { Status: MATCH_STATUS.NEEDS_REVIEW, 'Review Status': 'Recovery Needs Classification' });
        needsReview++;
        return;
      }
      transactionRows.push(makeRowForHeaders_(transactionSheet, {
        'Transaction ID': makeId('TXN', nextSequence++),
        'Transaction Type': transactionType,
        Date: normalizeImportedDate_(line['Statement Date']),
        Amount: moneyIn > 0 ? moneyIn : moneyOut,
        'Account ID': line['Account ID'],
        'Payer or Payee': line.Counterparty || line.Description,
        'Category ID': line['Category ID'],
        Description: line.Description,
        'Reference Number': line['Reference Number'],
        'Payment Method': 'Recovered Bank Statement Import',
        'Fund ID': line['Fund ID'],
        'Document ID': line['Document ID'],
        'Entered By': user.email,
        Status: TRANSACTION_STATUS.SUBMITTED,
        'Submitted At': now,
        Reason: 'Recovered from bank statement line ' + line['Bank Line ID'],
        'Created At': now,
        'Updated At': now,
        'Source Bank Line ID': line['Bank Line ID']
      }));
    });
    if (transactionRows.length) {
      transactionSheet.getRange(transactionSheet.getLastRow() + 1, 1, transactionRows.length, transactionRows[0].length).setValues(transactionRows);
    }
    updateRecordByHeaders(importSheet, statementImport._rowNumber, {
      'Import Status': 'Recovered',
      'Rows Imported': lineRecords.length,
      'Review Status': needsReview ? 'Needs Review' : 'Classified',
      'Error Details': 'Recovered by ' + user.email + ' at ' + now
    });
    safeWriteAuditLog_('Failed statement import repaired', 'Bank Statement Import', statementImport['Import ID'], statementImport, {
      missingTransactionsPrepared: transactionRows.length,
      needsReview: needsReview
    }, 'System Administrator repaired an interrupted statement import');
    return { ok: true, importId: statementImport['Import ID'], transactionsPrepared: transactionRows.length, needsReview: needsReview };
  } finally {
    lock.releaseLock();
  }
}

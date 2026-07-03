var BANK_IMPORT_STATUS = {
  PREVIEWED: 'Previewed',
  IMPORTED: 'Imported',
  DUPLICATE_WARNING: 'Duplicate Warning'
};

function previewBankCsv(fileData) {
  requireAnyRole([ROLES.FINANCE_OFFICER]);
  fileData = fileData || {};

  var fileName = String(fileData.fileName || '').trim();
  var base64 = String(fileData.base64 || '');
  if (!fileName || !base64) {
    throw new Error('Please choose a CSV file.');
  }
  if (!fileName.toLowerCase().match(/\.csv$/)) {
    throw new Error('Only CSV files are accepted here.');
  }

  var content = Utilities.newBlob(Utilities.base64Decode(base64)).getDataAsString();
  var rows = Utilities.parseCsv(content);
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
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
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
  var rows = Utilities.parseCsv(content);
  var headers = rows.shift().map(function(header) {
    return String(header || '').trim();
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var bankFolder = DriveApp.getFolderById(getSettingValue(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID));
    var file = bankFolder.createFile(Utilities.newBlob(Utilities.base64Decode(base64), 'text/csv', fileName));
    var fileHash = makeSimpleHash_(content);
    var duplicateFile = Boolean(findRecordByValue(getSheetByName('Bank Statement Imports'), 'File Hash', fileHash, false));
    var importId = getNextId('Bank Statement Imports', 'IMP');
    var documentId = createBankStatementDocument_(file, fileName, user.email, 'CSV Bank Statement');

    var importedRows = [];
    var duplicateLines = 0;
    rows.forEach(function(row) {
      if (!row.some(String)) {
        return;
      }

      var line = mapCsvRowToBankLine_(headers, row, mapping);
      if (!line.description && !line.moneyIn && !line.moneyOut) {
        return;
      }
      var duplicateLine = isDuplicateBankLine_(accountId, line);
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
        duplicateLine ? 'Duplicate Warning' : 'Imported',
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
      .setValues(importedRows);

    getSheetByName('Bank Statement Imports').appendRow([
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

    writeAuditLog('Bank CSV imported', 'Bank Statement Import', importId, '', {
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
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
  fileData = fileData || {};

  var fileName = String(fileData.fileName || '').trim();
  var base64 = String(fileData.base64 || '').trim();
  if (!fileName || !base64) {
    throw new Error('Please choose a PDF bank statement.');
  }
  if (!fileName.toLowerCase().match(/\.pdf$/)) {
    throw new Error('Only PDF files are accepted here.');
  }

  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > 10 * 1024 * 1024) {
    throw new Error('File is too large. Maximum size is 10 MB.');
  }

  var folder = DriveApp.getFolderById(getSettingValue(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID));
  var file = folder.createFile(Utilities.newBlob(bytes, 'application/pdf', fileName));
  var documentId = createBankStatementDocument_(file, fileName, user.email, 'PDF Bank Statement');

  writeAuditLog('PDF bank statement uploaded', 'Document', documentId, '', { fileName: fileName }, 'PDF statement stored as evidence');
  return { ok: true, documentId: documentId, fileId: file.getId(), fileName: fileName };
}

function addManualBankStatementLine(record) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
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
    var bankLineId = getNextId('Bank Statement Lines', 'BANK');
    getSheetByName('Bank Statement Lines').appendRow([
      bankLineId,
      '',
      clean['Account ID'],
      clean['Statement Date'],
      clean.Description,
      moneyIn,
      moneyOut,
      parseMoney_(clean['Running Balance']),
      clean['Reference Number'],
      duplicate ? 'Duplicate Warning' : 'Manual Entry',
      clean.Notes,
      clean['Document ID'],
      nowIso(),
      nowIso()
    ]);

    writeAuditLog('Manual bank statement line entered', 'Bank Statement Line', bankLineId, '', clean, 'Finance Officer entered bank line manually');
    return { ok: true, bankLineId: bankLineId, duplicateWarning: duplicate };
  } finally {
    lock.releaseLock();
  }
}

function getBankStatementData() {
  requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);

  return {
    accounts: getActiveAccounts_(),
    imports: getSheetRecords(getSheetByName('Bank Statement Imports')).slice(-20).reverse().map(function(item) {
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
        notes: line.Notes
      };
    })
  };
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
    lookup[String(header).trim().toLowerCase()] = header;
  });

  for (var i = 0; i < options.length; i++) {
    if (lookup[options[i]]) {
      return lookup[options[i]];
    }
  }
  return '';
}

function mapCsvRowToBankLine_(headers, row, mapping) {
  function valueFor(headerName) {
    var index = headers.indexOf(headerName);
    return index === -1 ? '' : row[index];
  }

  var moneyIn = parseMoney_(valueFor(mapping.moneyIn));
  var moneyOut = parseMoney_(valueFor(mapping.moneyOut));
  var amount = parseMoney_(valueFor(mapping.amount));
  if (!moneyIn && !moneyOut && amount) {
    if (amount > 0) {
      moneyIn = amount;
    } else {
      moneyOut = Math.abs(amount);
    }
  }

  return {
    statementDate: String(valueFor(mapping.date) || '').trim(),
    description: String(valueFor(mapping.description) || '').trim(),
    moneyIn: moneyIn,
    moneyOut: moneyOut,
    runningBalance: parseMoney_(valueFor(mapping.balance)),
    referenceNumber: String(valueFor(mapping.reference) || '').trim(),
    notes: ''
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
  return [
    String(accountId || '').trim(),
    String(line.statementDate || '').trim(),
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
  var documentId = getNextId('Documents', 'DOC');
  getSheetByName('Documents').appendRow([
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

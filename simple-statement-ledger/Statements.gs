function getStatementWorkspace() {
  requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.SYSTEM_ADMIN]);
  return {
    accounts: getActiveAccounts_(),
    categories: getActiveCategories_(),
    members: getSheetRecords(getSheetByName('Members')).filter(function(member) { return member.Status === 'Active'; }).map(function(member) {
      return { memberId: member['Member ID'], name: member['Preferred Name'] || member['Full Name'] };
    }),
    bankLines: getRecentBankLines_(),
    summary: getClassificationProgress_()
  };
}

function previewStatementCsv(fileData) {
  requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.SYSTEM_ADMIN]);
  var text = decodeTextFile_(fileData || {});
  return previewStatementText_(text, 'CSV');
}

function previewPastedStatementRows(text) {
  requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.SYSTEM_ADMIN]);
  return previewStatementText_(String(text || ''), 'Pasted Rows');
}

function importStatementRows(payload) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.SYSTEM_ADMIN]);
  payload = payload || {};
  var accountId = String(payload.accountId || '').trim();
  var rows = payload.rows || [];
  if (!accountId) {
    throw new Error('Choose the bank account for this statement.');
  }
  if (!rows.length) {
    throw new Error('No rows were provided.');
  }
  var account = findRecordByValue(getSheetByName('Bank Accounts'), 'Account ID', accountId, false);
  if (!account || account.Status !== 'Active') {
    throw new Error('Choose an active bank account.');
  }

  var importId = getNextId('Statement Imports', 'IMP');
  getSheetByName('Statement Imports').appendRow([
    importId,
    accountId,
    String(payload.sourceType || 'Imported Rows'),
    String(payload.fileName || ''),
    String(payload.documentId || ''),
    user.email,
    nowIso(),
    rows.length,
    String(payload.notes || '')
  ]);

  var bankLineSheet = getSheetByName('Bank Lines');
  rows.map(cleanBankLineRow_).forEach(function(line) {
    bankLineSheet.appendRow([
      getNextId('Bank Lines', 'BNK'),
      importId,
      accountId,
      line.statementDate,
      line.description,
      line.referenceNumber,
      line.moneyIn,
      line.moneyOut,
      line.runningBalance,
      String(payload.sourceType || 'Imported Rows'),
      'Unclassified',
      '',
      nowIso(),
      nowIso()
    ]);
  });

  writeAuditLog('Statement rows imported', 'Statement Import', importId, '', { accountId: accountId, rows: rows.length }, 'Finance Officer imported bank statement rows');
  return { ok: true, importId: importId, rowsImported: rows.length };
}

function uploadStatementPdf(fileData) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.SYSTEM_ADMIN]);
  fileData = fileData || {};
  var fileName = String(fileData.fileName || '').trim();
  var mimeType = String(fileData.mimeType || '').trim();
  var base64 = String(fileData.base64 || '');
  if (!fileName || !base64) {
    throw new Error('Choose a PDF statement file.');
  }
  if (mimeType !== 'application/pdf') {
    throw new Error('Only PDF files are accepted here.');
  }
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > 10 * 1024 * 1024) {
    throw new Error('PDF is too large. Maximum size is 10 MB.');
  }
  var folder = DriveApp.getFolderById(getSettingValue(SETTINGS_KEYS.STATEMENTS_FOLDER_ID));
  var file = folder.createFile(Utilities.newBlob(bytes, mimeType, fileName));
  var documentId = getNextId('Documents', 'DOC');
  getSheetByName('Documents').appendRow([documentId, file.getId(), fileName, 'Bank Statement PDF', '', user.email, nowIso(), 'Stored for manual entry or evidence']);
  writeAuditLog('PDF statement uploaded', 'Document', documentId, '', { fileName: fileName }, 'Finance Officer uploaded PDF statement');
  return { ok: true, documentId: documentId, fileId: file.getId() };
}

function addManualBankLine(record) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.SYSTEM_ADMIN]);
  var clean = cleanBankLineRow_(record || {});
  var accountId = String((record || {}).accountId || '').trim();
  if (!accountId) {
    throw new Error('Choose the bank account.');
  }
  var bankLineId = getNextId('Bank Lines', 'BNK');
  getSheetByName('Bank Lines').appendRow([
    bankLineId,
    'MANUAL',
    accountId,
    clean.statementDate,
    clean.description,
    clean.referenceNumber,
    clean.moneyIn,
    clean.moneyOut,
    clean.runningBalance,
    'Manual Entry',
    'Unclassified',
    String((record || {}).reviewNote || ''),
    nowIso(),
    nowIso()
  ]);
  writeAuditLog('Manual bank line added', 'Bank Line', bankLineId, '', clean, 'Finance Officer manually entered a bank line');
  return { ok: true, bankLineId: bankLineId };
}

function saveBankLineClassification(bankLineId, splits) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.SYSTEM_ADMIN]);
  var bankLineSheet = getSheetByName('Bank Lines');
  var bankLine = findRecordByValue(bankLineSheet, 'Bank Line ID', bankLineId, false);
  if (!bankLine) {
    throw new Error('Bank line was not found.');
  }
  var cleanSplits = cleanClassificationSplits_(bankLine, splits || []);
  var lineAmount = getBankLineAmount_(bankLine);
  var splitTotal = Math.round(cleanSplits.reduce(function(total, split) {
    return total + split.amount;
  }, 0) * 100) / 100;
  if (splitTotal !== Math.abs(lineAmount)) {
    throw new Error('Split total must equal the bank line amount.');
  }

  replaceExistingClassifications_(bankLineId);
  var sheet = getSheetByName('Classifications');
  cleanSplits.forEach(function(split) {
    sheet.appendRow([
      getNextId('Classifications', 'CLS'),
      bankLineId,
      split.categoryId,
      split.memberId,
      split.amount,
      lineAmount >= 0 ? 'Money In' : 'Money Out',
      split.notes,
      'Active',
      user.email,
      nowIso(),
      nowIso()
    ]);
  });
  updateRecordByHeaders(bankLineSheet, bankLine._rowNumber, {
    'Classification Status': cleanSplits.some(function(split) { return split.categoryType === 'Review'; }) ? 'Needs Review' : 'Classified',
    'Updated At': nowIso()
  });
  writeAuditLog('Bank line classified', 'Bank Line', bankLineId, bankLine, cleanSplits, 'Bank line was classified or split');
  return { ok: true, bankLineId: bankLineId, splitCount: cleanSplits.length };
}

function previewStatementText_(text, sourceType) {
  var rows = parseLooseRows_(text).slice(0, 100).map(function(row) {
    try {
      return cleanBankLineRow_({
        statementDate: row[0] || '',
        description: row[1] || '',
        moneyIn: row[2] || '',
        moneyOut: row[3] || '',
        runningBalance: row[4] || '',
        referenceNumber: row[5] || ''
      });
    } catch (error) {
      return null;
    }
  }).filter(function(row) {
    return Boolean(row);
  });
  return { sourceType: sourceType, rows: rows };
}

function parseLooseRows_(text) {
  return String(text || '').split(/\r?\n/).map(function(line) {
    return line.indexOf('\t') !== -1 ? line.split('\t') : line.split(',');
  }).map(function(row) {
    return row.map(function(cell) { return String(cell || '').trim().replace(/^"|"$/g, ''); });
  }).filter(function(row) {
    return row.some(Boolean);
  });
}

function decodeTextFile_(fileData) {
  if (!fileData.base64) {
    throw new Error('Choose a CSV or text file.');
  }
  return Utilities.newBlob(Utilities.base64Decode(fileData.base64), fileData.mimeType || 'text/plain').getDataAsString();
}

function cleanBankLineRow_(record) {
  var clean = {
    statementDate: normalizeDateInput_(record.statementDate || record['Statement Date'] || record.Date || ''),
    description: String(record.description || record.Description || '').trim(),
    referenceNumber: String(record.referenceNumber || record['Reference Number'] || '').trim(),
    moneyIn: parseMoney_(record.moneyIn || record['Money In'] || 0),
    moneyOut: parseMoney_(record.moneyOut || record['Money Out'] || 0),
    runningBalance: parseMoney_(record.runningBalance || record['Running Balance'] || 0)
  };
  if (!clean.description) {
    throw new Error('Description is required for every bank line.');
  }
  if (clean.moneyIn > 0 && clean.moneyOut > 0) {
    throw new Error('A bank line cannot have both money in and money out.');
  }
  if (clean.moneyIn <= 0 && clean.moneyOut <= 0) {
    throw new Error('Enter either Money In or Money Out.');
  }
  return clean;
}

function cleanClassificationSplits_(bankLine, splits) {
  if (!splits.length) {
    throw new Error('Add at least one classification.');
  }
  var categories = {};
  getActiveCategories_().forEach(function(category) {
    categories[category.categoryId] = category;
  });
  return splits.map(function(split) {
    var categoryId = String(split.categoryId || '').trim();
    if (!categories[categoryId]) {
      throw new Error('Choose a valid category.');
    }
    var amount = parseMoney_(split.amount);
    if (amount <= 0) {
      throw new Error('Each split amount must be greater than zero.');
    }
    return {
      categoryId: categoryId,
      categoryType: categories[categoryId].categoryType,
      memberId: String(split.memberId || '').trim(),
      amount: amount,
      notes: String(split.notes || '').trim()
    };
  });
}

function replaceExistingClassifications_(bankLineId) {
  var sheet = getSheetByName('Classifications');
  getSheetRecords(sheet).filter(function(record) {
    return record['Bank Line ID'] === bankLineId && record.Status === 'Active';
  }).forEach(function(record) {
    updateRecordByHeaders(sheet, record._rowNumber, { Status: 'Replaced', 'Updated At': nowIso() });
  });
}

function getBankLineAmount_(bankLine) {
  return parseMoney_(bankLine['Money In']) - parseMoney_(bankLine['Money Out']);
}

function getRecentBankLines_() {
  return getSheetRecords(getSheetByName('Bank Lines')).slice(-100).reverse().map(function(line) {
    return {
      bankLineId: line['Bank Line ID'],
      accountId: line['Account ID'],
      statementDate: formatDisplayDate_(line['Statement Date']),
      description: line.Description,
      referenceNumber: line['Reference Number'],
      moneyIn: parseMoney_(line['Money In']),
      moneyOut: parseMoney_(line['Money Out']),
      runningBalance: parseMoney_(line['Running Balance']),
      sourceType: line['Source Type'],
      classificationStatus: line['Classification Status'],
      reviewNote: line['Review Note']
    };
  });
}

function getClassificationProgress_() {
  var lines = getSheetRecords(getSheetByName('Bank Lines'));
  var classified = lines.filter(function(line) { return line['Classification Status'] === 'Classified'; }).length;
  var needsReview = lines.filter(function(line) { return line['Classification Status'] === 'Needs Review'; }).length;
  return {
    totalLines: lines.length,
    classifiedLines: classified,
    needsReviewLines: needsReview,
    unclassifiedLines: Math.max(0, lines.length - classified - needsReview)
  };
}

function setupStage1(options) {
  options = options || {};
  var scriptOwnerEmail = requireScriptOwnerExecution_();

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var activeEmail = normalizeEmail(options.bootstrapAdminEmail || scriptOwnerEmail);
    var rootFolder = options.rootFolderId
      ? DriveApp.getFolderById(options.rootFolderId)
      : getOrCreateFolder_(DriveApp.getRootFolder(), APP_CONFIG.ROOT_FOLDER_NAME);

    var dataFolder = getOrCreateFolder_(rootFolder, APP_CONFIG.DATA_SPREADSHEET_NAME);
    var bankStatementsFolder = getOrCreateFolder_(rootFolder, 'Bank Statements');
    var currentYear = new Date().getFullYear();
    [String(currentYear), String(currentYear + 1), 'Future Years'].forEach(function(name) {
      getOrCreateFolder_(bankStatementsFolder, name);
    });

    var receiptsFolder = getOrCreateFolder_(rootFolder, 'Receipts and Invoices');
    ['Welfare', 'Projects', 'Events', 'Administration', 'Other'].forEach(function(name) {
      getOrCreateFolder_(receiptsFolder, name);
    });

    var reportsFolder = getOrCreateFolder_(rootFolder, 'Financial Reports');
    ['Monthly', 'Quarterly', 'Annual'].forEach(function(name) {
      getOrCreateFolder_(reportsFolder, name);
    });

    var archiveFolder = getOrCreateFolder_(rootFolder, 'Archive');
    var spreadsheet = getOrCreateDataSpreadsheet_(dataFolder);

    initialiseSheets_(spreadsheet);
    setSettingValue_(SETTINGS_KEYS.DATA_SPREADSHEET_ID, spreadsheet.getId());
    setSettingValue_(SETTINGS_KEYS.ROOT_FOLDER_ID, rootFolder.getId());
    setSettingValue_(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID, bankStatementsFolder.getId());
    setSettingValue_(SETTINGS_KEYS.RECEIPTS_FOLDER_ID, receiptsFolder.getId());
    setSettingValue_(SETTINGS_KEYS.REPORTS_FOLDER_ID, reportsFolder.getId());
    setSettingValue_(SETTINGS_KEYS.ARCHIVE_FOLDER_ID, archiveFolder.getId());
    seedDefaultSettings_(spreadsheet, rootFolder, bankStatementsFolder, receiptsFolder, reportsFolder, archiveFolder);
    seedDefaultCategories_(spreadsheet);
    seedBootstrapAdmin_(spreadsheet, activeEmail);
    protectSheets_(spreadsheet);
    setSettingValue_('DATA_SCHEMA_VERSION', DATA_SCHEMA_VERSION);

    safeWriteAuditLog_('Stage 1 setup completed', 'System', 'Stage 1', '', {
      spreadsheetId: spreadsheet.getId(),
      rootFolderId: rootFolder.getId()
    }, 'Initial foundation setup');

    return {
      ok: true,
      spreadsheetId: spreadsheet.getId(),
      spreadsheetUrl: spreadsheet.getUrl(),
      rootFolderId: rootFolder.getId(),
      rootFolderUrl: rootFolder.getUrl(),
      bootstrapAdminEmail: activeEmail
    };
  } finally {
    lock.releaseLock();
  }
}

function getDataSpreadsheet_() {
  var spreadsheetId = getSettingValue_(SETTINGS_KEYS.DATA_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error('The data spreadsheet is not configured. Run setupStage1() first.');
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function getSheetByName(name) {
  var sheet = getDataSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error('Missing sheet tab: ' + name);
  }
  return sheet;
}

function getOrCreateFolder_(parentFolder, name) {
  var folders = parentFolder.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(name);
}

function getOrCreateDataSpreadsheet_(dataFolder) {
  var files = dataFolder.getFilesByName(APP_CONFIG.DATA_SPREADSHEET_NAME);
  if (files.hasNext()) {
    return SpreadsheetApp.openById(files.next().getId());
  }

  var spreadsheet = SpreadsheetApp.create(APP_CONFIG.DATA_SPREADSHEET_NAME);
  var file = DriveApp.getFileById(spreadsheet.getId());
  dataFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  return spreadsheet;
}

function initialiseSheets_(spreadsheet) {
  SHEET_DEFINITIONS.forEach(function(definition, index) {
    var sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) {
      sheet = index === 0 ? spreadsheet.getSheets()[0] : spreadsheet.insertSheet(definition.name);
      sheet.setName(definition.name);
    }

    ensureSheetHeaders_(sheet, definition.headers);
    sheet.setFrozenRows(1);
    if (sheet.getLastColumn()) {
      sheet.autoResizeColumns(1, sheet.getLastColumn());
    }
  });
}

function ensureSheetHeaders_(sheet, requiredHeaders) {
  var lastColumn = sheet.getLastColumn();
  var existing = lastColumn ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0] : [];
  var hasHeaders = existing.some(function(value) { return String(value || '').trim(); });

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    return;
  }

  var missing = requiredHeaders.filter(function(header) {
    return existing.indexOf(header) === -1;
  });
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
}

function upgradeDataSchema() {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var spreadsheet = getDataSpreadsheet_();
    var preUpgradeBackup = performDataBackup_(user.email, 'Pre-upgrade');
    initialiseSheets_(spreadsheet);
    var migration = migrateStage8Data_();
    setSettingValue_('DATA_SCHEMA_VERSION', DATA_SCHEMA_VERSION);
    upsertSettingRow_(spreadsheet.getSheetByName('Settings'), 'DATA_SCHEMA_VERSION', DATA_SCHEMA_VERSION, 'Current data-sheet structure version', user.email);
    safeWriteAuditLog_('Data schema upgraded', 'System', DATA_SCHEMA_VERSION, '', { schemaVersion: DATA_SCHEMA_VERSION }, 'System Administrator upgraded the data structure');
    return { ok: true, schemaVersion: DATA_SCHEMA_VERSION, migration: migration, backupFileId: preUpgradeBackup.fileId };
  } finally {
    lock.releaseLock();
  }
}

function migrateStage8Data_() {
  var duplicateRowsQuarantined = 0;
  var sourceLinksMigrated = 0;
  var bankLineSheet = getSheetByName('Bank Statement Lines');
  getSheetRecords(bankLineSheet).forEach(function(line) {
    if (line.Status === 'Duplicate Warning') {
      updateRecordByHeaders(bankLineSheet, line._rowNumber, {
        Status: 'Duplicate Quarantined',
        'Review Status': 'Duplicate Quarantined',
        'Is Duplicate': 'Yes',
        'Updated At': nowIso()
      });
      duplicateRowsQuarantined++;
    }
  });
  var transactionSheet = getSheetByName('Transactions');
  getSheetRecords(transactionSheet).forEach(function(transaction) {
    if (transaction['Source Bank Line ID']) {
      return;
    }
    var sourceId = getSourceBankLineIdFromTransaction_(transaction);
    if (sourceId) {
      updateRecordByHeaders(transactionSheet, transaction._rowNumber, { 'Source Bank Line ID': sourceId, 'Updated At': nowIso() });
      sourceLinksMigrated++;
    }
  });
  return {
    duplicateRowsQuarantined: duplicateRowsQuarantined,
    sourceLinksMigrated: sourceLinksMigrated
  };
}

function seedDefaultSettings_(spreadsheet, rootFolder, bankStatementsFolder, receiptsFolder, reportsFolder, archiveFolder) {
  var sheet = spreadsheet.getSheetByName('Settings');
  var email = getActiveUserEmail();
  upsertSettingRow_(sheet, SETTINGS_KEYS.DATA_SPREADSHEET_ID, spreadsheet.getId(), 'Main system data spreadsheet', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.ROOT_FOLDER_ID, rootFolder.getId(), 'Main Google Drive folder', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID, bankStatementsFolder.getId(), 'Bank statement folder', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.RECEIPTS_FOLDER_ID, receiptsFolder.getId(), 'Receipts and invoices folder', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.REPORTS_FOLDER_ID, reportsFolder.getId(), 'Financial reports folder', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.ARCHIVE_FOLDER_ID, archiveFolder.getId(), 'Monthly backups folder', email);
  upsertSettingRow_(sheet, 'DATA_SCHEMA_VERSION', DATA_SCHEMA_VERSION, 'Current data-sheet structure version', email);
}

function seedDefaultCategories_(spreadsheet) {
  var income = ['Membership Dues', 'Levies', 'Donations', 'Welfare Contributions', 'Event Contributions', 'Fundraising', 'School Project Contributions', 'Refunds Received', 'Interest Received', 'Other Income'];
  var expenses = ['Welfare Support', 'School Projects', 'Event Expenses', 'Administration', 'Communication', 'Banking Charges', 'Transport and Logistics', 'Refunds', 'Other Expenses'];
  var sheet = spreadsheet.getSheetByName('Categories');
  var existing = getExistingCategoryLookup_(sheet);
  var rows = [];
  var nextCategorySequence = Number(getNextId_('Categories', 'CAT').split('-')[1]);

  income.forEach(function(name) {
    if (!existing['Money In|' + name]) {
      rows.push([makeId('CAT', nextCategorySequence++), 'Money In', name, 'Active', nowIso(), nowIso()]);
    }
  });
  expenses.forEach(function(name) {
    if (!existing['Money Out|' + name]) {
      rows.push([makeId('CAT', nextCategorySequence++), 'Money Out', name, 'Active', nowIso(), nowIso()]);
    }
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows.map(safeSheetRow_));
  }
}

function seedBootstrapAdmin_(spreadsheet, email) {
  if (!email) {
    return;
  }

  var sheet = spreadsheet.getSheetByName('Users');
  if (findRecordRowByValue_(sheet, 'Email', email)) {
    return;
  }

  appendSafeRow_(sheet, [
    'USR-0001',
    email,
    'Bootstrap Administrator',
    ROLES.SYSTEM_ADMIN + ', ' + ROLES.MEMBER,
    'Active',
    '',
    nowIso(),
    nowIso()
  ]);
}

function protectSheets_(spreadsheet) {
  spreadsheet.getSheets().forEach(function(sheet) {
    var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    var protection = existing.length ? existing[0] : sheet.protect();
    protection.setDescription(APP_CONFIG.APP_NAME + ' protected data sheet');
    protection.setWarningOnly(false);
  });
}

function upsertSettingRow_(sheet, key, value, notes, email) {
  var rowNumber = findRecordRowByValue_(sheet, 'Setting Key', key);
  var row = [key, value, notes, nowIso(), email];
  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([safeSheetRow_(row)]);
    return;
  }
  appendSafeRow_(sheet, row);
}

function getExistingCategoryLookup_(sheet) {
  var values = sheet.getDataRange().getValues();
  var lookup = {};
  for (var i = 1; i < values.length; i++) {
    lookup[values[i][1] + '|' + values[i][2]] = true;
  }
  return lookup;
}

function findRecordRowByValue_(sheet, headerName, value) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) {
    return 0;
  }

  var headerIndex = values[0].indexOf(headerName);
  if (headerIndex === -1) {
    return 0;
  }

  var normalizedNeedle = normalizeEmail(value);
  for (var i = 1; i < values.length; i++) {
    if (normalizeEmail(values[i][headerIndex]) === normalizedNeedle) {
      return i + 1;
    }
  }

  return 0;
}

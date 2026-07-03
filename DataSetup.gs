function setupStage1(options) {
  options = options || {};

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var activeEmail = normalizeEmail(options.bootstrapAdminEmail || getActiveUserEmail());
    var rootFolder = options.rootFolderId
      ? DriveApp.getFolderById(options.rootFolderId)
      : getOrCreateFolder_(DriveApp.getRootFolder(), APP_CONFIG.ROOT_FOLDER_NAME);

    var dataFolder = getOrCreateFolder_(rootFolder, "NACO'94 Open Ledger - Data");
    var bankStatementsFolder = getOrCreateFolder_(rootFolder, 'Bank Statements');
    ['2026', '2027', 'Future Years'].forEach(function(name) {
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
    seedDefaultSettings_(spreadsheet, rootFolder, bankStatementsFolder, receiptsFolder, reportsFolder, archiveFolder);
    seedDefaultCategories_(spreadsheet);
    seedBootstrapAdmin_(spreadsheet, activeEmail);
    protectSheets_(spreadsheet);

    setSettingValue(SETTINGS_KEYS.DATA_SPREADSHEET_ID, spreadsheet.getId());
    setSettingValue(SETTINGS_KEYS.ROOT_FOLDER_ID, rootFolder.getId());
    setSettingValue(SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID, bankStatementsFolder.getId());
    setSettingValue(SETTINGS_KEYS.RECEIPTS_FOLDER_ID, receiptsFolder.getId());
    setSettingValue(SETTINGS_KEYS.REPORTS_FOLDER_ID, reportsFolder.getId());
    setSettingValue(SETTINGS_KEYS.ARCHIVE_FOLDER_ID, archiveFolder.getId());

    writeAuditLog('Stage 1 setup completed', 'System', 'Stage 1', '', {
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

function getDataSpreadsheet() {
  var spreadsheetId = getSettingValue(SETTINGS_KEYS.DATA_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error('The data spreadsheet is not configured. Run setupStage1() first.');
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function getSheetByName(name) {
  var sheet = getDataSpreadsheet().getSheetByName(name);
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

    sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, definition.headers.length);
  });
}

function seedDefaultSettings_(spreadsheet, rootFolder, bankStatementsFolder, receiptsFolder, reportsFolder, archiveFolder) {
  var sheet = spreadsheet.getSheetByName('Settings');
  var email = getActiveUserEmail();
  upsertSettingRow_(sheet, SETTINGS_KEYS.ROOT_FOLDER_ID, rootFolder.getId(), 'Main Google Drive folder', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.BANK_STATEMENTS_FOLDER_ID, bankStatementsFolder.getId(), 'Bank statement folder', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.RECEIPTS_FOLDER_ID, receiptsFolder.getId(), 'Receipts and invoices folder', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.REPORTS_FOLDER_ID, reportsFolder.getId(), 'Financial reports folder', email);
  upsertSettingRow_(sheet, SETTINGS_KEYS.ARCHIVE_FOLDER_ID, archiveFolder.getId(), 'Monthly backups folder', email);
}

function seedDefaultCategories_(spreadsheet) {
  var income = ['Membership Dues', 'Levies', 'Donations', 'Welfare Contributions', 'Event Contributions', 'Fundraising', 'School Project Contributions', 'Refunds Received', 'Interest Received', 'Other Income'];
  var expenses = ['Welfare Support', 'School Projects', 'Event Expenses', 'Administration', 'Communication', 'Banking Charges', 'Transport and Logistics', 'Refunds', 'Other Expenses'];
  var sheet = spreadsheet.getSheetByName('Categories');
  var existing = getExistingCategoryLookup_(sheet);
  var rows = [];

  income.forEach(function(name, index) {
    if (!existing['Money In|' + name]) {
      rows.push([makeId('CAT', index + 1), 'Money In', name, 'Active', nowIso(), nowIso()]);
    }
  });
  expenses.forEach(function(name, index) {
    if (!existing['Money Out|' + name]) {
      rows.push([makeId('CAT', income.length + index + 1), 'Money Out', name, 'Active', nowIso(), nowIso()]);
    }
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
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

  sheet.appendRow([
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
    sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
    return;
  }
  sheet.appendRow(row);
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

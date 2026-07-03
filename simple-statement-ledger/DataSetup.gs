function setupSimpleLedger() {
  var ownerEmail = normalizeEmail(Session.getActiveUser().getEmail());
  if (!ownerEmail) {
    throw new Error('Google account email was not available. Sign in before setup.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var root = getOrCreateFolder_(DriveApp.getRootFolder(), SIMPLE_APP.ROOT_FOLDER_NAME);
    var statements = getOrCreateFolder_(root, 'Bank Statements');
    var documents = getOrCreateFolder_(root, 'Documents');
    var backups = getOrCreateFolder_(root, 'Backups');
    var spreadsheet = getOrCreateSpreadsheet_(root, SIMPLE_APP.DATA_SPREADSHEET_NAME);

    setSettingValue(SETTINGS_KEYS.ROOT_FOLDER_ID, root.getId());
    setSettingValue(SETTINGS_KEYS.STATEMENTS_FOLDER_ID, statements.getId());
    setSettingValue(SETTINGS_KEYS.DOCUMENTS_FOLDER_ID, documents.getId());
    setSettingValue(SETTINGS_KEYS.BACKUP_FOLDER_ID, backups.getId());
    setSettingValue(SETTINGS_KEYS.DATA_SPREADSHEET_ID, spreadsheet.getId());

    ensureSheets_(spreadsheet);
    seedDefaultCategories_();
    seedOwnerUser_(ownerEmail);

    writeAuditLog('Setup completed', 'System', spreadsheet.getId(), '', { ownerEmail: ownerEmail }, 'Created simple statement ledger folders and sheets');
    return { ok: true, spreadsheetId: spreadsheet.getId(), rootFolderId: root.getId() };
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateFolder_(parentFolder, name) {
  var folders = parentFolder.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parentFolder.createFolder(name);
}

function getOrCreateSpreadsheet_(folder, name) {
  var files = folder.getFilesByName(name);
  if (files.hasNext()) {
    return SpreadsheetApp.openById(files.next().getId());
  }
  var spreadsheet = SpreadsheetApp.create(name);
  DriveApp.getFileById(spreadsheet.getId()).moveTo(folder);
  return spreadsheet;
}

function ensureSheets_(spreadsheet) {
  SHEET_DEFINITIONS.forEach(function(definition) {
    var sheet = spreadsheet.getSheetByName(definition.name) || spreadsheet.insertSheet(definition.name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
    }
    sheet.setFrozenRows(1);
  });
  var defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet) {
    spreadsheet.deleteSheet(defaultSheet);
  }
}

function seedDefaultCategories_() {
  if (getSheetByName('Categories').getLastRow() > 1) {
    return;
  }
  var now = nowIso();
  var rows = DEFAULT_CATEGORIES.map(function(category) {
    return category.concat([now, now]);
  });
  if (rows.length) {
    getSheetByName('Categories').getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
}

function seedOwnerUser_(ownerEmail) {
  if (findRecordByValue(getSheetByName('Users'), 'Email', ownerEmail, true)) {
    return;
  }
  getSheetByName('Users').appendRow([
    'USR-0001',
    ownerEmail,
    ownerEmail,
    [ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN].join(', '),
    'Active',
    '',
    nowIso(),
    nowIso()
  ]);
}

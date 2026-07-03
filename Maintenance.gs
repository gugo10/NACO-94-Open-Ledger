function backupDataSpreadsheet() {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var spreadsheet = getDataSpreadsheet();
  var archiveFolderId = getSettingValue(SETTINGS_KEYS.ARCHIVE_FOLDER_ID);
  if (!archiveFolderId) {
    throw new Error('Archive folder is not configured.');
  }

  var file = DriveApp.getFileById(spreadsheet.getId());
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd-HHmm');
  var copyName = APP_CONFIG.DATA_SPREADSHEET_NAME + ' Backup ' + timestamp;
  var copy = file.makeCopy(copyName, DriveApp.getFolderById(archiveFolderId));

  writeAuditLog('Data spreadsheet backed up', 'Backup', copy.getId(), '', {
    fileName: copyName,
    fileId: copy.getId()
  }, 'System Administrator created backup');

  return {
    ok: true,
    fileId: copy.getId(),
    fileName: copyName,
    createdBy: user.email
  };
}

function createMonthlyBackupTrigger() {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);
  deleteMonthlyBackupTriggers_();

  ScriptApp.newTrigger('backupDataSpreadsheet')
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();

  writeAuditLog('Monthly backup trigger created', 'Backup Trigger', 'backupDataSpreadsheet', '', {
    schedule: 'Monthly on day 1 at 06:00'
  }, 'System Administrator created monthly backup trigger');

  return { ok: true, message: 'Monthly backup trigger created.' };
}

function deleteMonthlyBackupTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'backupDataSpreadsheet') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function seedDemoData() {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var accountId = ensureDemoAccount_();
    var cashAccountId = ensureDemoCashAccount_();
    var fundId = ensureDemoFund_();

    writeAuditLog('Demo data seeded', 'Demo Data', 'DEMO', '', {
      accountId: accountId,
      cashAccountId: cashAccountId,
      fundId: fundId
    }, 'System Administrator seeded demo data');

    return {
      ok: true,
      accountId: accountId,
      cashAccountId: cashAccountId,
      fundId: fundId,
      seededBy: user.email
    };
  } finally {
    lock.releaseLock();
  }
}

function ensureDemoAccount_() {
  var sheet = getSheetByName('Accounts');
  var existing = findRecordByValue(sheet, 'Account Name', 'Demo Main Bank Account', false);
  if (existing) {
    return existing['Account ID'];
  }

  var accountId = getNextId('Accounts', 'ACC');
  sheet.appendRow([
    accountId,
    'Demo Main Bank Account',
    'Bank Account',
    0,
    0,
    'NGN',
    'Active',
    '****1234',
    'Demo account for testing',
    nowIso(),
    nowIso()
  ]);
  return accountId;
}

function ensureDemoCashAccount_() {
  var sheet = getSheetByName('Accounts');
  var existing = findRecordByValue(sheet, 'Account Name', 'Demo Cash at Hand', false);
  if (existing) {
    return existing['Account ID'];
  }

  var accountId = getNextId('Accounts', 'ACC');
  sheet.appendRow([
    accountId,
    'Demo Cash at Hand',
    'Cash at Hand',
    0,
    0,
    'NGN',
    'Active',
    '',
    'Demo cash account for testing',
    nowIso(),
    nowIso()
  ]);
  return accountId;
}

function ensureDemoFund_() {
  var sheet = getSheetByName('Funds and Projects');
  var existing = findRecordByValue(sheet, 'Fund or Project Name', 'Demo General Fund', false);
  if (existing) {
    return existing['Fund ID'];
  }

  var fundId = getNextId('Funds and Projects', 'FND');
  sheet.appendRow([
    fundId,
    'Demo General Fund',
    'General Association Fund',
    'Active',
    'Demo fund for testing',
    nowIso(),
    nowIso()
  ]);
  return fundId;
}

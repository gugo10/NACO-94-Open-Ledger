function backupDataSpreadsheet() {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  return performDataBackup_(user.email, 'Manual');
}

function performDataBackup_(requestedBy, backupType) {
  var spreadsheet = getDataSpreadsheet_();
  var archiveFolderId = getSettingValue_(SETTINGS_KEYS.ARCHIVE_FOLDER_ID);
  if (!archiveFolderId) {
    throw new Error('Archive folder is not configured.');
  }

  var archiveFolder = DriveApp.getFolderById(archiveFolderId);
  var file = DriveApp.getFileById(spreadsheet.getId());
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd-HHmm');
  var copyName = APP_CONFIG.DATA_SPREADSHEET_NAME + ' Backup ' + timestamp;
  var copy = file.makeCopy(copyName, archiveFolder);

  var evidenceCheck = backupEvidenceFiles_(archiveFolder);
  setPersistentSetting_('LAST_BACKUP_AT', nowIso(), 'Most recent backup attempt', requestedBy);
  setPersistentSetting_('LAST_BACKUP_STATUS', evidenceCheck.missing || evidenceCheck.failed ? 'Completed with evidence warning' : 'Successful', 'Most recent backup result', requestedBy);
  setPersistentSetting_('LAST_BACKUP_FILE_ID', copy.getId(), 'Most recent backup spreadsheet file', requestedBy);
  safeWriteAuditLog_('Data spreadsheet backed up', 'Backup', copy.getId(), '', {
    fileName: copyName,
    fileId: copy.getId(),
    backupType: backupType || 'Manual',
    evidenceFilesChecked: evidenceCheck.checked,
    missingEvidenceFiles: evidenceCheck.missing,
    evidenceFilesCopied: evidenceCheck.copied,
    evidenceBackupFailures: evidenceCheck.failed
  }, (backupType || 'Manual') + ' backup created');

  return {
    ok: true,
    fileId: copy.getId(),
    fileName: copyName,
    createdBy: requestedBy || 'Scheduled trigger',
    evidenceCheck: evidenceCheck
  };
}

function scheduledMonthlyBackup_() {
  try {
    return performDataBackup_('Scheduled trigger', 'Scheduled monthly');
  } catch (error) {
    setPersistentSetting_('LAST_BACKUP_AT', nowIso(), 'Most recent backup attempt', 'Scheduled trigger');
    setPersistentSetting_('LAST_BACKUP_STATUS', 'Failed: ' + String(error && error.message ? error.message : error), 'Most recent backup result', 'Scheduled trigger');
    console.error('Scheduled backup failed: ' + error.message);
    throw error;
  }
}

function createMonthlyBackupTrigger() {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);
  deleteMonthlyBackupTriggers_();

  ScriptApp.newTrigger('scheduledMonthlyBackup_')
    .timeBased()
    .onMonthDay(1)
    .atHour(6)
    .create();

  safeWriteAuditLog_('Monthly backup trigger created', 'Backup Trigger', 'backupDataSpreadsheet', '', {
    schedule: 'Monthly on day 1 at 06:00'
  }, 'System Administrator created monthly backup trigger');

  return { ok: true, message: 'Monthly backup trigger created.' };
}

function deleteMonthlyBackupTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'backupDataSpreadsheet' || trigger.getHandlerFunction() === 'scheduledMonthlyBackup' || trigger.getHandlerFunction() === 'scheduledMonthlyBackup_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function verifyEvidenceFiles_() {
  var checked = 0;
  var missing = 0;
  getSheetRecords(getSheetByName('Documents')).forEach(function(document) {
    var fileId = String(document['File ID'] || '').trim();
    if (!fileId) {
      return;
    }
    checked++;
    try {
      DriveApp.getFileById(fileId).getName();
    } catch (error) {
      missing++;
    }
  });
  return { checked: checked, missing: missing };
}

function backupEvidenceFiles_(archiveFolder) {
  var evidenceFolder = getOrCreateFolder_(archiveFolder, 'Evidence Files');
  var checked = 0;
  var copied = 0;
  var alreadyBackedUp = 0;
  var missing = 0;
  var failed = 0;
  var seen = {};
  getSheetRecords(getSheetByName('Documents')).forEach(function(document) {
    var fileId = String(document['File ID'] || '').trim();
    if (!fileId || seen[fileId]) {
      return;
    }
    seen[fileId] = true;
    checked++;
    try {
      var source = DriveApp.getFileById(fileId);
      var cleanName = String(source.getName() || document['File Name'] || 'Evidence').replace(/[\r\n]/g, ' ').slice(0, 180);
      var backupName = 'Evidence ' + fileId + ' - ' + cleanName;
      if (evidenceFolder.getFilesByName(backupName).hasNext()) {
        alreadyBackedUp++;
        return;
      }
      source.makeCopy(backupName, evidenceFolder);
      copied++;
    } catch (error) {
      try {
        DriveApp.getFileById(fileId).getName();
        failed++;
      } catch (missingError) {
        missing++;
      }
    }
  });
  return {
    checked: checked,
    copied: copied,
    alreadyBackedUp: alreadyBackedUp,
    missing: missing,
    failed: failed,
    folderId: evidenceFolder.getId()
  };
}

function getBackupHealth() {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);
  return {
    lastBackupAt: getSettingValue_('LAST_BACKUP_AT'),
    lastBackupStatus: getSettingValue_('LAST_BACKUP_STATUS'),
    lastBackupFileId: getSettingValue_('LAST_BACKUP_FILE_ID')
  };
}

function seedDemoData() {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var accountId = ensureDemoAccount_();
    var cashAccountId = ensureDemoCashAccount_();
    var fundId = ensureDemoFund_();

    safeWriteAuditLog_('Demo data seeded', 'Demo Data', 'DEMO', '', {
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

  var accountId = getNextId_('Accounts', 'ACC');
  appendSafeRow_(sheet, [
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

  var accountId = getNextId_('Accounts', 'ACC');
  appendSafeRow_(sheet, [
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

  var fundId = getNextId_('Funds and Projects', 'FND');
  appendSafeRow_(sheet, [
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

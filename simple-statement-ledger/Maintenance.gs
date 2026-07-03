function backupSimpleLedgerNow() {
  var user = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var spreadsheet = getDataSpreadsheet();
  var folder = DriveApp.getFolderById(getSettingValue(SETTINGS_KEYS.BACKUP_FOLDER_ID));
  var copyName = SIMPLE_APP.DATA_SPREADSHEET_NAME + ' Backup ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  var copy = DriveApp.getFileById(spreadsheet.getId()).makeCopy(copyName, folder);
  var backupId = getNextId('Backups', 'BKP');
  getSheetByName('Backups').appendRow([backupId, copy.getId(), user.email, nowIso(), 'Manual backup']);
  writeAuditLog('Backup created', 'Backup', backupId, '', { copyId: copy.getId() }, 'System Administrator created backup');
  return { ok: true, backupId: backupId, copyId: copy.getId() };
}

function seedSimpleDemoData() {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);
  if (!getActiveAccounts_().length) {
    addBankAccount({
      accountName: 'Main Association Bank Account',
      bankName: 'Demo Bank',
      maskedAccountNumber: '****1234',
      openingBalance: 0,
      openingDate: '01-07-2026'
    });
  }
  if (!getSheetRecords(getSheetByName('Members')).length) {
    addMember({ 'Full Name': 'Demo Member', 'Email Address': 'demo.member@example.com', City: 'Aba', Country: 'Nigeria' });
  }
  return { ok: true };
}

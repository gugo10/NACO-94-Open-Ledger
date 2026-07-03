function writeAuditLog(action, recordType, recordId, previousValue, newValue, reason) {
  if (!isAppConfigured()) {
    return;
  }

  var sheet = getSheetByName('Audit Log');
  var nextId = makeId('AUD', Math.max(1, sheet.getLastRow()));
  sheet.appendRow([
    nextId,
    nowIso(),
    getActiveUserEmail(),
    action,
    recordType,
    recordId,
    previousValue ? JSON.stringify(previousValue) : '',
    newValue ? JSON.stringify(newValue) : '',
    reason || ''
  ]);
}

function writeAuditLog(action, entityType, entityId, beforeValue, afterValue, notes) {
  var email = '';
  try {
    email = normalizeEmail(Session.getActiveUser().getEmail());
  } catch (error) {
    email = '';
  }
  var sheet = getSheetByName('Audit Log');
  sheet.appendRow([
    makeId('AUD', Math.max(1, sheet.getLastRow())),
    nowIso(),
    email,
    action,
    entityType,
    entityId,
    beforeValue ? JSON.stringify(beforeValue) : '',
    afterValue ? JSON.stringify(afterValue) : '',
    notes || ''
  ]);
}

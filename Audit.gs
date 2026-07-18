function writeAuditLog_(action, recordType, recordId, previousValue, newValue, reason) {
  if (!isAppConfigured()) {
    return;
  }
  appendAuditEntry_(makeAuditEntry_(action, recordType, recordId, previousValue, newValue, reason));
}

function makeAuditEntry_(action, recordType, recordId, previousValue, newValue, reason) {
  return {
    auditId: 'AUD-' + Utilities.getUuid().split('-')[0].toUpperCase(),
    dateTime: nowIso(),
    userEmail: getActiveUserEmail() || 'Scheduled process',
    action: String(action || ''),
    recordType: String(recordType || ''),
    recordId: String(recordId || ''),
    previousJson: stringifyAuditValue_(previousValue),
    newJson: stringifyAuditValue_(newValue),
    reason: String(reason || '')
  };
}

function appendAuditEntry_(entry) {
  appendSafeRow_(getSheetByName('Audit Log'), [
    entry.auditId,
    entry.dateTime,
    entry.userEmail,
    entry.action,
    entry.recordType,
    entry.recordId,
    entry.previousJson,
    entry.newJson,
    entry.reason
  ]);
}

function stringifyAuditValue_(value) {
  if (!value) {
    return '';
  }
  var text = JSON.stringify(redactAuditValue_(value));
  return text.length > 12000 ? text.slice(0, 12000) + '...[TRUNCATED]' : text;
}

function queuePendingAuditLog_(entry) {
  getScriptProperties_().setProperty('PENDING_AUDIT_' + entry.auditId, JSON.stringify(entry));
}

function flushPendingAuditLogs_() {
  if (!isAppConfigured()) {
    return { recovered: 0, remaining: 0 };
  }
  var properties = getScriptProperties_();
  var pending = properties.getProperties();
  var keys = Object.keys(pending).filter(function(key) { return key.indexOf('PENDING_AUDIT_') === 0; }).sort();
  var recovered = 0;
  keys.forEach(function(key) {
    try {
      appendAuditEntry_(JSON.parse(pending[key]));
      properties.deleteProperty(key);
      recovered++;
    } catch (error) {
      console.error('Pending audit entry could not be recovered: ' + key + ': ' + error.message);
    }
  });
  return { recovered: recovered, remaining: keys.length - recovered };
}

function getPendingAuditCount_() {
  return Object.keys(getScriptProperties_().getProperties()).filter(function(key) {
    return key.indexOf('PENDING_AUDIT_') === 0;
  }).length;
}

function redactAuditValue_(value) {
  if (Array.isArray(value)) {
    return value.map(redactAuditValue_);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  var sensitive = {
    'Date of Birth': true,
    'Residential Address': true,
    'Phone Number': true,
    'Spouse Name': true,
    'Admin Notes': true
  };
  var clean = {};
  Object.keys(value).forEach(function(key) {
    clean[key] = sensitive[key] ? '[REDACTED]' : redactAuditValue_(value[key]);
  });
  return clean;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function splitRoles(rolesValue) {
  if (Array.isArray(rolesValue)) {
    return rolesValue.filter(Boolean);
  }

  return String(rolesValue || '')
    .split(',')
    .map(function(role) {
      return role.trim();
    })
    .filter(Boolean);
}

function hasAnyRole(userRoles, allowedRoles) {
  var lookup = {};
  splitRoles(userRoles).forEach(function(role) {
    lookup[role] = true;
  });

  return allowedRoles.some(function(role) {
    return Boolean(lookup[role]);
  });
}

function makeId(prefix, sequenceNumber) {
  return prefix + '-' + String(sequenceNumber).padStart(4, '0');
}

function getScriptProperties_() {
  return PropertiesService.getScriptProperties();
}

function getSettingValue_(key) {
  return getScriptProperties_().getProperty(key) || '';
}

function setSettingValue_(key, value) {
  getScriptProperties_().setProperty(key, String(value || ''));
}

function setPersistentSetting_(key, value, notes, updatedBy) {
  setSettingValue_(key, value);
  if (!isAppConfigured()) {
    return;
  }
  try {
    upsertSettingRow_(getSheetByName('Settings'), key, String(value || ''), String(notes || ''), updatedBy || getActiveUserEmail() || 'Scheduled process');
  } catch (error) {
    console.error('Setting was saved to Script Properties but not the Settings sheet: ' + error.message);
  }
}

function isAppConfigured() {
  return Boolean(getSettingValue_(SETTINGS_KEYS.DATA_SPREADSHEET_ID));
}

function requireCurrentSchema_() {
  var current = getSettingValue_('DATA_SCHEMA_VERSION');
  if (current !== DATA_SCHEMA_VERSION) {
    throw new Error('A System Administrator must open Administration and click Upgrade Data Structure before using this new workflow.');
  }
}

function getAccountingLockDate_(accountId) {
  return getSettingValue_('ACCOUNTING_LOCK_DATE_' + String(accountId || '').trim());
}

function assertAccountingPeriodOpen_(accountId, dateValue) {
  var lockDate = getAccountingLockDate_(accountId);
  if (!lockDate) {
    return;
  }
  var transactionDate = normalizeImportedDate_(dateValue);
  if (transactionDate <= lockDate) {
    throw new Error('This account is locked through ' + formatDisplayDate_(lockDate) + '. Use a visible correction dated after the locked period.');
  }
}

function safeWriteAuditLog_(action, recordType, recordId, previousValue, newValue, reason) {
  if (typeof writeAuditLog_ !== 'function') {
    return false;
  }
  try {
    flushPendingAuditLogs_();
    writeAuditLog_(action, recordType, recordId, previousValue, newValue, reason);
    return true;
  } catch (error) {
    console.error('Audit log write failed for ' + action + ': ' + String(error && error.message ? error.message : error));
    try {
      queuePendingAuditLog_(makeAuditEntry_(action, recordType, recordId, previousValue, newValue, reason));
      return false;
    } catch (queueError) {
      throw new Error('The record was saved, but its audit entry could not be recorded or queued. Stop and ask the System Administrator to back up and inspect the Audit Log.');
    }
  }
}

function safeSheetValue_(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function safeSheetRow_(row) {
  return (row || []).map(safeSheetValue_);
}

function appendSafeRow_(sheet, row) {
  sheet.appendRow(safeSheetRow_(row));
}

function toObject(headers, row) {
  var record = {};
  headers.forEach(function(header, index) {
    record[header] = row[index];
  });
  return record;
}

function getSheetRecords(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) {
    return [];
  }

  var headers = values.shift();
  return values.filter(function(row) {
    return row.some(function(value) {
      return value !== '';
    });
  }).map(function(row, index) {
    var record = toObject(headers, row);
    record._rowNumber = index + 2;
    return record;
  });
}

function findRecordByValue(sheet, headerName, value, normalize) {
  var records = getSheetRecords(sheet);
  var expected = normalize ? normalizeEmail(value) : String(value || '');

  for (var i = 0; i < records.length; i++) {
    var actual = normalize ? normalizeEmail(records[i][headerName]) : String(records[i][headerName] || '');
    if (actual === expected) {
      return records[i];
    }
  }

  return null;
}

function updateRecordByHeaders(sheet, rowNumber, updates) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Object.keys(updates).forEach(function(header) {
    var columnIndex = headers.indexOf(header);
    if (columnIndex !== -1) {
      sheet.getRange(rowNumber, columnIndex + 1).setValue(safeSheetValue_(updates[header]));
    }
  });
}

function getNextId_(sheetName, prefix) {
  var sheet = getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  var values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : [];
  var maxSequence = values.reduce(function(maximum, row) {
    var match = String(row[0] || '').match(new RegExp('^' + prefix + '-(\\d+)$'));
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  return makeId(prefix, maxSequence + 1);
}

function getHeaderLookup_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var lookup = {};
  headers.forEach(function(header, index) {
    lookup[header] = index;
  });
  return lookup;
}

function makeRowForHeaders_(sheet, valuesByHeader) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(valuesByHeader, header) ? safeSheetValue_(valuesByHeader[header]) : '';
  });
}

function appendRecordByHeaders_(sheet, valuesByHeader) {
  appendSafeRow_(sheet, makeRowForHeaders_(sheet, valuesByHeader));
}

function normalizeImportedDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var raw = String(value || '').trim();
  if (!raw) {
    throw new Error('Statement date is required.');
  }
  if (/^\d{5}(?:\.\d+)?$/.test(raw)) {
    var serial = Number(raw);
    var excelDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return Utilities.formatDate(excelDate, 'UTC', 'yyyy-MM-dd');
  }
  var spacedMonth = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})$/);
  if (spacedMonth) {
    raw = spacedMonth[1] + '-' + spacedMonth[2].slice(0, 3) + '-' + spacedMonth[3];
  }
  var normalizedPdf = typeof normalizePdfStatementDate_ === 'function' ? normalizePdfStatementDate_(raw) : '';
  if (normalizedPdf) {
    return normalizedPdf;
  }
  return normalizeDateInput_(raw);
}

function parseAppDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return new Date(value.getTime());
  }
  var normalized = normalizeImportedDate_(value);
  var parts = normalized.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function normalizeDateInput_(value) {
  var raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return iso[1] + '-' + iso[2] + '-' + iso[3];
  }

  var display = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (display) {
    var day = Number(display[1]);
    var month = Number(display[2]);
    var year = Number(display[3]);
    if (isValidDateParts_(year, month, day)) {
      return String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
  }

  throw new Error('Date should be entered as dd-mm-yyyy, for example 31-07-2026.');
}

function formatDisplayDate_(value) {
  if (!value) {
    return '';
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd-MM-yyyy');
  }

  var raw = String(value).trim();
  var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return iso[3] + '-' + iso[2] + '-' + iso[1];
  }
  return raw;
}

function isValidDateParts_(year, month, day) {
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  var date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

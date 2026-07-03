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

function getScriptProperties() {
  return PropertiesService.getScriptProperties();
}

function getSettingValue(key) {
  return getScriptProperties().getProperty(key) || '';
}

function setSettingValue(key, value) {
  getScriptProperties().setProperty(key, String(value || ''));
}

function isAppConfigured() {
  return Boolean(getSettingValue(SETTINGS_KEYS.DATA_SPREADSHEET_ID));
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
      sheet.getRange(rowNumber, columnIndex + 1).setValue(updates[header]);
    }
  });
}

function getNextId(sheetName, prefix) {
  var sheet = getSheetByName(sheetName);
  return makeId(prefix, Math.max(1, sheet.getLastRow()));
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

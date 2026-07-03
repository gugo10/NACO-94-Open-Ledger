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
  return String(rolesValue || '').split(',').map(function(role) {
    return role.trim();
  }).filter(Boolean);
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

function parseMoney_(value) {
  var number = Number(String(value || '0').replace(/,/g, ''));
  if (isNaN(number)) {
    throw new Error('Amount must be a valid number.');
  }
  return Math.round(number * 100) / 100;
}

function normalizeDateInput_(value) {
  var raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  var iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return raw;
  }
  var display = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!display) {
    display = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  }
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

function isValidDateParts_(year, month, day) {
  var date = new Date(year, month - 1, day);
  return year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= 31
    && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
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
  return iso ? iso[3] + '-' + iso[2] + '-' + iso[1] : raw;
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

function getDataSpreadsheet() {
  var spreadsheetId = getSettingValue(SETTINGS_KEYS.DATA_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error('Run setupSimpleLedger() first.');
  }
  return SpreadsheetApp.openById(spreadsheetId);
}

function getSheetByName(name) {
  var sheet = getDataSpreadsheet().getSheetByName(name);
  if (!sheet) {
    throw new Error('Missing sheet: ' + name);
  }
  return sheet;
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
  var expected = normalize ? normalizeEmail(value) : String(value || '');
  var records = getSheetRecords(sheet);
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
    var index = headers.indexOf(header);
    if (index !== -1) {
      sheet.getRange(rowNumber, index + 1).setValue(updates[header]);
    }
  });
}

function getNextId(sheetName, prefix) {
  return makeId(prefix, Math.max(1, getSheetByName(sheetName).getLastRow()));
}

function validateRequired_(record, fields) {
  fields.forEach(function(field) {
    if (record[field] === undefined || record[field] === null || String(record[field]).trim() === '') {
      throw new Error(field + ' is required.');
    }
  });
}

function csvEscapeRow_(row) {
  return row.map(function(value) {
    var text = String(value === undefined || value === null ? '' : value);
    if (text.indexOf('"') !== -1 || text.indexOf(',') !== -1 || text.indexOf('\n') !== -1) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }).join(',');
}

function makeSimpleHash_(value) {
  var text = String(value || '');
  var hash = 0;
  for (var i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return String(Math.abs(hash));
}

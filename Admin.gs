function getAdministrationData() {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);

  return {
    users: getUsersForAdmin_(),
    members: getMembersForUserManagement_(),
    roles: [
      ROLES.MEMBER,
      ROLES.FINANCE_OFFICER,
      ROLES.PUBLISHER,
      ROLES.MEMBERSHIP_ADMIN,
      ROLES.SYSTEM_ADMIN
    ]
  };
}

function saveUserAccess(record) {
  var admin = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var clean = cleanUserAccessRecord_(record || {});
  validateRequired_(clean, ['Email', 'Full Name', 'Roles', 'Status']);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheetByName('Users');
    var existing = clean['User ID']
      ? findRecordByValue(sheet, 'User ID', clean['User ID'], false)
      : findRecordByValue(sheet, 'Email', clean.Email, true);
    var now = nowIso();

    if (existing) {
      var previous = {
        Email: existing.Email,
        'Full Name': existing['Full Name'],
        Roles: existing.Roles,
        Status: existing.Status,
        'Member ID': existing['Member ID']
      };
      updateRecordByHeaders(sheet, existing._rowNumber, {
        Email: clean.Email,
        'Full Name': clean['Full Name'],
        Roles: clean.Roles,
        Status: clean.Status,
        'Member ID': clean['Member ID'],
        'Updated At': now
      });
      writeAuditLog('User access updated', 'User', existing['User ID'], previous, clean, 'System Administrator updated user access');
      return { ok: true, userId: existing['User ID'], updatedBy: admin.email };
    }

    var userId = getNextId('Users', 'USR');
    sheet.appendRow([
      userId,
      clean.Email,
      clean['Full Name'],
      clean.Roles,
      clean.Status,
      clean['Member ID'],
      now,
      now
    ]);
    writeAuditLog('User access added', 'User', userId, '', clean, 'System Administrator added user access');
    return { ok: true, userId: userId, updatedBy: admin.email };
  } finally {
    lock.releaseLock();
  }
}

function deactivateUserAccess(userId) {
  var admin = requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var sheet = getSheetByName('Users');
  var user = findRecordByValue(sheet, 'User ID', userId, false);
  if (!user) {
    throw new Error('User not found.');
  }

  updateRecordByHeaders(sheet, user._rowNumber, {
    Status: 'Inactive',
    'Updated At': nowIso()
  });
  writeAuditLog('User access deactivated', 'User', userId, user, { Status: 'Inactive' }, 'System Administrator deactivated user access');
  return { ok: true, userId: userId, updatedBy: admin.email };
}

function previewMemberImport(payload) {
  requireAnyRole([ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  payload = payload || {};

  var rows = parseMemberImportRows_(payload);
  if (rows.length < 2) {
    throw new Error('No member rows found.');
  }

  var headers = rows[0].map(function(header) {
    return String(header || '').trim();
  });
  var records = rows.slice(1).filter(function(row) {
    return row.some(function(value) { return String(value || '').trim(); });
  }).map(function(row) {
    return mapImportRow_(headers, row);
  });

  return {
    headers: headers,
    rowCount: records.length,
    previewRecords: records.slice(0, 10),
    rawRowsJson: JSON.stringify(rows)
  };
}

function importMembers(payload) {
  var admin = requireAnyRole([ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  payload = payload || {};
  var rows = JSON.parse(payload.rawRowsJson || '[]');
  if (rows.length < 2) {
    throw new Error('No member rows to import.');
  }

  var headers = rows[0].map(function(header) {
    return String(header || '').trim();
  });
  var records = rows.slice(1).filter(function(row) {
    return row.some(function(value) { return String(value || '').trim(); });
  }).map(function(row) {
    return cleanImportedMemberRecord_(mapImportRow_(headers, row));
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var membersSheet = getSheetByName('Members');
    var usersSheet = getSheetByName('Users');
    var imported = 0;
    var skipped = 0;
    var errors = [];

    records.forEach(function(record, index) {
      try {
        if (!record['Full Name'] || !record['Email Address']) {
          throw new Error('Full Name and Email Address are required.');
        }
        if (record['Date of Birth']) {
          record['Date of Birth'] = normalizeBirthdayDayMonth_(record['Date of Birth']);
        }
        if (findRecordByValue(membersSheet, 'Email Address', record['Email Address'], true) || findRecordByValue(usersSheet, 'Email', record['Email Address'], true)) {
          skipped++;
          return;
        }

        var now = nowIso();
        var memberId = getNextId('Members', 'MEM');
        membersSheet.appendRow([
          memberId,
          record['Full Name'],
          record['Preferred Name'],
          record['Phone Number'],
          record['Email Address'],
          record['Date of Birth'],
          record['Residential Address'],
          record.City,
          record.State,
          record.Country,
          record.Occupation,
          record['Employer or Business'],
          record['Marital Status'],
          record['Spouse Name'],
          record['Profile Photo URL'],
          record["Date Joined NACO'94"],
          record['Membership Status'] || 'Active',
          record['Admin Notes'],
          'Yes',
          'Yes',
          'Yes',
          'No',
          'No',
          'No',
          now,
          now
        ]);

        usersSheet.appendRow([
          getNextId('Users', 'USR'),
          record['Email Address'],
          record['Full Name'],
          ROLES.MEMBER,
          'Active',
          memberId,
          now,
          now
        ]);
        imported++;
      } catch (error) {
        errors.push('Row ' + (index + 2) + ': ' + error.message);
      }
    });

    writeAuditLog('Members imported', 'Member Import', 'IMPORT', '', {
      imported: imported,
      skipped: skipped,
      errors: errors
    }, 'Administrator imported members');

    return {
      ok: true,
      imported: imported,
      skipped: skipped,
      errors: errors
    };
  } finally {
    lock.releaseLock();
  }
}

function getUsersForAdmin_() {
  return getSheetRecords(getSheetByName('Users')).map(function(user) {
    return {
      userId: user['User ID'],
      email: user.Email,
      fullName: user['Full Name'],
      roles: user.Roles,
      status: user.Status,
      memberId: user['Member ID'],
      updatedAt: user['Updated At']
    };
  });
}

function getMembersForUserManagement_() {
  return getSheetRecords(getSheetByName('Members')).map(function(member) {
    return {
      memberId: member['Member ID'],
      fullName: member['Full Name'],
      emailAddress: member['Email Address']
    };
  });
}

function cleanUserAccessRecord_(record) {
  return {
    'User ID': String(record['User ID'] || '').trim(),
    Email: normalizeEmail(record.Email),
    'Full Name': String(record['Full Name'] || '').trim(),
    Roles: normalizeRolesForStorage_(record.Roles),
    Status: String(record.Status || 'Active').trim(),
    'Member ID': String(record['Member ID'] || '').trim()
  };
}

function parseMemberImportRows_(payload) {
  if (payload.base64) {
    var content = Utilities.newBlob(Utilities.base64Decode(payload.base64)).getDataAsString();
    return Utilities.parseCsv(content);
  }

  var pasted = String(payload.pastedText || '').trim();
  if (!pasted) {
    throw new Error('Paste rows or choose a CSV file first.');
  }
  var delimiter = pasted.indexOf('\t') !== -1 ? '\t' : ',';
  return pasted.split(/\r?\n/).map(function(line) {
    return line.split(delimiter).map(function(value) {
      return String(value || '').trim();
    });
  });
}

function mapImportRow_(headers, row) {
  var aliases = getImportHeaderAliases_();
  var record = {};

  headers.forEach(function(header, index) {
    var canonical = aliases[String(header || '').trim().toLowerCase()];
    if (canonical) {
      record[canonical] = row[index];
    }
  });
  return record;
}

function cleanImportedMemberRecord_(record) {
  var clean = {};
  var allowed = SHEET_DEFINITIONS.filter(function(definition) {
    return definition.name === 'Members';
  })[0].headers;

  allowed.forEach(function(field) {
    clean[field] = String(record[field] || '').trim();
  });
  clean['Email Address'] = normalizeEmail(clean['Email Address']);
  clean['Membership Status'] = clean['Membership Status'] || 'Active';
  clean.Country = clean.Country || 'Nigeria';
  return clean;
}

function getImportHeaderAliases_() {
  return {
    'full name': 'Full Name',
    'name': 'Full Name',
    'preferred name': 'Preferred Name',
    'phone': 'Phone Number',
    'phone number': 'Phone Number',
    'email': 'Email Address',
    'email address': 'Email Address',
    'birthday': 'Date of Birth',
    'birthday day/month': 'Date of Birth',
    'date of birth': 'Date of Birth',
    'city': 'City',
    'state': 'State',
    'country': 'Country',
    'occupation': 'Occupation',
    'employer': 'Employer or Business',
    'employer or business': 'Employer or Business',
    'address': 'Residential Address',
    'residential address': 'Residential Address',
    'membership status': 'Membership Status'
  };
}

function normalizeRolesForStorage_(rolesValue) {
  var allowed = {};
  [
    ROLES.MEMBER,
    ROLES.FINANCE_OFFICER,
    ROLES.PUBLISHER,
    ROLES.REVIEWER,
    ROLES.MEMBERSHIP_ADMIN,
    ROLES.SYSTEM_ADMIN
  ].forEach(function(role) {
    allowed[role] = true;
  });

  var roles = splitRoles(rolesValue).filter(function(role) {
    return allowed[role] && role !== ROLES.REVIEWER;
  });

  if (!roles.length) {
    roles = [ROLES.MEMBER];
  }

  return roles.join(', ');
}

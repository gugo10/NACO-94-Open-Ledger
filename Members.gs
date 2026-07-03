var MEMBER_PUBLIC_FIELDS = [
  'Member ID',
  'Full Name',
  'Preferred Name',
  'City',
  'Country',
  'Occupation',
  'Phone Number',
  'Email Address',
  'Profile Photo URL'
];

var MEMBER_SELF_EDITABLE_FIELDS = [
  'Preferred Name',
  'Phone Number',
  'Email Address',
  'Date of Birth',
  'Residential Address',
  'City',
  'State',
  'Country',
  'Occupation',
  'Employer or Business',
  'Marital Status',
  'Spouse Name'
];

var MEMBER_PRIVACY_FIELDS = [
  'Show Name',
  'Show City Country',
  'Show Occupation',
  'Show Phone',
  'Show Email',
  'Show Photo'
];

function getMyProfile() {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  var member = getMemberForUser_(user);
  var pendingRequests = getPendingRequestsForMember_(member['Member ID']);

  return {
    profile: sanitizeMemberForSelf_(member),
    privacy: getMemberPrivacy_(member),
    pendingRequests: pendingRequests
  };
}

function requestMyProfileUpdate(changes) {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  var member = getMemberForUser_(user);
  var cleanChanges = cleanMemberUpdateChanges_(changes || {});
  if (cleanChanges['Date of Birth']) {
    cleanChanges['Date of Birth'] = normalizeBirthdayDayMonth_(cleanChanges['Date of Birth']);
  }

  if (!Object.keys(cleanChanges).length) {
    throw new Error('Please enter at least one detail to update.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheetByName('Member Update Requests');
    var requestId = getNextId('Member Update Requests', 'REQ');
    sheet.appendRow([
      requestId,
      member['Member ID'],
      user.email,
      JSON.stringify(cleanChanges),
      'Pending',
      '',
      '',
      nowIso()
    ]);

    writeAuditLog('Member profile update requested', 'Member Update Request', requestId, '', cleanChanges, 'Member requested profile update');

    return {
      ok: true,
      requestId: requestId,
      message: 'Your update request has been sent for review.'
    };
  } finally {
    lock.releaseLock();
  }
}

function updateMyPrivacySettings(settings) {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  var member = getMemberForUser_(user);
  var updates = cleanPrivacySettings_(settings || {});

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var sheet = getSheetByName('Members');
    var previous = getMemberPrivacy_(member);
    updates['Updated At'] = nowIso();
    updateRecordByHeaders(sheet, member._rowNumber, updates);

    writeAuditLog('Member privacy settings changed', 'Member', member['Member ID'], previous, updates, 'Member changed directory privacy settings');

    return {
      ok: true,
      privacy: cleanPrivacySettings_(updates),
      message: 'Your directory privacy settings were saved.'
    };
  } finally {
    lock.releaseLock();
  }
}

function getMemberDirectory() {
  requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);

  return getSheetRecords(getSheetByName('Members'))
    .filter(function(member) {
      return member['Membership Status'] === 'Active';
    })
    .map(sanitizeMemberForDirectory_)
    .filter(function(member) {
      return Boolean(member.name || member.cityCountry || member.occupation);
    });
}

function addMember(record) {
  var user = requireAnyRole([ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  var cleanRecord = cleanAdminMemberRecord_(record || {});
  if (cleanRecord['Date of Birth']) {
    cleanRecord['Date of Birth'] = normalizeBirthdayDayMonth_(cleanRecord['Date of Birth']);
  }

  if (!cleanRecord['Full Name']) {
    throw new Error('Full name is required.');
  }
  if (!cleanRecord['Email Address']) {
    throw new Error('Email address is required.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var membersSheet = getSheetByName('Members');
    var usersSheet = getSheetByName('Users');
    var normalizedEmail = normalizeEmail(cleanRecord['Email Address']);

    if (findRecordByValue(membersSheet, 'Email Address', normalizedEmail, true)) {
      throw new Error('A member with this email address already exists.');
    }

    var memberId = getNextId('Members', 'MEM');
    var now = nowIso();
    var memberRow = [
      memberId,
      cleanRecord['Full Name'],
      cleanRecord['Preferred Name'],
      cleanRecord['Phone Number'],
      normalizedEmail,
      cleanRecord['Date of Birth'],
      cleanRecord['Residential Address'],
      cleanRecord.City,
      cleanRecord.State,
      cleanRecord.Country,
      cleanRecord.Occupation,
      cleanRecord['Employer or Business'],
      cleanRecord['Marital Status'],
      cleanRecord['Spouse Name'],
      cleanRecord['Profile Photo URL'],
      cleanRecord["Date Joined NACO'94"],
      cleanRecord['Membership Status'] || 'Active',
      cleanRecord['Admin Notes'],
      'Yes',
      'Yes',
      'Yes',
      'No',
      'No',
      'No',
      now,
      now
    ];
    membersSheet.appendRow(memberRow);

    if (!findRecordByValue(usersSheet, 'Email', normalizedEmail, true)) {
      usersSheet.appendRow([
        getNextId('Users', 'USR'),
        normalizedEmail,
        cleanRecord['Full Name'],
        ROLES.MEMBER,
        'Active',
        memberId,
        now,
        now
      ]);
    }

    writeAuditLog('Member added', 'Member', memberId, '', cleanRecord, 'Membership Administrator added member');

    return {
      ok: true,
      memberId: memberId,
      addedBy: user.email
    };
  } finally {
    lock.releaseLock();
  }
}

function getPendingMemberUpdateRequests() {
  requireAnyRole([ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);

  return getSheetRecords(getSheetByName('Member Update Requests'))
    .filter(function(request) {
      return request.Status === 'Pending';
    })
    .map(function(request) {
      return {
        requestId: request['Request ID'],
        memberId: request['Member ID'],
        requestedByEmail: request['Requested By Email'],
        requestedChanges: parseJsonSafe_(request['Requested Changes JSON']),
        status: request.Status,
        createdAt: request['Created At']
      };
    });
}

function reviewMemberUpdateRequest(requestId, decision) {
  var user = requireAnyRole([ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  var normalizedDecision = String(decision || '').trim();
  if (['Approved', 'Rejected'].indexOf(normalizedDecision) === -1) {
    throw new Error('Decision must be Approved or Rejected.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var requestsSheet = getSheetByName('Member Update Requests');
    var request = findRecordByValue(requestsSheet, 'Request ID', requestId, false);
    if (!request) {
      throw new Error('Update request not found.');
    }
    if (request.Status !== 'Pending') {
      throw new Error('This update request has already been reviewed.');
    }

    var changes = parseJsonSafe_(request['Requested Changes JSON']);
    if (normalizedDecision === 'Approved') {
      var membersSheet = getSheetByName('Members');
      var member = findRecordByValue(membersSheet, 'Member ID', request['Member ID'], false);
      if (!member) {
        throw new Error('Member record not found.');
      }
      changes['Updated At'] = nowIso();
      updateRecordByHeaders(membersSheet, member._rowNumber, changes);
      updateLinkedUserAfterMemberChange_(member, changes);
      writeAuditLog('Member profile changed', 'Member', member['Member ID'], member, changes, 'Membership Administrator approved member update');
    }

    updateRecordByHeaders(requestsSheet, request._rowNumber, {
      Status: normalizedDecision,
      'Reviewed By': user.email,
      'Reviewed At': nowIso()
    });

    writeAuditLog('Member update request ' + normalizedDecision.toLowerCase(), 'Member Update Request', requestId, request, { status: normalizedDecision }, 'Membership Administrator reviewed request');

    return {
      ok: true,
      requestId: requestId,
      status: normalizedDecision
    };
  } finally {
    lock.releaseLock();
  }
}

function getMemberForUser_(user) {
  var membersSheet = getSheetByName('Members');
  var member = user.memberId ? findRecordByValue(membersSheet, 'Member ID', user.memberId, false) : null;
  if (!member) {
    member = findRecordByValue(membersSheet, 'Email Address', user.email, true);
  }
  if (!member) {
    throw new Error('No member profile is linked to your account yet.');
  }
  return member;
}

function updateLinkedUserAfterMemberChange_(member, changes) {
  var updates = {
    'Updated At': nowIso()
  };

  if (Object.prototype.hasOwnProperty.call(changes, 'Email Address')) {
    updates.Email = normalizeEmail(changes['Email Address']);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'Full Name')) {
    updates['Full Name'] = changes['Full Name'];
  }

  var usersSheet = getSheetByName('Users');
  var user = findRecordByValue(usersSheet, 'Member ID', member['Member ID'], false);
  if (user) {
    updateRecordByHeaders(usersSheet, user._rowNumber, updates);
  }
}

function sanitizeMemberForSelf_(member) {
  return {
    memberId: member['Member ID'],
    fullName: member['Full Name'],
    preferredName: member['Preferred Name'],
    phoneNumber: member['Phone Number'],
    emailAddress: member['Email Address'],
    dateOfBirth: formatBirthdayDayMonth_(member['Date of Birth']),
    residentialAddress: member['Residential Address'],
    city: member.City,
    state: member.State,
    country: member.Country,
    occupation: member.Occupation,
    employerOrBusiness: member['Employer or Business'],
    maritalStatus: member['Marital Status'],
    spouseName: member['Spouse Name'],
    profilePhotoUrl: member['Profile Photo URL'],
    dateJoined: formatDateOnly_(member["Date Joined NACO'94"]),
    membershipStatus: member['Membership Status']
  };
}

function sanitizeMemberForDirectory_(member) {
  var showName = isYes_(member['Show Name']);
  var showCityCountry = isYes_(member['Show City Country']);
  var showOccupation = isYes_(member['Show Occupation']);
  var showPhone = isYes_(member['Show Phone']);
  var showEmail = isYes_(member['Show Email']);
  var showPhoto = isYes_(member['Show Photo']);

  return {
    memberId: member['Member ID'],
    name: showName ? (member['Preferred Name'] || member['Full Name']) : '',
    cityCountry: showCityCountry ? [member.City, member.Country].filter(Boolean).join(', ') : '',
    occupation: showOccupation ? member.Occupation : '',
    phoneNumber: showPhone ? member['Phone Number'] : '',
    emailAddress: showEmail ? member['Email Address'] : '',
    profilePhotoUrl: showPhoto ? member['Profile Photo URL'] : ''
  };
}

function getMemberPrivacy_(member) {
  var privacy = {};
  MEMBER_PRIVACY_FIELDS.forEach(function(field) {
    privacy[field] = isYes_(member[field]) ? 'Yes' : 'No';
  });
  return privacy;
}

function cleanMemberUpdateChanges_(changes) {
  var clean = {};
  MEMBER_SELF_EDITABLE_FIELDS.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(changes, field)) {
      clean[field] = String(changes[field] || '').trim();
    }
  });
  return clean;
}

function cleanPrivacySettings_(settings) {
  var clean = {};
  MEMBER_PRIVACY_FIELDS.forEach(function(field) {
    clean[field] = isYes_(settings[field]) ? 'Yes' : 'No';
  });
  return clean;
}

function cleanAdminMemberRecord_(record) {
  var allowed = SHEET_DEFINITIONS.filter(function(definition) {
    return definition.name === 'Members';
  })[0].headers;
  var clean = {};

  allowed.forEach(function(field) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      clean[field] = String(record[field] || '').trim();
    }
  });

  clean['Email Address'] = normalizeEmail(clean['Email Address']);
  return clean;
}

function getPendingRequestsForMember_(memberId) {
  return getSheetRecords(getSheetByName('Member Update Requests'))
    .filter(function(request) {
      return request['Member ID'] === memberId && request.Status === 'Pending';
    })
    .map(function(request) {
      return {
        requestId: request['Request ID'],
        requestedChanges: parseJsonSafe_(request['Requested Changes JSON']),
        createdAt: request['Created At']
      };
    });
}

function parseJsonSafe_(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch (error) {
    return {};
  }
}

function isYes_(value) {
  return String(value || '').toLowerCase() === 'yes' || value === true;
}

function formatDateOnly_(value) {
  return formatDisplayDate_(value);
}

function formatBirthdayDayMonth_(value) {
  if (!value) {
    return '';
  }
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'dd/MM');
  }

  var raw = String(value).trim();
  var isoMatch = raw.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return isoMatch[2] + '/' + isoMatch[1];
  }

  return raw;
}

function normalizeBirthdayDayMonth_(value) {
  var raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  var match = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/);
  if (!match) {
    throw new Error('Birthday should be entered as DD/MM, for example 14/08.');
  }

  var day = Number(match[1]);
  var month = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Birthday day or month is not valid.');
  }

  var daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > daysInMonth[month - 1]) {
    throw new Error('Birthday day is not valid for that month.');
  }

  return String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0');
}

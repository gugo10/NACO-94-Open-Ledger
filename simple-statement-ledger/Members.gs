function getMyProfile() {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  var member = user.memberId ? findRecordByValue(getSheetByName('Members'), 'Member ID', user.memberId, false) : null;
  return {
    user: user,
    member: member ? sanitizeMemberForSelf_(member) : null
  };
}

function getMemberDirectory() {
  requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  return getSheetRecords(getSheetByName('Members')).filter(function(member) {
    return member.Status === 'Active';
  }).map(sanitizeMemberForDirectory_);
}

function saveMyProfile(changes) {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  if (!user.memberId) {
    throw new Error('Your user account is not linked to a member record yet.');
  }
  var sheet = getSheetByName('Members');
  var member = findRecordByValue(sheet, 'Member ID', user.memberId, false);
  if (!member) {
    throw new Error('Member record was not found.');
  }
  var updates = cleanMemberProfile_(changes || {});
  updates['Updated At'] = nowIso();
  updateRecordByHeaders(sheet, member._rowNumber, updates);
  writeAuditLog('Member profile updated', 'Member', user.memberId, member, updates, 'Member updated own profile');
  return { ok: true };
}

function addMember(record) {
  var user = requireAnyRole([ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  var clean = cleanMemberProfile_(record || {});
  validateRequired_(clean, ['Full Name', 'Email Address']);

  var email = normalizeEmail(clean['Email Address']);
  if (findRecordByValue(getSheetByName('Members'), 'Email Address', email, true)) {
    throw new Error('A member with this email already exists.');
  }

  var memberId = getNextId('Members', 'MEM');
  getSheetByName('Members').appendRow([
    memberId,
    clean['Full Name'],
    clean['Preferred Name'],
    email,
    clean['Phone Number'],
    clean.City,
    clean.Country || 'Nigeria',
    clean.Occupation,
    clean.Birthday,
    clean['Show Name'],
    clean['Show City Country'],
    clean['Show Occupation'],
    clean['Show Phone'],
    clean['Show Email'],
    'Active',
    nowIso(),
    nowIso()
  ]);
  writeAuditLog('Member added', 'Member', memberId, '', clean, 'Membership Administrator added member');
  return { ok: true, memberId: memberId };
}

function sanitizeMemberForSelf_(member) {
  return {
    memberId: member['Member ID'],
    fullName: member['Full Name'],
    preferredName: member['Preferred Name'],
    emailAddress: member['Email Address'],
    phoneNumber: member['Phone Number'],
    city: member.City,
    country: member.Country,
    occupation: member.Occupation,
    birthday: member.Birthday,
    showName: member['Show Name'],
    showCityCountry: member['Show City Country'],
    showOccupation: member['Show Occupation'],
    showPhone: member['Show Phone'],
    showEmail: member['Show Email']
  };
}

function sanitizeMemberForDirectory_(member) {
  var name = member['Show Name'] === 'Yes' ? (member['Preferred Name'] || member['Full Name']) : 'Member';
  var cityCountry = member['Show City Country'] === 'Yes'
    ? [member.City, member.Country].filter(Boolean).join(', ')
    : '';
  return {
    memberId: member['Member ID'],
    name: name,
    cityCountry: cityCountry,
    occupation: member['Show Occupation'] === 'Yes' ? member.Occupation : '',
    phoneNumber: member['Show Phone'] === 'Yes' ? member['Phone Number'] : '',
    emailAddress: member['Show Email'] === 'Yes' ? member['Email Address'] : ''
  };
}

function cleanMemberProfile_(record) {
  return {
    'Full Name': String(record['Full Name'] || record.fullName || '').trim(),
    'Preferred Name': String(record['Preferred Name'] || record.preferredName || '').trim(),
    'Email Address': normalizeEmail(record['Email Address'] || record.emailAddress || ''),
    'Phone Number': String(record['Phone Number'] || record.phoneNumber || '').trim(),
    City: String(record.City || record.city || '').trim(),
    Country: String(record.Country || record.country || 'Nigeria').trim(),
    Occupation: String(record.Occupation || record.occupation || '').trim(),
    Birthday: normalizeBirthday_(record.Birthday || record.birthday || ''),
    'Show Name': yesNo_(record['Show Name'] || record.showName, 'Yes'),
    'Show City Country': yesNo_(record['Show City Country'] || record.showCityCountry, 'Yes'),
    'Show Occupation': yesNo_(record['Show Occupation'] || record.showOccupation, 'No'),
    'Show Phone': yesNo_(record['Show Phone'] || record.showPhone, 'No'),
    'Show Email': yesNo_(record['Show Email'] || record.showEmail, 'No')
  };
}

function yesNo_(value, defaultValue) {
  if (value === true || String(value).toLowerCase() === 'yes' || String(value).toLowerCase() === 'on') {
    return 'Yes';
  }
  if (value === false || String(value).toLowerCase() === 'no' || value === '') {
    return value === '' ? defaultValue : 'No';
  }
  return defaultValue || 'No';
}

function normalizeBirthday_(value) {
  var raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  var match = raw.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) {
    throw new Error('Birthday should be day/month only, for example 14/08.');
  }
  var day = Number(match[1]);
  var month = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Birthday day or month is not valid.');
  }
  return String(day).padStart(2, '0') + '/' + String(month).padStart(2, '0');
}

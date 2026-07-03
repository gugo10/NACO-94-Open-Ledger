function getAdministrationData() {
  requireAnyRole([ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  return {
    users: getSheetRecords(getSheetByName('Users')).map(sanitizeUser_),
    members: getSheetRecords(getSheetByName('Members')).map(function(member) {
      return { memberId: member['Member ID'], fullName: member['Full Name'], emailAddress: member['Email Address'], status: member.Status };
    }),
    categories: getActiveCategories_(),
    accounts: getActiveAccounts_()
  };
}

function saveUserAccess(record) {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var clean = cleanUserAccess_(record || {});
  validateRequired_(clean, ['Email', 'Full Name', 'Roles']);
  var sheet = getSheetByName('Users');
  var existing = clean['User ID'] ? findRecordByValue(sheet, 'User ID', clean['User ID'], false) : findRecordByValue(sheet, 'Email', clean.Email, true);
  var now = nowIso();
  if (existing) {
    updateRecordByHeaders(sheet, existing._rowNumber, {
      Email: clean.Email,
      'Full Name': clean['Full Name'],
      Roles: clean.Roles,
      Status: clean.Status,
      'Member ID': clean['Member ID'],
      'Updated At': now
    });
    writeAuditLog('User access updated', 'User', existing['User ID'], existing, clean, 'System Administrator updated user access');
    return { ok: true, userId: existing['User ID'] };
  }
  var userId = getNextId('Users', 'USR');
  sheet.appendRow([userId, clean.Email, clean['Full Name'], clean.Roles, clean.Status, clean['Member ID'], now, now]);
  writeAuditLog('User access added', 'User', userId, '', clean, 'System Administrator added user access');
  return { ok: true, userId: userId };
}

function addBankAccount(record) {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var clean = {
    accountName: String((record || {}).accountName || '').trim(),
    bankName: String((record || {}).bankName || '').trim(),
    maskedAccountNumber: String((record || {}).maskedAccountNumber || '').trim(),
    currency: String((record || {}).currency || 'NGN').trim(),
    openingBalance: parseMoney_((record || {}).openingBalance || 0),
    openingDate: normalizeDateInput_((record || {}).openingDate || formatDateForInput_(new Date()))
  };
  if (!clean.accountName) {
    throw new Error('Account name is required.');
  }
  var accountId = getNextId('Bank Accounts', 'ACC');
  getSheetByName('Bank Accounts').appendRow([
    accountId,
    clean.accountName,
    clean.bankName,
    clean.maskedAccountNumber,
    clean.currency,
    clean.openingBalance,
    clean.openingDate,
    'Active',
    nowIso(),
    nowIso()
  ]);
  writeAuditLog('Bank account added', 'Bank Account', accountId, '', clean, 'System Administrator added bank account');
  return { ok: true, accountId: accountId };
}

function addCategory(record) {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);
  var clean = {
    categoryType: String((record || {}).categoryType || '').trim(),
    categoryName: String((record || {}).categoryName || '').trim(),
    reportGroup: String((record || {}).reportGroup || '').trim()
  };
  if (['Money In', 'Money Out', 'Transfer', 'Review'].indexOf(clean.categoryType) === -1) {
    throw new Error('Choose Money In, Money Out, Transfer, or Review.');
  }
  if (!clean.categoryName) {
    throw new Error('Category name is required.');
  }
  var categoryId = getNextId('Categories', 'CAT');
  getSheetByName('Categories').appendRow([categoryId, clean.categoryType, clean.categoryName, clean.reportGroup || clean.categoryType, 'Active', nowIso(), nowIso()]);
  writeAuditLog('Category added', 'Category', categoryId, '', clean, 'System Administrator added category');
  return { ok: true, categoryId: categoryId };
}

function getActiveCategories_() {
  return getSheetRecords(getSheetByName('Categories')).filter(function(category) {
    return category.Status === 'Active';
  }).map(function(category) {
    return {
      categoryId: category['Category ID'],
      categoryType: category['Category Type'],
      categoryName: category['Category Name'],
      reportGroup: category['Report Group']
    };
  });
}

function getActiveAccounts_() {
  return getSheetRecords(getSheetByName('Bank Accounts')).filter(function(account) {
    return account.Status === 'Active';
  }).map(function(account) {
    return {
      accountId: account['Account ID'],
      accountName: account['Account Name'],
      bankName: account['Bank Name'],
      maskedAccountNumber: account['Masked Account Number'],
      currency: account.Currency || 'NGN',
      openingBalance: parseMoney_(account['Opening Balance']),
      openingDate: account['Opening Date']
    };
  });
}

function sanitizeUser_(user) {
  return {
    userId: user['User ID'],
    email: user.Email,
    fullName: user['Full Name'],
    roles: user.Roles,
    status: user.Status,
    memberId: user['Member ID']
  };
}

function cleanUserAccess_(record) {
  return {
    'User ID': String(record['User ID'] || record.userId || '').trim(),
    Email: normalizeEmail(record.Email || record.email || ''),
    'Full Name': String(record['Full Name'] || record.fullName || '').trim(),
    Roles: splitRoles(record.Roles || record.roles).join(', '),
    Status: String(record.Status || record.status || 'Active').trim(),
    'Member ID': String(record['Member ID'] || record.memberId || '').trim()
  };
}

function formatDateForInput_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

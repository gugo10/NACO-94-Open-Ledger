function getActiveUserEmail() {
  return normalizeEmail(Session.getActiveUser().getEmail());
}

function getCurrentUserContext() {
  var email = getActiveUserEmail();
  var anonymousContext = {
    email: '',
    name: '',
    roles: [],
    memberId: '',
    status: 'Unknown',
    allowed: false,
    message: "Please open this app with the Google account registered with NACO'94."
  };

  if (!email) {
    return anonymousContext;
  }

  if (!isAppConfigured()) {
    return {
      email: email,
      name: 'Setup user',
      roles: [ROLES.SYSTEM_ADMIN],
      memberId: '',
      status: 'Setup Required',
      allowed: true,
      message: 'Run setupStage1() to create the data sheet and folders.'
    };
  }

  var user = findUserByEmail(email);
  if (!user || user.Status !== 'Active') {
    return {
      email: email,
      name: '',
      roles: [],
      memberId: '',
      status: user ? user.Status : 'Not Registered',
      allowed: false,
      message: "This Google account is not on the NACO'94 member allow-list."
    };
  }

  return {
    email: email,
    name: user['Full Name'] || '',
    roles: splitRoles(user.Roles),
    memberId: user['Member ID'] || '',
    status: user.Status,
    allowed: true,
    message: 'Access granted.'
  };
}

function findUserByEmail(email) {
  var normalizedEmail = normalizeEmail(email);
  var sheet = getSheetByName('Users');
  var values = sheet.getDataRange().getValues();
  var headers = values.shift();

  for (var i = 0; i < values.length; i++) {
    var record = toObject(headers, values[i]);
    if (normalizeEmail(record.Email) === normalizedEmail) {
      return record;
    }
  }

  return null;
}

function requireAnyRole(roles) {
  var user = getCurrentUserContext();
  if (!user.allowed || !hasAnyRole(user.roles, roles)) {
    throw new Error('You do not have permission to perform this action.');
  }
  return user;
}

function getVisibleNavigation(userRoles) {
  return APP_CONFIG.NAVIGATION.filter(function(item) {
    return hasAnyRole(userRoles, item.roles);
  }).map(function(item) {
    return {
      key: item.key,
      label: item.label
    };
  });
}

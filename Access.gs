function getActiveUserEmail() {
  var verifiedEmail = getVerifiedSessionEmail_();
  if (verifiedEmail) {
    return verifiedEmail;
  }
  var nativeEmail = normalizeEmail(Session.getActiveUser().getEmail());
  if (nativeEmail) {
    return nativeEmail;
  }
  return '';
}

function requestMemberSignInCode(email) {
  if (!isAppConfigured()) {
    throw new Error('The app must be set up before member sign-in can be used.');
  }
  email = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter the Google email address registered with NACO\'94.');
  }
  var sessionId = getAuthenticationSessionId_();
  if (!sessionId) {
    throw new Error('A secure browser session could not be established. Refresh and try again.');
  }
  var cache = CacheService.getScriptCache();
  var requestKey = 'LOGIN_REQUEST_' + sessionId;
  if (cache.get(requestKey)) {
    throw new Error('Please wait two minutes before requesting another code.');
  }
  cache.put(requestKey, '1', 120);
  var emailRequestKey = 'LOGIN_EMAIL_' + hashAuthenticationValue_(email);
  var emailRecentlyRequested = Boolean(cache.get(emailRequestKey));
  cache.put(emailRequestKey, '1', 120);
  if (MailApp.getRemainingDailyQuota() < 1) {
    throw new Error('The app cannot send another sign-in email today. Ask the System Administrator for help.');
  }

  var user = findUserByEmail_(email);
  if (!emailRecentlyRequested && user && user.Status === 'Active') {
    var code = generateMemberSignInCode_();
    var challenge = {
      email: email,
      codeHash: hashAuthenticationValue_(sessionId + '|' + email + '|' + code),
      attempts: 0
    };
    cache.put('LOGIN_CODE_' + sessionId, JSON.stringify(challenge), 600);
    try {
      MailApp.sendEmail({
        to: email,
        subject: "Your NACO'94 Open Ledger sign-in code",
        body: "Your NACO'94 Open Ledger sign-in code is: " + code
          + '\n\nIt expires in 10 minutes. Do not share this code with anyone.'
          + '\n\nIf you did not request it, you can ignore this email.',
        name: "NACO'94 Open Ledger"
      });
    } catch (error) {
      cache.remove('LOGIN_CODE_' + sessionId);
      cache.remove(requestKey);
      cache.remove(emailRequestKey);
      throw new Error('The sign-in email could not be sent. Please try again or ask the System Administrator for help.');
    }
  }
  return {
    ok: true,
    message: 'If that email is active in the member list, a six-digit code has been sent. Check Inbox and Spam.'
  };
}

function verifyMemberSignInCode(email, code) {
  email = normalizeEmail(email);
  code = String(code || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
    throw new Error('Enter the registered email and the six-digit code from the email.');
  }
  var sessionId = getAuthenticationSessionId_();
  var cache = CacheService.getScriptCache();
  var codeKey = 'LOGIN_CODE_' + sessionId;
  var raw = sessionId ? cache.get(codeKey) : '';
  if (!raw) {
    throw new Error('This code has expired. Request a new code.');
  }
  var challenge = JSON.parse(raw);
  challenge.attempts = Number(challenge.attempts || 0) + 1;
  if (challenge.attempts > 5) {
    cache.remove(codeKey);
    throw new Error('Too many incorrect attempts. Wait two minutes and request a new code.');
  }
  if (challenge.email !== email
    || challenge.codeHash !== hashAuthenticationValue_(sessionId + '|' + email + '|' + code)) {
    cache.put(codeKey, JSON.stringify(challenge), 600);
    throw new Error('The sign-in code is incorrect.');
  }
  var user = findUserByEmail_(email);
  if (!user || user.Status !== 'Active') {
    cache.remove(codeKey);
    throw new Error('This email is not active in the NACO\'94 member list.');
  }
  getScriptProperties_().setProperty('AUTH_SESSION_' + sessionId, JSON.stringify({
    email: email,
    expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000)
  }));
  purgeExpiredAuthenticationSessions_();
  cache.remove(codeKey);
  cache.remove('LOGIN_REQUEST_' + sessionId);
  return getCurrentUserContext();
}

function signOutCurrentUser() {
  var sessionId = getAuthenticationSessionId_();
  if (sessionId) {
    getScriptProperties_().deleteProperty('AUTH_SESSION_' + sessionId);
    CacheService.getScriptCache().remove('LOGIN_CODE_' + sessionId);
  }
  return { ok: true };
}

function getAuthenticationSessionId_() {
  var temporaryKey = String(Session.getTemporaryActiveUserKey() || '').trim();
  if (!temporaryKey) {
    return '';
  }
  return hashAuthenticationValue_(temporaryKey);
}

function getVerifiedSessionEmail_() {
  var sessionId = getAuthenticationSessionId_();
  if (!sessionId) {
    return '';
  }
  var key = 'AUTH_SESSION_' + sessionId;
  var raw = getScriptProperties_().getProperty(key);
  if (!raw) {
    return '';
  }
  try {
    var session = JSON.parse(raw);
    if (Number(session.expiresAt || 0) <= Date.now()) {
      getScriptProperties_().deleteProperty(key);
      return '';
    }
    return normalizeEmail(session.email);
  } catch (error) {
    getScriptProperties_().deleteProperty(key);
    return '';
  }
}

function hashAuthenticationValue_(value) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value || ''));
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function generateMemberSignInCode_() {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + nowIso()
  );
  var number = (((digest[0] & 255) * 16777216)
    + ((digest[1] & 255) * 65536)
    + ((digest[2] & 255) * 256)
    + (digest[3] & 255)) >>> 0;
  return String(number % 1000000).padStart(6, '0');
}

function purgeExpiredAuthenticationSessions_() {
  var properties = getScriptProperties_();
  var values = properties.getProperties();
  Object.keys(values).forEach(function(key) {
    if (key.indexOf('AUTH_SESSION_') !== 0) {
      return;
    }
    try {
      if (Number(JSON.parse(values[key]).expiresAt || 0) <= Date.now()) {
        properties.deleteProperty(key);
      }
    } catch (error) {
      properties.deleteProperty(key);
    }
  });
}

function requireScriptOwnerExecution_() {
  var active = normalizeEmail(Session.getActiveUser().getEmail());
  var effective = normalizeEmail(Session.getEffectiveUser().getEmail());
  if (!active || !effective || active !== effective) {
    throw new Error('For safety, this setup function can only be run by the Apps Script owner from the Apps Script editor.');
  }
  return active;
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
    message: "Verify the Google email address registered with NACO'94."
  };

  if (!email) {
    return anonymousContext;
  }

  if (!isAppConfigured()) {
    var activeOwner = normalizeEmail(Session.getActiveUser().getEmail());
    var effectiveOwner = normalizeEmail(Session.getEffectiveUser().getEmail());
    if (!activeOwner || !effectiveOwner || activeOwner !== effectiveOwner) {
      return {
        email: email,
        name: '',
        roles: [],
        memberId: '',
        status: 'Setup Required',
        allowed: false,
        message: 'Initial setup must be completed by the Apps Script owner.'
      };
    }
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

  var user = findUserByEmail_(email);
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

function findUserByEmail_(email) {
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

function requireFinanceOfficerOrSystemAdmin() {
  return requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.SYSTEM_ADMIN]);
}

function hasFinanceOfficerOrSystemAdmin(userRoles) {
  return hasAnyRole(userRoles, [ROLES.FINANCE_OFFICER, ROLES.SYSTEM_ADMIN]);
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

function getCurrentUser() {
  var email = normalizeEmail(Session.getActiveUser().getEmail());
  if (!email) {
    return null;
  }
  var user = findRecordByValue(getSheetByName('Users'), 'Email', email, true);
  if (!user || user.Status !== 'Active') {
    return null;
  }
  return {
    userId: user['User ID'],
    email: normalizeEmail(user.Email),
    fullName: user['Full Name'] || user.Email,
    roles: splitRoles(user.Roles),
    memberId: user['Member ID'] || ''
  };
}

function requireAnyRole(allowedRoles) {
  var user = getCurrentUser();
  if (!user) {
    throw new Error('You do not have access yet. Ask the administrator to add your Google account.');
  }
  if (!hasAnyRole(user.roles, allowedRoles)) {
    throw new Error('Your account does not have permission for this action.');
  }
  return user;
}

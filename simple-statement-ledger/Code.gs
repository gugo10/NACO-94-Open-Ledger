function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(SIMPLE_APP.NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getBootstrapData() {
  var configured = isAppConfigured();
  var user = null;
  if (configured) {
    user = getCurrentUser();
  }
  return {
    appName: SIMPLE_APP.NAME,
    configured: configured,
    user: user,
    navigation: user ? getVisibleNavigation(user.roles) : []
  };
}

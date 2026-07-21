/**
 * NACO'94 Bank Ledger - web entry points.
 */

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.appName = APP_CONFIG.APP_NAME;
  template.tagline = APP_CONFIG.TAGLINE;

  return template
    .evaluate()
    .setTitle(APP_CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getAppBootstrap() {
  var user = getCurrentUserContext();

  return {
    appName: APP_CONFIG.APP_NAME,
    tagline: APP_CONFIG.TAGLINE,
    user: user,
    navigation: getVisibleNavigation(user.roles),
    configured: isAppConfigured(),
    stage: 'Stage 8 - Bank-first controls',
    appVersion: APP_VERSION,
    schemaVersion: isAppConfigured() ? (getSettingValue_('DATA_SCHEMA_VERSION') || 'Legacy - upgrade required') : DATA_SCHEMA_VERSION,
    memberSignInAvailable: isAppConfigured(),
    verifiedMemberSession: Boolean(getVerifiedSessionEmail_())
  };
}

function getStage1Status() {
  requireAnyRole([ROLES.SYSTEM_ADMIN]);

  return {
    appName: APP_CONFIG.APP_NAME,
    configured: isAppConfigured(),
    dataSpreadsheetId: getSettingValue_('DATA_SPREADSHEET_ID'),
    rootFolderId: getSettingValue_('ROOT_FOLDER_ID'),
    sectionsReady: APP_CONFIG.NAVIGATION.length,
    sheetTabsReady: SHEET_DEFINITIONS.length
  };
}

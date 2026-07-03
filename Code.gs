/**
 * NACO'94 Open Ledger - Stage 1 web entry points.
 */

function doGet() {
  var template = HtmlService.createTemplateFromFile('Index');
  template.appName = APP_CONFIG.APP_NAME;
  template.tagline = APP_CONFIG.TAGLINE;

  return template
    .evaluate()
    .setTitle(APP_CONFIG.APP_NAME)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
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
    stage: 'Stage 7 - Finalisation'
  };
}

function getStage1Status() {
  requireAnyRole([ROLES.SYSTEM_ADMIN, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.MEMBER]);

  return {
    appName: APP_CONFIG.APP_NAME,
    configured: isAppConfigured(),
    dataSpreadsheetId: getSettingValue('DATA_SPREADSHEET_ID'),
    rootFolderId: getSettingValue('ROOT_FOLDER_ID'),
    sectionsReady: APP_CONFIG.NAVIGATION.length,
    sheetTabsReady: SHEET_DEFINITIONS.length
  };
}

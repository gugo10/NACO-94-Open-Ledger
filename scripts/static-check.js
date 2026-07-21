const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const gasFiles = fs.readdirSync(root).filter((name) => name.endsWith('.gs')).sort();
const source = gasFiles.map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const pad = (value) => String(value).padStart(2, '0');
const context = {
  console,
  Logger: { log: console.log },
  Session: {
    getScriptTimeZone: () => 'Africa/Lagos',
    getActiveUser: () => ({ getEmail: () => 'owner@example.com' }),
    getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' })
  },
  Utilities: {
    formatDate(date, timeZone, format) {
      if (format === 'yyyy-MM-dd') return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      if (format === 'dd-MM-yyyy') return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
      if (format === 'dd/MM') return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
      return date.toISOString();
    }
  }
};

vm.createContext(context);
vm.runInContext(source, context);
const results = context.runStage1Tests();
const failed = results.filter((result) => !result.ok);
if (failed.length) {
  throw new Error(`Pure tests failed: ${JSON.stringify(failed)}`);
}

const propertyValues = new Map();
const cacheValues = new Map();
let sentEmail = null;
const propertyStore = {
  getProperty: (key) => propertyValues.get(key) || null,
  setProperty: (key, value) => { propertyValues.set(key, String(value)); },
  deleteProperty: (key) => { propertyValues.delete(key); },
  getProperties: () => Object.fromEntries(propertyValues)
};
const scriptCache = {
  get: (key) => cacheValues.get(key) || null,
  put: (key, value) => { cacheValues.set(key, String(value)); },
  remove: (key) => { cacheValues.delete(key); }
};
context.PropertiesService = { getScriptProperties: () => propertyStore };
context.CacheService = { getScriptCache: () => scriptCache };
context.MailApp = {
  getRemainingDailyQuota: () => 100,
  sendEmail: (message) => { sentEmail = message; }
};
context.Session.getTemporaryActiveUserKey = () => 'static-test-session';
context.Utilities.DigestAlgorithm = { SHA_256: 'SHA_256' };
context.Utilities.computeDigest = (algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value)).digest()).map((byte) => byte > 127 ? byte - 256 : byte);
context.Utilities.base64EncodeWebSafe = (bytes) => Buffer.from(bytes.map((byte) => byte & 255)).toString('base64url');
context.Utilities.getUuid = () => crypto.randomUUID();
context.isAppConfigured = () => true;
context.findUserByEmail_ = (email) => email === 'member@example.com' ? {
  Email: email,
  Status: 'Active',
  'Full Name': 'Test Member',
  Roles: 'Member',
  'Member ID': 'MEM-0001'
} : null;
const requestResult = context.requestMemberSignInCode('member@example.com');
if (!requestResult.ok || !sentEmail || sentEmail.to !== 'member@example.com') {
  throw new Error('Email-code sign-in request test failed.');
}
const codeMatch = sentEmail.body.match(/\b(\d{6})\b/);
if (!codeMatch || !context.verifyMemberSignInCode('member@example.com', codeMatch[1]).allowed) {
  throw new Error('Email-code sign-in verification test failed.');
}
if (context.getActiveUserEmail() !== 'member@example.com') {
  throw new Error('Verified member session did not take precedence over native identity.');
}

context.getSheetByName = () => ({});
context.findRecordByValue = (sheet, header, categoryId) => ({
  'Category ID': categoryId,
  'Category Type': 'Money In',
  Status: 'Active'
});
context.validateOptionalFund_ = () => {};
const splitCheck = context.cleanBankLineCategorySplits_({
  Splits: [
    { Amount: 5000, 'Category ID': 'CAT-0001' },
    { Amount: 6000, 'Category ID': 'CAT-0002' },
    { Amount: 8000, 'Category ID': 'CAT-0003' }
  ]
}, 'Money In', 19000);
if (splitCheck.length !== 3 || splitCheck.reduce((sum, split) => sum + split.amount, 0) !== 19000) {
  throw new Error('The 19,000 statement split example did not validate correctly.');
}

JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Index.html inline script was not found.');
new Function(scriptMatch[1]);

const entryPanelMatch = scriptMatch[1].match(/function renderBankStatementEntryPanels\(data\) \{([\s\S]*?)\n      \}\n\n      function renderMatchWorkspace/);
if (!entryPanelMatch) throw new Error('Simplified Bank Statements entry panel was not found.');
if (!entryPanelMatch[1].includes('Option 1: Upload Excel or CSV') || !entryPanelMatch[1].includes('Option 2: Enter One Bank Item')) {
  throw new Error('Bank Statements must present Excel/CSV and manual entry as the two primary choices.');
}
if (entryPanelMatch[1].includes('application/pdf,.pdf,.xls')) {
  throw new Error('PDF must not be offered in the primary statement upload control.');
}
if (!html.includes('class="statement-grid"') || !html.includes('name="Notes"') || !html.includes('name="Evidence File"')) {
  throw new Error('Statement review must include the spreadsheet grid, notes, and optional evidence.');
}
if (!html.includes('Confirm the bank columns') || !source.includes('mapStatementTableRows_')) {
  throw new Error('Excel/CSV uploads must confirm column mapping and safely filter non-transaction rows.');
}
if (!html.includes('data-toggle-statement-split') || !html.includes('+ Create new classification')) {
  throw new Error('Statement review must support split classifications and in-place classification creation.');
}
if (!html.includes('<th>Fund / Project</th>') || !html.includes('<label>Fund / Project</label><select name="Split Fund">')) {
  throw new Error('Statement rows and split portions must support fund/project assignment for specialized reporting.');
}
if (!html.includes('data-scroll-statement="left"') || !html.includes('data-scroll-statement="right"') || !html.includes('statement-review-scroll')) {
  throw new Error('Statement review must provide visible horizontal scrolling controls.');
}
if (!source.includes('addStatementClassification') || !source.includes('preparedSplits.forEach')) {
  throw new Error('Statement split classifications must be validated and written as separate Publisher records.');
}
if (!source.includes('approvedTransactions.slice(-100).reverse()') || !html.includes('Recent Published Transactions')) {
  throw new Error('The Finances page must show the newest published transactions first.');
}
if (!html.includes('Waiting for a Publisher') || !html.includes('The person who entered a transaction cannot publish the same transaction')) {
  throw new Error('Finances must explain the separate Publisher step to officers and administrators.');
}
if (!html.includes('function saveRemainingStatementRows') || !html.includes('unsent row(s) remain below and were saved under Saved Work')) {
  throw new Error('Partial statement submission must keep and automatically save every unsent row.');
}
if (!source.includes('buildFinancialStatementsPackage_') || !source.includes('buildCashFlowStatement_') || !source.includes('buildFundProjectStatement_')) {
  throw new Error('Reports must include a complete nonprofit statement package, cash flow, and specialized fund/project reporting.');
}
if (!html.includes('Notes to the Financial Statements') || !html.includes('Print / Save as PDF') || !html.includes('Fund / Project Statement')) {
  throw new Error('Professional reports must include organized notes, print/PDF support, and project selection.');
}
if (!source.includes('Receivables / Debtors') || !source.includes('Payables / Creditors') || !source.includes('published cash and bank transactions')) {
  throw new Error('Financial statements must disclose zero accrual balances and the cash-derived accounting basis.');
}
if (!source.includes("name: 'Report Packs'") || !source.includes('function reviewReportPack') || !source.includes('function createReportPackSnapshot_')) {
  throw new Error('Guided report packs must use a separate Publisher workflow and frozen snapshots.');
}
if (!html.includes('Prepare Notes and Period-End Items') || !html.includes('Copy Meeting Summary') || !html.includes('supporting transaction explanation(s)')) {
  throw new Error('Reports must provide accessible guided notes, reusable transaction explanations, and a shareable summary.');
}
if (!source.includes('Income Earned but Not Received') || !source.includes('Expense Incurred but Not Paid') || !source.includes('Income Received in Advance') || !source.includes('Expense Paid in Advance')) {
  throw new Error('Report packs must support the four controlled period-end adjustment types.');
}
if (!source.includes('clean.evidenceDocumentId') || !source.includes("row.evidenceDocumentId || documentId")) {
  throw new Error('Statement-row evidence must be validated and linked to prepared transactions.');
}

const forbiddenPublicHelpers = ['getSettingValue', 'setSettingValue', 'findUserByEmail', 'writeAuditLog', 'safeWriteAuditLog', 'scheduledMonthlyBackup', 'getNextId', 'getScriptProperties', 'getDataSpreadsheet'];
forbiddenPublicHelpers.forEach((name) => {
  if (new RegExp(`^function ${name}\\(`, 'm').test(source)) {
    throw new Error(`Sensitive helper ${name} must remain private with a trailing underscore.`);
  }
});
if (!/^function setupStage1\([\s\S]*?requireScriptOwnerExecution_\(\)/m.test(source)) {
  throw new Error('setupStage1 must require direct execution by the Apps Script owner.');
}

console.log(`Static checks passed. Pure tests: ${results.length}. Email-code sign-in flow passed.`);

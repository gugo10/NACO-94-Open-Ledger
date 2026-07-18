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

JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error('Index.html inline script was not found.');
new Function(scriptMatch[1]);

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

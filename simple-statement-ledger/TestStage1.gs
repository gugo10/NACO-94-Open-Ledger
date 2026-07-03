function runSimpleLedgerTests() {
  var results = [
    testNormalizeEmail_(),
    testSplitRoles_(),
    testHasAnyRole_(),
    testNormalizeDateInput_(),
    testParseMoney_(),
    testCsvEscapeRow_(),
    testNormalizeBirthday_(),
    testSanitizeDirectoryPrivacy_(),
    testCleanUserAccess_(),
    testParseLooseRows_(),
    testCleanBankLineRow_(),
    testSummarizeCategoryRows_(),
    testNormalizeReportPeriod_()
  ];
  var failed = results.filter(function(result) {
    return !result.ok;
  });
  if (failed.length) {
    throw new Error('Simple Ledger tests failed: ' + JSON.stringify(failed));
  }
  Logger.log('Simple Statement Ledger tests passed: ' + results.length);
  return results;
}

function assertEqual_(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  return { name: name, ok: ok, actual: actual, expected: expected };
}

function testNormalizeEmail_() {
  return assertEqual_('normalizeEmail lowercases', normalizeEmail(' USER@Example.COM '), 'user@example.com');
}

function testSplitRoles_() {
  return assertEqual_('splitRoles parses roles', splitRoles('Member, Finance Officer'), ['Member', 'Finance Officer']);
}

function testHasAnyRole_() {
  return assertEqual_('hasAnyRole finds allowed role', hasAnyRole(['Member'], ['Publisher', 'Member']), true);
}

function testNormalizeDateInput_() {
  return assertEqual_('normalizeDateInput accepts slash dates', normalizeDateInput_('31/07/2026'), '2026-07-31');
}

function testParseMoney_() {
  return assertEqual_('parseMoney rounds', parseMoney_('1,250.567'), 1250.57);
}

function testCsvEscapeRow_() {
  return assertEqual_('csvEscapeRow quotes comma', csvEscapeRow_(['Aba, Nigeria', 'Ok']), '"Aba, Nigeria",Ok');
}

function testNormalizeBirthday_() {
  return assertEqual_('normalizeBirthday stores day month only', normalizeBirthday_('4/8'), '04/08');
}

function testSanitizeDirectoryPrivacy_() {
  return assertEqual_('directory hides private email', sanitizeMemberForDirectory_({
    'Member ID': 'MEM-0001',
    'Full Name': 'Chidi Okoro',
    'Preferred Name': 'Chidi',
    City: 'Aba',
    Country: 'Nigeria',
    Occupation: 'Engineer',
    'Phone Number': '0800',
    'Email Address': 'chidi@example.com',
    'Show Name': 'Yes',
    'Show City Country': 'Yes',
    'Show Occupation': 'No',
    'Show Phone': 'No',
    'Show Email': 'No'
  }), {
    memberId: 'MEM-0001',
    name: 'Chidi',
    cityCountry: 'Aba, Nigeria',
    occupation: '',
    phoneNumber: '',
    emailAddress: ''
  });
}

function testCleanUserAccess_() {
  return assertEqual_('cleanUserAccess normalizes email', cleanUserAccess_({
    Email: ' TEST@Example.COM ',
    'Full Name': ' Test User ',
    Roles: 'Member, Publisher'
  }).Email, 'test@example.com');
}

function testParseLooseRows_() {
  return assertEqual_('parseLooseRows accepts tabs', parseLooseRows_('01-07-2026\tDues\t100\t0\t100\tREF1')[0][1], 'Dues');
}

function testCleanBankLineRow_() {
  return assertEqual_('cleanBankLineRow normalizes line', cleanBankLineRow_({
    statementDate: '01-07-2026',
    description: ' Dues ',
    moneyIn: '1,000',
    moneyOut: '',
    runningBalance: '1,000'
  }), {
    statementDate: '2026-07-01',
    description: 'Dues',
    referenceNumber: '',
    moneyIn: 1000,
    moneyOut: 0,
    runningBalance: 1000
  });
}

function testSummarizeCategoryRows_() {
  return assertEqual_('summarizeCategoryRows totals income and expenses', summarizeCategoryRows_([
    { categoryType: 'Money In', amount: 1000 },
    { categoryType: 'Money Out', amount: 250 }
  ]), { moneyIn: 1000, moneyOut: 250, netMovement: 750 });
}

function testNormalizeReportPeriod_() {
  var period = normalizeReportPeriod_('01-07-2026', '31-07-2026');
  return assertEqual_('normalizeReportPeriod parses range', [period.start.getFullYear(), period.start.getMonth(), period.end.getDate()], [2026, 6, 31]);
}

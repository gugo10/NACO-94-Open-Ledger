function runStage1Tests() {
  var results = [
    testNormalizeEmail_(),
    testSplitRoles_(),
    testHasAnyRole_(),
    testVisibleNavigationForMember_(),
    testVisibleNavigationForFinanceOfficer_(),
    testVisibleNavigationForPublisher_(),
    testMakeId_(),
    testCleanPrivacySettings_(),
    testCleanMemberUpdateChanges_(),
    testSanitizeMemberForDirectory_(),
    testNormalizeBirthdayDayMonth_(),
    testParseMoney_(),
    testCleanTransactionRecord_(),
    testValidateRequired_(),
    testNormalizeRolesForStorage_(),
    testSuggestCsvMapping_(),
    testMakeBankLineKey_(),
    testDaysBetween_(),
    testSharesWord_(),
    testGetMatchScore_(),
    testCleanReconciliationRecord_(),
    testCleanCashCountRecord_(),
    testSummarizeTransactions_(),
    testCsvEscapeRow_(),
    testNormalizeReportPeriod_(),
    testSplitRolesDropsEmpty_(),
    testCleanUserAccessRecord_(),
    testObjectToAmountRows_(),
    testSumAmountRows_(),
    testNormalizeDateInput_(),
    testFormatDisplayDate_(),
    testCategoryNameCleanup_(),
    testMapImportRow_(),
    testCleanImportedMemberRecord_()
  ];

  var failed = results.filter(function(result) {
    return !result.ok;
  });

  if (failed.length) {
    throw new Error('Stage tests failed: ' + JSON.stringify(failed));
  }

  Logger.log('Stage 1, Stage 2, Stage 3, Stage 4, Stage 5, Stage 6, and Stage 7 tests passed: ' + results.length);
  return results;
}

function assertEqual_(name, actual, expected) {
  var ok = JSON.stringify(actual) === JSON.stringify(expected);
  return {
    name: name,
    ok: ok,
    actual: actual,
    expected: expected
  };
}

function testNormalizeEmail_() {
  return assertEqual_('normalizeEmail trims and lowercases', normalizeEmail('  USER@Example.COM '), 'user@example.com');
}

function testSplitRoles_() {
  return assertEqual_('splitRoles parses comma separated roles', splitRoles('Member, Finance Officer'), ['Member', 'Finance Officer']);
}

function testHasAnyRole_() {
  return assertEqual_('hasAnyRole matches one allowed role', hasAnyRole(['Member'], ['Publisher', 'Member']), true);
}

function testVisibleNavigationForMember_() {
  return assertEqual_('member navigation stays simple', getVisibleNavigation([ROLES.MEMBER]).map(function(item) {
    return item.label;
  }), ['Dashboard', 'Finances', 'Reports', 'Members', 'My Profile']);
}

function testVisibleNavigationForFinanceOfficer_() {
  return assertEqual_('finance officer sees bank matching', getVisibleNavigation([ROLES.FINANCE_OFFICER]).map(function(item) {
    return item.label;
  }), ['Dashboard', 'Finances', 'Bank Matching', 'Reports', 'My Profile']);
}

function testVisibleNavigationForPublisher_() {
  return assertEqual_('publisher sees bank matching', getVisibleNavigation([ROLES.PUBLISHER]).map(function(item) {
    return item.label;
  }), ['Dashboard', 'Finances', 'Bank Matching', 'Reports', 'My Profile']);
}

function testMakeId_() {
  return assertEqual_('makeId pads numeric ids', makeId('MEM', 7), 'MEM-0007');
}

function testCleanPrivacySettings_() {
  return assertEqual_('cleanPrivacySettings normalizes checkboxes', cleanPrivacySettings_({
    'Show Name': 'Yes',
    'Show City Country': 'No',
    'Show Occupation': true,
    'Show Phone': '',
    'Show Email': 'yes',
    'Show Photo': false
  }), {
    'Show Name': 'Yes',
    'Show City Country': 'No',
    'Show Occupation': 'Yes',
    'Show Phone': 'No',
    'Show Email': 'Yes',
    'Show Photo': 'No'
  });
}

function testCleanMemberUpdateChanges_() {
  return assertEqual_('cleanMemberUpdateChanges allows only member-editable fields', cleanMemberUpdateChanges_({
    'Preferred Name': '  Chidi ',
    'Date of Birth': '4/8',
    'Admin Notes': 'hidden',
    'City': 'Aba'
  }), {
    'Preferred Name': 'Chidi',
    'Date of Birth': '4/8',
    'City': 'Aba'
  });
}

function testSanitizeMemberForDirectory_() {
  return assertEqual_('sanitizeMemberForDirectory hides private fields', sanitizeMemberForDirectory_({
    'Member ID': 'MEM-0001',
    'Full Name': 'Chidi Okoro',
    'Preferred Name': 'Chidi',
    'City': 'Aba',
    'Country': 'Nigeria',
    'Occupation': 'Engineer',
    'Phone Number': '08000000000',
    'Email Address': 'chidi@example.com',
    'Profile Photo URL': 'https://example.com/photo.jpg',
    'Show Name': 'Yes',
    'Show City Country': 'Yes',
    'Show Occupation': 'No',
    'Show Phone': 'No',
    'Show Email': 'No',
    'Show Photo': 'No'
  }), {
    memberId: 'MEM-0001',
    name: 'Chidi',
    cityCountry: 'Aba, Nigeria',
    occupation: '',
    phoneNumber: '',
    emailAddress: '',
    profilePhotoUrl: ''
  });
}

function testNormalizeBirthdayDayMonth_() {
  return assertEqual_('normalizeBirthdayDayMonth stores only day and month', normalizeBirthdayDayMonth_('4/8'), '04/08');
}

function testParseMoney_() {
  return assertEqual_('parseMoney handles commas and decimals', parseMoney_('1,250.567'), 1250.57);
}

function testCleanTransactionRecord_() {
  return assertEqual_('cleanTransactionRecord trims finance fields', cleanTransactionRecord_({
    Date: ' 2026-07-02 ',
    Amount: ' 5000 ',
    'Account ID': ' ACC-0001 ',
    'Payer or Payee': ' Chidi ',
    'Category ID': ' CAT-0001 ',
    Description: ' Dues ',
    'Reference Number': ' REF1 ',
    'Payment Method': ' Transfer ',
    'Fund ID': ' FND-0001 ',
    'Document ID': ' DOC-0001 '
  }), {
    Date: '2026-07-02',
    Amount: '5000',
    'Account ID': 'ACC-0001',
    'Payer or Payee': 'Chidi',
    'Category ID': 'CAT-0001',
    Description: 'Dues',
    'Reference Number': 'REF1',
    'Payment Method': 'Transfer',
    'Fund ID': 'FND-0001',
    'Document ID': 'DOC-0001',
    Reason: ''
  });
}

function testValidateRequired_() {
  try {
    validateRequired_({ Date: '2026-07-02', Amount: '' }, ['Date', 'Amount']);
    return assertEqual_('validateRequired throws for missing amount', 'no error', 'error');
  } catch (error) {
    return assertEqual_('validateRequired throws for missing amount', error.message, 'Amount is required.');
  }
}

function testNormalizeRolesForStorage_() {
  return assertEqual_('normalizeRolesForStorage stores publisher role and drops reviewer alias', normalizeRolesForStorage_('Member, Reviewer, Publisher'), 'Member, Publisher');
}

function testSuggestCsvMapping_() {
  return assertEqual_('suggestCsvMapping detects common bank CSV columns', suggestCsvMapping_([
    'Transaction Date',
    'Narration',
    'Debit',
    'Credit',
    'Balance',
    'Reference'
  ]), {
    date: 'Transaction Date',
    description: 'Narration',
    moneyIn: 'Credit',
    moneyOut: 'Debit',
    amount: '',
    balance: 'Balance',
    reference: 'Reference'
  });
}

function testMakeBankLineKey_() {
  return assertEqual_('makeBankLineKey creates stable duplicate key', makeBankLineKey_('ACC-0001', {
    statementDate: '2026-07-02',
    referenceNumber: ' REF1 ',
    description: ' Bank Fee ',
    moneyIn: '0',
    moneyOut: '50'
  }), 'ACC-0001|2026-07-02|ref1|bank fee|0|50');
}

function testDaysBetween_() {
  return assertEqual_('daysBetween handles close dates', daysBetween_('2026-07-02', '2026-07-04'), 2);
}

function testSharesWord_() {
  return assertEqual_('sharesWord detects shared description terms', sharesWord_('NACO dues payment', 'Membership dues received'), true);
}

function testGetMatchScore_() {
  return assertEqual_('getMatchScore scores amount reference date and words', getMatchScore_({
    'Money In': 5000,
    'Money Out': 0,
    'Reference Number': 'REF123',
    'Statement Date': '2026-07-02',
    Description: 'Membership dues'
  }, {
    transactionType: TRANSACTION_TYPES.MONEY_IN,
    amount: 5000,
    referenceNumber: 'REF123',
    date: '2026-07-03',
    description: 'Dues payment'
  }), 100);
}

function testCleanReconciliationRecord_() {
  return assertEqual_('cleanReconciliationRecord trims fields', cleanReconciliationRecord_({
    'Account ID': ' ACC-0001 ',
    'Period Start': ' 2026-07-01 ',
    'Period End': ' 2026-07-31 ',
    'Opening Balance': ' 0 ',
    'Statement Closing Balance': ' 1000 ',
    'Document ID': ' DOC-0001 '
  }), {
    'Account ID': 'ACC-0001',
    'Period Start': '2026-07-01',
    'Period End': '2026-07-31',
    'Opening Balance': '0',
    'Statement Closing Balance': '1000',
    'Document ID': 'DOC-0001'
  });
}

function testCleanCashCountRecord_() {
  return assertEqual_('cleanCashCountRecord trims cash fields', cleanCashCountRecord_({
    'Account ID': ' CASH-1 ',
    'Count Date': ' 2026-07-02 ',
    'Expected Cash Balance': ' 100 ',
    'Actual Cash Counted': ' 95 ',
    Explanation: ' Short ',
    'Document ID': ' DOC-1 '
  }), {
    'Account ID': 'CASH-1',
    'Count Date': '2026-07-02',
    'Expected Cash Balance': '100',
    'Actual Cash Counted': '95',
    Explanation: 'Short',
    'Document ID': 'DOC-1'
  });
}

function testSummarizeTransactions_() {
  return assertEqual_('summarizeTransactions totals money in and out', summarizeTransactions_([
    { transactionType: TRANSACTION_TYPES.MONEY_IN, amount: 500 },
    { transactionType: TRANSACTION_TYPES.MONEY_OUT, amount: 125.25 }
  ]), {
    moneyIn: 500,
    moneyOut: 125.25,
    netMovement: 374.75,
    count: 2
  });
}

function testCsvEscapeRow_() {
  return assertEqual_('csvEscapeRow quotes commas and quotes', csvEscapeRow_(['Aba, Nigeria', 'He said "yes"']), '"Aba, Nigeria","He said ""yes"""');
}

function testNormalizeReportPeriod_() {
  var period = normalizeReportPeriod_('2026-07-01', '2026-07-31');
  return assertEqual_('normalizeReportPeriod parses valid range', [period.start.getFullYear(), period.start.getMonth(), period.end.getDate()], [2026, 6, 31]);
}

function testSplitRolesDropsEmpty_() {
  return assertEqual_('splitRoles drops empty values', splitRoles('Member, , Publisher, '), ['Member', 'Publisher']);
}

function testCleanUserAccessRecord_() {
  return assertEqual_('cleanUserAccessRecord normalizes user access', cleanUserAccessRecord_({
    'User ID': ' USR-1 ',
    Email: ' TEST@Example.COM ',
    'Full Name': ' Test User ',
    Roles: 'Member, Publisher',
    Status: '',
    'Member ID': ' MEM-1 '
  }), {
    'User ID': 'USR-1',
    Email: 'test@example.com',
    'Full Name': 'Test User',
    Roles: 'Member, Publisher',
    Status: 'Active',
    'Member ID': 'MEM-1'
  });
}

function testObjectToAmountRows_() {
  return assertEqual_('objectToAmountRows sorts and rounds statement rows', objectToAmountRows_({
    Donations: 100.555,
    Levies: 20
  }), [
    { name: 'Donations', amount: 100.56 },
    { name: 'Levies', amount: 20 }
  ]);
}

function testSumAmountRows_() {
  return assertEqual_('sumAmountRows totals statement rows', sumAmountRows_([
    { name: 'A', amount: '10.25' },
    { name: 'B', amount: 20 }
  ]), 30.25);
}

function testNormalizeDateInput_() {
  return assertEqual_('normalizeDateInput accepts display date', normalizeDateInput_('31-07-2026'), '2026-07-31');
}

function testFormatDisplayDate_() {
  return assertEqual_('formatDisplayDate converts iso to display date', formatDisplayDate_('2026-07-31'), '31-07-2026');
}

function testCategoryNameCleanup_() {
  var record = { categoryType: ' Money In ', categoryName: ' Scholarship Support ' };
  return assertEqual_('category record cleanup trims values', {
    categoryType: String(record.categoryType || '').trim(),
    categoryName: String(record.categoryName || '').trim()
  }, {
    categoryType: 'Money In',
    categoryName: 'Scholarship Support'
  });
}

function testMapImportRow_() {
  return assertEqual_('mapImportRow maps common pasted member headers', mapImportRow_(['Name', 'Email', 'Phone'], ['Ada Okoro', 'ada@example.com', '0801']), {
    'Full Name': 'Ada Okoro',
    'Email Address': 'ada@example.com',
    'Phone Number': '0801'
  });
}

function testCleanImportedMemberRecord_() {
  return assertEqual_('cleanImportedMemberRecord normalizes email and default country', cleanImportedMemberRecord_({
    'Full Name': ' Ada Okoro ',
    'Email Address': ' ADA@Example.COM '
  })['Email Address'], 'ada@example.com');
}

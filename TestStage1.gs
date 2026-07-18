function runStage1Tests() {
  requireScriptOwnerExecution_();
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
    testCleanImportedMemberRecord_(),
    testBuildIncomeExpenditureCsvRows_(),
    testBuildFinancialPositionCsvRows_(),
    testParsePdfStatementLineWithDebitCreditBalance_(),
    testParsePdfStatementLineWithSignedAmount_(),
    testParseCombinedPdfStatementLines_(),
    testParsePolarisCreditStatementLine_(),
    testParsePolarisDebitStatementLine_(),
    testParseBankStatementChoosesProfile_(),
    testGenericParserAcceptsMonthNameDate_(),
    testStatementBalanceChainPass_(),
    testStatementBalanceChainBreak_(),
    testDerivedBalanceIncludesTransfers_(),
    testTransactionSummaryExcludesTransfers_(),
    testExplicitSourceBankLineId_(),
    testBankDescriptionCategorySuggestion_(),
    testPdfSignatureAllowsLeadingWhitespace_(),
    testSafeSheetValue_(),
    testFinanceDocumentSignatureRejectsFake_()
  ];

  var failed = results.filter(function(result) {
    return !result.ok;
  });

  if (failed.length) {
    throw new Error('Stage tests failed: ' + JSON.stringify(failed));
  }

  Logger.log('Stage 1 through Stage 8 tests passed: ' + results.length);
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
  }), ['Dashboard', 'Finances', 'Bank Statements', 'Reports', 'My Profile']);
}

function testVisibleNavigationForPublisher_() {
  return assertEqual_('publisher sees bank matching', getVisibleNavigation([ROLES.PUBLISHER]).map(function(item) {
    return item.label;
  }), ['Dashboard', 'Finances', 'Bank Statements', 'Reports', 'My Profile']);
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

function testBuildIncomeExpenditureCsvRows_() {
  var rows = buildReportCsvRows_({
    reportType: 'Income and Expenditure Statement',
    periodLabel: '2026-07-01 to 2026-07-31',
    generatedAt: '2026-07-03T00:00:00.000Z',
    summary: {
      totalIncome: 1000,
      totalExpenditure: 250,
      surplusDeficit: 750
    },
    incomeRows: [{ name: 'Dues', amount: 1000 }],
    expenditureRows: [{ name: 'Bank Charges', amount: 250 }]
  });

  return assertEqual_('income and expenditure CSV rows include both sections', rows.slice(4), [
    ['Summary Item', 'Amount'],
    ['Total Income', 1000],
    ['Total Expenditure', 250],
    ['Surplus / Deficit', 750],
    [],
    ['Income', 'Amount'],
    ['Dues', 1000],
    [],
    ['Expenditure', 'Amount'],
    ['Bank Charges', 250]
  ]);
}

function testBuildFinancialPositionCsvRows_() {
  var rows = buildReportCsvRows_({
    reportType: 'Statement of Financial Position',
    periodLabel: 'As at 2026-07-31',
    generatedAt: '2026-07-03T00:00:00.000Z',
    summary: {
      bankBalance: 1000,
      cashAtHand: 200,
      totalFundsAvailable: 1200,
      representedFundsTotal: 1200
    },
    accountRows: [{ name: 'Main Bank', amount: 1000 }, { name: 'Cash Box', amount: 200 }],
    fundRows: [{ name: 'General Association Fund', amount: 1200 }]
  });

  return assertEqual_('financial position CSV rows include accounts and funds', rows.slice(4), [
    ['Summary Item', 'Amount'],
    ['Bank Balance', 1000],
    ['Cash at Hand', 200],
    ['Total Funds Available', 1200],
    ['Represented Funds', 1200],
    [],
    ['Funds Available', 'Amount'],
    ['Main Bank', 1000],
    ['Cash Box', 200],
    [],
    ['Represented By', 'Amount'],
    ['General Association Fund', 1200]
  ]);
}

function testParsePdfStatementLineWithDebitCreditBalance_() {
  var row = parsePdfStatementLine_('04-07-2026 BANK CHARGES 250.00 0.00 9,750.00');
  return assertEqual_('PDF parser reads debit credit balance rows', {
    statementDate: row.statementDate,
    description: row.description,
    moneyIn: row.moneyIn,
    moneyOut: row.moneyOut,
    runningBalance: row.runningBalance
  }, {
    statementDate: '2026-07-04',
    description: 'BANK CHARGES',
    moneyIn: 0,
    moneyOut: 250,
    runningBalance: 9750
  });
}

function testParsePdfStatementLineWithSignedAmount_() {
  var row = parsePdfStatementLine_('04/07/2026 MEMBER DUES PAYMENT 5,000.00 14,750.00');
  return assertEqual_('PDF parser reads amount and balance rows', {
    statementDate: row.statementDate,
    description: row.description,
    moneyIn: row.moneyIn,
    moneyOut: row.moneyOut,
    runningBalance: row.runningBalance
  }, {
    statementDate: '2026-07-04',
    description: 'MEMBER DUES PAYMENT',
    moneyIn: 5000,
    moneyOut: 0,
    runningBalance: 14750
  });
}

function testParseCombinedPdfStatementLines_() {
  var rows = parsePdfStatementText_([
    '04-07-2026',
    'TRANSFER FROM CHIDI OKORO',
    '0.00 10,000.00 24,750.00'
  ].join('\n'));
  return assertEqual_('PDF parser combines wrapped statement lines', {
    statementDate: rows[0].statementDate,
    description: rows[0].description,
    moneyIn: rows[0].moneyIn,
    moneyOut: rows[0].moneyOut,
    runningBalance: rows[0].runningBalance
  }, {
    statementDate: '2026-07-04',
    description: 'TRANSFER FROM CHIDI OKORO',
    moneyIn: 10000,
    moneyOut: 0,
    runningBalance: 24750
  });
}

function testParsePolarisCreditStatementLine_() {
  var row = parsePolarisStatementLine_('03-JUN-26 NIBSS:JIM:Strictly 2026 Annual Dues:000015260603131204000002391478 03-JUN-26 0 5,000.00 1,041,914.70');
  return assertEqual_('Polaris parser maps credit columns', {
    statementDate: row.statementDate,
    description: row.description,
    moneyIn: row.moneyIn,
    moneyOut: row.moneyOut,
    runningBalance: row.runningBalance,
    confidence: row.confidence
  }, {
    statementDate: '2026-06-03',
    description: 'NIBSS:JIM:Strictly 2026 Annual Dues:000015260603131204000002391478',
    moneyIn: 5000,
    moneyOut: 0,
    runningBalance: 1041914.7,
    confidence: 'High'
  });
}

function testParsePolarisDebitStatementLine_() {
  var row = parsePolarisStatementLine_('20-MAR-25 BRANCHTELLER:058/OKOROEGO CHIBUEZE 20-MAR-25 41,726.02 0 362,261.44');
  return assertEqual_('Polaris parser maps debit columns', {
    statementDate: row.statementDate,
    description: row.description,
    moneyIn: row.moneyIn,
    moneyOut: row.moneyOut,
    runningBalance: row.runningBalance,
    confidence: row.confidence
  }, {
    statementDate: '2025-03-20',
    description: 'BRANCHTELLER:058/OKOROEGO CHIBUEZE',
    moneyIn: 0,
    moneyOut: 41726.02,
    runningBalance: 362261.44,
    confidence: 'High'
  });
}

function testParseBankStatementChoosesProfile_() {
  var result = parseBankStatementText_('03-JUN-26 NIBSS:JIM:Annual Dues 03-JUN-26 0 5,000.00 1,041,914.70');
  return assertEqual_('PDF parser chooses a statement profile', {
    profile: result.profile,
    rowCount: result.rows.length,
    moneyIn: result.rows[0].moneyIn
  }, {
    profile: 'Polaris Bank column layout',
    rowCount: 1,
    moneyIn: 5000
  });
}

function testGenericParserAcceptsMonthNameDate_() {
  var row = parsePdfStatementLine_('03-JUN-26 Transfer from member 0 5,000.00 1,041,914.70');
  return assertEqual_('Generic PDF parser accepts month-name dates', {
    statementDate: row.statementDate,
    moneyIn: row.moneyIn,
    moneyOut: row.moneyOut,
    runningBalance: row.runningBalance
  }, {
    statementDate: '2026-06-03',
    moneyIn: 5000,
    moneyOut: 0,
    runningBalance: 1041914.7
  });
}

function testStatementBalanceChainPass_() {
  var rows = validateStatementBalanceChain_([
    { statementDate: '2026-01-01', description: 'Balance B/F', moneyIn: 0, moneyOut: 0, runningBalance: 1000 },
    { statementDate: '2026-01-02', description: 'Member dues', moneyIn: 500, moneyOut: 0, runningBalance: 1500 }
  ]);
  return assertEqual_('balance chain marks mathematically correct row high confidence', {
    confidence: rows[1].confidence,
    check: rows[1].balanceCheck,
    difference: rows[1].balanceDifference
  }, { confidence: 'High', check: 'Pass', difference: 0 });
}

function testStatementBalanceChainBreak_() {
  var rows = validateStatementBalanceChain_([
    { statementDate: '2026-01-01', description: 'Balance B/F', moneyIn: 0, moneyOut: 0, runningBalance: 1000 },
    { statementDate: '2026-01-02', description: 'Bank charge', moneyIn: 50, moneyOut: 0, runningBalance: 950 }
  ]);
  return assertEqual_('balance chain flags wrong debit or credit direction', {
    confidence: rows[1].confidence,
    check: rows[1].balanceCheck,
    difference: rows[1].balanceDifference
  }, { confidence: 'Review', check: 'Break', difference: -100 });
}

function testDerivedBalanceIncludesTransfers_() {
  var balance = calculateDerivedAccountBalance_('ACC-0001', 1000, [
    { 'Account ID': 'ACC-0001', 'Transaction Type': 'Money In', Amount: 500, Status: 'Published' },
    { 'Account ID': 'ACC-0001', 'Transaction Type': 'Transfer Out', Amount: 200, Status: 'Published' },
    { 'Account ID': 'ACC-0001', 'Transaction Type': 'Money Out', Amount: 100, Status: 'Published' }
  ]);
  return assertEqual_('derived balance includes bank transfers without treating them as income', balance, 1200);
}

function testTransactionSummaryExcludesTransfers_() {
  var summary = summarizeTransactions_([
    { transactionType: 'Money In', amount: 500 },
    { transactionType: 'Transfer In', amount: 200 },
    { transactionType: 'Money Out', amount: 100 }
  ]);
  return assertEqual_('receipts and payments summary excludes internal transfers', {
    moneyIn: summary.moneyIn,
    moneyOut: summary.moneyOut,
    netMovement: summary.netMovement
  }, { moneyIn: 500, moneyOut: 100, netMovement: 400 });
}

function testExplicitSourceBankLineId_() {
  return assertEqual_('explicit source bank line replaces reason-text link', getSourceBankLineIdFromTransaction_({
    'Source Bank Line ID': 'BANK-0099',
    Reason: 'No legacy identifier here'
  }), 'BANK-0099');
}

function testBankDescriptionCategorySuggestion_() {
  var categoryId = suggestCategoryForDescription_('ELECTRONIC MONEY TRANSFER LEVY EMTL', 'Money Out', [
    { categoryId: 'CAT-0012', categoryType: 'Money Out', categoryName: 'Banking Charges' }
  ]);
  return assertEqual_('bank fee description suggests banking charges', categoryId, 'CAT-0012');
}

function testPdfSignatureAllowsLeadingWhitespace_() {
  var bytes = [10, 37, 80, 68, 70, 45, 49, 46, 52];
  var errorMessage = '';
  try {
    validateStatementFileSignature_('polaris-statement.pdf', bytes);
  } catch (error) {
    errorMessage = error.message;
  }
  return assertEqual_('PDF signature allows harmless leading bytes before the header', errorMessage, '');
}

function testSafeSheetValue_() {
  return assertEqual_('sheet text that looks like a formula is stored as text', [
    safeSheetValue_('=IMPORTXML("https://example.com")'),
    safeSheetValue_('+1234'),
    safeSheetValue_('Ordinary description'),
    safeSheetValue_(125)
  ], [
    '\'=IMPORTXML("https://example.com")',
    "'+1234",
    'Ordinary description',
    125
  ]);
}

function testFinanceDocumentSignatureRejectsFake_() {
  var message = '';
  try {
    validateFinanceDocumentSignature_('receipt.pdf', 'application/pdf', [78, 79, 84, 65, 80, 68, 70]);
  } catch (error) {
    message = error.message;
  }
  return assertEqual_('receipt upload rejects a fake PDF', message, 'The selected file is not a valid PDF.');
}

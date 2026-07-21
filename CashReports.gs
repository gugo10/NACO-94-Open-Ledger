var CASH_COUNT_STATUS = {
  ENTERED: 'Entered',
  NEEDS_EXPLANATION: 'Needs Explanation',
  REVIEWED: 'Reviewed'
};

var REPORT_PACK_STATUS = {
  DRAFT: 'Draft',
  READY: 'Ready to Publish',
  PUBLISHED: 'Published',
  SENT_BACK: 'Sent Back'
};

var REPORT_ADJUSTMENT_TYPES = {
  INCOME_RECEIVABLE: 'Income Earned but Not Received',
  EXPENSE_PAYABLE: 'Expense Incurred but Not Paid',
  DEFERRED_INCOME: 'Income Received in Advance',
  PREPAID_EXPENSE: 'Expense Paid in Advance'
};

function getStage6Data() {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  requireCurrentSchema_();
  return {
    cashAccounts: getCashAccounts_(),
    recentCashCounts: getRecentCashCounts_(),
    reportSummaries: getReportSummaries_(),
    funds: getActiveFunds_(),
    reportPacks: getReportPackSummaries_(user),
    canPrepareReportPacks: hasFinanceOfficerOrSystemAdmin(user.roles),
    canPublishReportPacks: hasAnyRole(user.roles, [ROLES.PUBLISHER, ROLES.REVIEWER]),
    canEnterCash: hasFinanceOfficerOrSystemAdmin(user.roles),
    canReviewCash: hasAnyRole(user.roles, [ROLES.PUBLISHER, ROLES.REVIEWER])
  };
}

function recordCashCount(record) {
  var user = requireFinanceOfficerOrSystemAdmin();
  var clean = cleanCashCountRecord_(record || {});
  validateRequired_(clean, ['Account ID', 'Count Date', 'Actual Cash Counted']);

  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', clean['Account ID'], false);
  if (!account || account.Status !== 'Active' || account['Account Type'] !== 'Cash at Hand') {
    throw new Error('Please choose an active Cash at Hand account.');
  }
  var expected = calculateCashLedgerBalanceAsAt_(account, clean['Count Date']);
  var actual = parseMoney_(clean['Actual Cash Counted']);
  if (actual < 0) {
    throw new Error('Actual cash counted cannot be negative.');
  }
  validateOptionalDocument_(clean['Document ID']);
  var difference = Math.round((actual - expected) * 100) / 100;
  if (difference !== 0 && !clean.Explanation) {
    throw new Error('Please explain the cash difference.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', clean['Account ID'], false);
    if (!account || account.Status !== 'Active' || account['Account Type'] !== 'Cash at Hand') {
      throw new Error('The selected cash account is no longer active.');
    }
    expected = calculateCashLedgerBalanceAsAt_(account, clean['Count Date']);
    difference = Math.round((actual - expected) * 100) / 100;
    if (difference !== 0 && !clean.Explanation) {
      throw new Error('The ledger balance changed while saving. Explain the cash difference and try again.');
    }
    var cashCountId = getNextId_('Cash Counts', 'CASH');
    var status = difference === 0 ? CASH_COUNT_STATUS.ENTERED : CASH_COUNT_STATUS.NEEDS_EXPLANATION;
    appendSafeRow_(getSheetByName('Cash Counts'), [
      cashCountId,
      clean['Account ID'],
      clean['Count Date'],
      expected,
      actual,
      difference,
      clean.Explanation,
      clean['Document ID'],
      user.email,
      '',
      status,
      nowIso(),
      nowIso()
    ]);

    safeWriteAuditLog_('Cash count entered', 'Cash Count', cashCountId, '', {
      accountId: clean['Account ID'],
      expected: expected,
      actual: actual,
      difference: difference
    }, 'Finance Officer entered cash count');

    return { ok: true, cashCountId: cashCountId, difference: difference, status: status };
  } finally {
    lock.releaseLock();
  }
}

function getExpectedCashBalance(accountId, countDate) {
  requireFinanceOfficerOrSystemAdmin();
  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', String(accountId || '').trim(), false);
  if (!account || account.Status !== 'Active' || account['Account Type'] !== 'Cash at Hand') {
    throw new Error('Please choose an active Cash at Hand account.');
  }
  return {
    accountId: account['Account ID'],
    countDate: normalizeDateInput_(countDate),
    expectedCashBalance: calculateCashLedgerBalanceAsAt_(account, countDate)
  };
}

function calculateCashLedgerBalanceAsAt_(account, countDate) {
  var asAt = parseAppDate_(countDate);
  asAt.setHours(23, 59, 59, 999);
  var balance = parseMoney_(account['Opening Balance']);
  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    if (transaction['Account ID'] !== account['Account ID'] || !isPublishedTransactionStatus_(transaction.Status)) {
      return;
    }
    var transactionDate = parseAppDate_(transaction.Date);
    if (transactionDate > asAt) {
      return;
    }
    var amount = parseMoney_(transaction.Amount);
    balance += isMoneyInType_(transaction['Transaction Type']) ? amount : -amount;
  });
  return Math.round(balance * 100) / 100;
}

function reviewCashCount(cashCountId, notes) {
  var user = requireAnyRole([ROLES.PUBLISHER, ROLES.REVIEWER]);
  var sheet = getSheetByName('Cash Counts');
  var cashCount = findRecordByValue(sheet, 'Cash Count ID', cashCountId, false);
  if (!cashCount) {
    throw new Error('Cash count not found.');
  }
  if (normalizeEmail(cashCount['Counted By']) === user.email) {
    throw new Error('You cannot review a cash count you entered.');
  }
  if (cashCount.Status === CASH_COUNT_STATUS.REVIEWED) {
    throw new Error('This cash count has already been reviewed.');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var current = findRecordByValue(sheet, 'Cash Count ID', cashCountId, false);
    if (!current || current.Status === CASH_COUNT_STATUS.REVIEWED) {
      throw new Error('This cash count has already been reviewed.');
    }
    updateRecordByHeaders(sheet, current._rowNumber, {
      'Reviewed By': user.email,
      Status: CASH_COUNT_STATUS.REVIEWED,
      'Review Notes': String(notes || '').trim(),
      'Updated At': nowIso()
    });
  } finally {
    lock.releaseLock();
  }

  safeWriteAuditLog_('Cash count reviewed', 'Cash Count', cashCountId, cashCount, {
    reviewedBy: user.email,
    notes: notes || ''
  }, 'Publisher reviewed cash count');

  return { ok: true, cashCountId: cashCountId, status: CASH_COUNT_STATUS.REVIEWED };
}

function saveReportPack(payload) {
  var user = requireFinanceOfficerOrSystemAdmin();
  requireCurrentSchema_();
  var clean = cleanReportPackPayload_(payload || {});
  var submit = Boolean((payload || {}).submitForPublishing);
  var sheet = getSheetByName('Report Packs');
  var existing = clean.reportPackId ? findRecordByValue(sheet, 'Report Pack ID', clean.reportPackId, false) : null;
  if (clean.reportPackId && !existing) {
    throw new Error('The report pack could not be found.');
  }
  if (existing) {
    if (!canManageReportPack_(existing, user)) {
      throw new Error('Only the officer who prepared this report pack or a System Administrator can edit it.');
    }
    if ([REPORT_PACK_STATUS.DRAFT, REPORT_PACK_STATUS.SENT_BACK].indexOf(existing.Status) === -1) {
      throw new Error('Only a draft or sent-back report pack can be edited.');
    }
  }

  var now = nowIso();
  var reportPackId = existing ? existing['Report Pack ID'] : '';
  var values = {
    'Report Pack ID': reportPackId,
    'Report Type': clean.reportType,
    'Period Start': clean.periodStart,
    'Period End': clean.periodEnd,
    'Fund ID': clean.fundId,
    Status: submit ? REPORT_PACK_STATUS.READY : REPORT_PACK_STATUS.DRAFT,
    'Prepared By': user.email,
    'Prepared At': now,
    'Reviewed By': '',
    'Reviewed At': '',
    'Publisher Note': '',
    'Narrative JSON': JSON.stringify(clean.narrative),
    'Adjustments JSON': JSON.stringify(clean.adjustments),
    'Snapshot File ID': '',
    'Updated At': now
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (existing) {
      var current = findRecordByValue(sheet, 'Report Pack ID', reportPackId, false);
      if (!current || [REPORT_PACK_STATUS.DRAFT, REPORT_PACK_STATUS.SENT_BACK].indexOf(current.Status) === -1) {
        throw new Error('This report pack changed while you were editing it. Refresh Reports and try again.');
      }
      updateRecordByHeaders(sheet, current._rowNumber, values);
    } else {
      reportPackId = getNextId_('Report Packs', 'RPT');
      values['Report Pack ID'] = reportPackId;
      values['Created At'] = now;
      appendRecordByHeaders_(sheet, values);
    }
  } finally {
    lock.releaseLock();
  }
  safeWriteAuditLog_(submit ? 'Report pack sent to Publisher' : 'Report pack draft saved', 'Report Pack', reportPackId, existing || '', values, submit ? 'Finance Officer completed guided report notes and sent the pack for approval' : 'Finance Officer saved guided report notes');
  return { ok: true, reportPackId: reportPackId, status: values.Status };
}

function getReportPackForEditing(reportPackId) {
  var user = requireFinanceOfficerOrSystemAdmin();
  requireCurrentSchema_();
  var pack = findRecordByValue(getSheetByName('Report Packs'), 'Report Pack ID', String(reportPackId || '').trim(), false);
  if (!pack || !canManageReportPack_(pack, user)) {
    throw new Error('This report pack is not available for editing.');
  }
  if ([REPORT_PACK_STATUS.DRAFT, REPORT_PACK_STATUS.SENT_BACK].indexOf(pack.Status) === -1) {
    throw new Error('Only a draft or sent-back report pack can be edited.');
  }
  return sanitizeReportPack_(pack, true);
}

function previewReportPack(reportPackId) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);
  requireCurrentSchema_();
  var pack = findRecordByValue(getSheetByName('Report Packs'), 'Report Pack ID', String(reportPackId || '').trim(), false);
  if (!pack) {
    throw new Error('Report pack not found.');
  }
  if (pack.Status === REPORT_PACK_STATUS.PUBLISHED && pack['Snapshot File ID']) {
    return readReportPackSnapshot_(pack);
  }
  if (!hasAnyRole(user.roles, [ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]) && !canManageReportPack_(pack, user)) {
    throw new Error('You do not have access to this report pack.');
  }
  return buildReportPackReport_(pack);
}

function reviewReportPack(reportPackId, decision, publisherNote) {
  var user = requireAnyRole([ROLES.PUBLISHER, ROLES.REVIEWER]);
  requireCurrentSchema_();
  decision = String(decision || '').trim();
  if ([REPORT_PACK_STATUS.PUBLISHED, REPORT_PACK_STATUS.SENT_BACK].indexOf(decision) === -1) {
    throw new Error('Choose Publish or Send Back.');
  }
  var sheet = getSheetByName('Report Packs');
  var pack = findRecordByValue(sheet, 'Report Pack ID', String(reportPackId || '').trim(), false);
  if (!pack || pack.Status !== REPORT_PACK_STATUS.READY) {
    throw new Error('Only a report pack that is ready can be reviewed.');
  }
  if (normalizeEmail(pack['Prepared By']) === normalizeEmail(user.email)) {
    throw new Error('You cannot publish a report pack you prepared.');
  }

  var updates = {};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var current = findRecordByValue(sheet, 'Report Pack ID', pack['Report Pack ID'], false);
    if (!current || current.Status !== REPORT_PACK_STATUS.READY) {
      throw new Error('This report pack has already been reviewed.');
    }
    var snapshotFileId = '';
    if (decision === REPORT_PACK_STATUS.PUBLISHED) {
      var report = buildReportPackReport_(current);
      snapshotFileId = createReportPackSnapshot_(current, report);
    }
    updates = {
      Status: decision,
      'Reviewed By': user.email,
      'Reviewed At': nowIso(),
      'Publisher Note': String(publisherNote || '').trim(),
      'Snapshot File ID': snapshotFileId,
      'Updated At': nowIso()
    };
    updateRecordByHeaders(sheet, current._rowNumber, updates);
  } finally {
    lock.releaseLock();
  }
  safeWriteAuditLog_(decision === REPORT_PACK_STATUS.PUBLISHED ? 'Report pack published' : 'Report pack sent back', 'Report Pack', pack['Report Pack ID'], pack, updates, publisherNote || decision);
  return { ok: true, reportPackId: pack['Report Pack ID'], status: decision };
}

function getPublishedReportPack(reportPackId) {
  requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  requireCurrentSchema_();
  var pack = findRecordByValue(getSheetByName('Report Packs'), 'Report Pack ID', String(reportPackId || '').trim(), false);
  if (!pack || pack.Status !== REPORT_PACK_STATUS.PUBLISHED || !pack['Snapshot File ID']) {
    throw new Error('Published report pack not found.');
  }
  return readReportPackSnapshot_(pack);
}

function exportReportPackCsv(reportPackId) {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  requireCurrentSchema_();
  var pack = findRecordByValue(getSheetByName('Report Packs'), 'Report Pack ID', String(reportPackId || '').trim(), false);
  if (!pack) {
    throw new Error('Report pack not found.');
  }
  var report;
  if (pack.Status === REPORT_PACK_STATUS.PUBLISHED && pack['Snapshot File ID']) {
    report = readReportPackSnapshot_(pack);
  } else {
    var canPreview = hasAnyRole(user.roles, [ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]) || canManageReportPack_(pack, user);
    if (!canPreview) {
      throw new Error('You do not have access to export this report pack.');
    }
    report = buildReportPackReport_(pack);
  }
  return buildReportCsvRows_(report).map(csvEscapeRow_).join('\n');
}

function getReportPackSummaries_(user) {
  var canSeeAllWorkingPacks = hasAnyRole(user.roles, [ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);
  return getSheetRecords(getSheetByName('Report Packs')).filter(function(pack) {
    return pack.Status === REPORT_PACK_STATUS.PUBLISHED
      || canSeeAllWorkingPacks
      || (hasAnyRole(user.roles, [ROLES.FINANCE_OFFICER]) && normalizeEmail(pack['Prepared By']) === normalizeEmail(user.email));
  }).slice(-50).reverse().map(function(pack) {
    return sanitizeReportPack_(pack, false);
  });
}

function sanitizeReportPack_(pack, includeContent) {
  var clean = {
    reportPackId: pack['Report Pack ID'],
    reportType: pack['Report Type'],
    periodStart: formatDateOnly_(pack['Period Start']),
    periodEnd: formatDateOnly_(pack['Period End']),
    periodStartIso: normalizeDateInput_(pack['Period Start']),
    periodEndIso: normalizeDateInput_(pack['Period End']),
    fundId: pack['Fund ID'],
    status: pack.Status,
    preparedBy: pack['Prepared By'],
    preparedAt: pack['Prepared At'],
    reviewedBy: pack['Reviewed By'],
    reviewedAt: pack['Reviewed At'],
    publisherNote: pack['Publisher Note']
  };
  if (includeContent) {
    clean.narrative = parseReportJson_(pack['Narrative JSON'], {});
    clean.adjustments = parseReportJson_(pack['Adjustments JSON'], []);
  }
  return clean;
}

function cleanReportPackPayload_(payload) {
  var reportType = String(payload.reportType || payload['Report Type'] || '').trim();
  if (['Complete Financial Statements', 'Fund / Project Statement'].indexOf(reportType) === -1) {
    throw new Error('Choose Complete Financial Statements or Fund / Project Statement.');
  }
  var period = normalizeReportPeriod_(payload.periodStart || payload['Period Start'], payload.periodEnd || payload['Period End']);
  var fundId = String(payload.fundId || payload['Fund ID'] || '').trim();
  if (reportType === 'Fund / Project Statement') {
    if (!fundId) {
      throw new Error('Choose the fund or project for this report pack.');
    }
    if (fundId !== 'GENERAL') {
      validateOptionalFund_(fundId);
    }
  } else {
    fundId = '';
  }
  var narrative = payload.narrative || {};
  return {
    reportPackId: String(payload.reportPackId || '').trim(),
    reportType: reportType,
    periodStart: formatDateForInput_(period.start),
    periodEnd: formatDateForInput_(period.end),
    fundId: fundId,
    narrative: {
      periodHighlights: String(narrative.periodHighlights || '').trim(),
      significantItems: String(narrative.significantItems || '').trim(),
      subsequentEvents: String(narrative.subsequentEvents || '').trim(),
      otherInformation: String(narrative.otherInformation || '').trim(),
      includeTransactionExplanations: narrative.includeTransactionExplanations === true || String(narrative.includeTransactionExplanations || '').toLowerCase() === 'yes'
    },
    adjustments: cleanReportAdjustments_(payload.adjustments || [])
  };
}

function cleanReportAdjustments_(adjustments) {
  var allowed = {};
  Object.keys(REPORT_ADJUSTMENT_TYPES).forEach(function(key) { allowed[REPORT_ADJUSTMENT_TYPES[key]] = true; });
  return (Array.isArray(adjustments) ? adjustments : []).map(function(item) {
    item = item || {};
    var type = String(item.type || '').trim();
    var amount = parseMoney_(item.amount);
    if (!allowed[type]) {
      throw new Error('A period-end item has an invalid type.');
    }
    if (amount < 0) {
      throw new Error('Period-end amounts cannot be negative.');
    }
    return {
      type: type,
      amount: Math.round(amount * 100) / 100,
      description: String(item.description || '').trim() || type
    };
  }).filter(function(item) { return item.amount > 0; });
}

function canManageReportPack_(pack, user) {
  return hasAnyRole(user.roles, [ROLES.SYSTEM_ADMIN]) || normalizeEmail(pack['Prepared By']) === normalizeEmail(user.email);
}

function buildReportPackReport_(pack) {
  var context = {
    narrative: parseReportJson_(pack['Narrative JSON'], {}),
    adjustments: parseReportJson_(pack['Adjustments JSON'], []),
    reportPackId: pack['Report Pack ID'],
    periodStart: pack['Period Start'],
    periodEnd: pack['Period End']
  };
  var report = pack['Report Type'] === 'Fund / Project Statement'
    ? buildFundProjectStatement_(pack['Period Start'], pack['Period End'], pack['Fund ID'], context)
    : buildFinancialStatementsPackage_(pack['Period Start'], pack['Period End'], context);
  report.reportPack = sanitizeReportPack_(pack, false);
  return report;
}

function createReportPackSnapshot_(pack, report) {
  var folder = DriveApp.getFolderById(getSettingValue_(SETTINGS_KEYS.REPORTS_FOLDER_ID));
  var fileName = pack['Report Pack ID'] + '-' + String(pack['Report Type']).replace(/[^A-Za-z0-9]+/g, '-') + '.json';
  return folder.createFile(Utilities.newBlob(JSON.stringify(report), 'application/json', fileName)).getId();
}

function readReportPackSnapshot_(pack) {
  try {
    var report = JSON.parse(DriveApp.getFileById(pack['Snapshot File ID']).getBlob().getDataAsString());
    report.reportPack = sanitizeReportPack_(pack, false);
    return report;
  } catch (error) {
    throw new Error('The published report snapshot could not be opened. Ask the System Administrator to check the Financial Reports folder.');
  }
}

function parseReportJson_(value, fallback) {
  try {
    var parsed = value ? JSON.parse(value) : fallback;
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (error) {
    return fallback;
  }
}

function getReportData(reportType, startDate, endDate, fundId) {
  requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  startDate = startDate ? normalizeDateInput_(startDate) : '';
  endDate = endDate ? normalizeDateInput_(endDate) : '';
  if (reportType === 'Complete Financial Statements') {
    return buildFinancialStatementsPackage_(startDate, endDate);
  }
  if (reportType === 'Statement of Financial Activities' || reportType === 'Income and Expenditure Statement' || reportType === 'Receipts and Payments Statement') {
    return buildIncomeExpenditureStatement_(startDate, endDate, reportType === 'Receipts and Payments Statement' ? reportType : 'Statement of Financial Activities');
  }
  if (reportType === 'Statement of Financial Position' || reportType === 'Statement of Funds Available') {
    return buildFinancialPositionStatement_(endDate || startDate, 'Statement of Financial Position');
  }
  if (reportType === 'Statement of Cash Flows') {
    return buildCashFlowStatement_(startDate, endDate);
  }
  if (reportType === 'Fund / Project Statement') {
    return buildFundProjectStatement_(startDate, endDate, fundId);
  }
  return buildReport_(reportType || 'Monthly Financial Summary', startDate, endDate);
}

function exportReportCsv(reportType, startDate, endDate, fundId) {
  var report = getReportData(reportType, startDate, endDate, fundId);
  var rows = buildReportCsvRows_(report);
  return rows.map(csvEscapeRow_).join('\n');
}

function buildReportCsvRows_(report) {
  if (report.reportType === 'Complete Financial Statements') {
    return buildFinancialStatementsPackageCsvRows_(report);
  }
  if (report.reportType === 'Statement of Financial Activities' || report.reportType === 'Income and Expenditure Statement' || report.reportType === 'Receipts and Payments Statement') {
    return buildIncomeExpenditureCsvRows_(report);
  }
  if (report.reportType === 'Statement of Financial Position' || report.reportType === 'Statement of Funds Available') {
    return buildFinancialPositionCsvRows_(report);
  }
  if (report.reportType === 'Statement of Cash Flows') {
    return buildCashFlowCsvRows_(report);
  }
  if (report.reportType === 'Fund / Project Statement') {
    return buildFundProjectCsvRows_(report);
  }

  var rows = [
    ['Report', report.reportType],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Summary Item', 'Amount'],
    ['Money In', report.summary.moneyIn],
    ['Money Out', report.summary.moneyOut],
    ['Net Movement', report.summary.netMovement],
    [],
    ['Date', 'Type', 'Description', 'Amount', 'Status']
  ];
  report.transactions.forEach(function(txn) {
    rows.push([txn.date, txn.transactionType, txn.description, txn.amount, txn.status]);
  });
  return appendReportNotesCsvRows_(rows, report.notes);
}

function buildIncomeExpenditureCsvRows_(report) {
  var cashLabel = report.reportType === 'Receipts and Payments Statement';
  var rows = [
    ['Report', report.reportType],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Summary Item', 'Amount'],
    [cashLabel ? 'Total Receipts' : 'Total Income', report.summary.totalIncome],
    [cashLabel ? 'Total Payments' : 'Total Expenditure', report.summary.totalExpenditure],
    [cashLabel ? 'Net Receipts / Payments' : 'Surplus / Deficit', report.summary.surplusDeficit],
    [],
    [cashLabel ? 'Receipts' : 'Income', 'Amount']
  ].concat(amountRowsToCsvRows_(report.incomeRows), [
    [],
    [cashLabel ? 'Payments' : 'Expenditure', 'Amount']
  ], amountRowsToCsvRows_(report.expenditureRows));
  return appendReportNotesCsvRows_(rows, report.notes);
}

function buildFinancialPositionCsvRows_(report) {
  var rows = [
    ['Report', report.reportType],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Summary Item', 'Amount'],
    ['Bank Balance', report.mixedCurrencies ? 'See currency totals' : report.summary.bankBalance],
    ['Cash at Hand', report.mixedCurrencies ? 'See currency totals' : report.summary.cashAtHand],
    ['Total Funds Available', report.mixedCurrencies ? 'See currency totals' : report.summary.totalFundsAvailable],
    ['Total Assets', report.summary.totalAssets],
    ['Total Liabilities', report.summary.totalLiabilities],
    ['Net Assets', report.summary.netAssets],
    [],
    ['Assets', 'Amount']
  ].concat(amountRowsToCsvRows_(report.accountRows), report.mixedCurrencies ? [[], ['Currency Totals', 'Amount']].concat(amountRowsToCsvRows_(report.currencyRows)) : [], [
    ['Receivables / Debtors', report.summary.receivables],
    ['Other Assets', report.summary.otherAssets],
    ['Total Assets', report.summary.totalAssets],
    [],
    ['Liabilities', 'Amount'],
    ['Payables / Creditors', report.summary.payables],
    ['Deferred Income', report.summary.deferredIncome],
    ['Other Liabilities', report.summary.otherLiabilities],
    ['Total Liabilities', report.summary.totalLiabilities],
    [],
    ['Accumulated and Project Funds', 'Amount']
  ], amountRowsToCsvRows_(report.fundRows));
  return appendReportNotesCsvRows_(rows, report.notes);
}

function buildCashFlowCsvRows_(report) {
  var rows = [
    ['Report', report.reportType],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Cash Flow Item', 'Amount'],
    ['Cash receipts from operating activities', report.summary.cashReceipts],
    ['Cash payments for operating activities', -report.summary.cashPayments],
    ['Net cash from operating activities', report.summary.netOperatingCashFlow],
    ['Net cash from investing activities', report.summary.netInvestingCashFlow],
    ['Net cash from financing activities', report.summary.netFinancingCashFlow],
    ['Net increase / (decrease) in cash', report.summary.netIncreaseInCash],
    ['Cash and cash equivalents at start', report.summary.openingCash],
    ['Cash and cash equivalents at end', report.summary.closingCash],
    [],
    ['Operating receipts', 'Amount']
  ].concat(amountRowsToCsvRows_(report.receiptRows), [
    [],
    ['Operating payments', 'Amount']
  ], amountRowsToCsvRows_(report.paymentRows));
  return appendReportNotesCsvRows_(rows, report.notes);
}

function buildFundProjectCsvRows_(report) {
  var rows = [
    ['Report', report.reportType],
    ['Report Pack', report.reportPack ? report.reportPack.reportPackId : 'Live report'],
    ['Report Status', report.reportPack ? report.reportPack.status : 'Not archived'],
    ['Fund / Project', report.fund.name],
    ['Project Type', report.fund.type],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Summary Item', 'Amount'],
    ['Opening Fund Balance', report.summary.openingBalance],
    ['Income / Receipts', report.summary.totalIncome],
    ['Expenditure / Payments', report.summary.totalExpenditure],
    ['Surplus / (Deficit)', report.summary.surplusDeficit],
    ['Closing Fund Balance', report.summary.closingBalance],
    [],
    ['Income / Receipts', 'Amount']
  ].concat(amountRowsToCsvRows_(report.incomeRows), [
    [],
    ['Expenditure / Payments', 'Amount']
  ], amountRowsToCsvRows_(report.expenditureRows), [
    [],
    ['Date', 'Type', 'Category', 'Description', 'Amount', 'Status']
  ]);
  (report.transactions || []).forEach(function(transaction) {
    rows.push([transaction.date, transaction.transactionType, transaction.categoryName, transaction.description, transaction.amount, transaction.status]);
  });
  return appendReportNotesCsvRows_(rows, report.notes);
}

function buildFinancialStatementsPackageCsvRows_(report) {
  var rows = [
    ['NACO\'94 Open Ledger'],
    ['Complete Financial Statements'],
    ['Report Pack', report.reportPack ? report.reportPack.reportPackId : 'Live report'],
    ['Report Status', report.reportPack ? report.reportPack.status : 'Not archived'],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    []
  ];
  rows = rows.concat(buildIncomeExpenditureCsvRows_(report.activities), [[]]);
  rows = rows.concat(buildFinancialPositionCsvRows_(report.position), [[]]);
  rows = rows.concat(buildCashFlowCsvRows_(report.cashFlow));
  return rows;
}

function appendReportNotesCsvRows_(rows, notes) {
  if (!notes || !notes.length) {
    return rows;
  }
  rows.push([], ['Notes to the Financial Statements']);
  notes.forEach(function(note) {
    rows.push([], ['Note ' + note.number + ' - ' + note.title]);
    (note.paragraphs || []).forEach(function(paragraph) { rows.push([paragraph]); });
    if (note.rows && note.rows.length) {
      rows.push(['Detail', 'Amount']);
      rows = rows.concat(amountRowsToCsvRows_(note.rows));
    }
    if (note.details && note.details.length) {
      rows.push(['Date', 'Classification', 'Description', 'Officer Explanation', 'Amount', 'Evidence']);
      note.details.forEach(function(detail) {
        rows.push([detail.date, detail.category, detail.description, detail.explanation, detail.amount, detail.evidenceHeld ? 'Held by Finance' : 'Not attached']);
      });
    }
  });
  return rows;
}

function amountRowsToCsvRows_(rows) {
  return (rows || []).map(function(row) {
    return [row.name, row.amount];
  });
}

function getCashAccounts_() {
  return getActiveAccounts_().filter(function(account) {
    return account.accountType === 'Cash at Hand';
  });
}

function getRecentCashCounts_() {
  return getSheetRecords(getSheetByName('Cash Counts')).slice(-30).reverse().map(function(record) {
    return {
      cashCountId: record['Cash Count ID'],
      accountId: record['Account ID'],
      countDate: formatDateOnly_(record['Count Date']),
      expectedCashBalance: parseMoney_(record['Expected Cash Balance']),
      actualCashCounted: parseMoney_(record['Actual Cash Counted']),
      difference: parseMoney_(record.Difference),
      explanation: record.Explanation,
      countedBy: record['Counted By'],
      reviewedBy: record['Reviewed By'],
      status: record.Status
    };
  });
}

function getReportSummaries_() {
  var today = new Date();
  var year = today.getFullYear();
  var monthStart = new Date(year, today.getMonth(), 1);
  var monthEnd = new Date(year, today.getMonth() + 1, 0);
  var yearStart = new Date(year, 0, 1);
  var yearEnd = new Date(year, 11, 31);

  return {
    monthly: buildReport_('Monthly Financial Summary', formatDateForInput_(monthStart), formatDateForInput_(monthEnd)).summary,
    annual: buildReport_('Annual Financial Summary', formatDateForInput_(yearStart), formatDateForInput_(yearEnd)).summary
  };
}

function buildReport_(reportType, startDate, endDate) {
  var period = normalizeReportPeriod_(startDate, endDate);
  var txns = getSheetRecords(getSheetByName('Transactions')).filter(function(transaction) {
    var date = parseAppDate_(transaction.Date);
    return (transaction.Status === TRANSACTION_STATUS.APPROVED || transaction.Status === TRANSACTION_STATUS.RECONCILED)
      && date >= period.start
      && date <= period.end;
  }).map(sanitizeTransactionForDisplay_);

  var summary = summarizeTransactions_(txns);
  return {
    reportType: String(reportType || 'Financial Summary'),
    periodLabel: formatReportPeriodLabel_(period.start, period.end),
    generatedAt: nowIso(),
    summary: summary,
    transactions: txns,
    notes: buildGeneralReportNotes_()
  };
}

function buildIncomeExpenditureStatement_(startDate, endDate, reportLabel, reportContext) {
  var period = normalizeReportPeriod_(startDate, endDate);
  var categories = getCategoryLookup_();
  var txns = getPublishedTransactionsForPeriod_(period.start, period.end);
  var income = {};
  var expenditure = {};

  txns.forEach(function(transaction) {
    if (isInternalTransferType_(transaction['Transaction Type'])) {
      return;
    }
    var categoryName = categories[transaction['Category ID']] || 'Other';
    var amount = parseMoney_(transaction.Amount);
    if (transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN) {
      income[categoryName] = (income[categoryName] || 0) + amount;
    } else {
      expenditure[categoryName] = (expenditure[categoryName] || 0) + amount;
    }
  });
  applyReportAdjustmentsToActivities_(income, expenditure, reportContext && reportContext.adjustments);

  var incomeRows = objectToAmountRows_(income);
  var expenditureRows = objectToAmountRows_(expenditure);
  var totalIncome = sumAmountRows_(incomeRows);
  var totalExpenditure = sumAmountRows_(expenditureRows);
  var fundMovementRows = calculateFundMovementsForPeriod_(period.start, period.end);
  var activityAdjustmentSummary = summarizeReportAdjustments_(reportContext && reportContext.adjustments);
  if (activityAdjustmentSummary.netAssetsAdjustment) {
    fundMovementRows.push({ name: 'Period-end reporting adjustments', amount: activityAdjustmentSummary.netAssetsAdjustment });
  }

  return {
    reportType: reportLabel || 'Statement of Financial Activities',
    periodLabel: formatReportPeriodLabel_(period.start, period.end),
    generatedAt: nowIso(),
    incomeRows: incomeRows,
    expenditureRows: expenditureRows,
    fundMovementRows: fundMovementRows,
    summary: {
      totalIncome: totalIncome,
      totalExpenditure: totalExpenditure,
      surplusDeficit: Math.round((totalIncome - totalExpenditure) * 100) / 100
    },
    notes: appendContextualReportNotes_(buildActivitiesNotes_(incomeRows, expenditureRows, fundMovementRows), reportContext, period.start, period.end, '')
  };
}

function buildFinancialPositionStatement_(asAtDate, reportLabel, reportContext) {
  var asAt = asAtDate ? parseAppDate_(asAtDate) : new Date();
  if (isNaN(asAt.getTime())) {
    throw new Error('As at date is not valid.');
  }
  asAt.setHours(23, 59, 59, 999);

  var accounts = getActiveAccounts_();
  var accountRows = accounts.map(function(account) {
    return {
      name: account.accountName,
      type: account.accountType,
      currency: account.currency,
      amount: calculateAccountBalanceAsAt_(account, asAt)
    };
  });
  var bankTotal = sumAmountRows_(accountRows.filter(function(row) { return row.type !== 'Cash at Hand'; }));
  var cashTotal = sumAmountRows_(accountRows.filter(function(row) { return row.type === 'Cash at Hand'; }));
  var totalFunds = bankTotal + cashTotal;
  var fundRows = calculateFundBalancesAsAt_(asAt, accounts);
  var adjustmentSummary = summarizeReportAdjustments_(reportContext && reportContext.adjustments);
  var receivables = adjustmentSummary.receivables;
  var otherAssets = adjustmentSummary.prepaidExpenses;
  var payables = adjustmentSummary.payables;
  var deferredIncome = adjustmentSummary.deferredIncome;
  var otherLiabilities = 0;
  var totalAssets = Math.round((totalFunds + receivables + otherAssets) * 100) / 100;
  var totalLiabilities = Math.round((payables + deferredIncome + otherLiabilities) * 100) / 100;
  var netAssets = Math.round((totalAssets - totalLiabilities) * 100) / 100;
  if (adjustmentSummary.netAssetsAdjustment) {
    fundRows.push({ name: 'Period-end reporting adjustments', amount: adjustmentSummary.netAssetsAdjustment });
  }
  var currencies = {};
  accountRows.forEach(function(row) { currencies[row.currency || 'NGN'] = true; });
  var currencyTotals = {};
  accountRows.forEach(function(row) {
    var currency = row.currency || 'NGN';
    currencyTotals[currency] = Math.round(((currencyTotals[currency] || 0) + row.amount) * 100) / 100;
  });
  var mixedCurrencies = Object.keys(currencies).length > 1;

  return {
    reportType: reportLabel || 'Statement of Financial Position',
    periodLabel: 'As at ' + formatReportDate_(asAt),
    generatedAt: nowIso(),
    accountRows: accountRows,
    fundRows: fundRows,
    summary: {
      bankBalance: Math.round(bankTotal * 100) / 100,
      cashAtHand: Math.round(cashTotal * 100) / 100,
      totalFundsAvailable: Math.round(totalFunds * 100) / 100,
      receivables: receivables,
      otherAssets: otherAssets,
      totalAssets: totalAssets,
      payables: payables,
      deferredIncome: deferredIncome,
      otherLiabilities: otherLiabilities,
      totalLiabilities: totalLiabilities,
      netAssets: netAssets,
      representedFundsTotal: sumAmountRows_(fundRows)
    },
    currencyWarning: mixedCurrencies ? 'Accounts use more than one currency. Currency totals are shown separately and are not added together.' : '',
    mixedCurrencies: mixedCurrencies,
    currencyRows: Object.keys(currencyTotals).sort().map(function(currency) { return { name: currency + ' accounts', amount: currencyTotals[currency], currency: currency }; }),
    notes: appendContextualReportNotes_(buildPositionNotes_(accountRows, fundRows, mixedCurrencies, adjustmentSummary), reportContext, reportContext && reportContext.periodStart ? parseAppDate_(reportContext.periodStart) : new Date(0), asAt, '')
  };
}

function buildCashFlowStatement_(startDate, endDate, reportContext) {
  var period = normalizeReportPeriod_(startDate, endDate);
  var categories = getCategoryLookup_();
  var txns = getPublishedTransactionsForPeriod_(period.start, period.end);
  var receipts = {};
  var payments = {};
  txns.forEach(function(transaction) {
    if (isInternalTransferType_(transaction['Transaction Type'])) {
      return;
    }
    var categoryName = categories[transaction['Category ID']] || 'Other';
    var amount = parseMoney_(transaction.Amount);
    if (transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN) {
      receipts[categoryName] = (receipts[categoryName] || 0) + amount;
    } else {
      payments[categoryName] = (payments[categoryName] || 0) + amount;
    }
  });
  var receiptRows = objectToAmountRows_(receipts);
  var paymentRows = objectToAmountRows_(payments);
  var cashReceipts = sumAmountRows_(receiptRows);
  var cashPayments = sumAmountRows_(paymentRows);
  var netOperating = Math.round((cashReceipts - cashPayments) * 100) / 100;
  var openingDate = new Date(period.start.getTime() - 1);
  var openingCash = totalAccountBalancesAsAt_(openingDate);
  var closingCash = totalAccountBalancesAsAt_(period.end);
  var netIncrease = Math.round((closingCash - openingCash) * 100) / 100;

  return {
    reportType: 'Statement of Cash Flows',
    periodLabel: formatReportPeriodLabel_(period.start, period.end),
    generatedAt: nowIso(),
    receiptRows: receiptRows,
    paymentRows: paymentRows,
    summary: {
      cashReceipts: cashReceipts,
      cashPayments: cashPayments,
      netOperatingCashFlow: netOperating,
      netInvestingCashFlow: 0,
      netFinancingCashFlow: 0,
      netIncreaseInCash: netIncrease,
      openingCash: openingCash,
      closingCash: closingCash,
      reconciliationDifference: Math.round((netIncrease - netOperating) * 100) / 100
    },
    notes: appendContextualReportNotes_(buildCashFlowNotes_(receiptRows, paymentRows), reportContext, period.start, period.end, '')
  };
}

function buildFundProjectStatement_(startDate, endDate, fundId, reportContext) {
  var period = normalizeReportPeriod_(startDate, endDate);
  fundId = String(fundId || '').trim();
  if (!fundId) {
    throw new Error('Choose a fund or specialized project for this report.');
  }
  var fund = fundId === 'GENERAL' ? { fundId: 'GENERAL', fundName: 'General / Unallocated Activity', type: 'General Association Fund' } : getActiveFunds_().filter(function(item) {
    return item.fundId === fundId;
  })[0];
  if (!fund) {
    throw new Error('The selected fund or project is not active.');
  }

  var categories = getCategoryLookup_();
  var rawTransactions = getPublishedTransactionsForPeriod_(period.start, period.end).filter(function(transaction) {
    return (transaction['Fund ID'] || 'GENERAL') === fundId && !isInternalTransferType_(transaction['Transaction Type']);
  });
  var income = {};
  var expenditure = {};
  var transactions = rawTransactions.map(function(transaction) {
    var categoryName = categories[transaction['Category ID']] || 'Other';
    var amount = parseMoney_(transaction.Amount);
    if (transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN) {
      income[categoryName] = (income[categoryName] || 0) + amount;
    } else {
      expenditure[categoryName] = (expenditure[categoryName] || 0) + amount;
    }
    var clean = sanitizeTransactionForDisplay_(transaction);
    clean.categoryName = categoryName;
    return clean;
  });
  applyReportAdjustmentsToActivities_(income, expenditure, reportContext && reportContext.adjustments);
  var incomeRows = objectToAmountRows_(income);
  var expenditureRows = objectToAmountRows_(expenditure);
  var totalIncome = sumAmountRows_(incomeRows);
  var totalExpenditure = sumAmountRows_(expenditureRows);
  var openingDate = new Date(period.start.getTime() - 1);
  var openingBalance = calculateSingleFundBalanceAsAt_(fundId, openingDate);
  var surplusDeficit = Math.round((totalIncome - totalExpenditure) * 100) / 100;
  var closingBalance = Math.round((openingBalance + surplusDeficit) * 100) / 100;

  return {
    reportType: 'Fund / Project Statement',
    periodLabel: formatReportPeriodLabel_(period.start, period.end),
    generatedAt: nowIso(),
    fund: { id: fund.fundId, name: fund.fundName, type: fund.type || 'Fund / Project' },
    incomeRows: incomeRows,
    expenditureRows: expenditureRows,
    transactions: transactions,
    summary: {
      openingBalance: openingBalance,
      totalIncome: totalIncome,
      totalExpenditure: totalExpenditure,
      surplusDeficit: surplusDeficit,
      closingBalance: closingBalance,
      transactionCount: transactions.length
    },
    notes: appendContextualReportNotes_(buildFundProjectNotes_(fund, incomeRows, expenditureRows, transactions.length), reportContext, period.start, period.end, fundId)
  };
}

function buildFinancialStatementsPackage_(startDate, endDate, reportContext) {
  var period = normalizeReportPeriod_(startDate, endDate);
  return {
    reportType: 'Complete Financial Statements',
    periodLabel: formatReportPeriodLabel_(period.start, period.end),
    generatedAt: nowIso(),
    activities: buildIncomeExpenditureStatement_(startDate, endDate, 'Statement of Financial Activities', reportContext),
    position: buildFinancialPositionStatement_(endDate, 'Statement of Financial Position', reportContext),
    cashFlow: buildCashFlowStatement_(startDate, endDate, reportContext)
  };
}

function summarizeTransactions_(transactions) {
  var summary = {
    moneyIn: 0,
    moneyOut: 0,
    netMovement: 0,
    count: transactions.length
  };

  transactions.forEach(function(transaction) {
    if (isInternalTransferType_(transaction.transactionType)) {
      return;
    }
    if (transaction.transactionType === TRANSACTION_TYPES.MONEY_IN) {
      summary.moneyIn += parseMoney_(transaction.amount);
    } else {
      summary.moneyOut += parseMoney_(transaction.amount);
    }
  });
  summary.netMovement = Math.round((summary.moneyIn - summary.moneyOut) * 100) / 100;
  return summary;
}

function getPublishedTransactionsForPeriod_(start, end) {
  return getSheetRecords(getSheetByName('Transactions')).filter(function(transaction) {
    var date = parseAppDate_(transaction.Date);
    return (transaction.Status === TRANSACTION_STATUS.APPROVED || transaction.Status === TRANSACTION_STATUS.RECONCILED)
      && date >= start
      && date <= end;
  });
}

function calculateAccountBalanceAsAt_(account, asAt) {
  var balance = parseMoney_(account.openingBalance);
  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    var date = parseAppDate_(transaction.Date);
    if (transaction['Account ID'] !== account.accountId || date > asAt) {
      return;
    }
    if (transaction.Status !== TRANSACTION_STATUS.APPROVED && transaction.Status !== TRANSACTION_STATUS.RECONCILED) {
      return;
    }
    if (isMoneyInType_(transaction['Transaction Type'])) {
      balance += parseMoney_(transaction.Amount);
    } else if (isMoneyOutType_(transaction['Transaction Type'])) {
      balance -= parseMoney_(transaction.Amount);
    }
  });
  return Math.round(balance * 100) / 100;
}

function calculateFundBalancesAsAt_(asAt, accounts) {
  var funds = {};
  getActiveFunds_().forEach(function(fund) {
    funds[fund.fundId] = {
      name: fund.fundName,
      amount: 0
    };
  });

  var openingTotal = (accounts || getActiveAccounts_()).reduce(function(total, account) {
    return total + parseMoney_(account.openingBalance);
  }, 0);
  funds.OPENING = {
    name: 'Opening accumulated funds',
    amount: openingTotal
  };

  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    var date = parseAppDate_(transaction.Date);
    var fundId = transaction['Fund ID'] || 'GENERAL';
    if (date > asAt || !isPublishedTransactionStatus_(transaction.Status) || isInternalTransferType_(transaction['Transaction Type'])) {
      return;
    }
    if (!funds[fundId]) {
      funds[fundId] = { name: fundId === 'GENERAL' ? 'General Association Fund' : fundId, amount: 0 };
    }
    var amount = parseMoney_(transaction.Amount);
    funds[fundId].amount += transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN ? amount : -amount;
  });

  return objectToAmountRowsByName_(funds);
}

function calculateSingleFundBalanceAsAt_(fundId, asAt) {
  var balance = fundId === 'GENERAL' ? getActiveAccounts_().reduce(function(total, account) {
    return total + parseMoney_(account.openingBalance);
  }, 0) : 0;
  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    var transactionFundId = transaction['Fund ID'] || 'GENERAL';
    var date = parseAppDate_(transaction.Date);
    if (transactionFundId !== fundId || date > asAt || !isPublishedTransactionStatus_(transaction.Status) || isInternalTransferType_(transaction['Transaction Type'])) {
      return;
    }
    var amount = parseMoney_(transaction.Amount);
    balance += transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN ? amount : -amount;
  });
  return Math.round(balance * 100) / 100;
}

function calculateFundMovementsForPeriod_(start, end) {
  var funds = { GENERAL: { name: 'General / Unallocated Activity', amount: 0 } };
  getActiveFunds_().forEach(function(fund) {
    funds[fund.fundId] = { name: fund.fundName, amount: 0 };
  });
  getPublishedTransactionsForPeriod_(start, end).forEach(function(transaction) {
    if (isInternalTransferType_(transaction['Transaction Type'])) {
      return;
    }
    var fundId = transaction['Fund ID'] || 'GENERAL';
    if (!funds[fundId]) {
      funds[fundId] = { name: fundId, amount: 0 };
    }
    var amount = parseMoney_(transaction.Amount);
    funds[fundId].amount += transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN ? amount : -amount;
  });
  return objectToAmountRowsByName_(funds);
}

function totalAccountBalancesAsAt_(asAt) {
  return Math.round(getActiveAccounts_().reduce(function(total, account) {
    return total + calculateAccountBalanceAsAt_(account, asAt);
  }, 0) * 100) / 100;
}

function applyReportAdjustmentsToActivities_(income, expenditure, adjustments) {
  cleanReportAdjustments_(adjustments || []).forEach(function(item) {
    var label = item.description || item.type;
    if (item.type === REPORT_ADJUSTMENT_TYPES.INCOME_RECEIVABLE) {
      income[label] = (income[label] || 0) + item.amount;
    } else if (item.type === REPORT_ADJUSTMENT_TYPES.EXPENSE_PAYABLE) {
      expenditure[label] = (expenditure[label] || 0) + item.amount;
    } else if (item.type === REPORT_ADJUSTMENT_TYPES.DEFERRED_INCOME) {
      income[label] = (income[label] || 0) - item.amount;
    } else if (item.type === REPORT_ADJUSTMENT_TYPES.PREPAID_EXPENSE) {
      expenditure[label] = (expenditure[label] || 0) - item.amount;
    }
  });
}

function summarizeReportAdjustments_(adjustments) {
  var summary = {
    receivables: 0,
    payables: 0,
    deferredIncome: 0,
    prepaidExpenses: 0,
    netAssetsAdjustment: 0
  };
  cleanReportAdjustments_(adjustments || []).forEach(function(item) {
    if (item.type === REPORT_ADJUSTMENT_TYPES.INCOME_RECEIVABLE) {
      summary.receivables += item.amount;
    } else if (item.type === REPORT_ADJUSTMENT_TYPES.EXPENSE_PAYABLE) {
      summary.payables += item.amount;
    } else if (item.type === REPORT_ADJUSTMENT_TYPES.DEFERRED_INCOME) {
      summary.deferredIncome += item.amount;
    } else if (item.type === REPORT_ADJUSTMENT_TYPES.PREPAID_EXPENSE) {
      summary.prepaidExpenses += item.amount;
    }
  });
  Object.keys(summary).forEach(function(key) { summary[key] = Math.round(summary[key] * 100) / 100; });
  summary.netAssetsAdjustment = Math.round((summary.receivables + summary.prepaidExpenses - summary.payables - summary.deferredIncome) * 100) / 100;
  return summary;
}

function appendContextualReportNotes_(baseNotes, reportContext, periodStart, periodEnd, fundId) {
  var notes = (baseNotes || []).slice();
  if (!reportContext) {
    return renumberReportNotes_(notes);
  }
  var narrative = reportContext.narrative || {};
  notes.push({
    title: 'Officer commentary for the period',
    paragraphs: [
      narrative.periodHighlights ? 'Main activities: ' + narrative.periodHighlights : 'No additional period highlights were reported.',
      narrative.significantItems ? 'Significant or unusual items: ' + narrative.significantItems : 'No additional significant or unusual items were reported.',
      narrative.subsequentEvents ? 'Events after the reporting date: ' + narrative.subsequentEvents : 'No subsequent events were reported.',
      narrative.otherInformation ? 'Other information for members: ' + narrative.otherInformation : 'No other information was reported.'
    ]
  });
  var adjustments = cleanReportAdjustments_(reportContext.adjustments || []);
  notes.push({
    title: 'Period-end reporting adjustments',
    paragraphs: [adjustments.length ? 'The following non-cash items were entered by the Finance Officer and approved as part of this report pack. They affect the Statement of Financial Activities and Statement of Financial Position but not the Statement of Cash Flows.' : 'No period-end receivables, payables, deferred income, or prepaid expenses were reported.'],
    rows: adjustments.map(function(item) { return { name: item.type + ' — ' + item.description, amount: item.amount }; })
  });
  var explanations = narrative.includeTransactionExplanations ? getTransactionExplanationsForPeriod_(periodStart, periodEnd, fundId) : [];
  if (explanations.length) {
    notes.push({
      title: 'Transaction explanations supplied by officers',
      paragraphs: ['These explanations were captured once during bank-statement review and automatically brought into the report.'],
      details: explanations
    });
  }
  return renumberReportNotes_(notes);
}

function renumberReportNotes_(notes) {
  return (notes || []).map(function(note, index) {
    note.number = index + 1;
    return note;
  });
}

function getTransactionExplanationsForPeriod_(start, end, fundId) {
  var categories = getCategoryLookup_();
  var bankLines = {};
  getSheetRecords(getSheetByName('Bank Statement Lines')).forEach(function(line) { bankLines[line['Bank Line ID']] = line; });
  return getPublishedTransactionsForPeriod_(start, end).map(function(transaction) {
    var sourceLine = bankLines[getSourceBankLineIdFromTransaction_(transaction)] || {};
    var explanation = extractTransactionNote_(transaction.Reason) || cleanBankLineNoteForReport_(sourceLine.Notes);
    return { transaction: transaction, explanation: explanation };
  }).filter(function(item) {
    return (!fundId || (item.transaction['Fund ID'] || 'GENERAL') === fundId) && Boolean(item.explanation);
  }).map(function(item) {
    var transaction = item.transaction;
    return {
      date: formatDateOnly_(transaction.Date),
      category: categories[transaction['Category ID']] || 'Other',
      description: transaction.Description,
      explanation: item.explanation,
      amount: parseMoney_(transaction.Amount),
      evidenceHeld: Boolean(transaction['Document ID'])
    };
  });
}

function cleanBankLineNoteForReport_(note) {
  return String(note || '').replace(/\s*Split into \d+ classifications?\.?/ig, '').trim();
}

function extractTransactionNote_(reason) {
  var text = String(reason || '');
  var match = text.match(/\. Note:\s*([\s\S]*?)(?:\s*\|\s*Publisher note:|$)/i);
  return match ? String(match[1] || '').trim() : '';
}

function buildGeneralReportNotes_() {
  return [
    {
      number: 1,
      title: 'Basis of preparation',
      paragraphs: ['This report uses only transactions that have been published in NACO\'94 Open Ledger. Draft, returned, and duplicate-quarantined records are excluded.']
    },
    {
      number: 2,
      title: 'Accounting basis',
      paragraphs: ['The underlying ledger is bank-first and cash-derived. No separate receivables, payables, depreciation, or year-end accrual adjustment register is maintained by the app.']
    }
  ];
}

function buildActivitiesNotes_(incomeRows, expenditureRows, fundMovementRows) {
  return [
    {
      number: 1,
      title: 'Reporting entity and purpose',
      paragraphs: ['NACO\'94 is an alumni nonprofit association. These statements summarize published association activity for member transparency and internal stewardship.']
    },
    {
      number: 2,
      title: 'Basis of preparation and accounting policy',
      paragraphs: [
        'The statement follows a nonprofit income-and-expenditure presentation, but the figures are derived from published cash and bank transactions.',
        'Day-to-day income is recognized when received and expenditure when paid. A Publisher-approved report pack may add the disclosed period-end receivable, payable, deferred-income, and prepaid-expense adjustments. Depreciation, donated services, and general journals are not maintained.'
      ]
    },
    {
      number: 3,
      title: 'Income',
      paragraphs: ['Income is grouped by the classification selected and published for each transaction. Internal transfers between association accounts are excluded.'],
      rows: incomeRows
    },
    {
      number: 4,
      title: 'Expenditure',
      paragraphs: ['Expenditure is grouped by the published classification. Corrections remain visible through reversal and replacement records.'],
      rows: expenditureRows
    },
    {
      number: 5,
      title: 'Movement by fund or project',
      paragraphs: ['This note shows the period surplus or deficit attributed to each selected fund/project. Transactions without a fund are shown as General / Unallocated Activity.'],
      rows: fundMovementRows
    }
  ];
}

function buildPositionNotes_(accountRows, fundRows, mixedCurrencies, adjustmentSummary) {
  adjustmentSummary = adjustmentSummary || summarizeReportAdjustments_([]);
  return [
    {
      number: 1,
      title: 'Basis of preparation and measurement',
      paragraphs: [
        'The statement is presented in a nonprofit statement-of-affairs format using published ledger balances at the reporting date.',
        'Cash and bank balances are measured from account opening balances plus published transactions. A Publisher-approved report pack may add disclosed receivables, payables, deferred income, and prepaid expenses. Other non-cash assets, depreciation, and general journals are not maintained.'
      ]
    },
    {
      number: 2,
      title: 'Cash and cash equivalents',
      paragraphs: ['These are the calculated balances of active association bank, cash, welfare, project, event, and other money-holding accounts.'],
      rows: accountRows
    },
    {
      number: 3,
      title: 'Receivables and other assets',
      paragraphs: [adjustmentSummary.receivables || adjustmentSummary.prepaidExpenses ? 'These balances come from the Publisher-approved period-end items entered for this report pack.' : 'Receivables / debtors and prepaid expenses are reported as zero because no outstanding amounts were entered for this report. Zero does not confirm that no amount exists outside the app.'],
      rows: [{ name: 'Receivables / Debtors', amount: adjustmentSummary.receivables }, { name: 'Prepaid Expenses / Other Assets', amount: adjustmentSummary.prepaidExpenses }]
    },
    {
      number: 4,
      title: 'Liabilities',
      paragraphs: [adjustmentSummary.payables || adjustmentSummary.deferredIncome ? 'These balances come from the Publisher-approved period-end items entered for this report pack.' : 'Payables / creditors and deferred income are reported as zero because no outstanding amounts were entered for this report. Zero does not confirm that no obligation exists outside the app.'],
      rows: [{ name: 'Payables / Creditors', amount: adjustmentSummary.payables }, { name: 'Deferred Income', amount: adjustmentSummary.deferredIncome }, { name: 'Other Liabilities', amount: 0 }]
    },
    {
      number: 5,
      title: 'Accumulated and project funds',
      paragraphs: ['Funds represent opening accumulated balances plus published income less published expenditure assigned to each fund or project.'],
      rows: fundRows
    },
    {
      number: 6,
      title: 'Currency presentation',
      paragraphs: [mixedCurrencies ? 'More than one account currency exists. Currency balances are displayed separately and should not be combined without an approved exchange-rate policy.' : 'The active accounts use one reporting currency. Amounts are shown without a currency symbol so exported reports remain portable.']
    }
  ];
}

function buildCashFlowNotes_(receiptRows, paymentRows) {
  return [
    {
      number: 1,
      title: 'Basis of cash flow preparation',
      paragraphs: ['Cash flows include published movements across active association accounts. Transfers between association accounts are excluded because they do not change total association cash.']
    },
    {
      number: 2,
      title: 'Operating receipts',
      paragraphs: ['Member dues, donations, levies, welfare contributions, project contributions, and similar published receipts are treated as operating cash flows.'],
      rows: receiptRows
    },
    {
      number: 3,
      title: 'Operating payments',
      paragraphs: ['Published association payments are treated as operating cash flows because the current ledger has no separate capital-asset or borrowing classifications.'],
      rows: paymentRows
    },
    {
      number: 4,
      title: 'Investing and financing activities',
      paragraphs: ['Investing and financing cash flows are zero. If NACO\'94 later buys long-term assets or obtains financing, the ledger will need additional classifications before those flows can be reported separately.']
    }
  ];
}

function buildFundProjectNotes_(fund, incomeRows, expenditureRows, transactionCount) {
  return [
    {
      number: 1,
      title: 'Fund or project information',
      paragraphs: [String(fund.fundName || '') + ' is reported as ' + String(fund.type || 'a fund/project') + '. The report includes only published transactions assigned to this fund/project.']
    },
    {
      number: 2,
      title: 'Basis of preparation',
      paragraphs: ['This is a cash-derived accountability statement, not a separate legal entity statement. Shared or general costs are included only when a published transaction was specifically assigned to this fund/project.']
    },
    {
      number: 3,
      title: 'Income and receipts',
      paragraphs: ['Published receipts assigned to the fund/project are grouped by classification.'],
      rows: incomeRows
    },
    {
      number: 4,
      title: 'Expenditure and payments',
      paragraphs: ['Published payments assigned to the fund/project are grouped by classification.'],
      rows: expenditureRows
    },
    {
      number: 5,
      title: 'Completeness of project records',
      paragraphs: [transactionCount + ' published transaction(s) were assigned to this fund/project in the selected period. Transactions left as General / Unallocated are not included.']
    }
  ];
}

function formatReportDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd-MM-yyyy');
}

function formatReportPeriodLabel_(start, end) {
  return 'For the period ' + formatReportDate_(start) + ' to ' + formatReportDate_(end);
}

function getCategoryLookup_() {
  var lookup = {};
  getSheetRecords(getSheetByName('Categories')).forEach(function(category) {
    lookup[category['Category ID']] = category['Category Name'];
  });
  return lookup;
}

function objectToAmountRows_(amounts) {
  return Object.keys(amounts).sort().map(function(name) {
    return {
      name: name,
      amount: Math.round(amounts[name] * 100) / 100
    };
  });
}

function objectToAmountRowsByName_(items) {
  return Object.keys(items).sort(function(a, b) {
    return items[a].name.localeCompare(items[b].name);
  }).map(function(key) {
    return {
      name: items[key].name,
      amount: Math.round(items[key].amount * 100) / 100
    };
  });
}

function sumAmountRows_(rows) {
  return Math.round(rows.reduce(function(total, row) {
    return total + parseMoney_(row.amount);
  }, 0) * 100) / 100;
}

function cleanCashCountRecord_(record) {
  return {
    'Account ID': String(record['Account ID'] || '').trim(),
    'Count Date': normalizeDateInput_(record['Count Date']),
    'Expected Cash Balance': String(record['Expected Cash Balance'] || '').trim(),
    'Actual Cash Counted': String(record['Actual Cash Counted'] || '').trim(),
    Explanation: String(record.Explanation || '').trim(),
    'Document ID': String(record['Document ID'] || '').trim()
  };
}

function normalizeReportPeriod_(startDate, endDate) {
  var today = new Date();
  var start = startDate ? parseAppDate_(startDate) : new Date(today.getFullYear(), today.getMonth(), 1);
  var end = endDate ? parseAppDate_(endDate) : new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Report dates are not valid.');
  }
  if (start > end) {
    throw new Error('Report start date cannot be after end date.');
  }
  end.setHours(23, 59, 59, 999);
  return { start: start, end: end };
}

function formatDateForInput_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function csvEscapeRow_(row) {
  return row.map(function(value) {
    var text = String(value === undefined || value === null ? '' : value);
    if (/^[=+\-@]/.test(text)) {
      text = "'" + text;
    }
    if (text.indexOf('"') !== -1 || text.indexOf(',') !== -1 || text.indexOf('\n') !== -1) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }).join(',');
}

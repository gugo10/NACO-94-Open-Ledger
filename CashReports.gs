var CASH_COUNT_STATUS = {
  ENTERED: 'Entered',
  NEEDS_EXPLANATION: 'Needs Explanation',
  REVIEWED: 'Reviewed'
};

function getStage6Data() {
  var user = requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.SYSTEM_ADMIN]);
  return {
    cashAccounts: getCashAccounts_(),
    recentCashCounts: getRecentCashCounts_(),
    reportSummaries: getReportSummaries_(),
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

function getReportData(reportType, startDate, endDate) {
  requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  startDate = startDate ? normalizeDateInput_(startDate) : '';
  endDate = endDate ? normalizeDateInput_(endDate) : '';
  if (reportType === 'Income and Expenditure Statement' || reportType === 'Receipts and Payments Statement') {
    return buildIncomeExpenditureStatement_(startDate, endDate, reportType === 'Income and Expenditure Statement' ? reportType : 'Receipts and Payments Statement');
  }
  if (reportType === 'Statement of Financial Position' || reportType === 'Statement of Funds Available') {
    return buildFinancialPositionStatement_(endDate || startDate, reportType === 'Statement of Financial Position' ? reportType : 'Statement of Funds Available');
  }
  return buildReport_(reportType || 'Monthly Financial Summary', startDate, endDate);
}

function exportReportCsv(reportType, startDate, endDate) {
  var report = getReportData(reportType, startDate, endDate);
  var rows = buildReportCsvRows_(report);
  return rows.map(csvEscapeRow_).join('\n');
}

function buildReportCsvRows_(report) {
  if (report.reportType === 'Income and Expenditure Statement' || report.reportType === 'Receipts and Payments Statement') {
    return buildIncomeExpenditureCsvRows_(report);
  }
  if (report.reportType === 'Statement of Financial Position' || report.reportType === 'Statement of Funds Available') {
    return buildFinancialPositionCsvRows_(report);
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
  return rows;
}

function buildIncomeExpenditureCsvRows_(report) {
  var cashLabel = report.reportType === 'Receipts and Payments Statement';
  return [
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
}

function buildFinancialPositionCsvRows_(report) {
  return [
    ['Report', report.reportType],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Summary Item', 'Amount'],
    ['Bank Balance', report.mixedCurrencies ? 'See currency totals' : report.summary.bankBalance],
    ['Cash at Hand', report.mixedCurrencies ? 'See currency totals' : report.summary.cashAtHand],
    ['Total Funds Available', report.mixedCurrencies ? 'See currency totals' : report.summary.totalFundsAvailable],
    ['Represented Funds', report.summary.representedFundsTotal],
    [],
    ['Funds Available', 'Amount']
  ].concat(amountRowsToCsvRows_(report.accountRows), report.mixedCurrencies ? [[], ['Currency Totals', 'Amount']].concat(amountRowsToCsvRows_(report.currencyRows)) : [], [
    [],
    ['Represented By', 'Amount']
  ], amountRowsToCsvRows_(report.fundRows));
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
    periodLabel: formatDateForInput_(period.start) + ' to ' + formatDateForInput_(period.end),
    generatedAt: nowIso(),
    summary: summary,
    transactions: txns
  };
}

function buildIncomeExpenditureStatement_(startDate, endDate, reportLabel) {
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

  var incomeRows = objectToAmountRows_(income);
  var expenditureRows = objectToAmountRows_(expenditure);
  var totalIncome = sumAmountRows_(incomeRows);
  var totalExpenditure = sumAmountRows_(expenditureRows);

  return {
    reportType: reportLabel || 'Receipts and Payments Statement',
    periodLabel: formatDateForInput_(period.start) + ' to ' + formatDateForInput_(period.end),
    generatedAt: nowIso(),
    incomeRows: incomeRows,
    expenditureRows: expenditureRows,
    summary: {
      totalIncome: totalIncome,
      totalExpenditure: totalExpenditure,
      surplusDeficit: Math.round((totalIncome - totalExpenditure) * 100) / 100
    }
  };
}

function buildFinancialPositionStatement_(asAtDate, reportLabel) {
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
  var bankTotal = sumAmountRows_(accountRows.filter(function(row) { return row.type === 'Bank Account'; }));
  var cashTotal = sumAmountRows_(accountRows.filter(function(row) { return row.type === 'Cash at Hand'; }));
  var totalFunds = bankTotal + cashTotal;
  var fundRows = calculateFundBalancesAsAt_(asAt, accounts);
  var currencies = {};
  accountRows.forEach(function(row) { currencies[row.currency || 'NGN'] = true; });
  var currencyTotals = {};
  accountRows.forEach(function(row) {
    var currency = row.currency || 'NGN';
    currencyTotals[currency] = Math.round(((currencyTotals[currency] || 0) + row.amount) * 100) / 100;
  });
  var mixedCurrencies = Object.keys(currencies).length > 1;

  return {
    reportType: reportLabel || 'Statement of Funds Available',
    periodLabel: 'As at ' + formatDateForInput_(asAt),
    generatedAt: nowIso(),
    accountRows: accountRows,
    fundRows: fundRows,
    summary: {
      bankBalance: Math.round(bankTotal * 100) / 100,
      cashAtHand: Math.round(cashTotal * 100) / 100,
      totalFundsAvailable: Math.round(totalFunds * 100) / 100,
      representedFundsTotal: sumAmountRows_(fundRows)
    },
    currencyWarning: mixedCurrencies ? 'Accounts use more than one currency. Currency totals are shown separately and are not added together.' : '',
    mixedCurrencies: mixedCurrencies,
    currencyRows: Object.keys(currencyTotals).sort().map(function(currency) { return { name: currency + ' accounts', amount: currencyTotals[currency], currency: currency }; })
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

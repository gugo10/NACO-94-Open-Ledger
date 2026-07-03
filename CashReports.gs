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
    canEnterCash: hasAnyRole(user.roles, [ROLES.FINANCE_OFFICER]),
    canReviewCash: hasAnyRole(user.roles, [ROLES.PUBLISHER, ROLES.REVIEWER])
  };
}

function recordCashCount(record) {
  var user = requireAnyRole([ROLES.FINANCE_OFFICER]);
  var clean = cleanCashCountRecord_(record || {});
  validateRequired_(clean, ['Account ID', 'Count Date', 'Expected Cash Balance', 'Actual Cash Counted']);

  var expected = parseMoney_(clean['Expected Cash Balance']);
  var actual = parseMoney_(clean['Actual Cash Counted']);
  var difference = Math.round((actual - expected) * 100) / 100;
  if (difference !== 0 && !clean.Explanation) {
    throw new Error('Please explain the cash difference.');
  }

  var account = findRecordByValue(getSheetByName('Accounts'), 'Account ID', clean['Account ID'], false);
  if (!account || account.Status !== 'Active' || account['Account Type'] !== 'Cash at Hand') {
    throw new Error('Please choose an active Cash at Hand account.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var cashCountId = getNextId('Cash Counts', 'CASH');
    var status = difference === 0 ? CASH_COUNT_STATUS.ENTERED : CASH_COUNT_STATUS.NEEDS_EXPLANATION;
    getSheetByName('Cash Counts').appendRow([
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

    writeAuditLog('Cash count entered', 'Cash Count', cashCountId, '', {
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

  updateRecordByHeaders(sheet, cashCount._rowNumber, {
    'Reviewed By': user.email,
    Status: CASH_COUNT_STATUS.REVIEWED,
    'Updated At': nowIso()
  });

  writeAuditLog('Cash count reviewed', 'Cash Count', cashCountId, cashCount, {
    reviewedBy: user.email,
    notes: notes || ''
  }, 'Publisher reviewed cash count');

  return { ok: true, cashCountId: cashCountId, status: CASH_COUNT_STATUS.REVIEWED };
}

function getReportData(reportType, startDate, endDate) {
  requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.REVIEWER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  startDate = startDate ? normalizeDateInput_(startDate) : '';
  endDate = endDate ? normalizeDateInput_(endDate) : '';
  if (reportType === 'Income and Expenditure Statement') {
    return buildIncomeExpenditureStatement_(startDate, endDate);
  }
  if (reportType === 'Statement of Financial Position') {
    return buildFinancialPositionStatement_(endDate || startDate);
  }
  return buildReport_(reportType || 'Monthly Financial Summary', startDate, endDate);
}

function exportReportCsv(reportType, startDate, endDate) {
  var report = getReportData(reportType, startDate, endDate);
  var rows = buildReportCsvRows_(report);
  return rows.map(csvEscapeRow_).join('\n');
}

function buildReportCsvRows_(report) {
  if (report.reportType === 'Income and Expenditure Statement') {
    return buildIncomeExpenditureCsvRows_(report);
  }
  if (report.reportType === 'Statement of Financial Position') {
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
  return [
    ['Report', report.reportType],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Summary Item', 'Amount'],
    ['Total Income', report.summary.totalIncome],
    ['Total Expenditure', report.summary.totalExpenditure],
    ['Surplus / Deficit', report.summary.surplusDeficit],
    [],
    ['Income', 'Amount']
  ].concat(amountRowsToCsvRows_(report.incomeRows), [
    [],
    ['Expenditure', 'Amount']
  ], amountRowsToCsvRows_(report.expenditureRows));
}

function buildFinancialPositionCsvRows_(report) {
  return [
    ['Report', report.reportType],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Summary Item', 'Amount'],
    ['Bank Balance', report.summary.bankBalance],
    ['Cash at Hand', report.summary.cashAtHand],
    ['Total Funds Available', report.summary.totalFundsAvailable],
    ['Represented Funds', report.summary.representedFundsTotal],
    [],
    ['Funds Available', 'Amount']
  ].concat(amountRowsToCsvRows_(report.accountRows), [
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
    var date = new Date(transaction.Date);
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

function buildIncomeExpenditureStatement_(startDate, endDate) {
  var period = normalizeReportPeriod_(startDate, endDate);
  var categories = getCategoryLookup_();
  var txns = getPublishedTransactionsForPeriod_(period.start, period.end);
  var income = {};
  var expenditure = {};

  txns.forEach(function(transaction) {
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
    reportType: 'Income and Expenditure Statement',
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

function buildFinancialPositionStatement_(asAtDate) {
  var asAt = asAtDate ? new Date(asAtDate) : new Date();
  if (isNaN(asAt.getTime())) {
    throw new Error('As at date is not valid.');
  }
  asAt.setHours(23, 59, 59, 999);

  var accounts = getActiveAccounts_();
  var accountRows = accounts.map(function(account) {
    return {
      name: account.accountName,
      type: account.accountType,
      amount: calculateAccountBalanceAsAt_(account, asAt)
    };
  });
  var bankTotal = sumAmountRows_(accountRows.filter(function(row) { return row.type === 'Bank Account'; }));
  var cashTotal = sumAmountRows_(accountRows.filter(function(row) { return row.type === 'Cash at Hand'; }));
  var totalFunds = bankTotal + cashTotal;
  var fundRows = calculateFundBalancesAsAt_(asAt);

  return {
    reportType: 'Statement of Financial Position',
    periodLabel: 'As at ' + formatDateForInput_(asAt),
    generatedAt: nowIso(),
    accountRows: accountRows,
    fundRows: fundRows,
    summary: {
      bankBalance: Math.round(bankTotal * 100) / 100,
      cashAtHand: Math.round(cashTotal * 100) / 100,
      totalFundsAvailable: Math.round(totalFunds * 100) / 100,
      representedFundsTotal: sumAmountRows_(fundRows)
    }
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
    var date = new Date(transaction.Date);
    return (transaction.Status === TRANSACTION_STATUS.APPROVED || transaction.Status === TRANSACTION_STATUS.RECONCILED)
      && date >= start
      && date <= end;
  });
}

function calculateAccountBalanceAsAt_(account, asAt) {
  var balance = parseMoney_(account.openingBalance);
  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    var date = new Date(transaction.Date);
    if (transaction['Account ID'] !== account.accountId || date > asAt) {
      return;
    }
    if (transaction.Status !== TRANSACTION_STATUS.APPROVED && transaction.Status !== TRANSACTION_STATUS.RECONCILED) {
      return;
    }
    if (transaction['Transaction Type'] === TRANSACTION_TYPES.MONEY_IN) {
      balance += parseMoney_(transaction.Amount);
    } else {
      balance -= parseMoney_(transaction.Amount);
    }
  });
  return Math.round(balance * 100) / 100;
}

function calculateFundBalancesAsAt_(asAt) {
  var funds = {};
  getActiveFunds_().forEach(function(fund) {
    funds[fund.fundId] = {
      name: fund.fundName,
      amount: 0
    };
  });

  getSheetRecords(getSheetByName('Transactions')).forEach(function(transaction) {
    var date = new Date(transaction.Date);
    var fundId = transaction['Fund ID'] || 'GENERAL';
    if (date > asAt || (transaction.Status !== TRANSACTION_STATUS.APPROVED && transaction.Status !== TRANSACTION_STATUS.RECONCILED)) {
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
  var start = startDate ? new Date(startDate) : new Date(today.getFullYear(), today.getMonth(), 1);
  var end = endDate ? new Date(endDate) : new Date(today.getFullYear(), today.getMonth() + 1, 0);
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
    if (text.indexOf('"') !== -1 || text.indexOf(',') !== -1 || text.indexOf('\n') !== -1) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }).join(',');
}

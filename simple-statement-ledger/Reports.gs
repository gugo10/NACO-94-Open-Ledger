function getDashboardData() {
  requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  var progress = getClassificationProgress_();
  var report = buildSimpleReport_('', '');
  return {
    progress: progress,
    summary: report.summary,
    recentLines: getRecentBankLines_().slice(0, 10)
  };
}

function getSimpleReportData(startDate, endDate) {
  requireAnyRole([ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN]);
  return buildSimpleReport_(startDate, endDate);
}

function exportSimpleReportCsv(startDate, endDate) {
  var report = getSimpleReportData(startDate, endDate);
  var rows = [
    ['Report', 'Simple Statement Ledger Report'],
    ['Period', report.periodLabel],
    ['Generated At', report.generatedAt],
    [],
    ['Summary Item', 'Amount'],
    ['Money In', report.summary.moneyIn],
    ['Money Out', report.summary.moneyOut],
    ['Net Movement', report.summary.netMovement],
    ['Unclassified Bank Lines', report.summary.unclassifiedLines],
    ['Needs Review Bank Lines', report.summary.needsReviewLines],
    [],
    ['Category', 'Type', 'Amount']
  ];
  report.categoryRows.forEach(function(row) {
    rows.push([row.categoryName, row.categoryType, row.amount]);
  });
  rows.push([]);
  rows.push(['Date', 'Description', 'Category', 'Member ID', 'Amount', 'Direction', 'Notes']);
  report.detailRows.forEach(function(row) {
    rows.push([row.statementDate, row.description, row.categoryName, row.memberId, row.amount, row.direction, row.notes]);
  });
  return rows.map(csvEscapeRow_).join('\n');
}

function buildSimpleReport_(startDate, endDate) {
  var period = normalizeReportPeriod_(startDate, endDate);
  var categories = {};
  getActiveCategories_().forEach(function(category) {
    categories[category.categoryId] = category;
  });
  var bankLines = {};
  getSheetRecords(getSheetByName('Bank Lines')).forEach(function(line) {
    var date = new Date(line['Statement Date']);
    if (date >= period.start && date <= period.end) {
      bankLines[line['Bank Line ID']] = line;
    }
  });

  var categoryTotals = {};
  var detailRows = [];
  getSheetRecords(getSheetByName('Classifications')).filter(function(classification) {
    return classification.Status === 'Active' && bankLines[classification['Bank Line ID']];
  }).forEach(function(classification) {
    var category = categories[classification['Category ID']] || { categoryName: 'Unknown', categoryType: classification.Direction };
    if (category.categoryType === 'Transfer' || category.categoryType === 'Review') {
      return;
    }
    var bankLine = bankLines[classification['Bank Line ID']];
    var amount = parseMoney_(classification.Amount);
    var key = category.categoryId || category.categoryName;
    if (!categoryTotals[key]) {
      categoryTotals[key] = { categoryName: category.categoryName, categoryType: category.categoryType, amount: 0 };
    }
    categoryTotals[key].amount += amount;
    detailRows.push({
      statementDate: formatDisplayDate_(bankLine['Statement Date']),
      description: bankLine.Description,
      categoryName: category.categoryName,
      memberId: classification['Member ID'],
      amount: amount,
      direction: classification.Direction,
      notes: classification.Notes
    });
  });

  var categoryRows = Object.keys(categoryTotals).sort(function(a, b) {
    return categoryTotals[a].categoryName.localeCompare(categoryTotals[b].categoryName);
  }).map(function(key) {
    var row = categoryTotals[key];
    row.amount = Math.round(row.amount * 100) / 100;
    return row;
  });
  var summary = summarizeCategoryRows_(categoryRows);
  var progress = getClassificationProgress_();
  summary.unclassifiedLines = progress.unclassifiedLines;
  summary.needsReviewLines = progress.needsReviewLines;
  return {
    periodLabel: formatDisplayDate_(period.start) + ' to ' + formatDisplayDate_(period.end),
    generatedAt: nowIso(),
    summary: summary,
    categoryRows: categoryRows,
    detailRows: detailRows
  };
}

function summarizeCategoryRows_(rows) {
  var summary = { moneyIn: 0, moneyOut: 0, netMovement: 0 };
  rows.forEach(function(row) {
    if (row.categoryType === 'Money In') {
      summary.moneyIn += parseMoney_(row.amount);
    }
    if (row.categoryType === 'Money Out') {
      summary.moneyOut += parseMoney_(row.amount);
    }
  });
  summary.netMovement = Math.round((summary.moneyIn - summary.moneyOut) * 100) / 100;
  return summary;
}

function normalizeReportPeriod_(startDate, endDate) {
  var today = new Date();
  var start = startDate ? new Date(normalizeDateInput_(startDate)) : new Date(today.getFullYear(), today.getMonth(), 1);
  var end = endDate ? new Date(normalizeDateInput_(endDate)) : new Date(today.getFullYear(), today.getMonth() + 1, 0);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Report dates are not valid.');
  }
  if (start > end) {
    throw new Error('Start date cannot be after end date.');
  }
  end.setHours(23, 59, 59, 999);
  return { start: start, end: end };
}

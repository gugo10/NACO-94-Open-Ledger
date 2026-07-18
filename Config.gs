var APP_CONFIG = {
  APP_NAME: "NACO'94 Bank Ledger",
  TAGLINE: 'Bank-first records. Clear reports.',
  DATA_SPREADSHEET_NAME: "NACO'94 Bank Ledger - Data",
  ROOT_FOLDER_NAME: "NACO'94 Bank Ledger",
  NAVIGATION: [
    { key: 'dashboard', label: 'Dashboard', roles: ['Member', 'Finance Officer', 'Publisher', 'Reviewer', 'Membership Administrator', 'System Administrator'] },
    { key: 'finances', label: 'Finances', roles: ['Member', 'Finance Officer', 'Publisher', 'Reviewer', 'System Administrator'] },
    { key: 'bankMatching', label: 'Bank Statements', roles: ['Finance Officer', 'Publisher', 'Reviewer', 'System Administrator'] },
    { key: 'reports', label: 'Reports', roles: ['Member', 'Finance Officer', 'Publisher', 'Reviewer', 'Membership Administrator', 'System Administrator'] },
    { key: 'members', label: 'Members', roles: ['Member', 'Membership Administrator', 'System Administrator'] },
    { key: 'myProfile', label: 'My Profile', roles: ['Member', 'Finance Officer', 'Publisher', 'Reviewer', 'Membership Administrator', 'System Administrator'] },
    { key: 'administration', label: 'Administration', roles: ['System Administrator'] }
  ]
};

var DATA_SCHEMA_VERSION = '8.0';
var APP_VERSION = '8.1.0';

var ROLES = {
  MEMBER: 'Member',
  FINANCE_OFFICER: 'Finance Officer',
  PUBLISHER: 'Publisher',
  REVIEWER: 'Reviewer',
  MEMBERSHIP_ADMIN: 'Membership Administrator',
  SYSTEM_ADMIN: 'System Administrator'
};

var SETTINGS_KEYS = {
  DATA_SPREADSHEET_ID: 'DATA_SPREADSHEET_ID',
  ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
  BANK_STATEMENTS_FOLDER_ID: 'BANK_STATEMENTS_FOLDER_ID',
  RECEIPTS_FOLDER_ID: 'RECEIPTS_FOLDER_ID',
  REPORTS_FOLDER_ID: 'REPORTS_FOLDER_ID',
  ARCHIVE_FOLDER_ID: 'ARCHIVE_FOLDER_ID'
};

var SHEET_DEFINITIONS = [
  { name: 'Users', headers: ['User ID', 'Email', 'Full Name', 'Roles', 'Status', 'Member ID', 'Created At', 'Updated At'] },
  { name: 'Members', headers: ['Member ID', 'Full Name', 'Preferred Name', 'Phone Number', 'Email Address', 'Date of Birth', 'Residential Address', 'City', 'State', 'Country', 'Occupation', 'Employer or Business', 'Marital Status', 'Spouse Name', 'Profile Photo URL', "Date Joined NACO'94", 'Membership Status', 'Admin Notes', 'Show Name', 'Show City Country', 'Show Occupation', 'Show Phone', 'Show Email', 'Show Photo', 'Created At', 'Updated At'] },
  { name: 'Member Update Requests', headers: ['Request ID', 'Member ID', 'Requested By Email', 'Requested Changes JSON', 'Status', 'Reviewed By', 'Reviewed At', 'Created At'] },
  { name: 'Accounts', headers: ['Account ID', 'Account Name', 'Account Type', 'Opening Balance', 'Current Balance', 'Currency', 'Status', 'Masked Bank Account Number', 'Notes', 'Created At', 'Updated At'] },
  { name: 'Categories', headers: ['Category ID', 'Category Type', 'Category Name', 'Status', 'Created At', 'Updated At'] },
  { name: 'Funds and Projects', headers: ['Fund ID', 'Fund or Project Name', 'Type', 'Status', 'Notes', 'Created At', 'Updated At'] },
  { name: 'Transactions', headers: ['Transaction ID', 'Transaction Type', 'Date', 'Amount', 'Account ID', 'Payer or Payee', 'Category ID', 'Description', 'Reference Number', 'Payment Method', 'Fund ID', 'Document ID', 'Entered By', 'Status', 'Submitted At', 'Reviewed By', 'Reviewed At', 'Correction For Transaction ID', 'Reason', 'Created At', 'Updated At', 'Source Bank Line ID', 'Transfer Group ID', 'Correction Batch ID', 'Correction Action'] },
  { name: 'Bank Statement Imports', headers: ['Import ID', 'Account ID', 'File ID', 'File Name', 'File Hash', 'Import Status', 'Imported By', 'Imported At', 'Rows Imported', 'Duplicate Warning', 'Source Format', 'Parser Profile', 'Statement Start', 'Statement End', 'Review Status', 'Error Details', 'Draft File ID'] },
  { name: 'Bank Statement Lines', headers: ['Bank Line ID', 'Import ID', 'Account ID', 'Statement Date', 'Description', 'Money In', 'Money Out', 'Running Balance', 'Reference Number', 'Status', 'Notes', 'Document ID', 'Created At', 'Updated At', 'Row Number', 'Raw Source Text', 'Extraction Confidence', 'Category ID', 'Fund ID', 'Counterparty', 'Review Status', 'Source File Hash', 'Is Duplicate', 'Transfer Account ID'] },
  { name: 'Transaction Matches', headers: ['Match ID', 'Bank Line ID', 'Transaction ID', 'Match Status', 'Matched By', 'Matched At', 'Notes'] },
  { name: 'Reconciliations', headers: ['Reconciliation ID', 'Account ID', 'Period Start', 'Period End', 'Opening Balance', 'Money In', 'Money Out', 'Expected Closing Balance', 'Statement Closing Balance', 'Difference', 'Matched Items', 'Unmatched Bank Lines', 'Unmatched Ledger Transactions', 'Status', 'Prepared By', 'Approved By', 'Date Completed', 'Document ID', 'Created At', 'Updated At', 'Review Notes', 'Exception Approved'] },
  { name: 'Cash Counts', headers: ['Cash Count ID', 'Account ID', 'Count Date', 'Expected Cash Balance', 'Actual Cash Counted', 'Difference', 'Explanation', 'Document ID', 'Counted By', 'Reviewed By', 'Status', 'Created At', 'Updated At', 'Review Notes'] },
  { name: 'Documents', headers: ['Document ID', 'File ID', 'File Name', 'Document Type', 'Visibility', 'Related Record Type', 'Related Record ID', 'Uploaded By', 'Uploaded At', 'Notes'] },
  { name: 'Audit Log', headers: ['Audit ID', 'Date Time', 'User Email', 'Action', 'Record Type', 'Record ID', 'Previous Value JSON', 'New Value JSON', 'Reason'] },
  { name: 'Settings', headers: ['Setting Key', 'Setting Value', 'Notes', 'Updated At', 'Updated By'] }
];

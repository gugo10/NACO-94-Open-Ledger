var SIMPLE_APP = {
  NAME: "NACO'94 Simple Statement Ledger",
  ROOT_FOLDER_NAME: "NACO'94 Simple Statement Ledger",
  DATA_SPREADSHEET_NAME: "NACO'94 Simple Statement Ledger - Data"
};

var ROLES = {
  MEMBER: 'Member',
  FINANCE_OFFICER: 'Finance Officer',
  PUBLISHER: 'Publisher',
  MEMBERSHIP_ADMIN: 'Membership Administrator',
  SYSTEM_ADMIN: 'System Administrator'
};

var SETTINGS_KEYS = {
  DATA_SPREADSHEET_ID: 'DATA_SPREADSHEET_ID',
  ROOT_FOLDER_ID: 'ROOT_FOLDER_ID',
  STATEMENTS_FOLDER_ID: 'STATEMENTS_FOLDER_ID',
  DOCUMENTS_FOLDER_ID: 'DOCUMENTS_FOLDER_ID',
  BACKUP_FOLDER_ID: 'BACKUP_FOLDER_ID'
};

var SHEET_DEFINITIONS = [
  { name: 'Users', headers: ['User ID', 'Email', 'Full Name', 'Roles', 'Status', 'Member ID', 'Created At', 'Updated At'] },
  { name: 'Members', headers: ['Member ID', 'Full Name', 'Preferred Name', 'Email Address', 'Phone Number', 'City', 'Country', 'Occupation', 'Birthday', 'Show Name', 'Show City Country', 'Show Occupation', 'Show Phone', 'Show Email', 'Status', 'Created At', 'Updated At'] },
  { name: 'Categories', headers: ['Category ID', 'Category Type', 'Category Name', 'Report Group', 'Status', 'Created At', 'Updated At'] },
  { name: 'Bank Accounts', headers: ['Account ID', 'Account Name', 'Bank Name', 'Masked Account Number', 'Currency', 'Opening Balance', 'Opening Date', 'Status', 'Created At', 'Updated At'] },
  { name: 'Statement Imports', headers: ['Import ID', 'Account ID', 'Source Type', 'File Name', 'Document ID', 'Imported By', 'Imported At', 'Rows Imported', 'Notes'] },
  { name: 'Bank Lines', headers: ['Bank Line ID', 'Import ID', 'Account ID', 'Statement Date', 'Description', 'Reference Number', 'Money In', 'Money Out', 'Running Balance', 'Source Type', 'Classification Status', 'Review Note', 'Created At', 'Updated At'] },
  { name: 'Classifications', headers: ['Classification ID', 'Bank Line ID', 'Category ID', 'Member ID', 'Amount', 'Direction', 'Notes', 'Status', 'Created By', 'Created At', 'Updated At'] },
  { name: 'Documents', headers: ['Document ID', 'Drive File ID', 'File Name', 'Document Type', 'Linked Record ID', 'Uploaded By', 'Uploaded At', 'Notes'] },
  { name: 'Audit Log', headers: ['Audit ID', 'Timestamp', 'User Email', 'Action', 'Entity Type', 'Entity ID', 'Before', 'After', 'Notes'] },
  { name: 'Settings', headers: ['Key', 'Value', 'Updated At'] },
  { name: 'Backups', headers: ['Backup ID', 'Spreadsheet Copy ID', 'Created By', 'Created At', 'Notes'] }
];

var DEFAULT_CATEGORIES = [
  ['CAT-0001', 'Money In', 'Annual Dues', 'Income', 'Active'],
  ['CAT-0002', 'Money In', 'Welfare Contribution', 'Income', 'Active'],
  ['CAT-0003', 'Money In', 'Project Donation', 'Income', 'Active'],
  ['CAT-0004', 'Money In', 'Event Payment', 'Income', 'Active'],
  ['CAT-0005', 'Money Out', 'Welfare Support', 'Expenditure', 'Active'],
  ['CAT-0006', 'Money Out', 'Bank Charges', 'Expenditure', 'Active'],
  ['CAT-0007', 'Money Out', 'Event Expense', 'Expenditure', 'Active'],
  ['CAT-0008', 'Transfer', 'Internal Transfer', 'Ignore', 'Active'],
  ['CAT-0009', 'Review', 'Needs Review', 'Review', 'Active']
];

function getVisibleNavigation(roles) {
  var items = [
    { key: 'dashboard', label: 'Dashboard', roles: [ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN] },
    { key: 'statements', label: 'Bank Statements', roles: [ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.SYSTEM_ADMIN] },
    { key: 'reports', label: 'Reports', roles: [ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN] },
    { key: 'members', label: 'Members', roles: [ROLES.MEMBER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN] },
    { key: 'myProfile', label: 'My Profile', roles: [ROLES.MEMBER, ROLES.FINANCE_OFFICER, ROLES.PUBLISHER, ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN] },
    { key: 'administration', label: 'Administration', roles: [ROLES.MEMBERSHIP_ADMIN, ROLES.SYSTEM_ADMIN] }
  ];
  return items.filter(function(item) {
    return hasAnyRole(roles, item.roles);
  });
}

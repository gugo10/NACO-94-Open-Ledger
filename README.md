# NACO'94 Open Ledger

Clear accounts. Shared trust.

This is a simple Google Apps Script financial transparency and member database system for the National High School Aba Class of 1994 Alumni Association, NACO'94.

The project is intentionally small and Google-based:

- Google Apps Script backend
- Apps Script HTML Service web interface
- Google Sheets as the data store
- Google Drive for bank statements, receipts, invoices, reports, and backups
- Google account sign-in and a member email allow-list

## Current Scope: Complete Stage 1 to Stage 7

Stage 1 builds the foundation. Stage 2 adds the member database basics. Stage 3 adds basic finances. Stage 4 adds bank statement handling. Stage 5 adds bank matching and reconciliation. Stage 6 adds cash counts and simple reports. Stage 7 adds backup, demo data, and final operating guidance.

Included:

- Apps Script project structure
- Mobile-friendly HTML web app shell
- Google Sheet setup for the required data tabs
- Recommended Google Drive folder setup
- Role model and server-side access checks
- Simple Google account allow-list through the `Users` sheet
- Responsive navigation that hides sections by role
- Basic test functions
- Setup, deployment, and testing notes
- Member profile viewing
- Member profile update requests
- Member directory privacy controls
- Limited member directory
- Membership Administrator controls to add members
- Membership Administrator review of profile update requests
- Birthday day/month storage for private member records
- Accounts
- Funds and projects
- Money In entry
- Money Out entry
- Optional receipt/proof upload
- Transaction marked ready to publish
- Publisher can publish or send back transactions
- Published transaction list for members
- Dashboard balances from published transactions
- User access management from the Administration screen
- System Administrator can add custom Money In and Money Out categories
- Administrators can import members from CSV or pasted Excel rows
- CSV bank statement preview and import
- CSV column mapping
- Duplicate warning for likely duplicate bank statement lines
- PDF bank statement storage as evidence
- Manual bank statement line entry
- Bank statement import log
- Suggested bank-line matching
- Manual bank-line to transaction matching
- Mark bank lines as Needs Review or Internal Transfer
- Create a ledger record from an unmatched bank line
- Reconciliation preparation
- Publisher reconciliation lock
- Cash count entry
- Cash difference explanation
- Cash count review
- Monthly and annual report summaries
- Simple report viewer
- Member-generated Income and Expenditure Statement for any selected period
- Member-generated Statement of Financial Position as at a selected date
- CSV report export backend
- Manual backup button
- Monthly backup trigger setup
- Demo test data helper
- Visible working indicator for slow Google Apps Script actions
- Date entry uses `dd-mm-yyyy` with calendar pickers
- Final user, admin, deployment, and backup guidance

Not included yet:

- Complex accounting package features
- Paid OCR/PDF extraction
- Paid hosting

Those belong to later stages.

## Files

- `appsscript.json` - Apps Script manifest
- `Code.gs` - web app entry points and bootstrap API
- `Config.gs` - app settings, roles, navigation, and sheet definitions
- `Utilities.gs` - shared helpers
- `DataSetup.gs` - Stage 1 folder and spreadsheet setup
- `Members.gs` - Stage 2 member profile, directory, privacy, and update request logic
- `Finance.gs` - Stage 3 accounts, funds, transactions, publishing, balances, and receipt upload logic
- `Admin.gs` - user access and role management logic
- `BankStatements.gs` - Stage 4 CSV/PDF/manual bank statement handling
- `Matching.gs` - Stage 5 bank matching and reconciliation logic
- `CashReports.gs` - Stage 6 cash counts and reporting logic
- `Maintenance.gs` - Stage 7 backup and demo-data helpers
- `Access.gs` - Google account and role checks
- `Audit.gs` - simple audit log writer
- `TestStage1.gs` - basic Stage 1 and Stage 2 tests
- `Index.html` - mobile-friendly HTML Service interface

## Recommended Google Drive Structure

Create this under the official NACO'94 Google account. The `setupStage1()` function can create it automatically.

```text
NACO'94 Open Ledger
|
|-- NACO'94 Open Ledger - Data
|   `-- Google Sheet containing system data
|
|-- Bank Statements
|   |-- 2026
|   |-- 2027
|   `-- Future Years
|
|-- Receipts and Invoices
|   |-- Welfare
|   |-- Projects
|   |-- Events
|   |-- Administration
|   `-- Other
|
|-- Financial Reports
|   |-- Monthly
|   |-- Quarterly
|   `-- Annual
|
`-- Archive
```

Do not share the source Google Sheet or Drive folders directly with ordinary members. Members should use the web app.

## Google Sheet Structure

The data spreadsheet is named:

```text
NACO'94 Open Ledger - Data
```

Stage 1 creates these tabs:

- Users
- Members
- Member Update Requests
- Accounts
- Categories
- Funds and Projects
- Transactions
- Bank Statement Imports
- Bank Statement Lines
- Transaction Matches
- Reconciliations
- Cash Counts
- Documents
- Audit Log
- Settings

Stage 2 uses these existing tabs:

- Users
- Members
- Member Update Requests
- Audit Log

Stage 3 uses these existing tabs:

- Accounts
- Categories
- Funds and Projects
- Transactions
- Documents
- Audit Log

Stage 4 uses these existing tabs:

- Bank Statement Imports
- Bank Statement Lines
- Documents
- Audit Log

Stage 5 uses these existing tabs:

- Bank Statement Lines
- Transactions
- Transaction Matches
- Reconciliations
- Audit Log

Stage 6 uses these existing tabs:

- Cash Counts
- Transactions
- Accounts
- Audit Log

Stage 7 uses:

- Archive Drive folder
- Administration screen
- Audit Log

## Roles

The `Users` sheet controls access. Roles are stored as comma-separated values.

Supported roles:

- Member
- Finance Officer
- Publisher
- Membership Administrator
- System Administrator

Normal members see:

- Dashboard
- Finances
- Reports
- Members
- My Profile

Finance Officers and Publishers see additional finance sections. Only System Administrators see Administration.

Membership Administrators can use the Members section to add members and review profile update requests.
Finance Officers can prepare Money In and Money Out records. Publishers make checked records visible to members.
System Administrators can manage app users and roles from the Administration screen.

## Setup in Google Apps Script

1. Open the official NACO'94 Google account.
2. Create a new Apps Script project.
3. Add the files in this repository to the Apps Script project.
4. In the Apps Script editor, run:

```javascript
setupStage1()
```

5. Review the permissions prompt and approve it from the official account.
6. Confirm that the function returns a spreadsheet URL and root folder URL.
7. Open the created `Users` sheet.
8. Add allowed member Google email addresses and roles.

The setup function adds the active Google account as:

```text
System Administrator, Member
```

## Optional Setup With an Existing Root Folder

If the association already created the root Drive folder, pass its folder ID:

```javascript
setupStage1({
  rootFolderId: 'PASTE_FOLDER_ID_HERE',
  bootstrapAdminEmail: 'official-email@example.com'
})
```

## Deploy as Web App

1. In Apps Script, click **Deploy**.
2. Choose **New deployment**.
3. Select **Web app**.
4. Use these settings:
   - Execute as: **Me** using the official NACO'94 Google account
   - Who has access: **Anyone with a Google account**, or the closest available option for the association's Google environment
5. Deploy.
6. Share the web app URL with allowed members.

Access is still checked server-side against the `Users` sheet.
Do not deploy as "user accessing the web app"; ordinary members should not need direct access to the raw Google Sheet or Drive folders.

## Local Development With clasp

This project can be used with `clasp`, but it can also be edited directly in Apps Script.

After creating an Apps Script project:

```bash
clasp login
clasp clone SCRIPT_ID
clasp push
```

Do not commit a real `.clasp.json` containing a private script ID unless the repository is private and the association agrees.

## Basic Tests

In the Apps Script editor, run:

```javascript
runStage1Tests()
```

Expected result:

```text
Stage 1, Stage 2, Stage 3, Stage 4, Stage 5, Stage 6, and Stage 7 tests passed: 34
```

These tests cover pure Stage 1 and Stage 2 logic:

- Email normalization
- Role parsing
- Role matching
- Member navigation
- Finance Officer navigation
- Publisher navigation
- ID formatting
- Directory privacy normalization
- Profile update field filtering
- Member directory privacy filtering
- Money parsing
- Finance record cleanup
- Required-field validation
- User role normalization
- CSV column mapping
- Bank-line duplicate key creation
- Match suggestion scoring
- Reconciliation field cleanup
- Cash count field cleanup
- Transaction report summaries
- CSV escaping
- Report date validation
- User role cleanup
- User access cleanup
- Statement row formatting
- Statement row totals

## Manual Stage 1 Test

1. Run `setupStage1()`.
2. Open the generated Google Sheet.
3. Confirm all required tabs exist.
4. Confirm the active setup account appears in `Users`.
5. Add a test member email to `Users` with role `Member` and status `Active`.
6. Deploy the web app.
7. Open the web app as the System Administrator.
8. Confirm Administration is visible.
9. Open the web app as the test member.
10. Confirm only Dashboard, Finances, Reports, Members, and My Profile are visible.
11. Open the web app with an unlisted Google account.
12. Confirm access is denied.

## Manual Stage 2 Test

1. Open the app as a System Administrator or Membership Administrator.
2. Go to Members.
3. Add a test member with full name, email address, phone number, city, country, and occupation.
4. Confirm the member appears in the `Members` sheet.
5. Confirm the same email appears in the `Users` sheet with role `Member`.
6. Open the app as that member's Google account.
7. Go to My Profile.
8. Confirm the member can see only their own full profile.
9. Change directory privacy settings and save.
10. Go to Members and confirm only allowed fields are visible.
11. Submit a profile update request from My Profile.
12. Open the app as the Membership Administrator.
13. Go to Members and approve or reject the pending request.
14. Confirm approved changes update the `Members` sheet.
15. Confirm actions appear in the `Audit Log` sheet.

## Manual Stage 3 Test

1. Give one test user the `System Administrator` role.
2. Give one test user the `Finance Officer` role.
3. Give a different test user the `Publisher` role.
4. Open the app as the System Administrator.
5. Go to Finances.
6. Add at least one account, for example:

```text
Account Name: Main Bank Account
Account Type: Bank Account
Opening Balance: 0
Currency: NGN
```

7. Add a fund or project, for example:

```text
General Association Fund
```

8. Open the app as the Finance Officer.
9. Go to Finances.
10. Submit one Money In record.
11. Submit one Money Out record.
12. Optionally attach a PDF, JPG, or PNG receipt/proof.
13. Open the app as the Publisher.
14. Go to Finances.
15. Publish or send back the submitted records.
16. Confirm published records appear in the Published Transactions list.
17. Confirm Dashboard balances update only after publishing.
18. Confirm the `Audit Log` records the preparation and publishing actions.

Important: the same person should not both enter and publish the same transaction.

## Manual Stage 4 Test

1. Open the app as a Finance Officer.
2. Go to Bank Matching.
3. Upload a CSV bank statement.
4. Confirm the app shows a preview.
5. Confirm or adjust these mappings:

```text
Date column
Description column
Money-in column
Money-out column
Balance column
Reference column
```

6. Import the CSV lines.
7. Confirm the import appears under Recent CSV Imports.
8. Confirm imported rows appear under Recent Bank Lines.
9. Upload the same CSV again and confirm a duplicate warning appears.
10. Upload a PDF bank statement and confirm it is stored.
11. Manually enter one bank statement line.
12. Enter the same manual line again and confirm duplicate warning appears.
13. Confirm actions appear in the `Audit Log` sheet.

Stage 4 stores bank statement evidence and lines. Stage 5 matches bank lines to ledger transactions.

## Manual Stage 5 Test

1. Make sure at least one bank line exists from Stage 4.
2. Make sure at least one published transaction exists from Stage 3.
3. Open the app as a Finance Officer.
4. Go to Bank Matching.
5. Select an unmatched bank line.
6. Click Suggest Matches.
7. Match the bank line to a published transaction with the same amount.
8. Confirm the match appears under Recent Matches.
9. Mark another bank line as Needs Review.
10. Mark another bank line as Internal Transfer.
11. Use Create Record From Bank Line for a bank line that is not yet in the ledger.
12. Publish the newly created transaction from the Finances screen.
13. Prepare a reconciliation for the account and period.
14. Open the app as a Publisher.
15. Publish the reconciliation.
16. Confirm the reconciliation status becomes Locked.
17. Confirm actions appear in the `Audit Log` sheet.

## Manual Stage 6 Test

1. Open the app as System Administrator.
2. Go to Finances.
3. Add a `Cash at Hand` account if one does not exist.
4. Open the app as Finance Officer.
5. Go to Finances.
6. Enter a cash count.
7. If actual cash is different from expected cash, enter an explanation.
8. Confirm unexplained differences are rejected.
9. Open the app as Publisher.
10. Review the cash count.
11. Go to Reports.
12. Generate a Monthly Financial Summary.
13. Generate an Annual Financial Summary.
14. Generate an Income and Expenditure Statement for a selected period.
15. Generate a Statement of Financial Position as at a selected date.
16. Confirm published transactions appear in the report.
17. Confirm cash-count actions appear in the `Audit Log` sheet.

## Manual Stage 7 Test

1. Open the app as System Administrator.
2. Go to Administration.
3. Click Back Up Data Now.
4. Confirm a backup copy appears in the Archive folder.
5. Click Set Monthly Backup.
6. Confirm no error appears.
7. Click Add Demo Test Data.
8. Confirm demo accounts and fund appear in Finances.
9. Confirm actions appear in the `Audit Log` sheet.

## Simple User Guide

Members:

1. Open the web app link.
2. Use Dashboard to see balances.
3. Use Finances to see published Money In and Money Out records.
4. Use Reports to generate summaries.
5. Use Members to view the directory.
6. Use My Profile to update details and privacy settings.

## Interface Notes

The app is designed for mobile-first use by non-technical members. The interface uses plain-English labels, large buttons, soft cards, visible working messages, and short forms. Avoid adding dense spreadsheet-like screens or accounting jargon unless the association explicitly needs it.

Finance Officers:

1. Use Finances to add Money In and Money Out.
2. Attach receipts or proof where available.
3. Use Bank Matching to upload CSV/PDF bank statements.
4. Use Bank Matching to enter manual bank lines.
5. Match bank lines to published transactions.
6. Prepare reconciliations.
7. Enter cash counts.

Publishers:

1. Check records entered by Finance Officers.
2. Publish correct finance records.
3. Send back unclear records.
4. Publish and lock reconciliations.
5. Review cash counts.

Membership Administrators:

1. Add members from Members.
2. Review profile update requests.
3. Encourage members to set privacy choices.

System Administrators:

1. Use Administration to manage app users and roles.
2. Use Finances to add accounts and funds/projects.
3. Use Administration to back up data.
4. Keep the raw Google Sheet and Drive folders private.

## Member Import Guide

Administrators can import members from CSV or rows copied from Excel.

Required columns:

```text
Full Name
Email Address
```

Helpful optional columns:

```text
Preferred Name
Phone Number
Birthday Day/Month
City
State
Country
Occupation
Employer or Business
Residential Address
Membership Status
```

Steps:

1. Open Administration.
2. Go to Import Members.
3. Upload CSV or paste rows from Excel.
4. Click Preview Members.
5. Check the preview.
6. Click Import Members.

Imported users receive the `Member` role by default. Duplicate emails are skipped. Members can complete or correct extra profile details later from My Profile.

## Changing Officers

When a Treasurer, Financial Secretary, Publisher, Membership Administrator, or System Administrator changes:

1. Open the app as System Administrator.
2. Go to Administration.
3. Edit the outgoing officer and remove or deactivate their role.
4. Add or edit the incoming officer.
5. Assign the correct role.
6. Save.
7. Confirm the change appears in the `Users` sheet and `Audit Log`.

## Backup Guide

Manual backup:

1. Open the app as System Administrator.
2. Go to Administration.
3. Click Back Up Data Now.
4. Check the Archive folder in Google Drive.

Monthly backup:

1. Open Administration.
2. Click Set Monthly Backup.
3. The app creates a monthly trigger for the first day of each month.

Backups copy the main data spreadsheet into the Archive folder. They do not replace careful Google account ownership and Drive permission management.

## Deployment Guide

When files are updated:

1. Save all files in Apps Script.
2. Run `runStage1Tests()`.
3. Confirm the expected test message appears.
4. Click Deploy.
5. Click Manage deployments.
6. Click the pencil icon.
7. Choose New version.
8. Click Deploy.
9. Open the web app URL and test as Admin, Finance Officer, Publisher, and Member.

Recommended deployment settings:

```text
Execute as: Me
Who has access: Anyone with a Google account
```

Do not share the raw spreadsheet or Drive folders with ordinary members.

## Manual User Management Test

1. Open the app as a System Administrator.
2. Go to Administration.
3. Add or update a user.
4. Assign roles using the checkboxes.
5. Save the user.
6. Confirm the user appears in the Current Users list.
7. Confirm the `Users` sheet was updated.
8. Deactivate a test user.
9. Confirm the user can no longer access the app.

## Stage 2 Notes

- Members cannot directly edit their profile record.
- Members submit update requests for review.
- Members can directly save directory privacy settings.
- The member directory never shows residential address or birth year.
- Birthday is stored as day/month only, for example `14/08`; the year of birth is not collected.
- Birthday day/month is visible on the member's own profile and to authorised administrators through the data sheet.
- Member phone, email, occupation, photo, and location are controlled by simple Yes/No privacy fields.
- Membership Administrators do not automatically receive finance permissions.

## Stage 1 Completion Checklist

- Apps Script project structure is present.
- Data spreadsheet setup is automated.
- Drive folder setup is automated.
- Roles are defined.
- Allow-list access checks are in place.
- Navigation is responsive and role-based.
- Basic tests are included.
- README includes setup, deployment, and testing instructions.

## Stage 2 Completion Checklist

- Members can view their own profile.
- Members can submit profile update requests.
- Members can save directory privacy settings.
- Members can view a limited member directory.
- Membership Administrators can add members.
- Membership Administrators can approve or reject profile update requests.
- Profile and privacy actions are recorded in the audit log.
- README includes Stage 2 testing instructions.

## Stage 3 Completion Checklist

- System Administrator can add accounts.
- System Administrator can add funds and projects.
- System Administrator can add income and expense categories.
- System Administrator can manage users from the Administration screen.
- System Administrator or Membership Administrator can import members in bulk.
- Finance Officer can submit Money In.
- Finance Officer can submit Money Out.
- Finance Officer can optionally upload receipt or proof files.
- Publisher can publish or send back prepared transactions.
- Finance Officer cannot publish their own transaction.
- Members can see published transactions only.
- Dashboard balances update from published transactions.
- Important finance actions appear in the audit log.

## Stage 4 Completion Checklist

- Finance Officer can preview CSV bank statements.
- Finance Officer can map CSV columns.
- Finance Officer can import CSV bank lines.
- Duplicate CSV imports or bank lines show a warning.
- Finance Officer can upload PDF bank statements as evidence.
- Finance Officer can manually enter bank statement lines.
- Recent imports and recent bank lines are visible in Bank Matching.
- Bank statement actions appear in the audit log.

## Stage 5 Completion Checklist

- Finance Officer can view unmatched bank lines.
- Finance Officer can view unmatched published transactions.
- System suggests likely matches.
- Finance Officer can manually match a bank line to a published transaction.
- Finance Officer can mark bank lines as Needs Review.
- Finance Officer can mark bank lines as Internal Transfer.
- Finance Officer can create a ledger transaction from a bank line.
- Finance Officer can prepare a reconciliation.
- Publisher can publish and lock a reconciliation.
- Matching and reconciliation actions appear in the audit log.

## Stage 6 Completion Checklist

- Finance Officer can enter cash counts.
- Cash differences require an explanation.
- Publisher can review cash counts.
- Recent cash counts appear in Finances.
- Members can view report summaries.
- Members can generate simple financial reports.
- Members can generate Income and Expenditure Statement for any selected period.
- Members can generate Statement of Financial Position as at a selected date.
- Report data uses published transactions only.
- Cash-count actions appear in the audit log.

## Stage 7 Completion Checklist

- System Administrator can run a manual backup.
- System Administrator can create the monthly backup trigger.
- System Administrator can seed demo test data.
- User guide is documented.
- Administrator guide is documented.
- Backup guide is documented.
- Deployment guide is documented.
- Final testing checklist is documented.

## Final Testing Checklist

- Member can view dashboard, finances, reports, directory, and own profile.
- Member cannot edit finance records.
- Member cannot see raw Sheet or Drive folders.
- Finance Officer can submit Money In and Money Out.
- Publisher can publish or send back finance records.
- Published records appear to members.
- Bank CSV import works.
- PDF statement upload works.
- Manual bank line entry works.
- Matching works.
- Reconciliation can be locked.
- Cash count works.
- Reports work.
- User management works from Administration.
- Backups work.
- Audit Log records important actions.

The system is ready for association testing once all checklist items pass with real Google accounts.

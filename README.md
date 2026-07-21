# NACO'94 Bank Ledger

Bank-first records. Clear reports.

This is a simple Google Apps Script financial transparency and member database system for the National High School Aba Class of 1994 Alumni Association, NACO'94. The finance workflow is bank-first: officers upload or enter bank statement lines, categorise those lines, and Publishers approve the records before members see them.

The project is intentionally small and Google-based:

- Google Apps Script backend
- Apps Script HTML Service web interface
- Google Sheets as the data store
- Google Drive for bank statements, receipts, invoices, reports, and backups
- Email-code member sign-in and a member email allow-list

## Current Scope: Stage 1 to Stage 8

Stage 1 builds the foundation. Stage 2 adds the member database basics. Stage 3 adds basic finances. Stage 4 adds bank statement handling. Stage 5 adds bank matching and reconciliation. Stage 6 adds cash counts and simple reports. Stage 7 adds backup and operating guidance. Stage 8 adds the unified statement workbench, balance-checked PDF extraction, real Excel import, duplicate quarantine, internal transfers, visible corrections, and stronger reconciliation controls.

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
- Money In entry as a fallback
- Money Out entry as a fallback
- Optional receipt/proof upload
- Transaction marked ready to publish
- Publisher can publish or send back transactions
- Published transaction list for members
- Dashboard balances from published transactions
- User access management from the Administration screen
- System Administrator can add custom Money In and Money Out categories
- Administrators can import members from CSV or pasted Excel rows
- Excel and CSV bank statement preview and import
- Excel/CSV column mapping
- Duplicate quarantine for likely duplicate bank statement lines
- Spreadsheet-style statement review with a classification dropdown and notes on every row
- Compact statement-review text, full-width mobile layout, and visible left/right scrolling controls
- Newest published transactions shown first, with a visible total and automatic focus after publishing
- Clear Finances notice showing officers and administrators which records are waiting for a separate Publisher
- Partial statement submission keeps every unticked row on screen and automatically saves it under Saved Work
- Split one bank amount across two or more classifications during statement review
- Assign each imported statement row, or each portion of a split, to an optional fund or specialized project
- Create a new Money In or Money Out classification without leaving statement review
- Optional PDF, JPG, or PNG evidence on an imported statement row
- Simple manual bank statement entry with optional evidence
- Legacy PDF extraction remains in the backend for existing data and tests, but is not offered in the main volunteer interface
- Bank statement import log
- Suggested bank-line matching
- Manual bank-line to transaction matching
- Mark bank lines as Needs Review
- Prepare both sides of an Internal Transfer without counting it as income or expenditure
- Categorise an unmatched bank line into one or more ledger records
- Reconciliation preparation
- Publisher reconciliation lock
- Cash count entry
- Cash difference explanation
- Cash count review
- Monthly and annual report summaries
- Complete nonprofit financial-statements package for any selected period
- Statement of Financial Activities with income, expenditure, surplus/deficit, and fund/project movements
- Statement of Financial Position in statement-of-affairs format, including disclosed receivables, payables, deferred income, and prepaid expenses
- Statement of Cash Flows with opening-to-closing cash reconciliation
- Specialized Fund / Project Statement with opening balance, receipts, payments, closing balance, and published transaction detail
- Organized numbered notes explaining policies, classifications, balances, project scope, and reporting limitations
- Guided period commentary where a blank answer clearly means nothing additional was reported
- Optional automatic reuse of meaningful bank-row explanations in expandable financial-statement notes, with Finance and Publisher preview before member publication
- Controlled period-end reporting adjustments for income earned but unpaid, expenses incurred but unpaid, income received in advance, and prepaid expenses
- Separate Publisher approval and frozen report-pack snapshots for the member archive
- Copyable meeting/WhatsApp summary
- Print / Save as PDF presentation and CSV export from the Reports screen
- Visible reversal-and-replacement corrections for published records
- CSV report export from the Reports screen
- Manual backup button
- Trigger-safe monthly backup with recorded success/failure and evidence-file checks
- Demo test data helper
- Visible working indicator for slow Google Apps Script actions
- Date entry uses `dd-mm-yyyy` with calendar pickers
- Final user, admin, deployment, and backup guidance

Not included yet:

- Complex accounting package features
- A full double-entry accrual general ledger. Report packs support four controlled period-end adjustments, but the app does not maintain general journals, fixed assets, depreciation, inventory, payroll accruals, or automatic opening/closing accrual reversals.
- Guaranteed extraction from every bank PDF format
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
- `TestStage1.gs` - cumulative Stage 1 through Stage 8 pure-logic tests
- `Index.html` - mobile-friendly HTML Service interface

## Recommended Google Drive Structure

Create this under the official NACO'94 Google account. The `setupStage1()` function can create it automatically.

```text
NACO'94 Bank Ledger
|
|-- NACO'94 Bank Ledger - Data
|   `-- Google Sheet containing system data
|
|-- Bank Statements
  |   |-- Current Year
  |   |-- Next Year
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
NACO'94 Bank Ledger - Data
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
4. In the Apps Script editor, run this from the official owner account:

```javascript
setupStage1()
```

5. Review the permissions prompt and approve it from the official account. The app needs permission to send member sign-in codes from the official account.
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

If Apps Script cannot provide the visitor's email directly, the app asks for the email registered in `Users` and sends a six-digit code to that address. The code expires after 10 minutes; a verified browser remains signed in for up to 30 days. No member needs access to the raw Sheet or Drive folders.
Google's daily email-sending quota still applies. For the first rollout, invite members in manageable groups instead of asking everyone to request a code at the same time.
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
Stage 1 through Stage 8 tests passed: 60
```

These tests cover pure Stage 1 through Stage 8 logic:

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
- Nonprofit financial-position CSV structure
- Cash-flow opening and closing reconciliation structure
- Organized notes in report exports
- Guided period-end adjustment validation and balanced net-asset effects
- Reuse of bank-row explanations without exposing technical workflow text
- User role cleanup
- User access cleanup
- Statement row formatting
- Statement row totals
- PDF statement line parsing
- Spreadsheet-formula protection
- Receipt and proof file signature validation

GitHub also runs the same pure tests plus the email-code sign-in flow, manifest, browser-JavaScript, and private-helper checks on every push and pull request.

## Legacy PDF Statement Extraction Setup

The everyday Bank Statements page uses Excel, CSV, or manual entry. The older PDF extraction code is retained for compatibility and uses Google's Drive OCR through the Apps Script Advanced Drive Service.

In Apps Script:

1. Click **Services** on the left.
2. Click **+ Add a service**.
3. Choose **Drive API**.
4. Click **Add**.
5. Save the project.

PDF extraction is not shown in the primary volunteer interface because bank PDF layouts vary and automatic extraction can be unreliable. Prefer an Excel or CSV download from the bank.

## Required Upgrade For An Existing Installation

Schema 9.0 adds the `Report Packs` tab without deleting or moving existing data.

1. Back up the current spreadsheet before deploying the new code.
2. Save all updated Apps Script files.
3. Deploy a new web-app version.
4. Open the app as a System Administrator.
5. Open **Administration**.
6. Click **Upgrade Data Structure**.
7. Confirm the displayed data version is `9.0`.
8. Click **Verify and Rebuild Balances**.
9. Run `runStage1Tests()` in Apps Script and confirm all 60 tests pass.

Do not use Reports or the report-pack workflow until the data structure upgrade succeeds.

## Manual Stage 1 Test

1. Run `setupStage1()`.
2. Open the generated Google Sheet.
3. Confirm all required tabs exist.
4. Confirm the active setup account appears in `Users`.
5. Add a test member email to `Users` with role `Member` and status `Active`.
6. Deploy the web app.
7. Open the web app as the System Administrator.
8. Confirm Administration is visible.
9. Open the web app as the test member, request a code, and copy the six-digit code from the email.
10. Enter the code and confirm only Dashboard, Finances, Reports, Members, and My Profile are visible.
11. Enter an unlisted email and confirm the app gives the generic response but sends no code.
12. Confirm an unverified visitor cannot see ledger data.

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
2. Go to Bank Statements.
3. Under **Option 1: Upload Excel or CSV**, upload an Excel statement and click **Open Statement**.
4. Confirm the transactions appear in the spreadsheet-style grid.
5. Confirm each selected row has a classification dropdown, **Split amount**, and optional Notes and Evidence fields.
6. Split one test amount across at least two classifications and confirm the displayed remaining amount reaches zero.
7. Use **+ Create new classification** once and confirm the new classification appears without leaving the review.
8. Choose classifications for the remaining selected rows, assign at least one row or split portion to a Fund / Project, attach one test receipt/proof, and click **Send Selected Rows To Publisher**.
9. Leave at least one row unticked. Confirm the sent rows leave the review and the unticked row stays on screen. Refresh Bank Statements, open **Saved Work**, and confirm that row can be resumed without uploading the file again.
10. Go to **Finances** as the officer or System Administrator and confirm the sent records appear under **Waiting for a Publisher**.
11. Sign in with a separate account that has the **Publisher** role, go to **Finances**, and confirm the records appear under **Ready to Publish** with publishing buttons. The person who entered a transaction cannot publish that same transaction.
12. Repeat with a CSV statement. Confirm or adjust the suggested mappings:

```text
Date column
Description column
Money-in column
Money-out column
Balance column
Reference column
```

13. Under **Option 2: Enter One Bank Item**, enter one Money In or Money Out item, choose its classification, and optionally attach evidence.
14. Confirm the submitted items appear for the Publisher and the uploaded evidence is linked to the correct transaction.
15. Confirm matching, reconciliation, duplicates, and history are hidden until **Advanced officer tools and history** is opened.
16. Upload the same file again and confirm duplicates are quarantined and cannot be classified or reconciled.
17. Search for the quarantined line and explicitly choose **Confirm Duplicate** or **Accept Unique**.
18. Save a statement review, refresh the app, and resume it from Saved Work.
19. Manually enter one bank statement line using the separate tools section and choose its classification before saving.
20. Confirm actions appear in the `Audit Log` sheet.

Stage 4 stores bank statement evidence and lines. Stage 5 matches bank lines to ledger transactions.

## Manual Stage 5 Test

1. Make sure at least one bank line exists from Stage 4.
2. Make sure at least one published transaction exists from Stage 3.
3. Open the app as a Finance Officer.
4. Go to Bank Statements.
5. Select an unmatched bank line.
6. Click Suggest Matches.
7. Match the bank line to a published transaction with the same amount.
8. Confirm the match appears under Recent Matches.
9. Mark another bank line as Needs Review.
10. Mark another bank line as Internal Transfer, select the other association account, and confirm two linked transfer records are prepared.
11. Use Categorise Bank Line for a bank line that is not yet in the ledger.
12. For a bulk payment, add split rows and confirm the split total equals the bank amount.
13. Publish the newly created transaction records from the Finances screen.
14. Prepare a reconciliation for the account and period.
15. Open the app as a Publisher.
16. Publish the reconciliation.
17. Confirm the reconciliation status becomes Locked.
18. Confirm actions appear in the `Audit Log` sheet.

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
12. Choose a Start Date and End Date and generate **Complete Financial Statements**.
13. Confirm the package contains a Statement of Financial Activities, Statement of Financial Position, Statement of Cash Flows, and organized numbered notes.
14. Under **Prepare Notes and Period-End Items**, enter a short period highlight, tick **Include bank-row member explanations**, and confirm an existing bank explanation appears automatically in the preview without retyping it. Leave the option unticked if an older note contains internal wording.
15. Enter one test **Income Earned but Not Received** amount. Confirm it increases income and receivables but does not change the Statement of Cash Flows.
16. Save the report pack as a draft, reopen it, and confirm the guided notes and period-end item remain available.
17. Send the pack to the Publisher. Confirm the preparing account cannot publish its own pack.
18. Open the app as a separate Publisher, preview the report, and publish it.
19. Open the app as a Member and confirm the frozen pack appears under **Published Report Archive**.
20. Confirm later live-ledger changes do not silently change the published snapshot.
21. Confirm the Statement of Cash Flows reconciles opening cash to closing cash. Investigate any displayed reconciliation difference.
22. Create or use a Fund / Project, assign published test income and expenditure to it, then generate a **Fund / Project Statement** for the selected period.
23. Confirm the project statement shows opening balance, receipts, payments, surplus/deficit, closing balance, classifications, and transaction detail.
24. Click **Export CSV** and confirm numbered notes and transaction explanations are included.
25. Click **Print / Save as PDF** and confirm only the formatted report is printed.
26. Click **Copy Meeting Summary** and confirm a short plain-English summary can be pasted into a message.
27. Confirm draft, sent-back, and duplicate-quarantined transactions do not appear in any report.
28. Confirm report-pack and cash-count actions appear in the `Audit Log` sheet.

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
2. If asked, enter the registered Google email, click **Email Me a Code**, then enter the six-digit code from the email.
3. Use Dashboard to see balances.
4. Use Finances to see published Money In and Money Out records.
5. Use Reports to generate complete financial statements or a report for a selected project and period.
6. Use Members to view the directory.
7. Use My Profile to update details and privacy settings.
8. On a shared phone or computer, click **Sign Out** when finished.

## Interface Notes

The app is designed for mobile-first use by non-technical members. The interface uses plain-English labels, large buttons, visible working messages, and short forms. The Bank Statements page uses a compact, horizontally scrollable spreadsheet-style review grid because it lets volunteers classify many bank rows without opening many separate cards. Volunteers can swipe the grid or use the visible **Scroll left** and **Scroll right** buttons.

Finance Officers:

1. Use **Option 1: Upload Excel or CSV** for a bank-downloaded spreadsheet.
2. Tick the rows to use and choose the classification beside each selected row.
3. Use **Split amount** when one bank payment belongs to several classifications; every part must add up to the bank amount.
4. Choose **+ Create new classification** when a suitable classification does not exist.
5. Add an optional plain-language member explanation or PDF/JPG/PNG receipt/proof to a row. Avoid private personal details because the explanation may appear in a Publisher-approved report.
6. Use **Option 2: Enter One Bank Item** when no spreadsheet is available.
7. Open **Advanced officer tools and history** only for matching, transfers, duplicates, or reconciliation.
8. Use Finances only for fallback Money In and Money Out entry.
9. Enter cash counts.
10. In Reports, prepare guided period notes, enter only genuine period-end items, and send the report pack to the Publisher.

Long statements can be saved with **Save For Later**. The review remains visible under Saved Work. Completing or discarding it removes the temporary draft file but keeps the original statement evidence.

Publishers:

1. Check records entered by Finance Officers.
2. Publish correct finance records.
3. Send back unclear records.
4. Use Publish Selected for ordinary rows that have all been checked; transfers and corrections must always be reviewed as their linked two-record group.
5. Publish and lock reconciliations.
6. Review cash counts.
7. Preview report packs prepared by another person, publish correct packs, or send them back with a clear reason.

After publishing, the app moves to **Recent Published Transactions** near the top of Finances. This list shows the newest records first. Older published records remain available through Reports.

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
4. Return to Administration after the first scheduled date and verify the displayed last-backup status.

Backups copy the main data spreadsheet into the Archive folder. They also copy each new receipt and bank-statement evidence file once into `Archive > Evidence Files`; evidence already present there is not copied again. Keep the official Google account protected with recovery options and two-step verification, and periodically test that both a spreadsheet backup and several evidence copies can be opened.

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
- Duplicate statement rows are quarantined and excluded from matching and reconciliation.
- Finance Officer can preview and import Excel and CSV bank statements from the primary interface.
- Finance Officer can classify rows and add notes in the spreadsheet-style statement grid.
- Finance Officer can split a bank amount across classifications, with exact-total validation.
- Finance Officer can create a correctly typed classification during statement review.
- Finance Officer can attach optional evidence to an imported row.
- Finance Officer can manually enter and classify a bank statement item with optional evidence.
- Recent imports and recent bank lines are visible in Bank Statements.
- Bank statement actions appear in the audit log.

## Stage 5 Completion Checklist

- Finance Officer can view unmatched bank lines.
- Finance Officer can view unmatched published transactions.
- System suggests likely matches.
- Finance Officer can manually match a bank line to a published transaction.
- Finance Officer can mark bank lines as Needs Review.
- Finance Officer can prepare linked internal-transfer records for two association accounts.
- Finance Officer can categorise one bank line into one or more ledger transactions.
- Finance Officer can prepare a reconciliation.
- Publisher can publish and lock a reconciliation.
- Matching and reconciliation actions appear in the audit log.

## Stage 6 Completion Checklist

- Finance Officer can enter cash counts.
- Cash differences require an explanation.
- Publisher can review cash counts.
- Recent cash counts appear in Finances.
- Members can view report summaries.
- Members can generate complete nonprofit financial statements for any selected period.
- Members can generate a Statement of Financial Activities, Statement of Financial Position, and Statement of Cash Flows.
- Members can generate a specialized Fund / Project Statement for any active project.
- Each financial statement includes organized notes and a clear cash-derived accounting-basis disclosure.
- Members can export CSV or use Print / Save as PDF.
- Finance Officers can prepare guided report notes and controlled period-end items without editing the raw Sheet.
- Publishers can approve a frozen report snapshot prepared by another person.
- Members can open Publisher-approved reports from the Published Report Archive.
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

## Stage 8 Completion Checklist

- Existing installations can append the Stage 8 columns without deleting existing data.
- Legacy PDF parsing remains available in code for compatibility and pure-logic tests.
- Excel, CSV, and manual statement workflows are the supported volunteer interface.
- Duplicate lines are quarantined.
- Classification is available beside each reviewed statement row.
- Internal transfers create linked records and are excluded from receipts and payments.
- Published corrections use a visible reversal and replacement reviewed as one batch.
- Reconciliations cannot lock with a difference or unmatched records.
- Account balances can be rebuilt from opening balances and published records.
- Scheduled backups run without requiring an interactive user session.
- Bank lines support account, status, date, and text search with pagination.
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
- Locking a reconciliation closes that account through the reconciliation end date; later entries must use a date after the locked period or the visible correction workflow.
- Cash count works.
- Complete, individual, cash-flow, and fund/project reports work for selected periods.
- Report notes, CSV export, and Print / Save as PDF work.
- User management works from Administration.
- Backups work.
- Audit Log records important actions.

The system is ready for a controlled association pilot only after all checklist items pass with real Google accounts and the supplied Polaris statement is reviewed against the original PDF. Keep the previous deployment available until the pilot reconciliation agrees exactly with the bank.

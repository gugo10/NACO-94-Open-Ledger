# NACO'94 Simple Statement Ledger

This is a separate, simplified alternative to the main NACO'94 Open Ledger app.

The existing Open Ledger app should remain in place. This app is independent and uses its own Apps Script project, Google Sheet, and Drive folders.

## Main Idea

The bank statement is the source of truth.

Instead of entering transactions first and matching them later, this app works like this:

1. Upload, paste, or manually enter bank statement lines.
2. Classify each bank line.
3. Split lump-sum payments where needed.
4. Generate reports from the classified bank lines.

Because the bank statement is the base record, the app balance stays tied to the bank statement.

## What This App Supports

- CSV or text statement preview.
- Excel support by copying rows from Excel and pasting them into the app.
- Pasted rows from Excel, bank portals, email, WhatsApp, or copied PDF text.
- PDF statement upload for storage and evidence.
- Manual bank line entry when no usable file is available.
- Classification of each bank line.
- Split classification for lump-sum payments.
- `Needs Review` category for unclear payments.
- Member directory and profile privacy.
- Administration for users, members, bank accounts, categories, backups, and demo starter data.
- Simple reports and CSV export.

## Important PDF Note

The app stores PDF statements, but it does not rely on automatic PDF extraction.

Some Nigerian bank PDFs are hard to read automatically, especially if the PDF is a scanned image. For those cases, the user should either:

- copy and paste rows from the PDF if selectable text is available, or
- manually enter the bank lines.

## Files

- `appsscript.json` - Apps Script manifest.
- `Code.gs` - web app entry and bootstrap.
- `Config.gs` - app name, roles, sheets, default categories, navigation.
- `Utilities.gs` - shared helpers.
- `DataSetup.gs` - setup for Drive folders, Sheet tabs, default categories, and first admin user.
- `Access.gs` - Google account access checks.
- `Audit.gs` - audit log.
- `Members.gs` - member profile and directory.
- `Admin.gs` - users, bank accounts, and category management.
- `Statements.gs` - bank statement import, PDF storage, manual lines, and classification.
- `Reports.gs` - dashboard, report, and CSV export logic.
- `Maintenance.gs` - backup and demo starter data.
- `TestStage1.gs` - simple test function.
- `Index.html` - complete frontend.

## Setup In Apps Script

1. Create a new Google Apps Script project.
2. Add the files from this folder to that new project.
3. Save the project.
4. Run:

```javascript
setupSimpleLedger()
```

5. Approve permissions if Google asks.
6. Run:

```javascript
runSimpleLedgerTests()
```

Expected message:

```text
Simple Statement Ledger tests passed: 13
```

7. Deploy as a web app.

Recommended deployment settings:

```text
Execute as: Me
Who has access: Anyone with a Google account
```

## First Use

1. Open the deployed web app.
2. Go to `Administration`.
3. Add at least one bank account.
4. Add members or user access as needed.
5. Go to `Bank Statements`.
6. Paste rows, upload CSV/text, store a PDF, or manually enter bank lines.
7. Classify each bank line.
8. Use `Reports` to view or export summaries.

## Expected Pasted Row Order

For pasted rows and simple CSV files, use this order:

```text
Date, Description, Money In, Money Out, Running Balance, Reference Number
```

Example:

```text
01-07-2026, Chidi Okoro dues payment, 100000, 0, 100000, REF001
```

For a lump-sum payment, classify the bank line and add split rows. The split total must match the bank line amount before the app will save it.

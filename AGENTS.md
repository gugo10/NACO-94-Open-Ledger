# NACO'94 Open Ledger - Agent Context

## Project

NACO'94 Open Ledger is a Google Apps Script web app for the National High School Aba Class of 1994 Alumni Association.

Purpose:

- Financial transparency for members.
- Simple member database and profile updates.
- Bank statement handling, bank matching, reconciliation, cash counts, and simple reports.
- Designed for non-technical alumni members, mostly on Android phones.

Design principles:

- Keep it simple, transparent, easy to use, and easy to maintain.
- Avoid corporate accounting complexity and jargon.
- Use warm, modern, mobile-first UI with plain-English labels.
- Members should use the web app, not the raw Google Sheet or Drive folders.

## User Support Needs

The project owner is not tech savvy and will need extra support.

- Explain actions in plain English and avoid assuming technical background.
- Give concrete step-by-step instructions for Apps Script, Google Sheets, Drive, GitHub, and deployment tasks.
- Say exactly what the owner should click, copy, paste, run, or verify.
- Highlight risks, permissions, and irreversible actions before asking the owner to proceed.
- When reporting code changes, include the practical effect for ordinary users, not only file names or technical details.

## Technology

- Google Apps Script backend.
- Apps Script HTML Service frontend.
- Google Sheets data store.
- Google Drive for receipts, bank statements, reports, and backups.
- No React, Next.js, Docker, external paid database, or paid hosting.

## GitHub

Public repository:

```text
https://github.com/gugo10/NACO-94-Open-Ledger
```

Current branch:

```text
main
```

Initial published commit:

```text
2861447 Build NACO Open Ledger Apps Script app
```

On this machine, `git` and `gh` may not be on PATH inside Codex. Use full paths if needed:

```powershell
& "C:\Program Files\Git\cmd\git.exe" status -sb
& "C:\Program Files\GitHub CLI\gh.exe" auth status
```

## Apps Script Files

Core files:

- `Code.gs` - web app entry points and bootstrap.
- `Config.gs` - app config, roles, navigation, sheet definitions.
- `Utilities.gs` - common helpers, date formatting, row helpers.
- `DataSetup.gs` - initial Sheet and Drive setup.
- `Access.gs` - Google account allow-list and role checks.
- `Audit.gs` - audit logging.
- `Members.gs` - member profiles, privacy, update requests.
- `Admin.gs` - user management and bulk member import.
- `Finance.gs` - accounts, funds, categories, transactions, publishing.
- `BankStatements.gs` - CSV/PDF/manual bank statement handling.
- `Matching.gs` - bank matching and reconciliation.
- `CashReports.gs` - cash counts and financial reports.
- `Maintenance.gs` - backups and demo data.
- `TestStage1.gs` - cumulative test function.
- `Index.html` - complete frontend.
- `appsscript.json` - Apps Script manifest.
- `README.md` - setup, usage, deployment, and testing guide.

## Roles

Current role model:

- `Member`
- `Finance Officer`
- `Publisher`
- `Membership Administrator`
- `System Administrator`

`Reviewer` remains in code as a compatibility alias for earlier test rows, but new UI should use `Publisher`.

Finance workflow:

1. Finance Officer enters Money In / Money Out.
2. Publisher checks and publishes.
3. Members see published records only.
4. Corrections should be visible, not silent deletion.

## Current Features

Implemented through Stage 8 plus later enhancements:

- Setup for Drive folders and Sheet tabs.
- Role-based access.
- Member profile and privacy controls.
- Member directory.
- Bulk member import from CSV or pasted Excel rows.
- User management from Administration UI.
- Accounts, funds/projects, custom categories.
- Money In / Money Out.
- Receipt/proof upload.
- Publisher workflow.
- CSV bank statement preview/import.
- PDF bank statement upload.
- Manual bank statement lines.
- Bank matching and suggestions.
- Reconciliation preparation and locking.
- Cash counts.
- Reports:
  - Monthly/annual/transaction summaries.
  - Income and Expenditure Statement for selected period.
  - Statement of Financial Position as at selected date.
- Manual backup and monthly backup trigger.
- Demo data helper.

## Date Rules

Normal app dates use:

```text
dd-mm-yyyy
```

Date fields in UI include a manual input and a calendar picker.

Birthday uses day/month only:

```text
dd/mm
```

Do not request or display birth year for ordinary member birthday use.

## Deployment

In Apps Script:

1. Save files.
2. Run `runStage1Tests()`.
3. Expected current message:

```text
Stage 1 through Stage 8 tests passed: 52
```

4. Deploy > Manage deployments > Edit > New version > Deploy.

Recommended web app settings:

```text
Execute as: Me
Who has access: Anyone with a Google account
```

Do not deploy as "user accessing the web app" because ordinary members should not need raw Sheet or Drive access.

## Important Permissions

`appsscript.json` includes:

```text
https://www.googleapis.com/auth/script.scriptapp
https://www.googleapis.com/auth/script.send_mail
```

The first scope is needed for monthly backup trigger creation. The second sends short-lived member sign-in codes to allow-listed email addresses.

## Maintenance Notes

- Keep `.clasp.json` out of git; `.gitignore` excludes it.
- Raw data Sheet and Drive folders should stay private.
- Ordinary members should access data only through the web app.
- Before association handover, either create a fresh project under the official Gmail or clear test rows from data tabs.
- Use `Administration > Back Up Data Now` before major changes.

## Verification Constraints

Local environment cannot fully run Apps Script server code. Static checks done locally:

- JSON parse for `appsscript.json`.
- Basic text scans.

Functional tests must be run in Apps Script with:

```javascript
runStage1Tests()
```

Then perform manual role testing with real Google accounts.

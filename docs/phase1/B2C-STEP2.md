# B2C Phase 1, step 2: store and record permissions

## What runs where

| Rule | Report mode (default; TEST will run this for 7 days) | Enforce mode (`CRM_ACCESS_MODE=enforce`) |
|---|---|---|
| **Deleting a whole store**: administrator account only, after a copy to `<dataDir>/backups/store-delete/` | **Enforced** (day 1) | Enforced |
| **Wipe guard on save**: refused if the save empties the store while removing 2 or more records, or removes more than max(5, 10%), unless an administrator account confirms the count (`X-CRM-Confirm-Bulk: n`, with n ≥ the number removed) | **Enforced** (day 1) | Enforced |
| **Page load-failure guard**: a store whose read failed is never saved from that tab until a read succeeds; a notice says so | **Enforced** (day 1) | Enforced |
| **Scoped reads** | Served as before; a "would-scope" count is recorded (at most once per 10 minutes per person and store) | Only the person's records; "Restricted record" placeholders for clients and leads behind visible records |
| **Record-by-record writes**: no editing or creating outside your scope, no moving a record out of scope without reassign, records you could not see are kept, placeholders never saved | Saved as before; "would-deny" recorded | 403 when refused; otherwise merged |
| **Team record**: protected fields; private fields (PAN, PF, ESIC, bank, salary) hidden from others and kept on save | Recorded | Enforced |
| **Settings and reference data**: everyone reads; writing needs the store's capability | Recorded | Enforced |
| **Logs**: only grow (`auditLog` and `settingsAudit` strictly; capped logs may drop their oldest lines) | Recorded | Enforced |
| **Module action rights** (create, edit or delete on the module) | Recorded as **advisory** only | Recorded as advisory only, see below |

## Decision taken during this step

- **Empty-save rule refined (your choice, 2026-11-17).** The approved rule ("a list that becomes empty is refused unless an administrator confirms") would have refused ordinary actions that remove a last single record: converting the only lead, or deleting the only SLA or automation rule. An RM cannot confirm. You chose: **refuse emptying only when it removes 2 or more records**, and keep the max(5, 10%) limit. Removing the last single record works as today.

## Legitimate bulk removals in the page, now confirmed with a count

In each case below, the count is what the tab had loaded. A store that failed to load therefore confirms nothing.

| Removal | Where |
|---|---|
| System reset (admin) | H:~55740 (each store) and its team save |
| Backup restore (admin) | `confirmRestoreBackup` |
| Recycle bin: emptying (admin) and automatic purge | `emptyRecycleBin`, `autoPurgeExpiredRecords`. If the server refuses, nothing is marked purged and no "purged" audit line is written. |
| Warm-call meetings migration | `migrateWarmCallsOutOfMeetings` |

## Two points for your review

1. **Module action rights are recorded, not enforced.** The rights in question are create, edit and delete on the module (`can(module, …)`). Scope rules are enforced in enforce mode. The server already computes these rights and records any mismatch as `advisory`. They are not refused, because many record edits are side effects of other screens: stage moves, notes, automations. The 7-day report should show whether enforcing them would block real work. Enforcing them is a one-line change once the report is reviewed.
2. **HR stores** (attendance, leave, comp-off, regularisations) **are rule-checked in unit tests, but not seeded over HTTP in these suites.** Attendance and leave already have server rules of their own, which refuse synthetic rows. The read rule is: own records, records where you are the approver (`approverId`), HR staff and admin, and the manager chain for appraisals, incentives and the daily trackers.

## Evidence

The tests are listed under "Tests" in the Step 2 report. The parity suite compares the page's own scope functions, in a real browser, with the server's read rule, record by record, for 8 roles. Neither narrowing nor widening is allowed.

## Changes to existing test suites (approved 2026-11-17)

Five existing suites failed against the day-1 wipe guard. In each case the cause was the suite's own setup code: it wipes stores straight from the page to set up a scenario, for example `DB.leads = []; save('leads')`, or replacing a 408-member team with 3. The page itself never clears these stores; its real bulk removals already confirm. With your approval, each deliberate wipe in those suites now uses the page's own confirmation (`ssetBulkConfirm[key] = <records the tab had loaded>`), as the system reset does. Nothing else changed in these suites: 14 lines added, no assertion changed or removed, and the guard is not loosened.

| Suite | Setup line confirmed |
|---|---|
| `api-connectors` | `DB.leads = []` before the inbound-mapping test |
| `dbt-hierarchy` | its seed clearing the lead's business entries and allocations |
| `hierarchy-pdf` | replacing the 408-member team with a 3-person loop |
| `import-back` | clearing leads, clients and tasks before a combined import |
| `multi-dbt` | its seed clearing the client's entries, allocations and transactions |

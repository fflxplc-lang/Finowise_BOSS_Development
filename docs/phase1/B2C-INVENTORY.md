# B2C Phase 1, step 0: inventory and baseline

**Branch:** `claude/b2c-phase1-security`, created locally from `b4380fa`. At creation, `origin/main` and `origin/deploy` were both confirmed at `b4380fa` via `git ls-remote`.

**How it was produced:** read-only scans of `server.js` and `public/index.html`. No application code was changed in this step.

**Companion files:**
- `B2C-ROUTES.md`: 63 routes with their middleware.
- `B2C-STORE-WRITERS.md`: every page-side store write, with its enclosing function and permission calls.

---

## 1. Regression baseline

See §7. In short: 162 of 162 suites, 1,427 checks passed, 3 known pre-existing failures, 0 timeouts.

---

## 2. Routes (summary of `B2C-ROUTES.md`)

**63 routes:**

| Middleware | Count |
|---|---|
| `checkApiKey` only | 33 |
| `checkApiKey` + `requireApiAdmin` | 5 |
| `requireAdmin` (HTML user pages) | 3 |
| None (login, public token routes, share, health, events/changes, `/config.js`, the catch-all) | 22 |

Every `/api/*` route except health, `/sw.js`, client-link and static requests sits behind the global sign-in gate (S:1061–1074). One route, `POST /api/reminders/run` (S:4723), exists only when `CRM_REMINDERS=manual` (tests).

**Routes Phase 1 changes** are exactly those listed in `PHASE1-SCOPE-B2C.md` §2.

**Routes Phase 1 does not change, but which step 1 gives an explicit policy entry:**
- `/api/outlook/meeting` S:1761
- `/api/me/2fa*` S:1835–1862
- `/api/lookup/*` S:1894/1903
- `/api/market/*` S:2107/2349/2387
- `/api/ai/status` S:3014
- `/api/ai/hello` S:3027
- `/api/approvals` S:3829
- push S:4730–4743
- `/api/reminders/log` S:4752
- `/api/attendance/today` S:4760
- the public token routes S:3630–3985

These are entered as "signed-in, no record data", or "token-scoped", or "admin". **A CI test will fail on any route without an entry.**

**Already correct, no change:** live-sync events (`/api/events` S:3054, `/api/changes` S:3081) carry `{v, keys, origin, at}` only (S:198–206), never values.

---

## 3. Store classification: all 73 loaded stores

Class codes:
- **R:** record-scoped.
- **M:** member- or HR-scoped.
- **T:** team.
- **S:** shared settings or reference data.
- **L:** append-only log.
- **X:** system or import.

The read rule is the **server mirror of what the page shows today**. Where the page uses two rules for one store, the server uses their **union**, so no screen loses rows it shows today (for example `platformHoldings`).

Rows marked "confirmed in step 2" have a link field that is checked against the record-creation code before the rule is enforced. The coverage check passed: all 73 stores loaded by the page are in this table, and nothing extra.

| # | Store | Class | Read rule (server mirror of the page) | Write rule | Evidence |
|---|---|---|---|---|---|
| 1 | `leads` | R | owner `assignedTo`; branch `branch` | LMS add/edit/delete on in-scope records | RECORD_DOORS.LMS H:35593; EXPORT_SOURCES H:69497 |
| 2 | `clients` | R | owner `rmName`; branch `branch` | CMS add/edit/delete on in-scope records; existing client-form guard S:1183 kept | RECORD_DOORS.CMS H:35595; EXPORT_SOURCES H:69498 |
| 3 | `reviews` | R | owner `assignTo`, else the client's `rmName`; branch `branch`, else the client's | RMS rights, in scope | RECORD_DOORS.RMS H:35597 |
| 4 | `tasks` | R | owner first of `assignTo`,`createdBy`, else client/lead owner (`listOwnerOf` H:49227); plus people on the task (`dstVisible` H:45320) | DST rights, in scope; existing tasks guard kept | TASK_OWNER_FIELDS H:49265; RECORD_DOORS.DST H:35600 |
| 5 | `queries` | R | `queryOwnerFor` H:31172 (`assignTo`, else client `rmName`); branch from client | Queries rights, in scope | RECORD_DOORS.Queries H:35602 |
| 6 | `queryReplies` | R | visible when its `queryId` query is visible | Queries rights | creation H:31456 |
| 7 | `recommendations` | R | first of `createdBy`,`assignTo`, else client/lead owner | Recommendations rights; approval needs `approveAllocations` flag | ALLOC_OWNER_FIELDS H:49267 |
| 8 | `meetings` | R | first of `assignTo`,`createdBy`, else client/lead owner | Meetings rights | MEETING_OWNER_FIELDS H:49264 |
| 9 | `moms` | R | visible when its `clientId` client is visible | CMS edit on that client | creation H:44288 |
| 10 | `callEntries` | R | owner `loggedBy` (then `createdBy`); branch `callBranchOf` | Calls rights | CALL_OWNER_FIELDS H:49262; EXPORT H:69504 |
| 11 | `businessEntries` | R | `bizOwnerOf` (client `rmName`, lead `assignedTo`, else `createdBy`) | Business rights | H:49271; EXPORT H:69505 |
| 12 | `transactions` | R | first of `rmName`,`createdBy`, else client owner | Transactions rights | TXN_OWNER_FIELDS H:49266 |
| 13 | `platformHoldings` | R | **union** of the page's two uses: linked client visible (dashboard `mdBookRows`) or `importedBy` = in scope (export H:69507) | import permission (Transactions); never shrink without admin | EXPORT H:69507; mdBookRows |
| 14 | `platformSips` | R | same union as platformHoldings | as platformHoldings | EXPORT H:69508 |
| 15 | `insPolicies` | R | visible when its linked client is visible (link field confirmed in step 2) | CMS edit on that client | creation H:29558 |
| 16 | `clientDocuments` | R | visible when `clientId` client is visible | CMS edit | creation H:44366 |
| 17 | `clientGoals` | R | visible when `clientId` client is visible | CMS edit | creation H:44201 |
| 18 | `clientFeedback` | R | visible when `clientId` client is visible | CMS edit | creation H:44339 |
| 19 | `communications` | R | owner `by` (export H:69516) or linked client visible | CMS rights | EXPORT H:69516; creation H:44085 |
| 20 | `docLinks` | R | visible when the linked record (client/lead/review) is visible | edit on the linked record | creation H:27269 |
| 21 | `docSubmissions` | R | visible when the linked record is visible | edit on the linked record; public-link writes are server-side and unaffected | creation H:26516 |
| 22 | `approvals` | R | visible to requester and to approvers; linked record visible | server route S:3829 is the main writer (unchanged) | H:28622; S:3829 |
| 23 | `complianceItems` | R | linked client visible (link field confirmed in step 2) | CMS edit | writer list |
| 24 | `aumMonthly` | R | linked client/owner visible (shape confirmed in step 2) | Transactions rights | writer list |
| 25 | `projects` | R | owner `owner`; branch `branch` | Projects rights | RECORD_DOORS.Projects H:35604 |
| 26 | `projectClients` | R | visible when both project and client are visible | Projects edit | creation H:55047 |
| 27 | `projectTasks` | R | visible when its project is visible | Projects edit | creation H:55074 |
| 28 | `partners` | R | owner `createdBy`; branch `branch` | Partners rights | EXPORT H:69509 |
| 29 | `campaigns` | R | owner `createdBy`; branch `branch` | Campaigns rights | EXPORT H:69510 |
| 30 | `campaignRecipients` | R | visible when its campaign is visible | Campaigns edit | creation H:53434 |
| 31 | `reviewEdits` | R | visible when its review is visible (shape confirmed in step 2) | RMS edit | loaded, written by key |
| 32 | `reviewReports` | R | visible when its review is visible (shape confirmed in step 2) | RMS edit | loaded; `reviewFile.*` keys |
| 33 | `hrAttendance` | M | own records; HR/admin all | existing server guard kept + own only | server guard S:1432 area |
| 34 | `hrLeave` | M | own; approvers (manager chain) and HR/admin | existing server guard kept | server guard |
| 35 | `hrCompOff` | M | own; HR/admin | existing server guard kept | server guard |
| 36 | `hrRegularizations` | M | own; manager chain and HR/admin | own; approver for decisions | writer list |
| 37 | `hrAppraisals` | M | own; manager chain and HR/admin | HR/manager | creation H:86922 |
| 38 | `hrIncentives` | M | own; HR/admin | HR/admin | creation H:85769 |
| 39 | `notifications` | M | addressed to me | own (mark read); creation by any signed-in user for others is kept (it is how the page notifies) | creation H:36988 |
| 40 | `workActivities` | M | own; manager chain; admin | own | creation H:50649 |
| 41 | `djtEntries` | M | own; manager chain; admin | own | creation H:51199 |
| 42 | `accessRequests` | M | own; approvers with `managePermissions`/admin | own create; decision by approvers | creation H:37284 |
| 43 | `supportQueries` | M | own (`by`); admin all | own | creation H:42848 |
| 44 | `team` | T | all members' public fields; `TEAM_PRIVATE` (bank, PAN, salary, documents) to self, HR, admin | `TEAM_PROTECTED` (role, scope, branch, perms, pagePerms, adminFlags, hrAccess, parentUserId, active) admin only; self edits own contact fields | 41 writers (appendix B) |
| 45 | `config` | S | all signed-in | admin; members with an admin flag may change only the keys that flag governs (key map built in step 2) | 116 writers (appendix B) |
| 46 | `settings` | S | all signed-in | admin (plus flag-key map as config) | 12 writers |
| 47 | `hrConfig` | S | all signed-in | admin or HR admin | writer list |
| 48 | `slaRules` | S | all signed-in | admin / `manageWorkflows` | writer list |
| 49 | `sops` | S | all signed-in | admin | writer list |
| 50 | `automationRules` | S | all signed-in | admin / `manageWorkflows` | writer list |
| 51 | `webhooks` | S | admin | admin | writer list |
| 52 | `integrationConnectors` | S | all signed-in (no secrets held) | admin | loaded |
| 53 | `apiConnectors` | S | all signed-in (definitions only; secrets live in connections.json) | admin / `manageModuleSettings` | writer list |
| 54 | `campaignTemplates` | S | all signed-in | Campaigns edit | writer list |
| 55 | `hrSourceMaps` | S | all signed-in | HR admin | writer list |
| 56 | `multiProductSchemes` | S | all signed-in | Masters edit | writer list |
| 57 | `amcs` | S | all signed-in | Masters add/edit (page rule mirrored) | EXPORT H:69522 |
| 58 | `schemes` | S | all signed-in | Masters add/edit | EXPORT H:69523 |
| 59 | `commissionRates` | S | all signed-in | Masters add/edit | EXPORT H:69524 |
| 60 | `auditLog` | L | admin; others only entries whose `by` is in scope and who hold Team view (mirrors export H:69527) | append only | EXPORT H:69527 |
| 61 | `settingsAudit` | L | admin | append only | writer list |
| 62 | `errorLog` | L | admin; own entries | append only | writer list |
| 63 | `apiReqLog` | L | admin / `manageModuleSettings` | append only | writer list |
| 64 | `automationExecutionLog` | L | admin / `manageWorkflows` | append only | writer list |
| 65 | `exportHistory` | L | admin; own entries | append only | writer list |
| 66 | `importHistory` | L | admin; import permission | append only | writer list |
| 67 | `backupHistory` | L | admin | append only | writer list |
| 68 | `systemState` | X | all signed-in (migration flags) | admin; non-admin refused quietly (background) | writer list |
| 69 | `importBatches` | X | owner `by` (export H:69517); admin | import permission; never shrink | EXPORT H:69517 |
| 70 | `importUndo` | X | importer; admin | import permission | writer list |
| 71 | `apiInbox` | X | admin / `manageModuleSettings` | server-side writer; page writes admin / flag | writer list |
| 72 | `apiSyncRuns` | X | admin / `manageModuleSettings` | admin / flag | writer list |
| 73 | `assetUploads` | X | all signed-in (upload index) | upload permission; dynamic `ma*` keys follow it | loaded |

**Not stores:** `darkModePref` and `txnViewPref` are written with `shared === false` (browser-local) and never reach the server.

**Dynamic keys:** `maRows.*`, `maFile.*` and `reviewFile.*` (H:55643–55647) follow their parent store (`assetUploads` / `reviewReports`) for reads and writes. DELETE on them is admin-only (the reset flow).

---

## 4. Background writes (page load and timers)

The boot sequence (H:35815–35870) runs about 50 `migrate*`, `align*` and `heal*` routines **in every user's browser, without an admin check**. 43 distinct routines write stores:

| Target class | Routines | Stores |
|---|---|---|
| S (settings) | 31 | config, settings, slaRules, amcs, schemes, commissionRates |
| T (team) | 7 | team |
| L (logs) | 4 | settingsAudit |
| R (records) | 32 | clients, leads, tasks, meetings, transactions, recommendations, businessEntries, callEntries, docLinks, insPolicies, projects |
| M | 1 | workActivities |

Most are one-time: they check a flag and do nothing once done.

**Step 2 handling (no silent widening):**
- A refused **background** save (S, T, L or X class from a non-admin) is answered with 403. The page is changed to treat a 403 on a background save as "not mine to do", logging it quietly. **Today a non-403 failure is already only logged** (`sset` H:~3010), so boot behaviour does not change.
- The routine runs and persists when an admin next loads the page.
- Record-class migrations by a non-admin touch only records in that user's scope, through `mergeWrite`.

**One boot routine deletes a store:** `migrateAwayFromLevelsAndIncentives` calls `sdel` (H:34637). Under admin-only DELETE, a non-admin's call gets 403 and the legacy key stays until an admin loads the page.

---

## 5. Callers of the day-1 items, mail and Aadhaar

| Route | Page callers (function, line, gate in function body) |
|---|---|
| `/api/connections` | • `loadConnections` H:58087 (read at boot, no gate)<br>• `putConnection` H:58120 (no gate in body)<br>• `guideTestConnector` H:61645, `forgetConnector` H:61803, `testConnector` H:61831 (`canAdmin('manageModuleSettings')`)<br>• `confirmSystemReset` H:55676 (`isAdmin()`)<br>• `loadMailChannel` H:78941 (read) |
| `/api/apiconnectors` | `apiCall` H:71849, `apiLoadSecretState` H:72120, `apiPutSecret` H:72561, `apiTestRun` H:72642, `renderSettingsImportBack` H:71665. The screens are gated by `apiMayManage()` = `canAdmin('manageModuleSettings')` H:71810; scheduled syncs by the same (H:72101). |
| `DELETE /api/storage` | `confirmSystemReset` H:55643–55652 (`isAdmin()`); `migrateAwayFromLevelsAndIncentives` H:34637 (boot, see §4) |
| `/api/mail/send` | `runDripJourneys` H:53421 (boot, no gate); `confirmSendCampaign` H:54390 (`can('Campaigns','edit')`); `deliverMail` H:79315; `submitComposeMail` H:79878 |
| `/api/aadhaar` | `cmsAadhaarToggle` H:44663, `cmsAadhaarStore` H:44685 (CMS form); `aadhaarAccessLoad` H:75485 and `aadhaarAccessSet` H:75538 (Setup; server is admin-only for set) |

**Effect of the approved decisions, for the record:**
- **Connector configuration and testing are admin-only (D8).** Today, members who hold `manageModuleSettings` without being account admins can also test and remove connectors (H:61645–61831), so they lose that. Account admins are unaffected.
- **Connector use (D9)** stays with `manageModuleSettings`, as today.
- **Store DELETE:** no non-admin user action calls it. The only non-admin caller is the boot routine in §4.

---

## 6. PAN readers (page)

`seAnnexRouteList` H:4178, `cmsNomineeFields` H:5399, `cifContent` H:8222, `rmsInternalSectionHtml` H:12107, `seLoad` H:15993, `insParsePolicyText` H:29304, `viewLeadDetail` H:41152, `viewCMS` H:42909, `cpOverview` H:43367, `cpPortfolio` H:43410, `projectChecklistCard` H:54871, `renderAddClients` / `acHitsHtml` / `acRenderHits` H:54968–55009 (client search by PAN), `bossClientAlerts` H:59283 and `sheetPersonFacts` H:63381 (assistant), `renderReportBody` H:63286/63321 (reports), **`impClientIndex` / `impMatchClient` / `impAnalyse` H:68386–68517 (platform import matches clients by PAN)**, `impBodyHtml` H:69074, and `teamMemberFieldGroups` H:74478 (team PAN, `mask:1`, admin).

**Finding for step 3:**
- Platform import matching by PAN runs in the importer's browser. Under "full PAN for admins only" (decision 1), a non-admin importer would see masked PANs and could no longer match. The approved server-side `pan-match` endpoint is therefore built to take a **batch** of PANs from an import file and return matching in-scope client ids, never PANs. Imports keep working without revealing PAN.
- This stays within the approved "server-side PAN match" item. It is recorded here as a clarification, not a scope change.

---

## 7. Regression baseline (this branch, before any change)

Run: `tests/parallel.sh` with 8 workers, on `claude/b2c-phase1-security` at `b4380fa` (no changes), 2026-11-16.

| Measure | Result |
|---|---|
| Suites run | **162 of 162** |
| Checks passed (`ok`) | **1,427** |
| Checks failed | **3**, one in each of 3 suites (the runner's "failed : 6" counts each FAIL line twice: once in the suite report and once in its problem list) |
| Timed out / skipped | 0 / 0 |
| `node --check server.js` | OK |

**Known pre-existing failures.** These are the same three as recorded before Phase 1, all unrelated to security:
1. `hr-section`: "Full Day, Half Day and Comp Off — and a half day counts as half": the request did not keep its unit (`{"days":0}`).
2. `b2c-28`: "a second leave request over the same dates is refused, here and by the server": the page refused for a different reason (the dates fall on a weekly off). The server refusal itself works (422).
3. `insurance-workflow`: "the policy PDF itself, uploaded on the box, is read and fills the form": the PDF text was not read in this environment.

**The rule for every later step:** no suite may newly fail, and the passed count may only fall if a test is replaced by a stricter one. That would be reported, never silent.

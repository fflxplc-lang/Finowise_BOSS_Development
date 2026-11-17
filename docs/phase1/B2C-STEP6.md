# B2C Phase 1, step 6: final verification and TEST rollout runbook

> **STATUS: B2C PHASE 1 SIGN-OFF COMPLETE** (step 6b, §9–§11).
>
> - Four independent review rounds were run. Every Critical and High finding is fixed, each with a test that failed first. The Medium findings are fixed, except module action rights (report-first by approved design) and the low items, both moved to the Phase 2 backlog (§11) with the owner's agreement.
> - **Not yet approved:**
>   - deploying to TEST (owner's separate approval, then the authorised session);
>   - switching on enforce mode (after the seven report-only days, §4).

This is the hand-over for the **authorised session** (`session_01HoKKaWGR1evYyNexhomFLD`), the only thread that may move `main` or `deploy`. **Deploying to TEST needs the owner's separate approval.** Production stays on hold.

## 0. Invariants (every server, every step, no exceptions)

- **Never change, add, rotate or remove `CRM_SESSION_SECRET` or `CRM_AADHAAR_KEY` on an existing server.**
  - The Aadhaar vault key comes from `CRM_AADHAAR_KEY` when set, otherwise from `CRM_SESSION_SECRET`. Changing either, or adding `CRM_AADHAAR_KEY` where it was absent, locks every stored Aadhaar number for good.
  - The generated-password key is also derived from `CRM_SESSION_SECRET`.
  - Phase 1 reads both and writes neither.
- Never commit `data.json`, `users.db`, `connections.json`, `aadhaar-vault.json`, `audit/` or any secret.
- No native dependencies (`npm ci --omit=dev` runs on the VPS at every deploy). Phase 1 adds none.
- The deploy script stays on the server; Phase 1 does not change it.

## 1. What is enforced from day 1, and what reports first

**Day 1** means it enforces in every mode, from the first deploy. **Report → enforce** means it records a would-deny for seven days, then enforces only with `CRM_ACCESS_MODE=enforce`.

| Step | Rule | Day 1 | Report → enforce |
|---|---|---|---|
| 1 | Server-side principal (admin from `users.db`; member from the server's team copy); `me()` with no `team[0]` fallback; 401 handling | ✔ (identity only) | |
| 1 | Reconciliation (`GET /api/access/reconcile`) and audit reader (`GET /api/audit`), administrator account only | ✔ | |
| 2 | Store and record permissions (read scope, write scope, team and settings rules, append-only logs, stubs) | | ✔ |
| 2 | Store `DELETE`: administrator account only, snapshot first | ✔ | |
| 2 | Shrink guard: emptying a store (2+ records) or removing more than max(5, 10%) needs the administrator account's counted confirmation | ✔ | |
| 2 | Browser load-failure guard (a store that failed to load is never saved back) | ✔ | |
| 3 | PAN masking for everyone but the administrator account; masked PAN on save means "unchanged" | | ✔ (masking) / ✔ day 1 (restore) |
| 3 | `POST /api/clients/pan-match` (ids only, never a PAN) | ✔ | |
| 3 | Aadhaar store/replace/remove/view by scope and CMS rights | | ✔ |
| 3 | Generated passwords sealed at rest (AES-256-GCM) | ✔ | |
| 4 | Connector save, test and delete: administrator account only; secrets never echoed; a masked placeholder keeps the secret; privacy attestation resets on a new endpoint | ✔ | |
| 4 | Outbound guard: no private, loopback, link-local or metadata addresses; https only; exact host; pinned DNS; no redirects. `bossai` alone may use its saved private host | ✔ | |
| 4 | API connector secret only to the hosts approved when it was saved | ✔ | |
| 4 | Connector use gate (*Manage module settings*); trimmed connector list for non-admins | | ✔ |
| 4 | Mail recipient scope, Campaigns permission for campaign/drip, compose caps (20 recipients, `CRM_MAIL_HOURLY_CAP` 100/hour) | | ✔ |
| 4 | AI assistant permission, `CRM_AI_HOURLY_CAP` 60/hour; server-only endpoint, key and privacy; records-are-data rule | ✔ (config, rule) | ✔ (permission, cap) |
| 5 | Server sessions: 30-minute idle (real input only), 25-minute warning, 12-hour limit, revocation; one re-login after deploy | ✔ | |
| 5 | Re-login in place keeping unsaved work; constant-time token compare; safe errors | ✔ | |
| 5 | Audit coverage: writes, PAN changes, team access changes, accounts, sessions, exports | ✔ | |
| 6 | `users.db`: replaced bytes zeroed (`secure_delete`), write-ahead log truncated and file compacted at start-up, so no plain-text remnant of an old password survives | ✔ | |

The kill switch needs both `CRM_SCOPED_STORAGE=off` and `CRM_ALLOW_UNSCOPED=yes-i-understand`. It turns off the report → enforce scoping only. Day-1 rules stay on.

## 2. TEST deployment checklist (authorised session, after approval)

**Before**
1. The owner approves the TEST deploy of `claude/b2c-phase1-security` at the reviewed SHA.
2. On the server, record today's state (read-only, counts only):
   ```bash
   cd /home/finowise-test/app && runuser -u finowise-test -- bash -c 'set -a; . /home/finowise-test/app.env; set +a; node scripts/phase1-census.js --days 1' > /home/finowise-test/census-before.txt
   ```
   Run this after the deploy too, since the script is on the branch. Before the deploy, run it from a checkout of the branch pointed at the same data with `--data /home/finowise-test/data/data.json`.
3. Confirm `/home/finowise-test/app.env` has **no** `CRM_ACCESS_MODE` (so report is the default), and that `CRM_SESSION_SECRET` and `CRM_AADHAAR_KEY` are exactly as they were. Do not edit them.
4. Announce the four behaviour changes (step 5 doc):
   - one re-login after the deploy;
   - a password prompt after 30 idle minutes;
   - a daily re-login;
   - browser-only HR reminders appear after re-login.

**Deploy** (the only push allowed, by the authorised session)
5. Bring the branch into `main` as the owning thread decides, then `git push origin origin/main:refs/heads/deploy`. The VPS timer backs up `/home/finowise-test/data` (the whole folder, including `users.db`, `audit/`, `connections.json` and the vault) into `backups/` before installing.
6. `cat /home/finowise-test/deploy-status.txt` should read `LIVE <sha>`. `ROLLED BACK` means the new code failed to start, and the old code is serving.

**Smoke checks (first hour)**
7. Sign in as the administrator, an RM and a manager. Each signs in once more, which is expected.
8. As an RM, open Setup → Connections. Saving, testing or deleting a connector is refused. As the administrator it works.
9. Bulk-delete protection: an RM's "delete store" is refused, and the administrator's "Delete all imported data" asks for DELETE and clears the data for good.
10. Leave a tab untouched for 25 minutes: the "Stay signed in" bar appears. At 30 minutes the password is asked for over the screen.
11. Run `node scripts/phase1-census.js --days 1` and keep the output:
    - the reconcile counts should match `/api/access/reconcile`;
    - `panMaskedInStore` must be 0;
    - `issuedPasswordPlainText` must be 0.

## 3. Seven days of report-only

Every day, as the administrator:

| What | How |
|---|---|
| Daily counts (no personal data) | On the server: `node scripts/phase1-census.js --days 1` (as above). It gives the would-deny count by action and reason, the refusals, the sessions and the reconcile counts. |
| Account vs team mismatches | Browser, signed in as the administrator: `/api/access/reconcile`. Counts plus team ids; fix each in Team Members. |
| The detail behind a count | `/api/audit?limit=500`, the newest first. Who, which store or route, the reason, and ids, never values. |

Classify every would-deny reason in a short daily note:
- **(a) correct**: enforcement should refuse it;
- **(b) a real workflow the rule gets wrong**: fix it on the feature branch, re-test, and redeploy with approval;
- **(c) a data problem**: an account not linked, an RM name not on the team, a client without an RM. Fix the data.

## 4. Criteria to switch on `CRM_ACCESS_MODE=enforce` (owner approval required)

All of these must be true:
1. **Reconcile is clean.** All five counts are 0, or each remaining one is explained in writing. The census's `rmNotOnTeam` and `withoutRm` are 0, or understood.
2. **No unexplained would-deny.** Every reason seen over the seven days is classified, and none is (b) unfixed. The last two days show no new reason.
3. **Nothing broke.** No 5xx in the log attributable to Phase 1, no rollback in `deploy-status.txt`, and no user report of a missing record that the census cannot explain.
4. **Tested.** The fixes from (b) are on the branch with the full regression and all `sec-*` suites green, in both modes.
5. **People are ready.** A named human tester has walked an RM, a manager and the administrator through their daily work on TEST.
6. **The owner approves.**

**How to switch:** add `CRM_ACCESS_MODE=enforce` to `/home/finowise-test/app.env` (touch nothing else), then run `systemctl restart finowise-test`. The log's first lines read `[access] mode: enforce`. Watch the census and audit for refusals for the next 24 hours.

## 5. Instant rollback (in increasing order of weight)

| Level | Do | Effect | Tested |
|---|---|---|---|
| 1. Back to report | Remove `CRM_ACCESS_MODE` from `app.env` and restart | Scoping, masking, mail, AI and use gate go back to recording only. Day-1 rules and sessions stay. | `sec-report-mode` |
| 2. Kill switch | Add **both** `CRM_SCOPED_STORAGE=off` and `CRM_ALLOW_UNSCOPED=yes-i-understand`, then restart | Reads and writes unscoped, even in enforce mode. Day-1 administrator-only rules stay. The log warns at start-up. One setting alone does nothing. | `sec-report-mode` |
| 3. Previous code | The authorised session points `deploy` back at `b4380fa` (or the last good SHA). For data, restore the matching folder from `/home/finowise-test/backups/` only if needed. | Old code ignores the `sessions` table and `audit/`; everyone signs in once more. A pending generated password shows as sealed text until an administrator issues a new one. Real passwords are unaffected, and the data is unchanged. | Drill below |

**Rollback drill** (synthetic data, one data folder):
- **This branch:** 50 clients, an RM with a typed password, an RM with a generated (sealed) password, and an API connector with approved hosts.
- **Rolled back to `b4380fa`:** admin, RM and generated-password sign-ins all work; reads work; the new-format cookie gets 401; the data is identical.
- **Rolled forward:** the old HMAC cookie gets 401 (one re-login), sign-in works, and the data is identical.

## 6. Operational recommendations for the open items

1. **Audit retention and rotation.**
   - Keep 24 months of monthly files (`audit/YYYY-MM.jsonl`), as proposed in Q-C8 and still awaiting the owner's decision.
   - Volume is roughly 15,000 lines (4–5 MB) a day for 50 people, most of it the HR heartbeat's save (`hrAttendance`, every two minutes per punched-in person).
   - Recommended, on the server and outside the repo:
     - a monthly cron that gzips files older than three months (about 10:1);
     - deletion after 24 months;
     - the folder included in the existing backups.
   - For Phase 2: collapse the heartbeat's save lines into one line per person per hour. That cuts most of the volume without losing anything a reviewer needs.
2. **`/api/share/:id` needs a signed-in session as well as the token.** That is the baseline behaviour, kept. An external mirror cannot pull unattended.
   - Recommended: keep it until a real external consumer exists.
   - If one does, open only `GET /api/share/:id` to token-only callers, with the constant-time token check (already in place), a per-connector rate limit, an optional caller IP allowlist, and the export audit line (already in place).
3. **Save cost at 50,000 clients.** See §7: about 0.2–0.5 s extra per save of the whole client store. It is negligible at today's 1,478.
4. **Exports are page-reported.** A true record needs server-side export (Phase 2).
5. **Rate limits and attempt counters** are per process, in memory. That is fine for the single TEST process.

## 7. Verification results (step 6)

- **Security suites:** all suites run in both modes, using the standard runner (report) and with `CRM_ACCESS_MODE=enforce` for the runner's server. Each suite also starts enforce-mode servers of its own where it needs them.
- **Log and at-rest scan** (`sec-log-scan`). After connector secrets, an SMTP password, an assistant request carrying its own key, sessions and passwords have all been through the server, seven places are searched for seven kinds of value:
  - places: the server log, audit files, error answers, `data.json`, `users.db` with its WAL, `connections.json` and the Aadhaar vault;
  - values: account passwords, session cookies, connector secrets, a key sent in a request body, Aadhaar digits, PANs and phone numbers;
  - result: each value is found only where it belongs. PANs and phones are only in `data.json`, secrets only in `connections.json` (0600), and passwords and cookies nowhere.
  - This found, and step 6 fixed, plain-text remnants of old generated passwords left in `users.db`'s free space and WAL after sealing.
- **Parity** (page rules vs server rules, record by record, 8 roles):
  - 1,478 clients: 60,736 decisions, 0 narrowing, 0 widening;
  - 10,000 clients: 86,448 decisions (sampled), 0 and 0;
  - 50,000 clients: 86,448 decisions (sampled), 0 and 0.
  - The per-role visible counts are identical to step 2's.
- **Cost** (`tests/perf-phase1.js`): milliseconds, median of 5, through HTTP, the same machine and the same synthetic data.

| Clients | Mode | Admin read | RM read | Admin save | RM save |
|---|---|---|---|---|---|
| 1,478 | baseline | 4 | 4 | 17 | 16 |
| 1,478 | report | 6 | 6 | 21 | 23 |
| 1,478 | enforce | 5 | 7 | 20 | 34 |
| 10,000 | baseline | 28 | 28 | 107 | 101 |
| 10,000 | report | 25 | 21 | 142 | 139 |
| 10,000 | enforce | 20 | 23 | 123 | 179 |
| 50,000 | baseline | 110 | 103 | 599 | 604 |
| 50,000 | report | 105 | 117 | 955 | 1,089 |
| 50,000 | enforce | 101 | 160 | 805 | 959 |

- **Full regression, report mode (the default):** 185 suites (the baseline's 162 plus 23 `sec-*`).
  - All 23 `sec-*` suites are clean, 195 passing checks.
  - The non-security suites have the baseline's 1,427 passing checks. `backup-restore` lost 5 checks in the full run while two 50,000-client jobs ran beside it ("Failed to fetch"), and it is clean on its own (10/10).
  - The suites with problems are the baseline's own: `hr-section`, `annual-leave`, `insurance-workflow` (date and PDF), and `notif-dst`, `plan-form-basics-carry`, `profile-details`, `fsl-workflow` (console noise identical at the baseline).
  - `b2c-28` failed at the baseline and passes now.
- **Full regression, enforce mode** (`CRM_ACCESS_MODE=enforce` for every runner server):
  - Every non-security suite behaves as in report mode. The same baseline problems recur; `multi-dbt` (a known flake) and `workbook-formats` (a load flake, clean on its own) are extra.
  - 11 `sec-*` suites fail exactly their report-mode steps, which by definition need a report-mode server: aadhaar, ai-assistant, connectors, email, load-failure, pan, report-mode, self-promotion, store-delete, store-read, store-write-scope.
  - Each of those suites covers enforce mode with servers of its own, and those steps pass.
- **Independent review:** §8.
- **Still with the owner:**
  - review and run the census script on TEST;
  - name the human tester;
  - approve the TEST deploy;
  - after seven days, approve enforcement.

## 8. Independent review (step 6): findings

A fresh reviewer agent was given only the diff (`b4380fa..fc0aaf4`) and the acceptance criteria, not this thread's documents. It wrote its own attack scripts and ran them against servers of its own on synthetic data. Its scripts are kept outside the repository.

**Confirmed. Reproduced again by this thread** on an enforce-mode server with synthetic data:

| # | Severity | Finding | Where |
|---|---|---|---|
| 1 | **Critical** | An RM saves the team store with a second copy of their own record, `role: Admin` and `scope: all`, placed first. The team check keys records by id (the last copy wins, and it is unchanged), so the save is accepted. The server's member lookup takes the first copy. Result: 6 → 30 clients visible, and writes to other RMs' clients. | `access-control.js` `teamViolations` / `mergeWrite` (T); `server.js` `memberOfUser` |
| 2 | **Critical** | An RM saves a `docLinks` row whose `clientId` is their own client and whose `recordId` is another RM's client. The link store checks `clientId` only. `GET /api/public/bundle?token=…` then serves that client in full, unauthenticated: full PAN, email, family. `POST /api/public/patch` can change it. The same works for leads, and even an own-client link serves the full PAN. | `access-control.js` `linkedVisible`; `server.js` `publicScope` |
| 3 | **High** | A new client carrying `recordId: <another RM's client>` and the masked form of that client's PAN gets the full PAN filled in by the masked-PAN restore, which looks up `recordId` without a scope check. 422 versus 200 also confirms the last four. | `server.js` masked-PAN restore (`linkedTo`) |
| 6 | **Medium (day-1 rule)** | The outbound guard allows `https://[::ffff:169.254.169.254]/` and `https://[::ffff:127.0.0.1]/`. The URL parser turns them into hex form (`::ffff:a9fe:a9fe`), which `classify` does not recognise. `[::127.0.0.1]`, NAT64 `64:ff9b::/96` and `fec0::/10` are reported too. It needs an administrator to save such an address. | `outbound-guard.js` `classify` |

**Reported by the reviewer, not yet reproduced here:**

| # | Severity | Finding |
|---|---|---|
| 4 | Medium | PAN masking misses a PAN inside free text or used as an object key; settings-type stores are not masked. |
| 5 | Medium | `replyTo` is not cleaned, so a CRLF in it can add a second `From:` / `Bcc:` header. |
| 7 | Medium | The sign-in attempt limit is per IP and is reset by any successful sign-in from that IP. That is the baseline behaviour, but it means one's own account resets the counter. |
| 8 | Medium | Setting a team record Inactive or deleted without the account sync leaves the session and the record's permissions in force. |
| 9 | Low | The compose caps apply only when the request says `X-CRM-Mail: compose`; a request can claim another kind. |
| 10 | Low | A settings writer can add a role list in which the default role is Admin, making members with an empty role team Admin. |
| 11 | Low | The shrink guard counts ids, so placeholder (`_stub`) rows for every record pass it. In report mode a non-admin's placeholders are saved as records. |
| 12 | Info | The `DYNAMIC` pattern names `maRows.`/`maFile.` but the page uses `assetRows.`/`assetFile.`, so non-admins get 403 on multi-asset rows in enforce mode (fails closed). Storage keys `__proto__`, `constructor` and `hasOwnProperty` are accepted. |
| — | Suspected | SMTP connect is not behind the outbound guard; old `integrationConnectors`/`webhooks` rows are readable settings; `apiconnectors/:id/call` lets the caller choose headers, which could echo the secret off an approved host. |

**What held:**
- store scope by id, reassignment, id collisions, placeholders not saved in enforce mode;
- sessions (background calls do not extend, the absolute limit, logout reuse, revocation, old cookie);
- day-1 delete, shrink and connector rules in report mode;
- Aadhaar scope; the AI permission and rate limit; the mail recipient scope;
- logs, audit and error answers free of seeded secrets.

**Proposed fix step (for approval).** It is not started; the owner decides.
1. **Team store.** Refuse duplicate ids in every list store (for every principal), and make the member lookup refuse an ambiguous team.
2. **Links.** Every id a link row names (`clientId`, `recordId`, `leadId`, …) must be in the writer's scope. The public bundle and patch serve and accept only what the link's own client covers, with PANs masked.
3. **Masked-PAN restore.** Restore only from records the writer may read.
4. **Outbound guard.** Normalise every IPv6 form (mapped, compatible, NAT64, site-local) before classifying, with tests for each.
5. **The medium findings:**
   - #5: strip CR/LF from mail headers;
   - #8: an Inactive or deleted member gets no access;
   - #4: mask PANs inside text;
   - #9: apply the caps whatever the request claims;
   - #10: the role list cannot make Admin the default;
   - #11: placeholders are never saved, and never counted as kept;
   - #12: fix the `DYNAMIC` names and refuse reserved keys.
6. **Attempt limit (#7).** Count failures per account as well as per IP.
7. **Tests.** Add each reproduction to the `sec-*` suites first, so they fail now and pass after, then rerun everything and send the diff back to a fresh reviewer.

## 9. Step 6b: remediation of §8

Approved by the owner. Every finding was first written as a failing test in `tests/suites/sec-review-fixes.js`:
- §8 items: 16 steps, all failing at `87ce5c0`;
- the second review's items: 9 more steps, all failing at `0a8b267`.

Then each was fixed. All 25 pass at the final commit.

| # | Finding | Fix | Applies | Verified by (`sec-review-fixes`) |
|---|---|---|---|---|
| 1 | Duplicate team record shadows the principal | A save may not add a duplicate id to any list, nor a second team record bound to one email. A team holding two records with one id gives that account no member. | every mode, everyone | `#1 …` (both steps) |
| 2 | Link naming another RM's record, served unauthenticated | Every reference a record names must be in the writer's scope. A CMS link whose record is not its own client, or a review of another client, serves and accepts nothing. PANs go out masked on client links and are restored on the way back. | references: enforce; link use and masking: every mode | `#2 …` (3 steps), `R2-N1`, `R2-N1/N5` |
| 3 | Cross-scope masked-PAN restore, last-four oracle | Restore only from records the writer may read: a client or lead in scope; a team record only if its private fields are open to the writer. One identical refusal for right and wrong last four. | every mode | `#3`, `R2-N2` |
| 4 | PANs in free text, keys, settings | Masked in text (base64 and data left alone), in object keys and in settings stores; restored on save | enforce (masking) | `#4` |
| 5 | Reply-To CRLF injection | Reply-To must be one valid address | every mode | `#5` |
| 6 | IPv6 and IPv4 spellings past the outbound guard | IPv6 parsed to its 8 groups. Mapped, compatible, translated, NAT64, 6to4, Teredo, documentation, site-local and metadata are classified by what they reach. Azure WireServer is refused. | day 1 | `#6`, `R2 Azure` |
| 7 | Attempt limit reset by own sign-in | Counted per address+account (8), per account (20) and per address (30, never reset by a success). A success clears only its own account. | every mode | `#7` |
| 8 | Inactive team record keeps access | Any status other than Active, or deleted, ends sessions and refuses sign-in. The administrator account is exempt and cannot be locked out by a team edit. | every mode | `#8`, `R2 #8` |
| 9 | Caps by claimed kind; addresses in free text | Recipient cap for every kind except campaign/drip (Campaigns permission); the hourly cap counts template sends. Only email fields vouch for an address, and colleagues' emails are protected (N3). | enforce | `#9`, `R2-N3` |
| 10 | Role list makes Admin the default | The default role is never Admin, on the server and on the page. Only the administrator account changes the role list. | default role: every mode; role list: enforce | `#10` |
| 11 | Placeholders bypass the shrink guard | A placeholder always stands for the stored record and is never stored | every mode, everyone | `#11` |
| 12 | Upload-row keys; reserved store names | `assetRows.*`/`assetFile.*` follow CMS access, PANs masked. Reserved names (`__proto__`, `constructor`, …) refused. Lookups use own properties only. | rows: enforce; names: every mode | `#12` |
| N1 | Links, leads, reviews and transactions pointed at another RM's client by other fields | The reference check covers every record store and every joining field (create, or when a reference changes) | enforce | `R2-N1` |
| N2 | A colleague's team PAN pulled into a visible field; team unmasked on links | Team restore sources are limited as in #3; the link page masks the team | every mode | `R2-N2` |
| N3 | An RM edits a colleague's team record | A colleague's name, email and phones need Team edit or Manage Users. Fields hidden from the writer are not counted. | enforce | `R2-N3` |
| N4 | Email fallback lets an unlinked account become a linked member | The fallback applies only to a single record that no other account is linked to | every mode | `R2-N4` |
| N5 | A client link appends rows for any lead or client | Appended rows must hang off the link's own records; a submission only for its own token; owner and joining fields are never changed through a link. Present at the baseline. | every mode | `R2-N1/N5` |
| N6 | A Manage Permissions delegate grants admin-making flags | Granting Manage Permissions or Manage Users needs the administrator account | enforce | `R2-N6` |
| R3-C1 | A link appends a lead claiming another client as its conversion, then a link follows it | A lead's convertedToClientId is believed only when the client says it came from that lead. Link-added rows may not name records outside the link. On writes, a lead reference also reaches the client it became. | every mode (use), enforce (writes) | `R3-C1` |
| R3-H1/L1 | A masked PAN restored where masking never looks; PANs beside `=`/`#`/`_` unmasked | One matching rule for masking and restoring (not touching a letter or digit; data: and base64 excluded); keys with text covered | enforce | `R3-H1/L1` |
| R3-M1 | A link naming another RM's converted, removed lead | A lead id is checked against the client converted from it | enforce | `R3-M1` |
| R3-M2/M3 | A link re-points itself; link appends for other members, clients, queries | Token, allocation and joining fields are kept on link updates. Appended rows may name only the link's records and its owner. | every mode | `R3-M2/M3` |
| R3-M4 | The email match makes an account a team Admin; new members skip capability checks | No email match to an Admin-role or firm-wide record. New members: only rights the creator holds; HR access needs HR admin; managers within the creator's team. | every mode / enforce | `R3-M4` |
| R3-L2/L3 | JSON-escaped secret echo; anyone writes the upload index | JSON-escaped forms redacted; the upload index is written only by those who may upload | day 1 / enforce | `R3-L3` |
| R4-C1 | A value that is not JSON, or of the wrong shape, skipped every check and overwrote the store | Not JSON: 400. Anything but a list where a list is stored, or anything but an object where an object is stored: 422. Both refused before any other check. | day 1, everyone | `R4-C1` |
| R4-H1 | PAN match used to brute-force the full PAN from the masked last four | Not for the administrator account: at most 8 candidates sharing a last four per request, 20 per hour, 30 requests per ten minutes | every mode | `R4-H1` |
| R4-H2 | A link token equal to a record id makes that record the link's own | The token is never a record id in a link's scope. A new token must be 8–128 letters, digits, `-` or `_`, and not the id of a record. | every mode | `R4-H2` |
| R4-M2 | A colleague's viewFullPan and HR identity fields changed without rights | viewFullPan is a protected field (Manage Permissions). Employee id, designation, joining date, official mobile, Aadhaar last four and account email need Team edit, Manage Users or HR admin. | enforce | `R4-M2` |
| R4-M4 | Upload rows emptied by any CMS editor | Upload rows may be replaced by a new upload, but emptying them is guarded like any store (the index already was) | day 1 | `R4-M4` |
| — | SMTP to link-local or metadata | The SMTP host is resolved, classified and pinned; private relays still allowed | day 1 | `(suspected) the mail connector…` |
| — | API secret echoed by an approved host | Cut out of the response before it is trimmed, in raw, URL-encoded and Basic forms | day 1 | review |
| — | Legacy `webhooks` / `integrationConnectors` readable by everyone | Read only by those who may change them | enforce | `R2 legacy…` |

Test-harness changes in step 6b:
- `sec-principal` now expects upload rows to be replaceable but not emptiable (the R4-M4 change).
- A failing iseq-landing case taught two things, both fixed:
  - rows created in one link request may name each other;
  - the ISEQ riding on an input sheet answers under its own token.
- A security suite's report-mode steps use a report-mode server of its own when the whole run is in enforce mode, so both modes run clean.
- One `sec-store-write-scope` step no longer sends a duplicate id: the forged record replaces the placeholder it was shown. It still expects 403 `edit_outside_scope`.

## 10. Independent review rounds and the final verification

| Round | Reviewed | Given | Result | Outcome |
|---|---|---|---|---|
| 1 | `fc0aaf4` | Diff and spec only | 2 Critical, 1 High, 8 Medium/Low, plus suspected items | All fixed in `0a8b267` |
| 2 | `0a8b267` | Diff, spec and the list of earlier holes | #2 still open, #3 and #9 partial; N1–N6 (3 High) | Fixed in `49a46e3` |
| 3 | `49a46e3` | Diff, spec and areas previously broken | C1, H1, M1–M4, L1–L3 | Fixed in `0d47c72` |
| 4 | `0d47c72` | Diff and spec only, no hints | C1, H1, H2, M1–M4, L1–L5 | C1, H1, H2, M2 and M4 fixed in the final commit; M1–M3 and the low items moved to §11 (owner's decision, 2026-11-17) |

Each round's reproductions were added to `sec-review-fixes` before the fix. There are 36 steps in all, each red before its fix and green at the final commit. The owner chose to end the review loop after round 4, with this verification:

- **Syntax:** 202 JavaScript files pass `node --check`; the page's inline script compiles; `git diff --check` is clean.
- **Security suites:** all 24 `sec-*` suites are clean in report mode and in enforce mode, 231 passing checks each.
- **Affected functional suites:** 44 suites clean, among them `api-connectors`, `multi-asset`, `public-forms`, `iseq-landing`, `levels` and every client-link, PAN-match and import suite.
- **Full regression at `0d47c72`:** 186 suites in report mode and in enforce mode. The only failures are the baseline's own (`hr-section`, `annual-leave` and `insurance-workflow`, which are date and PDF dependent, plus identical console noise). The one other enforce-mode failure was `sec-principal` meeting the round-4 upload-row change mid-run; it was updated and is clean.
- **Parity at `0d47c72`:** 1,478 / 10,000 / 50,000 clients, zero narrowing and zero widening, per-role counts identical to step 2.

## 11. Phase 2 / post-report-window backlog

These were found and confirmed, and are deliberately not fixed in Phase 1:

| From | Item | Why it waits | Recommended |
|---|---|---|---|
| R4-M1 | Staff can approve their own HR rows (incentive amount and status, appraisal rating, leave status) | Module action rights, report-first by approved design; present at the baseline | Approver and status fields per HR store: only the named approver or HR admin may set them |
| R4-M3 | CMS (and other module) view, create and delete rights are recorded as advisory, not enforced on storage | Same: the approved split enforces record scope first, module rights after the report window | Turn the advisory lines into refusals per module once the seven-day census shows no legitimate hits |
| R4-M2 (rest) | Other non-identity fields on a colleague's team record (preferences, signature, incentive category) can be changed by people without Team rights | Several page features legitimately do this (HR incentive grid, signatures, department rename); needs a field-by-field owner list | One owner (role or capability) per team field |
| R4-M4 (rest) | Upload rows (`assetRows.*`) are visible to every CMS viewer and are not scoped per client | The rows carry no stored client link; the page matches them at runtime | Store the matched client id on each row at upload, then scope like `platformHoldings` |
| R4-L1 | An account linked to no team member can still read the team list and settings, and append to the audit log | Report-first; the reconcile count shows such accounts and they should be 0 before enforcing | Refuse everything but `/config.js` and sign-out to unlinked non-admin accounts in enforce mode |
| R4-L2 | Log stores (`auditLog`, `settingsAudit`) accept entries naming another person | The server's own audit trail (`audit/`) is the authoritative record | Stamp the writer on every appended log entry server-side |
| R4-L3 | The mail recipient rule can be widened by writing an address into one's own lead or client | Inherent to "records you can see"; the address is audited (domain) | Keep; review in the seven-day census |
| R4-L4 | PAN masking misses unusual spellings (spaces or dashes inside, full-width characters, zero-width spaces, a PAN fused to other letters) | Normal PANs and the usual separators are masked | Normalise text (NFKC, strip zero-width characters) before matching |
| R4-L5 | `systemState` writable by everyone; `aadhaarLast4` not in the private team fields; the SMTP host is guarded but private relays are allowed | Boot migrations write `systemState` from every browser; the rest is low value | Add `aadhaarLast4` to the private fields; move migrations server-side |
| R3/R4 Info | An RM can tell whether a hidden record id exists (403 versus 200 on reuse) | Low value | Accept |
| Step 4/5 | Outgoing webhooks are sent from the browser; exports are page-reported; the save audit costs about 130 ms at 50,000 clients; audit volume and retention | Operational (§6) | As §6 |

## 12. Sign-off

**B2C Phase 1 Sign-Off Complete.**

The branch `claude/b2c-phase1-security` at the final step 6b commit meets the step 6 exit criteria, with the round-4 boundary set by the owner:
- full regression with no new failures against `b4380fa`;
- every security suite clean in both modes;
- parity at 1,478, 10,000 and 50,000 clients;
- four independent reviews, every Critical and High finding fixed and covered by a test;
- the count-only census script;
- a documented and drilled rollback.

What remains is the owner's:
1. approve the TEST deploy, which the authorised session then performs (day-1 rules enforce at once; the rest reports for seven days);
2. run the census daily on TEST;
3. name the human tester;
4. after the seven days, approve `CRM_ACCESS_MODE=enforce` (§4).

Production stays on hold. `CRM_SESSION_SECRET` and `CRM_AADHAAR_KEY` were never changed.

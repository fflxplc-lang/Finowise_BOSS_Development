# B2C Phase 1, step 6: final verification and TEST rollout runbook

> **STATUS: SIGN-OFF WITHHELD.** The independent review in step 6 found two Critical defects that bypass enforce mode and a gap in a day-1 rule (§8). Four were reproduced by this thread. **Do not deploy to TEST and do not switch on enforce mode** until they are fixed and re-verified with the owner's approval. The checklist below is ready for when they are.

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

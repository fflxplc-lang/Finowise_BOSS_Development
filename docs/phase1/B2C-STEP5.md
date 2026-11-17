# B2C Phase 1, step 5: sessions, audit coverage, safe errors

## What runs where

Per the approved scope (step table: "sessions: enforce"), everything in this step applies in **every mode**. Nothing here is report-only. `CRM_ACCESS_MODE` does not change it.

| Rule | Report mode (default) | Enforce mode |
|---|---|---|
| **Server sessions** (`sessions.js`). The cookie is an opaque random id (32 bytes). `users.db` keeps one row per session, keyed by the id's SHA-256, so the table cannot be used to sign in. | Enforced | Enforced |
| **One forced re-login after deploy.** A cookie in the old `<user>.<expiry>.<hmac>` form matches no row. | Enforced | Enforced |
| **Idle timeout: 30 minutes**, counting only real activity. The page sends `POST /api/session/activity` at most once a minute, after trusted keyboard, mouse or touch input in that window. The HR heartbeat, saves, live sync (`/api/events`, `/api/changes`), drips, scheduled syncs and the status check `GET /api/session` never extend a session. There is no unattended exemption. | Enforced | Enforced |
| **Warning at 25 minutes.** A bar reads "You will be signed out in m:ss" with **Stay signed in**. Before warning, the page asks the server, because another window may have kept the session going. | Active | Active |
| **Unsaved work kept across re-login.** When a session has ended, the page asks for the password over the screen instead of navigating away, so open forms keep what was typed. Any request that was refused (401) waits and is sent again once the person is back. The email is fixed to the tab's account, and another account goes through the sign-in page ("Sign in as someone else"). Two-step codes and the attempt limit apply as on the sign-in page. | Active | Active |
| **Absolute limit: 12 hours** from sign-in, however busy. A notice shows 5 minutes before the limit. | Enforced | Enforced |
| **Revocation.** A session ends on sign-out (that session; the same cookie used again is refused). It also ends on a password reset, a change of sign-in role or CRM role, email or team link, deactivation, account removal, or an administrator's "sign out everywhere" (`POST /api/users/:memberId/sessions/revoke`). Each row carries a fingerprint of the account fields at sign-in, so a change made with `scripts/user.js` on the server also ends the session at the next request. A session found ended is closed for good: undoing the change does not revive it. A 2FA switch or the sign-in stamp does not end a session. | Enforced | Enforced |
| **Constant-time comparison.** Connector share tokens, the API key and the editor-connector key are compared through SHA-256 and `timingSafeEqual`, so neither the length nor the content shows in timing. A wrong token of any length gets the same answer. | Active | Active |
| **Safe errors.** Bad JSON returns 400, an oversized body 413, a malformed request 400, all with a plain message. An unexpected error returns 500 with a reference, and the stack goes only to the server log, without the request body. Express's default (stack traces whenever `NODE_ENV` is not `production`) can no longer reach a caller. | Active | Active |
| **Audit coverage.** See the next section. | Active | Active |

## Audit coverage after step 5

| Event | Line | Since |
|---|---|---|
| Refusals and would-be refusals | `store.write`, `store.delete`, `store.shrink`, `store.read`, `aadhaar.*`, `connector.*`, `mail.send`, `ai.chat` | Steps 1–4 |
| **Every save that changes something** | `store.write` with outcome `ok`, `+added ~changed -removed`, up to 50 ids. A save that changes nothing writes nothing. The line is written just after the answer is sent. | Step 5 |
| **PAN change** | `pan.change`: record ids and field `pan`, never a PAN | Step 5 |
| **Team access change** | `team.permissions`: member id and field names (role, perms, adminFlags, scope, status, parentUserId, branch, department, viewFullPan, teamAccess), never values | Step 5 |
| **Account change** | `account.change`: password reset, role, deactivation, removal, with the number of sessions ended | Step 5 |
| **Sessions** | `session.start`, `session.signin` (failures: wrong password, unknown account, deactivated, wrong or locked code, too many attempts; a typed address that matches no account is not recorded), `session.end` (idle, expired, account changed or removed), `session.signout`, `session.revoke` | Step 5 |
| **Exports** | `export.share` (a connector share, ok or bad token) and `import.share` (bad token); `export` with outcome `reported` for a file saved from the page. The page reports these because the browser builds the file: only the file type and the screen, never the file name or contents. | Step 5 |

`GET /api/audit` remains administrator-account only (tested: RM and team-role Admin get 403).

## Settings (all optional; no secret)

| Variable | Default | Effect |
|---|---|---|
| `CRM_IDLE_MINUTES` | 30 | Idle limit. The warning comes 5 minutes before it. Under 10 minutes it comes at the same 25/30 proportion. |
| `CRM_SESSION_MAX_HOURS` | 12 | Absolute limit from sign-in |

**`CRM_SESSION_SECRET` and `CRM_AADHAAR_KEY` were not added, removed, changed or rotated.** `CRM_SESSION_SECRET` still keys the two-step codes, and both the vault and the generated-password key derive from it as before. Sessions no longer depend on it, so a restart no longer signs anyone out even where the secret is unset.

## Code that was not changed

- **HR active-time tracking** is byte for byte the baseline's. `sec-hr-activity` compares `hrActivityCfg`, `hrActCfg`, `hrActNote`, `hrActBeat`, `hrSessionTimes`, `hrDayTimes`, `hrOpenSession`, `hrPunchIn`, `hrPunchOut` and the input lines with `b4380fa`. It still records active and idle spans, and its beats and saves leave the session's last-seen time where it was.
- **Public client links** (token routes) do not use sessions and are unaffected.

## Tests

| Suite | Steps |
|---|---|
| `sec-sessions` | 13. With an injected clock: idle at 30:00 and not at 29:59; activity extends; warning 5 minutes before; 12-hour limit while pinging every 30 s; at most one write a minute; every account change ends the session, a 2FA switch does not; hashes only in the table; a closed session stays closed. Through the server with short limits: 51 background requests (saves, heartbeat save, live sync, status) did not prevent the idle end; activity pings did, until the absolute limit; sign-out reuse refused while the other window carries on; password reset, role change, deactivation and sign out everywhere; a `scripts/user.js` change; old, forged and garbage cookies refused; re-login in place (wrong password, other account, success); the attempt limit; audit content; no password or cookie in the audit or log. |
| `sec-session-page` | 4, in a real browser with an 18 s idle limit: the warning bar appears and Stay signed in restores the time; the re-login dialog keeps an open form's text and re-sends a save made meanwhile; a wrong password is refused in place; mouse movement keeps the session past the limit; no page errors. |
| `sec-hr-activity` | 3: HR code identical to baseline; active and idle recorded; heartbeat does not extend, mouse does. |
| `sec-audit` | 7: write counts and ids (and none for a no-op save); PAN change without PANs; team access fields without values; share export with constant-time token refusal; errors without stack traces; admin-only reader; a page download reported by type and screen, the file name not recorded, junk input cleaned. |

### One change to a Step 1 test

`sec-negative-misc` expected a tab whose session ended to navigate to the sign-in page. Under step 5 (unsaved work kept across re-login) the tab asks for the password over the screen instead. The step now checks four things:

- the dialog appears;
- the URL does not change;
- the refused read stays unanswered, so nothing is served while signed out;
- "Sign in as someone else" still leads to `/login`.

It still asserts that nothing is served without a session.

## Behaviour changes to announce before TEST

1. Everyone signs in once more after the deploy.
2. After 30 minutes without input, the password is asked for again. Two-step accounts are asked for a code too. What is on screen is kept.
3. Everyone signs in at least once a day (12-hour limit).
4. HR reminders shown only in the browser appear after re-login, if the session ended first (readiness §2).

## Findings

1. **Connector share (`/api/share/:id`) sits behind the sign-in gate**, as at the baseline: a caller without a session never reaches the token check. An external mirror therefore cannot use it unattended. Step 5 did not change that; opening it to token-only callers would be a separate decision.
2. **Cost of the save audit.** Comparing every record by its JSON takes about 130 ms per save of a 50,000-record store (232 ms when the stored copy is not cached), and a few ms at today's ~1,500 clients. It runs just after the response, so saves are not delayed, but it uses the same process.
3. **Audit volume.** Each changing save writes one line, including the HR heartbeat's save every two minutes per punched-in person. That is roughly 15,000 lines (about 4–5 MB) a day for 50 people. Retention (proposed 24 months, Q-C8) is still to be decided.
4. **Exports are page-reported.** The browser can build a file without telling the server, so the `export` lines are what the page says. A modified browser could skip them. A true record would need server-side export.
5. **Rate-limit and attempt counters are per process and in memory**, as before.

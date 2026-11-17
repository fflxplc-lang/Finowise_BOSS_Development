# B2C Phase 1, step 1: server-side identity and authorisation (report mode)

**Mode:** report. Nothing in this step refuses a request that was allowed before. Every rule added here either records a "would deny" entry in the server's audit trail, or is a read-only administrator route.

## What was added

| Piece | What it does |
|---|---|
| `access-control.js` (new) | Defines four things:<br>• **`principal(user)`:** admin comes only from the `users.db` account. The team member is the server's copy, matched by id then email. There is no `team[0]` fallback.<br>• **`can()`, `canAdmin()`, `inScope()`:** the page's `can()`, admin flags and `visibleRecords()`, worked out on the server.<br>• **`teamViolations()`:** the rule for team records. Nobody changes protected fields on their own record. On somebody else's record the page's own capability is needed. The Admin role and scope `all` need an administrator account. Nobody grants an admin flag they don't hold.<br>• **Modes and the route list.** Mode is `CRM_ACCESS_MODE` (`report` by default). The unscoped switch needs both settings. `ROUTE_POLICY` declares who every route is for. |
| `audit-log.js` (new) | An append-only JSONL file per month in `<dataDir>/audit/`. Only a fixed set of keys is written. Anything shaped like a PAN, an Aadhaar number or a mobile number is replaced before writing. |
| `server.js` | • Creates both modules.<br>• **Team writes:** `PUT /api/storage/team` evaluates the team rule and records would-deny entries; the write itself is unchanged.<br>• **New admin routes:** `GET /api/access/reconcile` and `GET /api/audit`, both for administrator accounts only. |
| `public/index.html` | • **Unlinked sign-ins:** a sign-in that is neither an administrator nor linked to a team member now works as an empty placeholder, with a notice, instead of as `team[0]`.<br>• **Ended sessions:** a 401 from a store read or save sends the tab to the sign-in page, with a way back. |
| `.gitignore` | `audit/` and `backups/` (the data folder defaults to the repo root locally). |
| Tests | `tests/lib/sec-http.js` (HTTP as real accounts) plus four suites: `sec-route-policy`, `sec-principal`, `sec-self-promotion`, `sec-negative-misc`. |

## Departures from the step plan, and why

1. **Administrator accounts with no linked member keep the `team[0]` fallback.** The plan said to replace the fallback with an "account not linked" screen. Two facts argued against doing that for everyone:
   - every test suite signs in as an administrator account with no member;
   - a fresh install has no member for its first administrator.

   Replacing the fallback for everyone would break both. So the placeholder applies to **non-administrator** accounts only. That covers exactly the case that mattered: an ordinary sign-in working as the firm's Admin record. The server never used the fallback.
2. **`GET /api/audit` arrived in step 1 instead of step 5.** The step 1 tests have to read the would-deny entries, and the suites cannot see the server's data folder. It is administrator-only and read-only. Step 5 still completes audit coverage.

## What step 2 changes

The same `teamViolations()` result becomes a refusal (403) in enforce mode, together with scoped reads and writes and the day-1 lock-downs.

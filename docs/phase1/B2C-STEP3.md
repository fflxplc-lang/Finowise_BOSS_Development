# B2C Phase 1, step 3: PAN masking, Aadhaar scope, generated passwords

## What runs where

| Rule | Report mode (default) | Enforce mode (`CRM_ACCESS_MODE=enforce`) |
|---|---|---|
| **PAN masking**: every PAN in what the server sends shows as `XXXXXX234F` for anyone but the administrator account. This covers client, family, nominee, lead, form answers, audit-line values and the person's own team PAN. Matching is on the value, so a PAN in an unlisted field is masked too. | PANs served in full, as before; the read is recorded with "N PAN(s) masked" | Masked |
| **Masked PAN on save means "unchanged"**: the stored PAN is put back before any other check reads the record. Lookup order: the record's own stored copy (by id), then the client or lead it hangs off (a form pre-filled from the client). A masked value that cannot be traced is refused (422) and nothing is written. A full PAN typed in is a change and is saved. | Active (it never fires, since nothing is masked) | Active |
| **PAN match** (`POST /api/clients/pan-match`): ids of in-scope clients carrying each PAN asked, plus a yes/no for "also on a client outside your scope", in request order. Never a PAN. Needs CMS view, CMS create or import permission; at most 5,000 per call; audited as a count. | Available | Available |
| **Page: imports when PANs are masked.** The platform import asks the server before matching any row. The module import keyed on PAN does the same for clients; other modules say plainly that only an administrator can match on PAN. A row whose PAN belongs only to an out-of-scope client is left alone, never duplicated. The project client search finds a typed full PAN. **With unmasked PANs (report mode, administrator) every path is exactly as before.** | Local matching, as before | Server matching |
| **Page: PAN field validation** accepts an unchanged masked PAN; any other invalid value is still refused | Same | Same |
| **Aadhaar store or replace**: the client is in scope and CMS edit is held. **Remove**: also CMS delete. **View**: the existing approval list and the client in scope. The administrator account is not limited by scope (viewing still needs the approval list). Every attempt is audited without digits. | Recorded as would-deny; carries on | Refused (403); also written to the vault's own log as "refused" |
| **Generated passwords at rest** (`issued_password`): AES-256-GCM, `enc1:` prefix. Still shown to an administrator until first sign-in, then cleared, as before. Plain-text values from older code are sealed at start-up. | Active (a storage change, not an access rule) | Active |

## Keys: what was and was not touched

- **The Aadhaar vault is unchanged**: `aadhaarKey`, `vaultSeal`, `vaultOpen`, the vault file and its log. `CRM_AADHAAR_KEY` and `CRM_SESSION_SECRET` are not added, removed, changed or rotated anywhere. `sec-aadhaar` stores a number, restarts the server with the same secret, and reads it back.
- **The generated-password key** is `sha256(CRM_SESSION_SECRET + ':issued-password')`, which reads the secret without changing it. Without that secret (a laptop, the tests) the key is a generated file, `issued-password.key`, beside `users.db` (gitignored).
- **Rollback note:** old code would show the sealed text instead of a pending generated password until an admin issues a new one. Real password hashes and sign-in are unaffected.

## Cost at 50,000 clients

These apply in enforce mode. Report mode evaluates a read at most once per person and store every 10 minutes.

| Operation | Time |
|---|---|
| An RM's scoped and masked client read | about 115 ms |
| A firm-wide masked read | about 158 ms |
| Restoring masked PANs on a 50,000-record save | about 101 ms (only when the request contains a masked PAN) |
| PAN match of 5,000 PANs | about 5 ms |

## One change to a Step 2 test

`sec-store-read` expected RM A to see their own team PAN in full. Under the Step 3 rule (full PAN for the administrator account only) it is shown masked (`XXXXXX111A`). The assertion now expects that, which is the stricter rule.

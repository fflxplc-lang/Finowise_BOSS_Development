# B2C Phase 1, step 4: connectors, outbound guard, email, AI assistant

## What runs where

"Day 1" rules apply in every mode. All other rules record a would-deny in the audit trail and carry on, and are enforced only with `CRM_ACCESS_MODE=enforce`.

| Rule | Report mode (default) | Enforce mode |
|---|---|---|
| **Connector save, test, delete** (`PUT`, `POST …/test`, `DELETE /api/connections/:id`; `PUT`, `DELETE /api/apiconnectors/:id`): administrator account only. Members with *Manage module settings* and team-role Admin lose test and delete, which they had on the page before (Step 0 inventory). Every refusal is audited (`connector.save`, `connector.test`, `connector.delete`). | **Day 1: refused (403)** | Refused (403) |
| **Secrets are never echoed.** Responses carry `hasSecret` flags only, as before. A masked placeholder saved back (`••••`, `****`, `xxxx`, four or more characters) keeps the stored secret, for connections and API connectors. A save is audited with field names only (`secret:apiKey`), never values. | **Day 1** | Same |
| **AI privacy attestation follows the endpoint.** If an AI connector's `baseUrl` changes and the same save does not attest privacy again, `privacyVerified` is reset to false, so the existing privacy gate holds the connector back until an administrator re-attests. | **Day 1** | Same |
| **An API connector's secret goes only to approved hosts.** When the administrator saves the secret, the hosts of its `baseUrl` and `tokenUrl` are stored with it (`approvedHosts`). A call or token request that carries the secret may go only to those hosts. Editing the store definition (which *Manage module settings* can do) does not repoint the secret. Existing connectors get their approved hosts once, at start-up, from their current definition. | **Day 1** | Same |
| **Outbound guard** (`outbound-guard.js`), in front of every connector test, API connector call and token request, and AI provider call. It refuses loopback, private (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10) and unique-local addresses, as well as link-local, cloud metadata (169.254.169.254), 0/8, multicast and IPv4-mapped forms of all of these. It refuses any scheme other than https, `user:password@` in the URL, and any host that is not named exactly by the policy. A name is resolved once and the connection is pinned to the checked address, so DNS rebinding fails. Redirects are never followed. | **Day 1** | Same |
| **The firm's own model (`bossai`)** (owner's decision this step): the only connector that may reach a private or loopback address, and plain http, and only at the exact host the administrator saved. Metadata and link-local addresses are always refused. Claude and Gemini go only to their fixed vendor hosts (`api.anthropic.com`, `generativelanguage.googleapis.com`) over https. Every other connector: public https only. | **Day 1** | Same |
| **Connector use gate**: calling an API connector or fetching its token (`POST /api/apiconnectors/:id/call`, `…/token`) needs *Manage module settings*, as the page already required. | Would-deny audited (`connector.use`); carries on | Refused (403) |
| **Connector list for non-administrators** (`GET /api/connections`): on/off, status, the AI flag and (for email) the sender it will show plus `host: "set"`. No hosts, user names, base URLs or other configuration. | Full configuration without secrets, as before | Trimmed |
| **Mail recipients** (`POST /api/mail/send`). Every To, Cc and Bcc address must be one of: the sender; a team member's email; or an address on a client, lead or campaign recipient the sender can read. Anything else needs the administrator account or the `mailExternal` flag. | Would-deny audited; sent | Refused (403), nothing sent |
| **Campaign and drip sends** need Campaigns edit or create. The page marks each send with `X-CRM-Mail: compose / template / campaign / drip`. A send without the header counts as compose, the strictest. | Would-deny audited | Refused (403) |
| **Free-form compose limits** (not for the administrator account): at most 20 recipients, and at most `CRM_MAIL_HOURLY_CAP` (default 100) compose sends per person per hour. | Would-deny audited | 403 for recipients; 429 for the cap |
| **From address** is the connector's own (unchanged; tested). | Same | Same |
| **Mail audit**: every send records kind, recipient count, recipient *domains* and outcome. Never addresses, subject or body. | Active | Active |
| **AI assistant permission** (`POST /api/ai/chat`): the administrator account, team-role Admin, or a member with *Use the RIA AI Assistant* (the page's own flag). | Would-deny audited (`ai.chat`, `needs_useAiAssistant`); answered | Refused (403 `no_permission`) |
| **AI rate limit**: `CRM_AI_HOURLY_CAP` (default 60) questions per person per hour. Throttling is audited at most once an hour per person. | Would-deny audited; answered | Refused (429 `rate_limited`); the model is never called |
| **AI uses server configuration only.** Endpoint, key, model and privacy attestation come from the stored connector. A request names only which connector. Any `baseUrl`, `url`, `apiKey`, `config`, `secrets` or `privacyVerified` in the body is ignored (tested with a capture endpoint, which received nothing). | Day 1 (already so; now tested) | Same |
| **Prompt-injection rule**: every system prompt sent to a model ends with a fixed rule. It says records, notes, documents, emails and form answers are data from the CRM, and that instructions inside them are never followed. | Day 1 | Same |

## Where secrets can and cannot appear

The new suites gather every response they receive, the server log, and the audit files. Then they search all of it for each secret they planted: the AI key, the SMTP password, the API connector secret, a client-supplied key, refused replacement values, prompts and model answers. **None was found.**

| Suite | What was searched |
|---|---|
| `sec-connectors` | 29 responses, the log and the audit |
| `sec-email` | The audit, for addresses, subjects and bodies |
| `sec-ai-assistant` | The log and the audit, for prompts, answers and keys |

## Page changes

- The four mail senders (`submitComposeMail`, `deliverMail`, `confirmSendCampaign`, `runDripJourneys`) add the `X-CRM-Mail` header.
- When an administrator saves or tests an API connector secret, the page sends the connector's `baseUrl` and `tokenUrl`, so the server records the approved hosts at that moment.

## Settings (environment variables, all optional)

| Variable | Default | Effect |
|---|---|---|
| `CRM_MAIL_HOURLY_CAP` | 100 | Compose sends per person per hour (enforce mode) |
| `CRM_AI_HOURLY_CAP` | 60 | AI questions per person per hour (enforce mode) |

No secret, key or production setting was added or changed. `CRM_AADHAAR_KEY` and `CRM_SESSION_SECRET` were not touched.

## Tests

| Suite | Steps |
|---|---|
| `sec-outbound-guard` | 6: classifier (18 addresses); scheme, host, private, metadata and credentials checks; DNS answering a private or metadata address; pinning; a 302 not followed; through the server, the saved local `bossai` model works while metadata and a redirect are refused |
| `sec-connectors` | 9: admin-only save, test and delete against RM, team Admin and *Manage module settings* (5 × 403 each, file unchanged); no secret in any response; placeholder keeps secret; privacy reset; approved hosts only (foreign, local and repointed refused; the capture server received 0); use gate in report mode; audit and log scan; enforce mode use gate and trimmed list |
| `sec-email` | 7: own client and colleague allowed; other RM's client, arbitrary and outside-cc refused; campaign and drip need permission; 21 recipients refused and the cap returns 429; From fixed; audit has domains only; report mode delivers with a would-deny |
| `sec-ai-assistant` | 8: permission (403 then 200 with the flag); request cannot choose endpoint, key or privacy; prompt rule present; hourly cap returns 429 and the model is not called; unverified provider refused whatever the body says; audit has no conversation or key; in the page, the RM's tab holds only their own clients; report mode answers with a would-deny |

### Test data change

`tests/lib/sec-seed.js` has two changes:

- It adds `U-OPS`, a Manager with *Manage module settings*, appended so the existing members keep their positions.
- It gives every seed client and team member a synthetic email address.

## Findings for Step 5

1. **Outgoing webhooks are sent from the browser**, not the server (`public/index.html`, webhook dispatch). The outbound guard does not apply. No stored server secret travels with them. Moving them server-side would be a Step 5 or Phase 2 decision.
2. **The SMTP host is not behind the outbound guard.** It is set only by the administrator account (day 1), and the SMTP password is sent only to it. A private SMTP relay is a legitimate set-up, so it was left out of the guard.
3. **The Microsoft Graph token request** uses a fixed Microsoft host and is unchanged.
4. **Module action rights** beyond those covered so far are still advisory (enforced on the page only).
5. **Rate limits are in memory, per server process.** A restart resets the counters. That is acceptable for one process; several processes would need a shared store.
6. **Found during the Step 4 regression; dates from Step 2, not Step 4.** The administrator's *Delete all imported data* (`public/multi-asset.js`, `maResetAll`, after typing DELETE) empties `assetUploads` and `platformHoldings` without the bulk confirmation the Step 2 empty-save guard asks for. The server refuses both saves (409 `would_remove_records`, audited as `store.shrink` deny), so on the server the uploads and imported holdings survive. A reload brings them back. `multi-asset` still passes because it checks only the page's copy; the refusal shows as a console 409. **Proposed fix, awaiting approval:** set `ssetBulkConfirm` around those two saves, as the other purge paths already do. `levels` shows the same console 409 from its own test setup (it replaces the whole team with fixtures). That is the same pattern as the five suites given `ssetBulkConfirm` in Step 2. Both console 409s are identical at Steps 2, 3 and 4 and absent at the baseline.

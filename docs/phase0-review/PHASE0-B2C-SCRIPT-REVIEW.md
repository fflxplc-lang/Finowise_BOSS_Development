# Finowise B2C: Phase 0 census script for review (not yet run on TEST data)

**Status:** the script is written and validated on **synthetic data only**. It has **not** been run on the B2C TEST data: you asked to review it first, and this session cannot reach the TEST VPS anyway.

Nothing in any repository was edited, committed, pushed or deployed. Production data was not accessed.

- **Script:** `ria-b2c-census.js` (281 lines)
- **sha256:** `1b5a9c2607b78846ff12ba4d137e84a44ea12e0889ffe25060f2b4d55b81452e`

---

## 1. What the script does and does not do

| Guarantee | How it is ensured / verified |
|---|---|
| Read-only | A single `fs.readFileSync`; no write, rename, delete, lock, network or child process; only Node's `fs` and `path`. The data file's sha256 is identical before and after a run |
| Counts only | Only counts are printed: no money totals, no per-client amounts, no names, PAN, mobile, email or record ids |
| Labels | Status, transaction-type, frequency and platform labels are printed with counts, because the SIP mapping needs them. Anything PAN-, phone-, email- or id-like, matching a client, team or project name, or longer than 40 characters, is replaced by `[redacted …]`. Combined labels are redacted part by part |
| Leak scan | Every id, name, PAN, mobile, email, RM, project, scheme and batch id in the data is searched for in the output. Result: **0 of 69** found (trap set) and **0 of 3,951** (1,478-client synthetic store), in text and JSON output |
| Scanner works | Negative control: output plus one planted project name → the scan fails (exit 1), as it should |

---

## 2. What it measures, and what each count decides

| Section | Counts | Decides |
|---|---|---|
| **AUM** (dashboard book logic) | clients with platform holdings / ledger only / both (the dashboard ignores the ledger) / neither; holdings by platform; with or without asset-class sleeves; with scheme-level detail; missing report date; zero value; orphan holdings; static `clients.aum` usage; AUM imports per platform | Whether Total, branch, RM and product AUM are reliable, and how many clients have no AUM figure at all |
| **Branches** | configured branches; distinct branch values on clients; clients without branch; clients whose branch is not in the configured list | Branch-wise reliability, and the size of the "No branch" / unlisted buckets |
| **RMs** | distinct RMs; clients without RM, with an RM missing from the team, with an inactive RM; use of the wrong `assignedTo` field | RM-wise reliability, and the size of the field defect |
| **Projects** | projects by category; links; links to missing project or client; duplicates; projects without clients; clients in 0 / 1 / 2+ projects; **double-count factor** | Project-wise AUM reliability and how much totals would exceed firm AUM |
| **Transactions, schemes, AMCs** | by type and status; completed; missing date, amount or client; with scheme; scheme found in master; AMC found | Transaction summaries, and whether scheme- and AMC-wise views are possible |
| **SIPs** | configured status and type lists; SIP transactions by type, status and status-vs-stage; statuses not in the configured list; SIP business entries; platform SIPs by platform; any status field; end-date buckets; SIP type; frequency; monthly amount present; scheme matches master; orphan SIPs; not in the latest report; missing report date; SIP stop/pause task types and statuses | The SIP status mapping, SIP counts and monthly SIP amount reliability |
| **Monthly history** | `aumMonthly` rows; first and last month; dated vs filed-under-arrival; missing months | What the existing firm-wide trend can show before new snapshots start |
| **Other field health** | tasks without `assignTo`; wrong-field use; tasks by status | Task / operations reliability |

**Validated on a synthetic trap set:** every count matched the expected value (checked by hand). Planted name, PAN and phone values in status and frequency fields were redacted.

---

## 3. A correction to plan v2 (found while writing the script)

The **Finowise AUM import is investor-level**: invested, current value and XIRR per client, **no scheme or folio**. This is the same as NJ and Anand Rathi.

So **no AUM import carries scheme-level holdings**. Scheme-wise and AMC-wise distribution can only come from:
1. BOSS ledger transactions (`schemeId` → `schemes.amcId` → `amcs`), and
2. the SIP book (platform SIP `schemeName` matched to the scheme master, plus SIP-type transactions).

**AUM by AMC or scheme therefore cannot be calculated from imported holdings.** It can be shown as "invested through BOSS transactions" and "SIP book" by scheme or AMC, labelled as such. The census reports how much of that data links to the masters. Plan v2 §1.1 and §4 will be corrected.

---

## 4. Project-wise AUM: implications of "count in every linked project"

Your preference: count each client in every linked project, and disclose that project totals may exceed firm AUM. What it means:

1. **Totals:** the sum of project AUMs is **not** firm AUM and can exceed it. The census's double-count factor shows by how much in your data; for example, 1.5 means project totals sum to about 1.5× the AUM of the linked clients.
2. **No share-of-total charts:** pie and donut charts and "% of total" figures would be misleading for projects. Projects get bar charts and tables only, and the report has no single "Total" row summing projects. It shows "AUM of distinct clients in these projects" separately.
3. **No apportioning:** a project shows each linked client's **full** AUM. BOSS does not record which holdings belong to which project, so splitting a client's AUM between projects would be invented.
4. **Unlinked clients:** shown as "Not in any project", so the reader can reconcile against firm AUM.
5. **Bad links:** links to missing or deleted clients or projects, and duplicate links, are excluded and counted in the data-gaps note.
6. **History:** snapshots record project membership at the time of the snapshot; later re-linking does not rewrite past months.
7. **Other views:** branch-, RM- and firm-level AUM are not affected; each client counts once there.

Please confirm these implications before implementation (not needed for Phase 0).

---

## 5. Running it on the B2C TEST data (after your review)

Copy the script into `/home/finowise-test/`, **not** `/home/finowise/`. Then check it is the reviewed file (expect `1b5a9c26…452e`):

```bash
sha256sum /home/finowise-test/ria-b2c-census.js
```

Run it as the test user, reading the TEST file only:

```bash
sudo -u finowise-test node /home/finowise-test/ria-b2c-census.js /home/finowise-test/data/data.json > /tmp/ria-b2c-census.txt
```

Review the output before sharing it. It should contain only counts, configured labels and `[redacted …]` markers:

```bash
cat /tmp/ria-b2c-census.txt
```

Afterwards, remove the script and the report from the server.

The test data may be a copy of real data. That is why the output is counts-only and the leak scan exists.

---

## 6. What happens with the results

Once you send me the output, I will return:
- **A metric reliability table:** Total, branch, RM, project, product, scheme and AMC AUM; SIP counts; monthly SIP amount; transaction and client summaries. Each is rated *reliable* / *reliable with stated gaps* / *not possible from current data*, with the counts behind the rating.
- **The SIP status mapping proposal from actual values:** every observed status, with its count and BOSS's own meaning (from its automations), mapped to factual categories (request lifecycle, platform registration, stop/pause requests). Labels like "active / stopped / paused" are proposed only where the data supports them, and anything ambiguous is listed for your decision.
- **Field-gap findings:** for example, clients without branch, RM or AUM; orphan records; statuses outside the configured list.

Phase 1 and every other phase stay on hold until you approve them.

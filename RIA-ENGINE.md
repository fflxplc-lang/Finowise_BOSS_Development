# RIA AI's Python engine

RIA AI now has a second brain: a small Python service that reads the real
CRM records, does the analysis itself and writes its own answer — no AI model
needed for it — and keeps its own database of what it built and said.

```
Browser (BOSS) ──► Node server.js ──► /api/ria/engine/* ──► Python ria_engine (127.0.0.1:8765)
                                                              ├─ its own SQLite database (ria-engine.sqlite, beside data.json)
                                                              ├─ client analysis · model portfolios · rebalancing · book report
                                                              └─ the firm's quartile sheet and fund basket (files in this repo)
```

## What it does (phase 1)

| Ask RIA AI | The engine answers with |
|---|---|
| `ZZ Client ka portfolio analysis`, `deep analysis` (a client open / active) | Value, gain, look-through equity / debt / gold, every holding's **Hold / Reduce / Switch / Review** with its reason (firm quartile sheet, 25% concentration, de-risking at 55+), overlap, micro-tail clutter, LTCG vs the ₹1.25 lakh exemption, and what changed since its last analysis |
| `model portfolio moderate 10 years 10 lakh + 15k SIP`, `Ramesh ke liye portfolio banao` | The fund basket's cell for that risk profile and horizon, in rupees (lumpsum and SIP), saved to its database |
| `rebalance Ramesh`, `iska rebalance` | Drift from the risk profile's target (±5 pt band), how much to move, from which holdings (Switch / Reduce first) into which basket funds |
| `book report`, `poori book ka analysis` | AUM, asset classes, branches, the largest clients and their share, the SIP book, and the clients to act on |

When the engine is not running, none of this changes anything: those questions
go wherever they went before. RIA AI never says Buy or Sell; every answer
carries the governance line.

## Safety

- The engine binds to **127.0.0.1** only and requires `X-Ria-Engine-Token`
  (`RIA_ENGINE_TOKEN`, in the server's env file — never in git).
- The browser never talks to it. Node checks the session, works out the
  person's scope (own / team / branch / firm — the Dashboard's Live AUM rule)
  and passes **only those clients** and their holdings, SIPs and transactions.
  Staff records go as id, name and branch only. The engine never opens
  `data.json`.
- Its answers carry no PAN, Aadhaar, mobile, e-mail, bank or address.
- Its database holds analyses, recommendations and portfolios (scheme names,
  amounts, client id and name), `chmod 600`, beside `data.json`, outside git.

## Install (once per server, by someone with root)

Needs only `python3` 3.8+ (standard library — nothing is pip-installed).
Deploy a BOSS commit that contains `ria_engine/` first, then:

```bash
sudo bash /home/finowise-test/app/deploy/ria-engine/install-ria-engine.sh finowise-test 8765
```

For boss.finowise.com (user `finowise-b2c`) use port 8767:

```bash
sudo bash /home/finowise-b2c/app/deploy/ria-engine/install-ria-engine.sh finowise-b2c 8767
```

It adds `RIA_ENGINE_PORT` and a fresh `RIA_ENGINE_TOKEN` to that user's
`app.env`, installs `ria-engine-<user>.service`, starts it, restarts BOSS so
Node reads the token, and checks both answer. Logs:
`journalctl -u ria-engine-finowise-test -n 50`.

After that, each deploy restarts the engine with the new code (the TEST
`autodeploy.sh` does `systemctl try-restart ria-engine-finowise-test`; re-run
`install-autodeploy.sh` once so the server's copy has that line).

## Develop and test

```bash
python3 -m unittest discover -s ria_engine/tests -v          # the engine alone (22 tests)
cd tests && ./run.sh ria-engine                               # through BOSS: starts the engine itself
RIA_ENGINE_DB=/tmp/ria.sqlite python3 -m ria_engine.server   # run it by hand on 127.0.0.1:8765
```

| File | What it is |
|---|---|
| `ria_engine/normalize.py`, `classify.py` | CRM records → people and positions, ported from the page (checked against the page's own code) |
| `ria_engine/reference.py` | the quartile sheet (`public/ria-quartiles.js`) and fund basket (`ria-fund-basket.json`) |
| `ria_engine/analysis.py` | one client's analysis and its written answer |
| `ria_engine/portfolio.py` | model portfolios and rebalancing |
| `ria_engine/book.py` | the book report |
| `ria_engine/db.py` | the engine's own SQLite database |
| `ria_engine/server.py` | the HTTP service |
| `server.js` (`/api/ria/engine/*`) | the Node side: session, scope, relay |

Next phases: move the remaining in-page analysis (upload research, diagnostics
workbook, SIP / goal projections) into the engine one at a time, each tested on
TEST first.

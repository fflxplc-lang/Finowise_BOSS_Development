# SOP guides in RIA AI

RIA AI answers an SOP question ("nomination ka process kya hai", "NRI account
opening documents", "PAN update kaise kare") with the firm's own steps, and —
where the deck's PDF is on the server — a **📄 View Visual SOP Guide
(Read-Only)** button. *Self Service & SOPs › All SOP Guides* lists every guide
with a filter.

## What is where

| Thing | Where | In git? |
|---|---|---|
| Steps, titles, keywords, which PDF | `sop-registry.json` | yes |
| The PDFs | `CRM_SOP_DIR`, else `<data dir>/sops-pdf` (beside `data.json`), else `sops-pdf/` in the repo | **no** for decks with client data |
| Source `.pptx` decks | `sops-src/` (git-ignored) or anywhere you point `--src` at | no |
| The tool | `scripts/sops-build.js` (Node only; LibreOffice for `--convert`) | yes |

The PDF is served only from `GET /api/sops/pdf/<file>`: signed-in users only,
only files the registry names, `Content-Disposition: inline`,
`X-Content-Type-Options: nosniff`, `Cache-Control: no-store`. The viewer draws
the pages onto a canvas (pdf.js): no browser PDF toolbar, no download or print
button, right-click / drag / Ctrl+S / Ctrl+P refused, a faint watermark of the
viewer, hidden when printing. It cannot stop a screenshot or a phone camera.

## Adding the remaining decks

1. **Check every deck for client data first.** Screenshots in our decks show
   real clients — filled forms, PAN and Aadhaar cards, client lists, names and
   e-mails. A PAN / Aadhaar / form slide must be withheld or redacted. The
   script lists, per deck, every picture-only slide and any PAN / Aadhaar /
   mobile / e-mail it finds in the text.
2. Put the `.pptx` files in `sops-src/` and run (on a machine with LibreOffice):

   ```bash
   node scripts/sops-build.js --src sops-src
   ```

   This drafts a registry entry for each new deck (steps from its slides,
   `"curated": false`) and prints the warnings. For a slide to leave out, add
   its number to the entry's `withholdSlides`.
3. Convert, straight into the folder the server reads (on the server, or
   locally and copy them up):

   ```bash
   node scripts/sops-build.js --src sops-src --convert --out /home/finowise-test/data/sops-pdf
   ```

   Withheld slides are never rendered into the PDF. A 3–4 MB deck comes out
   well under 1 MB.
4. Or, for one guide at a time: in RIA AI, an **admin** asking for an SOP with
   no PDF yet gets **⬆ Add the visual guide (PDF)** — the file goes to the
   server's data folder, not git (≤ 20 MB, must be a PDF, only a registered
   name).
5. Tidy the drafted steps in `sop-registry.json` (set `"curated": true`),
   commit the registry, and check: `node scripts/sops-build.js --check`.

PDFs that are confirmed free of client data may also go in `sops-pdf/` in the
repo; the server reads both folders.

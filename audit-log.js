'use strict';
/* =====================================================================
   THE SERVER'S OWN AUDIT TRAIL  (Phase 1)

   The CRM already keeps an auditLog store, but it is an ordinary store:
   whoever can write a store can rewrite it. This one is written only by
   the server, one JSON line per event, into <dataDir>/audit/YYYY-MM.jsonl,
   outside data.json and out of reach of /api/storage. Nothing here ever
   rewrites or deletes a line; there is no automatic deletion (how long
   to keep it is a compliance decision, not code's).

   What a line may hold is a fixed list of keys. Values are cut short,
   and anything that looks like a PAN, an Aadhaar number or a mobile
   number is replaced before it is written, so a careless caller cannot
   put one in the file. Secrets, mail bodies and AI prompts are never
   passed here in the first place.
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const KEYS = ['at', 'userId', 'email', 'memberId', 'action', 'target', 'ids', 'count', 'fields',
  'outcome', 'reason', 'mode', 'route'];
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi;
const AADHAAR_RE = /\b[0-9]{4}[\s-]?[0-9]{4}[\s-]?[0-9]{4}\b/g;
const MOBILE_RE = /(?<![0-9])(?:\+?91[\s-]?)?[6-9][0-9]{9}(?![0-9])/g;

function clean(v) {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v).slice(0, 300).replace(PAN_RE, '[redacted]').replace(AADHAAR_RE, '[redacted]').replace(MOBILE_RE, '[redacted]');
}

function create(opts) {
  const dir = opts.dir;
  let made = false;
  function file(at) { return path.join(dir, at.slice(0, 7) + '.jsonl'); }

  function append(entry) {
    const at = new Date().toISOString();
    const line = { at };
    KEYS.forEach((k) => {
      if (k === 'at' || entry[k] === undefined) return;
      if (k === 'ids' || k === 'fields') line[k] = (Array.isArray(entry[k]) ? entry[k] : [entry[k]]).slice(0, 50).map(clean);
      else line[k] = clean(entry[k]);
    });
    try {
      if (!made) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); made = true; }
      fs.appendFileSync(file(at), JSON.stringify(line) + '\n', { mode: 0o600 });
    } catch (e) {
      // The audit trail must never take the request down with it. Say so, without the entry.
      console.error('[audit] could not write an entry:', e.code || e.message);
    }
    return line;
  }

  /* Newest first, across months, up to `limit` lines. */
  function read(limit) {
    const max = Math.max(1, Math.min(Number(limit) || 200, 2000));
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().reverse(); } catch (e) { return []; }
    const out = [];
    for (const f of files) {
      let lines = [];
      try { lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean); } catch (e) { continue; }
      for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
        try { out.push(JSON.parse(lines[i])); } catch (e) { /* a torn last line is skipped, not fatal */ }
      }
      if (out.length >= max) break;
    }
    return out;
  }

  return { append, read, dir };
}

module.exports = { create, clean, KEYS };

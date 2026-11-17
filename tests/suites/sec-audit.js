/* WHAT THE AUDIT TRAIL RECORDS — PHASE 1, STEP 5.

   Step 1-4 suites cover refusals, deletes, Aadhaar, connectors, mail and
   the assistant. Added here:
     - every save that changes something: counts (+added ~changed
       -removed) and up to 50 ids; a save that changes nothing writes
       nothing;
     - a PAN change: the record id and the field name, never the PAN;
     - a team access change: who, and which fields (role, perms, …),
       never the values;
     - exports: a connector share (and a wrong share token), and a file
       saved from the page (its type and screen, never its name);
     - share tokens compared in constant time; errors answer without a
       stack trace;
     - the administrator-only reader. */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const signIn = require('../lib/signin');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

secSuite(async (t) => {
  const data = seed.build(12);
  data.apiConnectors = [{ id: 'ZZSHARE', name: 'ZZ Mirror', direction: 'out', active: true, baseUrl: 'https://mirror.example', store: 'leads' }];
  const srv = await t.startServer({});
  let admin = await srv.admin();
  await seed.load(admin, data);
  const lines = () => fs.readdirSync(path.join(srv.dir, 'audit')).map((f) => fs.readFileSync(path.join(srv.dir, 'audit', f), 'utf8')).join('')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const since = (n, action) => lines().slice(n).filter((e) => e.action === action);
  /* A save's audit line is written just after its answer: let it land. */
  const settle = () => new Promise((r) => setTimeout(r, 300));

  await t.step('a save that changes records is recorded with counts and ids; one that changes nothing is not', async () => {
    const n = lines().length;
    const clients = await admin.store('clients', []);
    const next = clients.slice(1).concat([{ id: 'ZZ-NEW', cmsName: 'ZZ New', rmName: 'U-RMA' }]);
    next[0] = Object.assign({}, next[0], { city: 'ZZ City' });
    await admin.save('clients', next); await settle();
    const n2 = lines().length;
    await admin.save('clients', next); await settle();             // the same again
    const w = since(n, 'store.write').filter((e) => e.target === 'clients' && e.outcome === 'ok');
    const again = since(n2, 'store.write').filter((e) => e.outcome === 'ok');
    if (w.length !== 1 || w[0].reason !== '+1 ~1 -1' || !w[0].ids.includes('ZZ-NEW') || !w[0].ids.includes(clients[0].id) || again.length)
      throw new Error(JSON.stringify(w) + ' again ' + again.length);
    return w[0].reason + ', ids ' + w[0].ids.join(', ') + '; the identical save wrote no line';
  });

  await t.step('a PAN change: the record and the field name, never the PAN', async () => {
    const n = lines().length;
    const clients = await admin.store('clients', []);
    const target = clients.find((c) => c.pan);
    const NEWPAN = 'ZQZPZ9876Q';
    await admin.save('clients', clients.map((c) => (c.id === target.id ? Object.assign({}, c, { pan: NEWPAN }) : c))); await settle();
    const p = since(n, 'pan.change');
    const text = JSON.stringify(lines().slice(n));
    if (p.length !== 1 || p[0].ids[0] !== target.id || p[0].fields[0] !== 'pan' || text.includes(NEWPAN) || text.includes(target.pan))
      throw new Error(JSON.stringify(p));
    return 'pan.change on ' + target.id + ' (field "pan"); neither PAN in the trail';
  });

  await t.step('a team access change: who, and which fields — not the values', async () => {
    const n = lines().length;
    const team = await admin.store('team', []);
    await admin.save('team', team.map((m) => (m.id === 'U-RMA' ? Object.assign({}, m, { role: 'Manager', adminFlags: Object.assign({}, m.adminFlags, { manageUsers: 1 }) }) : m))); await settle();
    const p = since(n, 'team.permissions');
    if (p.length !== 1 || p[0].ids[0] !== 'U-RMA' || p[0].fields.join() !== 'role,adminFlags' || JSON.stringify(p).includes('Manager'))
      throw new Error(JSON.stringify(p));
    return 'U-RMA: ' + p[0].fields.join(', ');
  });

  await t.step('a connector share is an export; a wrong token (any length) is refused alike and recorded', async () => {
    admin = await srv.admin();
    await admin.put('/api/apiconnectors/ZZSHARE', { shareToken: 'zz-share-token-0123456789' });
    const n = lines().length;
    /* The sign-in gate covers /api/share (as at the baseline), so the caller holds a session as well as the token. */
    const get = (tok) => fetch(srv.base + '/api/share/ZZSHARE?token=' + encodeURIComponent(tok), { headers: { Cookie: admin.cookie } });
    const short = await get('x'), same = await get('zz-share-token-012345678X'), right = await get('zz-share-token-0123456789');
    const [m1, m2] = [await short.json(), await same.json()];
    const ex = since(n, 'export.share');
    const text = JSON.stringify(lines().slice(n));
    if (short.status !== 401 || same.status !== 401 || m1.error !== m2.error || right.status !== 200
        || ex.filter((e) => e.outcome === 'deny').length !== 2 || ex.filter((e) => e.outcome === 'ok').length !== 1 || text.includes('zz-share-token'))
      throw new Error([short.status, same.status, right.status, JSON.stringify(ex)].join(' '));
    return 'short and same-length wrong tokens: 401 with the same message; right token 200; 2 refusals + 1 export recorded, no token in the trail';
  });

  await t.step('errors answer without a stack trace', async () => {
    const bad = await admin.call('PUT', '/api/storage/zz', undefined, { 'Content-Type': 'application/json' });
    const raw = await fetch(srv.base + '/api/storage/zz', { method: 'PUT', headers: { Cookie: admin.cookie, 'Content-Type': 'application/json' }, body: '{not json' });
    const rawText = await raw.text();
    const uri = await fetch(srv.base + '/api/storage/%E0%A4%A', { headers: { Cookie: admin.cookie } });
    const uriText = await uri.text();
    const stack = /\bat [\w.<>]+ \(|node_modules|server\.js:\d+|SyntaxError|URIError/;
    if (raw.status !== 400 || stack.test(rawText) || uri.status !== 400 || stack.test(uriText)) throw new Error(raw.status + ' ' + rawText.slice(0, 160) + ' | ' + uri.status + ' ' + uriText.slice(0, 160));
    return 'bad JSON → 400 "' + JSON.parse(rawText).error + '"; a malformed path → 400, plain message (status ' + bad.status + ' for an empty body)';
  });

  await t.step('only the administrator account reads the audit trail', async () => {
    const rm = await seed.signIn(admin, 'U-RMB');
    const tAdm = await seed.signIn(admin, 'U-TADM');
    const a = await admin.get('/api/audit?limit=5'), b = await rm.get('/api/audit?limit=5'), c = await tAdm.get('/api/audit?limit=5');
    if (a.status !== 200 || b.status !== 403 || c.status !== 403) throw new Error([a.status, b.status, c.status].join(','));
    return 'administrator 200; RM 403; team-role Admin 403';
  });

  /* A file saved from the page: the browser builds it, so the page reports it. */
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  try {
    await t.step('a file saved from the page is reported: its type and screen, never its name', async () => {
      const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
      await signIn(page, srv.base); await ready(page);
      await page.waitForFunction(() => appBooted === true, null, { timeout: 30000 });
      const n = lines().length;
      await page.evaluate(() => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['zz'], { type: 'text/plain' }));
        a.download = 'ZZ Client Rahulkumar statement.xlsx';
        a.click();
      });
      await page.waitForTimeout(800);
      const e = since(n, 'export');
      const text = JSON.stringify(lines().slice(n));
      const junk = await page.evaluate(async () => (await fetch('/api/audit/export', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, apiHeaders()),
        body: JSON.stringify({ format: '<b>x</b>.exe', screen: '../../etc<script>' }) })).status);
      const e2 = since(n, 'export').pop();
      if (e.length !== 1 || e[0].reason !== 'xlsx' || e[0].outcome !== 'reported' || text.includes('Rahulkumar') || junk !== 200 || /[<>.\/]/.test(e2.target + e2.reason))
        throw new Error(JSON.stringify(e) + ' ' + JSON.stringify(e2));
      return 'export reported: xlsx from "' + e[0].target + '"; no file name; junk cleaned to ' + e2.reason + ' / ' + e2.target;
    });
  } finally { await browser.close(); }
});

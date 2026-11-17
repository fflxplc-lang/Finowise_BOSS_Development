/* THE SERVER SHOWS EXACTLY WHAT THE PAGE SHOWS — PHASE 1, STEP 2.

   The server's read rules (access-control.js readView) are meant to be the
   page's own rules, worked out on the server, so that enforcing them takes
   nothing away from anybody's screens and gives nobody anything new. This
   checks that, record by record, for eight people with different scopes:

     the page side    the page's own functions, in a real browser, after it
                      has booted: inMyScope() with each store's owner and
                      branch rule (the record door, the export list, the
                      list screens), dstVisible() for tasks, the client a
                      record hangs off for client-linked stores;
     the server side  readView() over the very same data.

   A record the page shows and the server would withhold is a NARROWING; a
   record the server would show and the page does not is a WIDENING. Both
   must be zero. Size: SEC_PARITY_N clients (default 1,478, the size of the
   live book at the last count); above 2,000 each store is compared on a
   fixed sample of records, because the page's own lookups are linear. */
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const AC = require('../../access-control');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const N = Number(process.env.SEC_PARITY_N || 1478);
const SAMPLE = N <= 2000 ? 0 : 600;
const ROLES = ['U-TADM', 'U-BMA', 'U-TL', 'U-RMA', 'U-RMB', 'U-RMC', 'U-EXEC', 'U-ALL'];
const STORES = ['leads', 'clients', 'reviews', 'tasks', 'queries', 'recommendations', 'meetings', 'transactions', 'callEntries',
  'businessEntries', 'platformHoldings', 'platformSips', 'partners', 'campaigns', 'projects', 'communications',
  'clientDocuments', 'moms', 'insPolicies', 'docLinks', 'queryReplies'];

secSuite(async (t) => {
  const data = seed.build(N);
  const admin = await t.admin();
  const t0 = Date.now();
  await seed.load(admin, data);
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(t.base + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#email', require('../lib/signin').EMAIL); await page.fill('#password', require('../lib/signin').PASSWORD);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
    await ready(page, 120000);
    await page.waitForFunction(() => appBooted === true, null, { timeout: 240000 });
    await page.waitForTimeout(1500);                       // boot-time saves land

    /* the page's verdict, per role, per store, per record id */
    const pageSide = await page.evaluate(({ roles, stores, sample }) => {
      const pick = (list) => {
        if (!sample || list.length <= sample) return list;
        const step = list.length / sample, out = [];
        for (let i = 0; i < sample; i++) out.push(list[Math.floor(i * step)]);
        return out;
      };
      const was = currentUser, out = {};
      const cl = (id) => DB.clients.find((c) => c.id === id);
      const clientVis = (r) => { const c = r && r.clientId ? cl(r.clientId) : null; return !!c && inMyScope(c, (x) => x.rmName, (x) => x.branch); };
      const rules = {
        leads: (r) => inMyScope(r, (l) => l.assignedTo, (l) => l.branch),
        clients: (r) => inMyScope(r, (c) => c.rmName, (c) => c.branch),
        reviews: (r) => inMyScope(r, RECORD_DOORS.RMS.owner, RECORD_DOORS.RMS.branch) || inMyScope(r, (x) => x.assignTo, (x) => (cl(x.clientId) || {}).branch),
        tasks: null,
        queries: (r) => inMyScope(r, queryOwnerFor, (x) => x.branch || doorClient(x.clientId).branch) || inMyScope(r, queryOwnerFor, (x) => doorClient(x.clientId).branch),
        recommendations: (r) => inMyScope(r, (x) => listOwnerOf(x, ALLOC_OWNER_FIELDS), (x) => listBranchOf(x, ALLOC_OWNER_FIELDS)),
        meetings: (r) => inMyScope(r, (x) => listOwnerOf(x, MEETING_OWNER_FIELDS), (x) => listBranchOf(x, MEETING_OWNER_FIELDS)),
        transactions: (r) => inMyScope(r, (x) => listOwnerOf(x, TXN_OWNER_FIELDS), (x) => listBranchOf(x, TXN_OWNER_FIELDS)),
        callEntries: (r) => inMyScope(r, (x) => x.loggedBy, callBranchOf),
        businessEntries: (r) => inMyScope(r, bizOwnerOf, bizBranchOf),
        platformHoldings: (r) => clientVis(r) || inMyScope(r, (x) => x.importedBy, (x) => x.branch),
        platformSips: (r) => clientVis(r) || inMyScope(r, (x) => x.importedBy, (x) => x.branch),
        partners: (r) => inMyScope(r, (x) => x.createdBy, (x) => x.branch),
        campaigns: (r) => inMyScope(r, (x) => x.createdBy, (x) => x.branch),
        projects: (r) => inMyScope(r, (x) => x.owner, (x) => x.branch),
        communications: (r) => inMyScope(r, (x) => x.by, (x) => x.branch) || clientVis(r),
        clientDocuments: clientVis, moms: clientVis, insPolicies: clientVis, docLinks: clientVis,
        queryReplies: (r) => { const q = (DB.queries || []).find((x) => x.id === r.queryId); return !!q && rules.queries(q); },
      };
      for (const role of roles) {
        currentUser = role;
        out[role] = {};
        for (const s of stores) {
          const list = pick((DB[s] || []).filter((r) => r && r.id));
          let vis;
          if (s === 'tasks') { const shown = new Set(dstVisible(list.map((x) => Object.assign({}, x, { deletedAt: null }))).map((x) => x.id)); vis = list.map((r) => [r.id, shown.has(r.id)]); }
          else vis = list.map((r) => [r.id, !!rules[s](r)]);
          out[role][s] = vis;
        }
      }
      currentUser = was;
      return out;
    }, { roles: ROLES, stores: STORES, sample: SAMPLE });

    /* the server's verdict over the same data, read back after boot */
    const raw = {};
    for (const k of STORES.concat(['team', 'config'])) {
      const r = await admin.get('/api/storage/' + k);
      if (r.status === 200) raw[k] = r.json.value;
    }
    const team = JSON.parse(raw.team || '[]');
    const ac = AC.create({ storeRaw: (k) => raw[k], memberOfUser: (u) => team.find((m) => m.id === u.member_id) || null, env: {}, warn: () => {} });

    let compared = 0;
    const problems = [];
    const perRole = {};
    for (const role of ROLES) {
      const p = ac.principal({ id: 1, role: 'user', member_id: role, email: role + '@x' });
      let shown = 0;
      for (const s of STORES) {
        const view = ac.readView(p, s, raw[s]);
        const kept = new Set((view.value ? JSON.parse(view.value) : []).filter((r) => r && !r._stub).map((r) => r.id));
        for (const [id, pageSays] of pageSide[role][s]) {
          compared++;
          const serverSays = kept.has(id);
          if (pageSays) shown++;
          if (pageSays && !serverSays) problems.push(role + ' ' + s + ' ' + id + ' NARROWED');
          if (!pageSays && serverSays) problems.push(role + ' ' + s + ' ' + id + ' WIDENED');
        }
      }
      perRole[role] = shown;
    }

    await t.step('the data is big enough to mean something', async () => {
      if (data.clients.length !== N) throw new Error(data.clients.length + ' clients');
      return N + ' clients, ' + STORES.reduce((n, s) => n + (data[s] || []).length, 0) + ' records in ' + STORES.length + ' stores'
        + (SAMPLE ? ' (compared on a sample of ' + SAMPLE + ' per store)' : ' (every record compared)') + '; seeded and booted in ' + Math.round((Date.now() - t0) / 1000) + 's';
    });

    await t.step('no record the page shows is withheld by the server (no narrowing)', async () => {
      const n = problems.filter((x) => /NARROWED/.test(x));
      if (n.length) throw new Error(n.length + ': ' + n.slice(0, 8).join('; '));
      return compared + ' decisions compared over ' + ROLES.length + ' roles';
    });

    await t.step('no record the page hides is given out by the server (no widening)', async () => {
      const w = problems.filter((x) => /WIDENED/.test(x));
      if (w.length) throw new Error(w.length + ': ' + w.slice(0, 8).join('; '));
      return 'records visible per role: ' + ROLES.map((r) => r.replace('U-', '') + ' ' + perRole[r]).join(', ');
    });

    await t.step('the scopes are actually different from each other (the test can fail)', async () => {
      const v = Object.values(perRole);
      if (new Set(v).size < 4 || Math.min(...v) === Math.max(...v)) throw new Error(JSON.stringify(perRole));
      return 'from ' + Math.min(...v) + ' to ' + Math.max(...v) + ' records per person';
    });
  } finally { await browser.close(); }
});

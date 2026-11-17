/* MATCHING BY PAN WITHOUT SEEING ONE — PHASE 1, STEP 3.

   With PANs masked, a page cannot match an import row (or a typed PAN) to a
   client by comparing PANs itself. POST /api/clients/pan-match answers
   instead: for each PAN asked, in the order asked, the ids of live clients
   in the person's scope that carry it and whether it is also on a client
   outside their scope. Never a PAN. The platform import and the module
   import both use it when the tab's PANs are masked, and only then: in
   report mode and for the administrator account they match as before. */
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

secSuite(async (t) => {
  const data = seed.build(80);
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const admin = await srv.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const exec = await seed.signIn(admin, 'U-EXEC');
  const own = data.clients.find((c) => c.rmName === 'U-RMA');
  const other = data.clients.find((c) => c.rmName === 'U-RMB');
  const unknown = 'ZZZPU7777U';

  await t.step('an RM: own client’s PAN gives its id; another RM’s gives no id, only "elsewhere"; an unknown one, nothing', async () => {
    const r = await rmA.post('/api/clients/pan-match', { pans: [own.pan, other.pan, unknown, 'not a pan'] });
    const [a, b, c, d] = r.json.results;
    if (r.status !== 200 || a.ids.join() !== own.id || a.elsewhere || b.ids.length || !b.elsewhere || c.ids.length || c.elsewhere || d !== null) throw new Error(r.text.slice(0, 300));
    return JSON.stringify(r.json.results);
  });

  await t.step('the answer never carries a PAN, and is in the order asked', async () => {
    const r = await rmA.post('/api/clients/pan-match', { pans: [unknown, own.pan.toLowerCase()] });
    if (/[A-Z]{5}[0-9]{4}[A-Z]/i.test(r.text) || r.json.results[1].ids[0] !== own.id) throw new Error(r.text);
    return 'no PAN in the body; lower-case input matched';
  });

  await t.step('the administrator account gets every matching id', async () => {
    const r = await admin.post('/api/clients/pan-match', { pans: [other.pan] });
    if (r.json.results[0].ids.join() !== other.id || r.json.results[0].elsewhere) throw new Error(r.text);
    return other.id;
  });

  await t.step('an account with no CMS view and no import permission is refused; signed out is 401', async () => {
    const a = await exec.post('/api/clients/pan-match', { pans: [own.pan] });
    const b = await t.anonymous().post('/api/clients/pan-match', { pans: [own.pan] });
    const c = await rmA.post('/api/clients/pan-match', { pans: new Array(5001).fill(own.pan) });
    if (a.status !== 403 || b.status !== 401 || c.status !== 413) throw new Error([a.status, b.status, c.status].join(','));
    return 'Executive 403; signed out 401; 5,001 at once 413';
  });

  await t.step('lookups are in the audit trail as counts, never PANs', async () => {
    const e = ((await admin.get('/api/audit?limit=200')).json.entries || []).filter((x) => x.action === 'pan.match');
    if (e.length < 4 || /ZZZP[A-Z][0-9]{4}/.test(JSON.stringify(e))) throw new Error(JSON.stringify(e.slice(0, 2)));
    return e.length + ' entries (' + e.filter((x) => x.outcome === 'deny').length + ' refused)';
  });

  /* The page, as RM A in enforce mode: imports match through the server. */
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  try {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(srv.base + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#email', seed.email('U-RMA')); await page.fill('#password', 'Passw0rd-u-rma');
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
    await ready(page); await page.waitForFunction(() => appBooted === true, null, { timeout: 30000 });

    await t.step('platform import: with masked PANs the tab alone would match nothing; through the server it matches', async () => {
      const r = await page.evaluate(async ({ own, other, unknown }) => {
        const clients = DB.clients.filter((c) => !c.deletedAt);
        const masked = crmPansMasked(clients);
        impWiz = null;                        // the page's own (let) binding
        const local = impMatchClient({ pan: own.pan, name: own.cmsName }, clients);
        impWiz = { serverPans: await crmPanLookup([own.pan, other.pan, unknown]) };
        const idx = impClientIndex(clients);
        const a = impMatchClient({ pan: own.pan, name: own.cmsName }, clients, idx);
        const b = impMatchClient({ pan: other.pan, name: other.cmsName }, clients, idx);
        const c = impMatchClient({ pan: unknown, name: 'ZZ Nobody' }, clients, idx);
        impWiz = null;
        return { masked, local: local.how, a: [a.how, a.clientId], b: [b.how, b.why], c: c.how };
      }, { own, other, unknown });
      if (!r.masked || r.local !== 'new' || r.a[0] !== 'pan' || r.a[1] !== own.id || r.b[0] !== 'invalid' || !/outside your scope/.test(r.b[1]) || r.c !== 'new')
        throw new Error(JSON.stringify(r));
      return 'locally: "' + r.local + '" (would have duplicated the client); via the server: own → ' + r.a[1] + ', another RM’s → refused ("' + r.b[1] + '"), unknown → new';
    });

    await t.step('module import keyed on PAN: waits for the server, then matches own clients and leaves others’ alone', async () => {
      const r = await page.evaluate(async ({ own, other, unknown }) => {
        const key = (mapImpFields('clients').find((f) => f.vk === 'pan' || /pan/i.test(f.k)) || {}).k;
        if (!key) return { noKey: true };
        window.mapImp = { srcId: 'clients', file: 'zz.csv', read: { headers: ['Name', 'PAN'], rows: [[own.cmsName, own.pan], [other.cmsName, other.pan], ['ZZ Brand New', unknown]] },
          map: { Name: 'cmsName', PAN: key }, keyField: key, mode: 'update', tables: [], sheet: '' };
        mapImp = window.mapImp;
        const first = mapImpBuild();
        const waiting = first.blocking.some((b) => b.k === '__pan');
        for (let i = 0; i < 50 && !(mapImp.serverPans && !mapImp.serverPans.__error); i++) await new Promise((res) => setTimeout(res, 100));
        const plan = mapImpBuild();
        const v = plan.rows.map((x) => x.verdict + (x.rec && x.rec.__id ? ':' + x.rec.__id : ''));
        mapImp = null;
        return { waiting, blockedAfter: plan.blocking.some((b) => b.k === '__pan'), v };
      }, { own, other, unknown });
      if (r.noKey) return 'the client module has no PAN field to key on (nothing to test)';
      if (!r.waiting || r.blockedAfter || r.v[0] !== 'update:' + own.id || !/^skip/.test(r.v[1]) || /:CMS-/.test(r.v[1])) throw new Error(JSON.stringify(r));
      return 'blocked while checking; then own → ' + r.v[0] + ', another RM’s → ' + r.v[1] + ', unknown → ' + r.v[2];
    });

    await t.step('a full PAN typed into the project client search finds the RM’s own client', async () => {
      const r = await page.evaluate(async (own) => {
        window._ac = { projectId: (DB.projects[0] || {}).id, branch: '', q: own.pan, picked: [], bulk: '' };
        const node = document.createElement('div'); node.id = 'acHits'; document.body.appendChild(node);
        acRenderHits();
        for (let i = 0; i < 40 && !(window._ac._pan && window._ac._pan.ids.length); i++) await new Promise((res) => setTimeout(res, 100));
        acRenderHits();
        const found = node.innerHTML.includes(own.cmsName);
        node.remove();
        return { found, ids: window._ac._pan && window._ac._pan.ids };
      }, own);
      if (!r.found) throw new Error(JSON.stringify(r));
      return 'found ' + own.cmsName + ' by its full PAN';
    });
    await ctx.close();
  } finally { await browser.close(); }
});

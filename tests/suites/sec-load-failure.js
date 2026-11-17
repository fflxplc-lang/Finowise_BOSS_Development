/* A STORE THAT DID NOT LOAD MUST NOT BE SAVED BACK — PHASE 1, STEP 2, DAY 1.

   The page reads each store when it starts. A read that failed used to hand
   the screen an empty list, and the next save of that store wrote the empty
   list over everything on the server. Two guards now stand in the way:

   the page   remembers which stores did not load and will not save them
              until a read succeeds (with a notice saying so);
   the server refuses a save that would empty a store while taking two or
              more records with it, or remove more than max(5, 10%) of its
              records, unless an administrator account confirms how many
              (X-CRM-Confirm-Bulk). Removing a last single record is an
              ordinary action and goes through.

   Both are in force in every mode; this runs on the runner's server, which
   is in report mode. */
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

secSuite(async (t) => {
  const data = seed.build(80);
  const admin = await t.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const total = data.clients.length;
  const count = async (k) => (await admin.store(k, [])).length;

  await t.step('an RM saving an empty client list is refused, and nothing changes', async () => {
    const r = await rmA.save('clients', []);
    if (r.status !== 409 || r.json.error !== 'would_remove_records' || !r.json.emptied) throw new Error(r.status + ' ' + r.text.slice(0, 160));
    if (await count('clients') !== total) throw new Error('clients changed');
    return '409 would_remove_records; still ' + total;
  });

  await t.step('the administrator account is refused too, unless it confirms the number', async () => {
    const noConfirm = await admin.save('leads', []);
    const tooFew = await admin.save('leads', [], { 'X-CRM-Confirm-Bulk': '3' });
    const leads = await count('leads');
    const ok = await admin.save('leads', [], { 'X-CRM-Confirm-Bulk': String(leads) });
    const after = await count('leads');
    await admin.save('leads', data.leads);
    if (noConfirm.status !== 409 || tooFew.status !== 409 || ok.status !== 200 || after !== 0) throw new Error([noConfirm.status, tooFew.status, ok.status, after].join(','));
    return 'no confirmation 409; confirming 3 of ' + leads + ' 409; confirming ' + leads + ' 200';
  });

  await t.step('an RM’s confirmation is not accepted', async () => {
    const r = await rmA.save('clients', [], { 'X-CRM-Confirm-Bulk': String(total) });
    if (r.status !== 409 || await count('clients') !== total) throw new Error(String(r.status));
    return '409';
  });

  await t.step('a save that keeps a few records but drops the rest is refused', async () => {
    const r = await rmA.save('clients', data.clients.slice(0, 3).concat([{ id: 'CMS-ZZFRESH', cmsName: 'ZZ Fresh', rmName: 'U-RMA', branch: 'A' }]));
    if (r.status !== 409 || r.json.emptied || await count('clients') !== total) throw new Error(r.status + ' ' + r.text.slice(0, 120));
    return '409 (would remove ' + r.json.removed + ' of ' + r.json.total + ')';
  });

  await t.step('ordinary removals go through: one record, up to the limit, and a last single record', async () => {
    const one = await admin.save('tasks', data.tasks.slice(1));
    const limit = Math.max(5, Math.floor(data.tasks.length * 0.10));
    const some = await admin.save('tasks', data.tasks.slice(1 + limit - 1));
    await admin.save('tasks', data.tasks);
    await admin.save('amcs', [{ id: 'AMC-ZZ1', name: 'ZZ AMC' }]);
    const last = await rmA.save('amcs', []);
    const two = await admin.save('zzTwo', [{ id: 'T1' }, { id: 'T2' }]);
    const emptyTwo = await rmA.save('zzTwo', []);
    if (one.status !== 200 || some.status !== 200 || last.status !== 200 || two.status !== 200 || emptyTwo.status !== 409)
      throw new Error([one.status, some.status, last.status, two.status, emptyTwo.status].join(','));
    return 'remove 1: 200; remove ' + limit + ': 200; last single record: 200; emptying 2: 409';
  });

  await t.step('soft deletion is an edit, not a removal', async () => {
    const at = new Date().toISOString();
    const r = await admin.save('clients', data.clients.map((c, i) => (i < 40 ? Object.assign({}, c, { deletedAt: at }) : c)));
    await admin.save('clients', data.clients);
    if (r.status !== 200) throw new Error(String(r.status));
    return '40 records marked deleted: 200';
  });

  await t.step('each refusal is in the audit trail', async () => {
    const e = ((await admin.get('/api/audit?limit=300')).json.entries || []).filter((x) => x.action === 'store.shrink');
    if (e.length < 5) throw new Error(e.length + ' entries');
    return e.length + ' refusals recorded';
  });

  /* The page: a store whose read fails is not saved back. */
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  try {
    await t.step('in the page: a store that failed to load is not sent back, and the person is told', async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      let failed = 0; const puts = [];
      await page.route('**/api/storage/clients', (route) => {
        const m = route.request().method();
        if (m === 'GET' && failed === 0) { failed++; return route.fulfill({ status: 500, body: '{"error":"boom"}' }); }
        if (m === 'PUT') puts.push(route.request().postData() || '');
        return route.continue();
      });
      await page.goto(t.base + '/login', { waitUntil: 'domcontentloaded' });
      await page.fill('#email', seed.email('U-RMA')); await page.fill('#password', 'Passw0rd-u-rma');
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
      await ready(page); await page.waitForFunction(() => appBooted === true, null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        const loaded = DB.clients.length, marked = crmLoadFailed.has('clients');
        DB.clients.push({ id: 'CMS-ZZPAGE', cmsName: 'ZZ Made In The Broken Tab', rmName: currentUser, branch: 'A' });
        const res = await sset('clients', DB.clients);
        return { loaded, marked, res, notice: !!document.getElementById('crmLoadFailedNotice') };
      });
      await ctx.close();
      const server = await admin.store('clients', []);
      /* r.loaded is what the tab held after its failed read: the fallback plus
         anything start-up routines added to it, which is exactly what used to be
         saved back over the real list. */
      if (r.loaded >= total || !r.marked || r.res !== false || !r.notice || puts.length || server.length !== total)
        throw new Error(JSON.stringify(Object.assign(r, { puts: puts.length, server: server.length })));
      return 'read failed → the tab held ' + r.loaded + ' client(s) instead of ' + total + '; store marked, save refused in the tab (no PUT sent), notice shown; server still ' + server.length;
    });

    await t.step('in the page: once a read succeeds, saving works again', async () => {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(t.base + '/login', { waitUntil: 'domcontentloaded' });
      await page.fill('#email', seed.email('U-RMA')); await page.fill('#password', 'Passw0rd-u-rma');
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
      await ready(page); await page.waitForFunction(() => appBooted === true, null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        crmLoadFailed.add('clients');                     // as if an earlier read had failed
        DB.clients = await sget('clients', []);           // a read that works clears it
        const c = DB.clients.find((x) => x.rmName === currentUser);
        c.city = 'ZZ Varanasi';
        const res = await sset('clients', DB.clients);
        return { marked: crmLoadFailed.has('clients'), res, n: DB.clients.length };
      });
      await ctx.close();
      if (r.marked || r.res === false) throw new Error(JSON.stringify(r));
      return 'cleared by a good read; saved (' + r.n + ' clients in the tab)';
    });
  } finally { await browser.close(); }
});

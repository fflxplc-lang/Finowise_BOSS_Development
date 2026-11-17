/* THE DOORS THAT WERE ALREADY SHUT STAY SHUT, AND THE NEW ONES ARE.

   Signed out means 401 on the API. The two new administrator routes
   (/api/access/reconcile, /api/audit) are for the administrator account
   only, and the team role "Admin" alone does not open them. A sign-in that
   is not linked to any team member no longer works as whoever is first in
   the team list. A session that ends under an open tab goes to sign-in.
   Phase 1, step 1. */
const { secSuite } = require('../lib/sec-http');
const pw = require('../lib/pw');
const ready = require('../lib/ready');

const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TEAM = [
  { id: 'U-ADM', name: 'ZZ Firm Admin', role: 'Admin', scope: 'all', status: 'Active' },
  { id: 'U-TADM', name: 'ZZ Team Admin', role: 'Admin', scope: 'all', status: 'Active' },
  { id: 'U-RMA', name: 'ZZ RM A', role: 'Executive', scope: 'own', branch: 'A', status: 'Active' },
];

secSuite(async (t) => {
  const anon = t.anonymous();
  const admin = await t.admin();
  await admin.save('team', TEAM);
  const rmA = await t.account(admin, 'U-RMA', 'rma2@sec.test', 'Passw0rd-rma-2');
  const tAdm = await t.account(admin, 'U-TADM', 'tadm@sec.test', 'Passw0rd-tadm-1');
  /* a sign-in for nobody: made for a member id, which is then not on the team */
  await admin.post('/api/users/sync', { memberId: 'U-GHOST', email: 'ghost@sec.test', password: 'Passw0rd-ghost-1' });

  await t.step('signed out: the API answers 401 and gives nothing away', async () => {
    const paths = ['/api/storage/clients', '/api/storage/team', '/api/access/reconcile', '/api/audit', '/api/connections'];
    const got = [];
    for (const p of paths) got.push([p, (await anon.get(p)).status]);
    const bad = got.filter(([, s]) => s !== 401);
    if (bad.length) throw new Error(JSON.stringify(bad));
    return paths.length + ' routes → 401';
  });

  await t.step('the reconcile and audit routes: administrator account only', async () => {
    const r = { admin: [(await admin.get('/api/access/reconcile')).status, (await admin.get('/api/audit')).status],
      rm: [(await rmA.get('/api/access/reconcile')).status, (await rmA.get('/api/audit')).status],
      teamAdmin: [(await tAdm.get('/api/access/reconcile')).status, (await tAdm.get('/api/audit')).status] };
    if (r.admin.join() !== '200,200' || r.rm.join() !== '403,403' || r.teamAdmin.join() !== '403,403') throw new Error(JSON.stringify(r));
    return 'admin 200; RM 403; team-role Admin without an admin account 403';
  });

  await t.step('the reconcile report finds each kind of mismatch', async () => {
    const r = (await admin.get('/api/access/reconcile')).json;
    const c = r.counts;
    const ok = r.ids.teamAdminWithoutAdminAccount.includes('U-TADM') && r.ids.scopeAllWithoutAdminAccount.includes('U-TADM')
      && r.ids.accountsWithoutMember.length >= 2 && r.ids.membersWithoutAccount.includes('U-ADM');
    if (!ok) throw new Error(JSON.stringify(r));
    const leaked = /@sec\.test|@finowise\.test/.test(JSON.stringify(r));
    if (leaked) throw new Error('emails in the report');
    return JSON.stringify(c);
  });

  await t.step('an error answer carries no stack trace or internals', async () => {
    const r = await rmA.call('PUT', '/api/storage/team', { value: 42 });
    if (r.status !== 400 || /\bat \w+ \(|node:internal|\.js:\d+/.test(r.text)) throw new Error(r.status + ' ' + r.text.slice(0, 200));
    return '400 with a plain message';
  });

  /* The page, as two different people. */
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  const asUser = async (email, password) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(t.base + '/login', { waitUntil: 'domcontentloaded' });
    await page.fill('#email', email); await page.fill('#password', password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
    await ready(page); await page.waitForFunction(() => appBooted === true, null, { timeout: 30000 });
    return { ctx, page };
  };
  try {
    await t.step('a sign-in linked to nobody works as nobody, not as the first team member', async () => {
      const { ctx, page } = await asUser('ghost@sec.test', 'Passw0rd-ghost-1');
      const r = await page.evaluate(() => ({ id: me().id, admin: isAdmin(), cms: can('CMS', 'view'), team: DB.team.length,
        notice: !!document.getElementById('crmUnlinkedNotice') }));
      await ctx.close();
      if (r.id !== '__unlinked__' || r.admin || r.cms || !r.notice) throw new Error(JSON.stringify(r));
      return 'me() is the placeholder, no Admin, no CMS, notice shown (' + r.team + ' members on the team)';
    });

    await t.step('a linked RM is themselves; the administrator account keeps its fallback', async () => {
      const a = await asUser('rma2@sec.test', 'Passw0rd-rma-2');
      const rm = await a.page.evaluate(() => ({ id: me().id, notice: !!document.getElementById('crmUnlinkedNotice') }));
      await a.ctx.close();
      const b = await asUser('test@finowise.test', 'testpassword1');
      const ad = await b.page.evaluate(() => ({ id: me() && me().id, unlinked: crmUnlinked, notice: !!document.getElementById('crmUnlinkedNotice') }));
      await b.ctx.close();
      if (rm.id !== 'U-RMA' || rm.notice || ad.unlinked || ad.notice || !ad.id || ad.id === '__unlinked__') throw new Error(JSON.stringify({ rm, ad }));
      return 'RM → U-RMA; admin account without a member → ' + ad.id + ' (unchanged behaviour)';
    });

    /* Step 5 changed what the tab does (approved scope: unsaved work kept
       across re-login): instead of navigating away it asks for the
       password over the screen. The read is still refused and nothing is
       served until the person signs in; another account still goes
       through the sign-in page. */
    await t.step('a session that ends under an open tab asks for the password in place; nothing is served meanwhile', async () => {
      const { ctx, page } = await asUser('rma2@sec.test', 'Passw0rd-rma-2');
      const before = page.url();
      await ctx.clearCookies();
      await page.evaluate(() => { window.__zzRead = 'pending'; sget('clients', null).then((v) => { window.__zzRead = v === null ? 'refused' : 'served'; }); });
      await page.waitForSelector('#crmRelogin', { timeout: 8000 });
      await page.waitForTimeout(500);
      const read = await page.evaluate(() => window.__zzRead);
      const stayed = page.url() === before;
      await Promise.all([page.waitForURL(/\/login/, { timeout: 8000 }), page.click('#crmRelogin a[href="/logout"]')]);
      const url = page.url();
      await ctx.close();
      if (read !== 'pending' || !stayed || !/\/login/.test(url)) throw new Error(JSON.stringify({ read, stayed, url }));
      return 'sign-in dialog over the same screen; the read waits (nothing served); "Sign in as someone else" → ' + url.replace(t.base, '');
    });
  } finally {
    await browser.close();
  }
});

/* THE ADMINISTRATOR'S WORK STILL WORKS IN ENFORCE MODE — PHASE 1, STEP 6.

   Enforcement must take nothing away from the administrator account. On
   an enforce-mode server, end to end through the API:
     team and permissions, settings, connectors, a 50,000-client import,
     bulk reassignment, a confirmed bulk removal, mail to an outside
     address, Aadhaar store / view / remove, and the audit reader. */
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const smtp = require('../lib/smtp');

const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
function aadhaar(stem) { let c = 0; (stem + '0').split('').reverse().forEach((ch, i) => { c = D[c][P[i % 8][Number(ch)]]; }); return stem + [0,4,3,2,1,5,6,7,8,9][c]; }

secSuite(async (t) => {
  const mailPort = Number(process.env.BOSS_PORT || 3000) + 660;
  const mail = smtp.start(mailPort); await mail.ready;
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const admin = await srv.admin();
  const data = seed.build(20);
  await seed.load(admin, data);

  await t.step('team and permissions: role, scope and flags change and stay changed', async () => {
    const team = await admin.store('team', []);
    const r = await admin.save('team', team.map((m) => (m.id === 'U-RMB' ? Object.assign({}, m, { role: 'Manager', scope: 'branch', adminFlags: Object.assign({}, m.adminFlags, { useAiAssistant: 1 }) }) : m)));
    const b = (await admin.store('team', [])).find((m) => m.id === 'U-RMB');
    if (r.status !== 200 || b.role !== 'Manager' || b.scope !== 'branch' || !b.adminFlags.useAiAssistant) throw new Error(r.status + ' ' + JSON.stringify(b));
    return '200; U-RMB is now Manager / branch / AI assistant';
  });

  await t.step('settings save', async () => {
    const cfg = await admin.store('config', {});
    const r = await admin.save('config', Object.assign({}, cfg, { company: Object.assign({}, cfg.company, { name: 'ZZ Admin Firm' }) }));
    const after = await admin.store('config', {});
    if (r.status !== 200 || after.company.name !== 'ZZ Admin Firm') throw new Error(r.status);
    return '200; company name saved';
  });

  await t.step('connectors: configure, test, delete', async () => {
    const a = await admin.put('/api/connections/email', { enabled: true, config: smtp.connector(mailPort) });
    const b = await admin.post('/api/connections/email/test', {});
    const c = await admin.put('/api/connections/gemini', { enabled: false, config: { model: 'zz' }, secrets: { apiKey: 'zz-admin-key' } });
    const d = await admin.del('/api/connections/gemini');
    if (a.status !== 200 || !b.json.ok || c.status !== 200 || d.status !== 200) throw new Error([a.status, b.json.message, c.status, d.status].join(' / '));
    return 'save 200; test connected; another saved and deleted';
  });

  await t.step('a 50,000-client import is accepted whole', async () => {
    const big = seed.build(50000);
    const t0 = Date.now();
    const r = await admin.save('clients', big.clients, { 'X-CRM-Confirm-Bulk': String(data.clients.length) });
    const ms = Date.now() - t0;
    const n = (await admin.store('clients', [])).length;
    if (r.status !== 200 || n !== big.clients.length) throw new Error(r.status + ' ' + n + ' ' + r.text.slice(0, 160));
    return n + ' clients saved in ' + ms + ' ms';
  });

  await t.step('bulk reassignment of 2,000 clients', async () => {
    const all = await admin.store('clients', []);
    const ids = new Set(all.filter((c) => c.rmName === 'U-RMA').slice(0, 2000).map((c) => c.id));
    const r = await admin.save('clients', all.map((c) => (ids.has(c.id) ? Object.assign({}, c, { rmName: 'U-RMC' }) : c)));
    const moved = (await admin.store('clients', [])).filter((c) => ids.has(c.id) && c.rmName === 'U-RMC').length;
    if (r.status !== 200 || moved !== ids.size) throw new Error(r.status + ' moved ' + moved + '/' + ids.size);
    return moved + ' clients moved to U-RMC';
  });

  await t.step('a bulk removal: refused unconfirmed, accepted with the count', async () => {
    const all = await admin.store('clients', []);
    const keep = all.slice(0, all.length - 6000);              // 12%: over the max(5, 10%) limit
    const a = await admin.save('clients', keep);
    const b = await admin.save('clients', keep, { 'X-CRM-Confirm-Bulk': '6000' });
    const n = (await admin.store('clients', [])).length;
    if (a.status !== 409 || b.status !== 200 || n !== keep.length) throw new Error([a.status, b.status, n].join(' / '));
    return 'unconfirmed 409; with X-CRM-Confirm-Bulk: 6000 → 200; ' + n + ' left';
  });

  await t.step('mail to an outside address', async () => {
    const before = mail.received.length;
    const r = await admin.post('/api/mail/send', { to: 'partner@outside.example', subject: 'ZZ admin', body: 'ZZ' }, { 'X-CRM-Mail': 'compose' });
    if (r.status !== 200 || mail.received.length !== before + 1) throw new Error(r.status + ' ' + r.text.slice(0, 120));
    return '200; delivered';
  });

  await t.step('Aadhaar: store, view (on the approval list), remove', async () => {
    const id = (await admin.store('clients', []))[0].id;
    const N = aadhaar('29876543210');
    await admin.put('/api/aadhaar/access', { emails: ['test@finowise.test'], roles: [] });
    const a = await admin.put('/api/aadhaar/' + id, { number: N });
    const v = await admin.get('/api/aadhaar/' + id);
    const d = await admin.put('/api/aadhaar/' + id, { number: '' });
    if (a.status !== 200 || v.status !== 200 || !String(v.text).includes(N) || d.status !== 200) throw new Error([a.status, v.status, d.status].join(' / '));
    return 'stored 200; viewed in full 200; removed 200';
  });

  await t.step('the audit reader', async () => {
    const r = await admin.get('/api/audit?limit=50');
    if (r.status !== 200 || !(r.json.entries || []).length) throw new Error(r.status);
    return r.json.entries.length + ' entries returned';
  });
  await mail.close();
});

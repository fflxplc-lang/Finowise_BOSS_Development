/* REPORT MODE, THE KILL SWITCH AND THE DAY-1 RULES — PHASE 1, STEP 6.

   What TEST will run for its first seven days, checked end to end:
     - report mode (the default) serves today's answers: an RM reads every
       client with PANs in full and may save another RM's client, exactly
       as at the baseline, and each of those is written down as "would
       deny" / "would scope";
     - the kill switch needs both settings: one alone leaves scoping on;
     - the day-1 rules refuse in report mode too: deleting a store, a save
       that empties a store, connector settings, the outbound guard,
       sessions. */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');

secSuite(async (t) => {
  const data = seed.build(20);
  const srv = await t.startServer({});                       // report mode: the default
  const admin = await srv.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const audit = () => fs.readdirSync(path.join(srv.dir, 'audit')).map((f) => fs.readFileSync(path.join(srv.dir, 'audit', f), 'utf8')).join('')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));

  await t.step('report mode serves today’s answers: an RM reads every client, PANs in full', async () => {
    const all = await rmA.store('clients', []);
    const others = all.filter((c) => c.rmName !== 'U-RMA').length;
    const masked = all.filter((c) => /^X{6}/.test(c.pan || '')).length;
    const notes = audit().filter((e) => e.action === 'store.read' && e.target === 'clients' && e.outcome === 'would-scope');
    if (all.length !== data.clients.length || !others || masked || !notes.length) throw new Error(JSON.stringify({ n: all.length, others, masked, notes: notes.length }));
    return all.length + ' clients (' + others + ' of other RMs), 0 PANs masked; recorded: ' + notes[0].reason;
  });

  await t.step('report mode saves as before, and records the save that enforce mode would refuse', async () => {
    const all = await admin.store('clients', []);
    const theirs = all.find((c) => c.rmName === 'U-RMB');
    const r = await rmA.save('clients', all.map((c) => (c.id === theirs.id ? Object.assign({}, c, { city: 'ZZ Report City' }) : c)));
    const after = (await admin.store('clients', [])).find((c) => c.id === theirs.id);
    const e = audit().filter((x) => x.action === 'store.write' && x.outcome === 'would-deny');
    if (r.status !== 200 || after.city !== 'ZZ Report City' || !e.length) throw new Error(r.status + ' ' + after.city + ' ' + e.length);
    return '200 and saved (as at the baseline); would-deny: ' + e[0].reason + ' on ' + (e[0].ids || []).join(',');
  });

  await t.step('day-1 rules refuse even in report mode', async () => {
    const del = await rmA.del('/api/storage/clients');
    const wipe = await rmA.save('leads', []);
    const conn = await rmA.put('/api/connections/claude', { config: { model: 'x' }, secrets: { apiKey: 'zz' } });
    await admin.put('/api/connections/bossai', { enabled: true, config: { baseUrl: 'http://169.254.169.254/v1', model: 'm' } });
    const meta = await admin.post('/api/connections/bossai/test', {});
    if (del.status !== 403 || wipe.status !== 409 || conn.status !== 403 || meta.json.ok) throw new Error([del.status, wipe.status, conn.status, meta.json.message].join(' / '));
    return 'store DELETE 403; emptying leads 409; connector settings 403; metadata address refused ("' + String(meta.json.message).slice(0, 50) + '…")';
  });

  await t.step('the kill switch needs both settings; one alone leaves scoping on', async () => {
    const one = await t.startServer({ CRM_ACCESS_MODE: 'enforce', CRM_SCOPED_STORAGE: 'off' });
    const a1 = await one.admin(); await seed.load(a1, data);
    const r1 = await seed.signIn(a1, 'U-RMA');
    const n1 = (await r1.store('clients', [])).filter((c) => !c._stub).length;
    const both = await t.startServer({ CRM_ACCESS_MODE: 'enforce', CRM_SCOPED_STORAGE: 'off', CRM_ALLOW_UNSCOPED: 'yes-i-understand' });
    const a2 = await both.admin(); await seed.load(a2, data);
    const r2 = await seed.signIn(a2, 'U-RMA');
    const n2 = (await r2.store('clients', [])).filter((c) => !c._stub).length;
    const del2 = await r2.del('/api/storage/clients');                    // administrator-only operations still apply
    const own = data.clients.filter((c) => c.rmName === 'U-RMA').length;
    const warned = /only one of/.test(one.log()) && /scoped storage is switched OFF/.test(both.log());
    await one.stop(); await both.stop();
    if (n1 !== own || n2 !== data.clients.length || del2.status !== 403 || !warned) throw new Error(JSON.stringify({ n1, n2, own, del: del2.status, warned }));
    return 'one setting: ' + n1 + ' (own only, scoped); both: ' + n2 + ' (all); store DELETE still 403; both start-ups warn in the log';
  });
});

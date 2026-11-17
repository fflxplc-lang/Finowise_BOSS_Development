/* CHANGING A RECORD THAT IS NOT YOURS — PHASE 1, STEP 2.

   A store is still saved whole (the page's sset), but the server now looks
   at it record by record against its own copy (access-control.js
   mergeWrite). In enforce mode: a record outside your scope cannot be
   changed, a record cannot be moved out of your scope without the reassign
   permission, you cannot create a record for somebody outside your scope,
   records you could not see are kept exactly as they were whatever you
   send, a placeholder is never saved, settings need their capability and
   logs only grow. In report mode the same attempts are saved as before and
   written down as "would-deny". Every refusal is checked to have left the
   server's data unchanged. */
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');

const edit = (list, id, patch) => list.map((r) => (r.id === id ? Object.assign({}, r, patch) : r));
const N = 120;

secSuite(async (t) => {
  const data = seed.build(N);
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const admin = await srv.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const tl = await seed.signIn(admin, 'U-TL');
  const exec = await seed.signIn(admin, 'U-EXEC');
  const aClient = data.clients.find((c) => c.rmName === 'U-RMA').id;
  const bClient = data.clients.find((c) => c.rmName === 'U-RMB').id;
  const serverClients = async () => admin.store('clients', []);
  const reset = async () => { const r = await admin.save('clients', data.clients); if (r.status !== 200) throw new Error('reset ' + r.status); };
  const unchanged = async (label) => {
    const now = await serverClients();
    if (JSON.stringify(now) !== JSON.stringify(data.clients)) throw new Error(label + ': the server copy changed');
  };

  await t.step('an RM may edit their own client', async () => {
    const mine = await rmA.store('clients', []);
    const r = await rmA.save('clients', edit(mine, aClient, { mobile: '9000000002' }));
    const after = (await serverClients()).find((c) => c.id === aClient);
    await reset();
    if (r.status !== 200 || after.mobile !== '9000000002') throw new Error(r.status + ' ' + r.text.slice(0, 160));
    return 'saved; the other ' + (data.clients.length - mine.filter((c) => !c._stub).length) + ' clients RM A cannot see were kept';
  });

  await t.step('an RM cannot edit another RM’s client by putting its id in the payload', async () => {
    const mine = await rmA.store('clients', []);
    /* the forged record takes the place of the placeholder the RM was shown for it (one copy of the id, so the scope rule is what decides) */
    const forged = mine.filter((c) => c.id !== bClient).concat([Object.assign({}, data.clients.find((c) => c.id === bClient), { mobile: '9111111111', cmsName: 'ZZ Hijacked' })]);
    const r = await rmA.save('clients', forged);
    if (r.status !== 403 || !(r.json.reasons || []).includes('edit_outside_scope')) throw new Error(r.status + ' ' + r.text.slice(0, 200));
    await unchanged('forged id');
    return '403 edit_outside_scope; server copy unchanged';
  });

  await t.step('an RM cannot take another RM’s client by changing its owner to themselves', async () => {
    const all = data.clients;            // as if they had the whole store from somewhere
    const r = await rmA.save('clients', edit(all, bClient, { rmName: 'U-RMA' }));
    if (r.status !== 403) throw new Error(r.status + ' ' + r.text.slice(0, 160));
    await unchanged('steal');
    return '403 (' + r.json.reasons.join(',') + ')';
  });

  await t.step('an RM cannot hand their own client to someone outside their scope without the reassign permission', async () => {
    const mine = await rmA.store('clients', []);
    const r = await rmA.save('clients', edit(mine, aClient, { rmName: 'U-RMB' }));
    if (r.status !== 403 || !r.json.reasons.includes('moved_outside_scope')) throw new Error(r.status + ' ' + r.text.slice(0, 160));
    await unchanged('reassign without permission');
    return '403 moved_outside_scope';
  });

  await t.step('a team lead with the reassign permission may move a client within reach and out of it', async () => {
    const theirs = await tl.store('clients', []);
    const r = await tl.save('clients', edit(theirs, aClient, { rmName: 'U-RMC' }));
    const after = (await serverClients()).find((c) => c.id === aClient);
    await reset();
    if (r.status !== 200 || after.rmName !== 'U-RMC') throw new Error(r.status + ' ' + r.text.slice(0, 160));
    return 'saved: reassigned to RM C (branch B)';
  });

  await t.step('an RM cannot create a client owned by another RM', async () => {
    const mine = await rmA.store('clients', []);
    const r = await rmA.save('clients', mine.concat([{ id: 'CMS-ZZNEWB', cmsName: 'ZZ New For B', rmName: 'U-RMB', branch: 'A' }]));
    if (r.status !== 403 || !r.json.reasons.includes('create_outside_scope')) throw new Error(r.status + ' ' + r.text.slice(0, 160));
    await unchanged('create for another');
    return '403 create_outside_scope';
  });

  await t.step('an RM may create their own client; nothing else moves', async () => {
    const mine = await rmA.store('clients', []);
    const r = await rmA.save('clients', mine.concat([{ id: 'CMS-ZZNEWA', cmsName: 'ZZ New For A', rmName: 'U-RMA', branch: 'A' }]));
    const now = await serverClients();
    await reset();
    if (r.status !== 200 || now.length !== data.clients.length + 1 || !now.find((c) => c.id === 'CMS-ZZNEWA')) throw new Error(r.status + ' ' + now.length);
    return 'saved; ' + now.length + ' clients on the server';
  });

  await t.step('leaving out records you cannot see does not remove them', async () => {
    const r = await rmA.save('clients', data.clients.filter((c) => c.rmName === 'U-RMA'));
    const now = await serverClients();
    if (r.status !== 200 || now.length !== data.clients.length) throw new Error(r.status + ' ' + now.length);
    return 'saved own ' + data.clients.filter((c) => c.rmName === 'U-RMA').length + '; server still holds all ' + now.length;
  });

  await t.step('a placeholder sent back is never saved over the real record', async () => {
    const mine = await rmA.store('clients', []);
    const stub = mine.find((c) => c._stub);
    if (!stub) throw new Error('no placeholder to test with');
    const r = await rmA.save('clients', mine);
    const real = (await serverClients()).find((c) => c.id === stub.id);
    if (r.status !== 200 || !real || real._stub || real.cmsName === 'Restricted record' || !real.rmName) throw new Error(JSON.stringify(real));
    return 'the real ' + real.id + ' kept its name and owner';
  });

  await t.step('the answer to a save shows only what the person may read', async () => {
    const mine = await rmA.store('clients', []);
    const r = await rmA.save('clients', mine);
    const echoed = JSON.parse(r.json.value).filter((c) => !c._stub);
    if (echoed.some((c) => c.rmName !== 'U-RMA')) throw new Error('the echo carried another RM’s client');
    return echoed.length + ' clients echoed, all RM A’s';
  });

  await t.step('settings: an Executive with no capability cannot change them; reading is still open', async () => {
    const sops = await exec.store('sops', []);
    const r = await exec.save('sops', sops.map((x) => Object.assign({}, x, { title: 'ZZ Renamed By Exec' })));
    const now = await admin.store('sops', []);
    if (sops.length !== 1 || r.status !== 403 || now[0].title !== 'ZZ Opening an account') throw new Error(r.status + ' ' + JSON.stringify(now));
    const pm = await seed.signIn(admin, 'U-PM');                 // holds an admin flag
    const ok = await pm.save('sops', sops.concat([{ id: 'SOP-ZZ2', title: 'ZZ Second' }]));
    await admin.save('sops', data.sops);
    if (ok.status !== 200) throw new Error('a flag holder was refused: ' + ok.status);
    return 'Executive 403, SOPs unchanged; a member holding an admin flag 200';
  });

  await t.step('the audit log only grows: appending is fine, rewriting or removing a line is refused', async () => {
    const lines = await rmA.store('auditLog', []);
    const ok = await rmA.save('auditLog', lines.concat([{ id: 'AUD-ZZNEW', at: new Date().toISOString(), by: 'U-RMA', module: 'CMS', recordId: aClient, action: 'ZZ new' }]));
    const changed = await rmA.save('auditLog', edit(lines, lines[0].id, { action: 'ZZ rewritten' }));
    const removed = await rmA.save('auditLog', lines.slice(1));
    const now = await admin.store('auditLog', []);
    if (ok.status !== 200 || changed.status !== 403 || removed.status !== 403) throw new Error([ok.status, changed.status, removed.status].join(','));
    if (now.length !== data.auditLog.length + 1 || !now.find((l) => l.id === lines[0].id && l.action === 'ZZ edit')) throw new Error('the log changed: ' + now.length);
    return 'append 200; rewrite 403; remove 403; the other ' + (data.auditLog.length - lines.length) + ' lines RM A cannot see untouched';
  });

  await t.step('the administrator account may change anything', async () => {
    const r = await admin.save('clients', edit(data.clients, bClient, { rmName: 'U-RMC' }));
    await reset();
    if (r.status !== 200) throw new Error(r.status);
    return '200';
  });

  await t.step('every refusal is in the audit trail, with ids and reasons only', async () => {
    const e = ((await admin.get('/api/audit?limit=500')).json.entries || []).filter((x) => x.action === 'store.write' && x.outcome === 'deny');
    const reasons = new Set([].concat(...e.map((x) => String(x.reason).split(','))));
    for (const want of ['edit_outside_scope', 'moved_outside_scope', 'create_outside_scope', 'settings_write_not_allowed', 'log_entry_changed', 'log_entry_removed'])
      if (!reasons.has(want)) throw new Error('missing ' + want + ' in ' + [...reasons]);
    if (/9111111111|ZZ Hijacked|ZZ Renamed/.test(JSON.stringify(e))) throw new Error('record values in the audit trail');
    return e.length + ' refusals recorded: ' + [...reasons].join(', ');
  });

  /* ---- report mode: the runner's server ---- */
  const radmin = await t.admin();
  await seed.load(radmin, data);
  const rA = await seed.signIn(radmin, 'U-RMA');
  await t.step('report mode: the same forged edit is saved as before, and recorded as would-deny', async () => {
    const forged = data.clients.map((c) => (c.id === bClient ? Object.assign({}, c, { mobile: '9222222222' }) : c));
    const r = await rA.save('clients', forged);
    const after = (await radmin.store('clients', [])).find((c) => c.id === bClient);
    const e = ((await radmin.get('/api/audit?limit=200')).json.entries || []).find((x) => x.action === 'store.write' && x.outcome === 'would-deny' && x.target === 'clients');
    if (r.status !== 200 || after.mobile !== '9222222222') throw new Error('report mode changed behaviour: ' + r.status);
    if (!e || !/edit_outside_scope/.test(e.reason) || !(e.ids || []).includes(bClient)) throw new Error(JSON.stringify(e));
    return 'saved (200), and would-deny recorded for ' + bClient;
  });
});

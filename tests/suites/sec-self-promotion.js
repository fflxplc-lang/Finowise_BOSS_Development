/* NOBODY MAKES THEMSELVES AN ADMINISTRATOR: REPORT MODE (STEP 1) AND ENFORCE MODE (STEP 2).

   Before Phase 1 an RM could rewrite their own team record to role Admin,
   scope all, every permission, with one PUT, and the server said 200. The
   rule now lives on the server (access-control.js). In step 1 it runs in
   report mode: the write still goes through exactly as before, and the
   attempt is written to the server's audit trail as "would deny". In
   enforce mode (a second server, at the end) the same attempts are
   refused with 403 and the team record is left exactly as it was.

   Both sides are checked: what must be flagged, and what must not be
   (somebody editing their own phone, a permissions manager doing their
   job, the administrator). */
const { secSuite } = require('../lib/sec-http');

const TEAM = [
  { id: 'U-ADM', name: 'ZZ Firm Admin', role: 'Admin', scope: 'all', status: 'Active' },
  { id: 'U-RMA', name: 'ZZ RM A', role: 'Executive', scope: 'own', branch: 'A', status: 'Active', perms: { CMS: { view: 1, edit: 1 } } },
  { id: 'U-RMB', name: 'ZZ RM B', role: 'Executive', scope: 'own', branch: 'A', status: 'Active', perms: { CMS: { view: 1 } } },
  { id: 'U-PM', name: 'ZZ Permissions', role: 'Manager', scope: 'own', branch: 'A', status: 'Active',
    adminFlags: { managePermissions: 1 }, perms: { Team: { view: 1, edit: 1 } } },
];
const edit = (team, id, patch) => team.map((m) => (m.id === id ? Object.assign({}, m, patch) : m));

secSuite(async (t) => {
  const admin = await t.admin();
  let seeded = await admin.save('team', TEAM);
  if (seeded.status !== 200) throw new Error('could not seed the team: ' + seeded.status);
  const rmA = await t.account(admin, 'U-RMA', 'rma@sec.test', 'Passw0rd-rma-1');
  const pm = await t.account(admin, 'U-PM', 'pm@sec.test', 'Passw0rd-pm-1');
  const audit = async () => ((await admin.get('/api/audit?limit=500')).json || {}).entries || [];
  const allFlagged = async () => (await audit()).filter((e) => e.action === 'store.write' && e.target === 'team' && e.outcome === 'would-deny');
  /* What the action just taken added: entries are read newest first, so the
     new ones are the first (after - before) of the list. */
  const mark = async () => (await allFlagged()).length;
  const flagged = async (before) => { const all = await allFlagged(); return all.slice(0, all.length - before); };
  const reset = async () => { const r = await admin.save('team', TEAM); if (r.status !== 200) throw new Error('reset failed'); };

  await t.step('the server says it is in report mode', async () => {
    const r = await admin.get('/api/access/reconcile');
    if (r.status !== 200 || r.json.mode !== 'report') throw new Error(r.status + ' ' + r.text.slice(0, 200));
    return 'mode: report';
  });

  await t.step('an RM making themselves Admin with scope all is recorded as would-deny', async () => {
    const since = await mark();
    const team = await rmA.store('team', []);
    const r = await rmA.save('team', edit(team, 'U-RMA', { role: 'Admin', scope: 'all', adminFlags: { manageUsers: 1, managePermissions: 1 } }));
    const hits = await flagged(since);
    const hit = hits.find((e) => (e.ids || []).includes('U-RMA'));
    if (!hit) throw new Error('no would-deny entry; entries: ' + JSON.stringify(hits));
    if (!/own_record/.test(hit.reason) || !/admin_role_needs_admin_account/.test(hit.reason) || !/scope_all/.test(hit.reason)) throw new Error('reason: ' + hit.reason);
    if (hit.memberId !== 'U-RMA' || hit.email !== 'rma@sec.test' || hit.mode !== 'report') throw new Error('who: ' + JSON.stringify(hit));
    hit.fields = hit.fields || [];
    /* report mode: behaviour is unchanged, which is the point of report mode */
    if (r.status !== 200) throw new Error('report mode changed the response: ' + r.status);
    const after = (await admin.store('team', [])).find((m) => m.id === 'U-RMA');
    await reset();
    return 'audited (' + hit.reason + '); response still ' + r.status + ', role now ' + after.role + ' — refused in enforce mode below';
  });

  await t.step('an RM raising another member is recorded as would-deny', async () => {
    const since = await mark();
    const team = await rmA.store('team', []);
    await rmA.save('team', edit(team, 'U-RMB', { perms: { CMS: { view: 1, edit: 1, delete: 1 } }, scope: 'branch' }));
    const hit = (await flagged(since)).find((e) => (e.ids || []).includes('U-RMB'));
    await reset();
    if (!hit || !/needs_managePermissions:perms/.test(hit.reason) || !/needs_teamEdit:scope/.test(hit.reason)) throw new Error(JSON.stringify(hit));
    return hit.reason;
  });

  await t.step('an RM editing their own phone number is not flagged', async () => {
    const since = await mark();
    const team = await rmA.store('team', []);
    const r = await rmA.save('team', edit(team, 'U-RMA', { mobile: '9000000001', city: 'Varanasi' }));
    const hits = await flagged(since);
    await reset();
    if (r.status !== 200 || hits.length) throw new Error(r.status + ' ' + JSON.stringify(hits));
    return 'saved, no entry';
  });

  await t.step('a permissions manager granting a module permission to another member is not flagged', async () => {
    const since = await mark();
    const team = await pm.store('team', []);
    await pm.save('team', edit(team, 'U-RMB', { perms: { CMS: { view: 1, edit: 1 } } }));
    const hits = await flagged(since);
    await reset();
    if (hits.length) throw new Error(JSON.stringify(hits));
    return 'no entry';
  });

  await t.step('a permissions manager granting a capability it does not hold, or scope all, is flagged', async () => {
    const since = await mark();
    const team = await pm.store('team', []);
    await pm.save('team', edit(team, 'U-RMB', { adminFlags: { manageModuleSettings: 1 }, scope: 'all' }));
    const hit = (await flagged(since)).find((e) => (e.ids || []).includes('U-RMB'));
    await reset();
    if (!hit || !/grants_flag_not_held/.test(hit.reason) || !/scope_all/.test(hit.reason)) throw new Error(JSON.stringify(hit));
    return hit.reason;
  });

  await t.step('the administrator account changing anyone is not flagged', async () => {
    const since = await mark();
    await admin.save('team', edit(TEAM, 'U-RMB', { role: 'Admin', scope: 'all', adminFlags: { manageUsers: 1 } }));
    const hits = await flagged(since);
    await reset();
    if (hits.length) throw new Error(JSON.stringify(hits));
    return 'no entry';
  });

  await t.step('the audit entries carry no record values', async () => {
    const text = JSON.stringify(await audit());
    const leaks = ['9000000001', 'Varanasi', 'ZZ RM A'].filter((s) => text.includes(s));
    if (leaks.length) throw new Error('leaked: ' + leaks.join(', '));
    return 'ids, field names and reasons only';
  });

  /* ---- enforce mode: a server of its own ---- */
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const a2 = await srv.admin();
  if ((await a2.save('team', TEAM)).status !== 200) throw new Error('could not seed the enforce server');
  const rmA2 = await srv.account(a2, 'U-RMA', 'rma@sec.test', 'Passw0rd-rma-1');
  const pm2 = await srv.account(a2, 'U-PM', 'pm@sec.test', 'Passw0rd-pm-1');
  const teamNow = async () => a2.store('team', []);
  const same = async (label) => { if (JSON.stringify(await teamNow()) !== JSON.stringify(TEAM)) throw new Error(label + ': the team changed'); };

  await t.step('enforce: an RM making themselves Admin with scope all is refused, and nothing changes', async () => {
    const team = await rmA2.store('team', []);
    const r = await rmA2.save('team', edit(team, 'U-RMA', { role: 'Admin', scope: 'all', adminFlags: { manageUsers: 1 } }));
    if (r.status !== 403) throw new Error(r.status + ' ' + r.text.slice(0, 200));
    await same('self-promotion');
    return '403 (' + r.json.reasons.join(',') + '); team unchanged';
  });

  await t.step('enforce: an RM raising another member is refused', async () => {
    const team = await rmA2.store('team', []);
    const r = await rmA2.save('team', edit(team, 'U-RMB', { perms: { CMS: { view: 1, edit: 1, delete: 1 } } }));
    if (r.status !== 403) throw new Error(String(r.status));
    await same('raise another');
    return '403';
  });

  await t.step('enforce: an RM may still edit their own phone number', async () => {
    const team = await rmA2.store('team', []);
    const r = await rmA2.save('team', edit(team, 'U-RMA', { mobile: '9000000003' }));
    const now = (await teamNow()).find((m) => m.id === 'U-RMA');
    await a2.save('team', TEAM);
    if (r.status !== 200 || now.mobile !== '9000000003' || now.role !== 'Executive') throw new Error(r.status + ' ' + JSON.stringify(now));
    return '200; role unchanged';
  });

  await t.step('enforce: a permissions manager may grant a module permission, but not a capability it lacks or scope all', async () => {
    const team = await pm2.store('team', []);
    const ok = await pm2.save('team', edit(team, 'U-RMB', { perms: { CMS: { view: 1, edit: 1 } } }));
    await a2.save('team', TEAM);
    const team2 = await pm2.store('team', []);
    const bad = await pm2.save('team', edit(team2, 'U-RMB', { adminFlags: { manageModuleSettings: 1 } }));
    const bad2 = await pm2.save('team', edit(team2, 'U-RMB', { scope: 'all' }));
    if (ok.status !== 200 || bad.status !== 403 || bad2.status !== 403) throw new Error([ok.status, bad.status, bad2.status].join(','));
    await same('permissions manager');
    return 'module permission 200; capability not held 403; scope all 403';
  });

  await t.step('enforce: the administrator account may change anyone', async () => {
    const r = await a2.save('team', edit(TEAM, 'U-RMB', { role: 'Admin', scope: 'all' }));
    await a2.save('team', TEAM);
    if (r.status !== 200) throw new Error(String(r.status));
    return '200';
  });
});

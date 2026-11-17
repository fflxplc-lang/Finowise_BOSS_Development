/* NOBODY MAKES THEMSELVES AN ADMINISTRATOR: STEP 1, REPORT MODE.

   Before Phase 1 an RM could rewrite their own team record to role Admin,
   scope all, every permission, with one PUT, and the server said 200. The
   rule now lives on the server (access-control.js). In step 1 it runs in
   report mode: the write still goes through exactly as before, and the
   attempt is written to the server's audit trail as "would deny". Step 2
   turns the same rule into a refusal and this suite's assertions with it.

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
  const allFlagged = async () => (await audit()).filter((e) => e.action === 'team.write' && e.outcome === 'would-deny');
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
    /* report mode: behaviour is unchanged, which is the point of report mode */
    if (r.status !== 200) throw new Error('report mode changed the response: ' + r.status);
    const after = (await admin.store('team', [])).find((m) => m.id === 'U-RMA');
    await reset();
    return 'audited (' + hit.fields.join(',') + '; ' + hit.reason + '); response still ' + r.status + ', role now ' + after.role + ' — refused from step 2';
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
});

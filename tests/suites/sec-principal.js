/* WHO IS ASKING, WORKED OUT ON THE SERVER: THE RULES THEMSELVES.

   access-control.js is the server's copy of the page's can(),
   visibleRecords() and role helpers. These are unit checks against a
   store held in memory: no server, no browser, so a wrong answer can
   only be the rule. Also the audit trail's promise that it never writes
   a PAN, an Aadhaar number or a mobile number. Phase 1, step 1. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const AC = require('../../access-control');
const AL = require('../../audit-log');

function make(storeObj, env) {
  const raw = {};
  Object.keys(storeObj).forEach((k) => { raw[k] = JSON.stringify(storeObj[k]); });
  const memberOfUser = (u) => {
    const team = storeObj.team || [];
    return team.find((t) => t.id === u.member_id) || team.find((t) => t.email && u.email && t.email.toLowerCase() === u.email.toLowerCase()) || null;
  };
  return { ac: AC.create({ storeRaw: (k) => raw[k], memberOfUser, env: env || {}, warn: () => {} }), raw };
}

const TEAM = [
  { id: 'U-ADM', name: 'Firm Admin', role: 'Admin', scope: 'all' },
  { id: 'U-BM', name: 'Branch Mgr', role: 'Manager', scope: 'branch', branch: 'A', perms: { CMS: { view: 1, edit: 1 } } },
  { id: 'U-TL', name: 'Team Lead', role: 'Senior Manager', scope: 'team', branch: 'A', perms: { CMS: { view: 1 } } },
  { id: 'U-R1', name: 'RM One', role: 'Executive', scope: 'own', branch: 'A', parentUserId: 'U-TL', perms: { CMS: { view: 1 } } },
  { id: 'U-R2', name: 'RM Two', role: 'Executive', scope: 'own', branch: 'A', parentUserId: 'U-R1', perms: { CMS: { view: 1 } } },
  { id: 'U-R3', name: 'RM Three', role: 'Executive', scope: 'own', branch: 'B', perms: {} },
  { id: 'U-NR', name: 'No Role', scope: 'own', email: 'norole@x.test' },
  { id: 'U-PM', name: 'Perm Mgr', role: 'Manager', scope: 'own', adminFlags: { managePermissions: 1 }, perms: { Team: { edit: 1 } } },
];
const user = (id, role, memberId, email) => ({ id, role: role || 'user', member_id: memberId || '', email: email || id + '@x.test' });

secSuite(async (t) => {
  const { ac } = make({ team: TEAM, config: { moduleRoles: { Calls: ['Manager'] } } });

  await t.step('admin comes only from the sign-in account', async () => {
    const a = ac.principal(user(1, 'admin', ''));
    const teamAdmin = ac.principal(user(2, 'user', 'U-ADM'));
    if (!a.admin || a.linked) throw new Error('account admin without a member: ' + JSON.stringify(a));
    if (teamAdmin.admin || !teamAdmin.teamAdmin) throw new Error('team Admin role became an account admin');
    return 'account admin → admin; team role Admin → teamAdmin only';
  });

  await t.step('the member is the server copy, by id then by email; nobody else is picked', async () => {
    const byEmail = ac.principal(user(3, 'user', '', 'norole@x.test'));
    const nobody = ac.principal(user(4, 'user', 'U-GONE', 'stranger@x.test'));
    if (byEmail.memberId !== 'U-NR') throw new Error('email match failed');
    if (nobody.linked || nobody.memberId || nobody.scope !== 'none') throw new Error('an unknown account was given a member: ' + JSON.stringify(nobody));
    return 'U-NR found by email; an unknown account is linked to nobody (no team[0] fallback)';
  });

  await t.step('a member with no role gets the most junior role, never Admin', async () => {
    const p = ac.principal(user(5, 'user', 'U-NR'));
    if (p.role !== 'Executive' || p.teamAdmin) throw new Error('role ' + p.role);
    const empty = make({ team: TEAM, config: { roles: ['Admin', 'Partner', 'Intern'] } }).ac.principal(user(5, 'user', 'U-NR'));
    if (empty.role === 'Admin') throw new Error('custom role list gave Admin');
    return 'Executive; with a custom list: ' + empty.role;
  });

  await t.step("can() matches the page's rule", async () => {
    const r1 = ac.principal(user(6, 'user', 'U-R1'));
    const bm = ac.principal(user(7, 'user', 'U-BM'));
    const nobody = ac.principal(user(8, 'user', 'U-GONE'));
    const cases = [
      [ac.can(r1, 'CMS', 'view'), true, 'ticked view'],
      [ac.can(r1, 'CMS', 'edit'), false, 'unticked edit'],
      [ac.can(r1, 'CMS', 'changeStage'), true, 'changeStage is on unless taken away'],
      [ac.can(r1, 'Calls', 'view'), false, 'module closed to the role'],
      [ac.can(bm, 'Calls', 'view'), false, 'module open to Manager but view not ticked'],
      [ac.can(ac.principal(user(9, 'user', 'U-ADM')), 'Calls', 'delete'), true, 'team Admin: full module access, as the page'],
      [ac.can(nobody, 'CMS', 'view'), false, 'unlinked account'],
      [ac.can(r1, 'AMC', 'view'), false, 'AMC is filed under Masters'],
    ];
    const bad = cases.filter(([got, want]) => got !== want);
    if (bad.length) throw new Error(bad.map((c) => c[2] + ': got ' + c[0]).join('; '));
    return cases.length + ' cases agree';
  });

  await t.step("inScope() matches the page's visibleRecords()", async () => {
    const P = (m) => ac.principal(user(10, 'user', m));
    const cases = [
      [ac.inScope(P('U-R1'), 'U-R1', 'A'), true, 'own'],
      [ac.inScope(P('U-R1'), 'U-R2', 'A'), false, 'own scope, another RM'],
      [ac.inScope(P('U-TL'), 'U-R2', 'A'), true, 'team scope reaches two levels down'],
      [ac.inScope(P('U-TL'), 'U-R3', 'B'), false, 'team scope, outside the chain'],
      [ac.inScope(P('U-BM'), 'U-R3', 'A'), true, 'branch scope by the record branch'],
      [ac.inScope(P('U-BM'), 'U-R1', 'B'), false, 'branch scope, other branch'],
      [ac.inScope(P('U-ADM'), 'anyone', 'Z'), true, 'team Admin sees all records, as the page'],
      [ac.inScope(P('U-GONE'), '', ''), false, 'unlinked account sees nothing'],
    ];
    const bad = cases.filter(([got, want]) => got !== want);
    if (bad.length) throw new Error(bad.map((c) => c[2] + ': got ' + c[0]).join('; '));
    return cases.length + ' cases agree';
  });

  await t.step('the team rule: nobody raises their own access', async () => {
    const r1 = ac.principal(user(11, 'user', 'U-R1'));
    const after = TEAM.map((m) => m.id === 'U-R1' ? Object.assign({}, m, { role: 'Admin', scope: 'all', perms: { CMS: { view: 1, edit: 1, delete: 1 } } }) : m);
    const v = ac.teamViolations(r1, TEAM, after);
    if (v.length !== 1 || !/own_record/.test(v[0].reason) || !/admin_role/.test(v[0].reason) || !/scope_all/.test(v[0].reason))
      throw new Error(JSON.stringify(v));
    const phone = TEAM.map((m) => m.id === 'U-R1' ? Object.assign({}, m, { mobile: '9000000001' }) : m);
    if (ac.teamViolations(r1, TEAM, phone).length) throw new Error('own phone change was flagged');
    return 'role/scope/perms on own record flagged (' + v[0].fields.join(',') + '); own phone allowed';
  });

  await t.step('the team rule: a permissions manager, within limits', async () => {
    const pm = ac.principal(user(12, 'user', 'U-PM'));
    const perms = TEAM.map((m) => m.id === 'U-R3' ? Object.assign({}, m, { perms: { CMS: { view: 1 } } }) : m);
    const flag = TEAM.map((m) => m.id === 'U-R3' ? Object.assign({}, m, { adminFlags: { manageUsers: 1 } }) : m);
    const all = TEAM.map((m) => m.id === 'U-R3' ? Object.assign({}, m, { scope: 'all' }) : m);
    const own = TEAM.map((m) => m.id === 'U-PM' ? Object.assign({}, m, { adminFlags: { managePermissions: 1, manageUsers: 1 } }) : m);
    const removed = TEAM.filter((m) => m.id !== 'U-R3');
    const got = {
      perms: ac.teamViolations(pm, TEAM, perms).length,
      flag: (ac.teamViolations(pm, TEAM, flag)[0] || {}).reason || '',
      all: (ac.teamViolations(pm, TEAM, all)[0] || {}).reason || '',
      own: (ac.teamViolations(pm, TEAM, own)[0] || {}).reason || '',
      removed: (ac.teamViolations(pm, TEAM, removed)[0] || {}).reason || '',
    };
    if (got.perms !== 0 || !/grants_flag_not_held/.test(got.flag) || !/scope_all/.test(got.all) || !/own_record/.test(got.own) || !/teamDelete/.test(got.removed))
      throw new Error(JSON.stringify(got));
    return "grants CMS view to another: allowed; a flag it doesn't hold, scope all, its own flags, removing a member: flagged";
  });

  await t.step('an account admin may change anything', async () => {
    const a = ac.principal(user(13, 'admin', ''));
    const wild = TEAM.map((m) => Object.assign({}, m, { role: 'Admin', scope: 'all', adminFlags: { manageUsers: 1 } }));
    if (ac.teamViolations(a, TEAM, wild).length) throw new Error('admin was flagged');
    return 'no violations';
  });

  await t.step('modes: report by default; the unscoped switch needs both settings', async () => {
    const one = make({ team: TEAM }, { CRM_SCOPED_STORAGE: 'off' }).ac;
    const both = make({ team: TEAM }, { CRM_SCOPED_STORAGE: 'off', CRM_ALLOW_UNSCOPED: 'yes-i-understand' }).ac;
    const enf = make({ team: TEAM }, { CRM_ACCESS_MODE: 'enforce' }).ac;
    const odd = make({ team: TEAM }, { CRM_ACCESS_MODE: 'off' }).ac;
    if (ac.MODE !== 'report' || one.UNSCOPED || !both.UNSCOPED || enf.MODE !== 'enforce' || odd.MODE !== 'report')
      throw new Error(JSON.stringify({ d: ac.MODE, one: one.UNSCOPED, both: both.UNSCOPED, enf: enf.MODE, odd: odd.MODE }));
    return 'default report; one switch ignored; both switches → unscoped; enforce; an unknown value → report';
  });

  await t.step('a write to the store is seen at once (cache keyed on the raw value)', async () => {
    const s = { team: TEAM.slice() };
    const { ac: live, raw } = make(s);
    const before = live.principal(user(14, 'user', 'U-R1')).scope;
    s.team = TEAM.map((m) => m.id === 'U-R1' ? Object.assign({}, m, { scope: 'branch' }) : m);
    raw.team = JSON.stringify(s.team);
    const after = live.principal(user(14, 'user', 'U-R1')).scope;
    if (before !== 'own' || after !== 'branch') throw new Error(before + ' → ' + after);
    return 'own → branch without a restart';
  });

  await t.step('the audit trail never writes a PAN, an Aadhaar number or a mobile number', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-audit-'));
    const log = AL.create({ dir });
    log.append({ action: 'x', reason: 'pan ABCDE1234F aadhaar 2345 6789 0123 mobile 9876543210 +91 9876543211',
      ids: ['ZZZPZ9999Z'], fields: ['pan'], secret: 'sk-should-not-appear', body: 'mail body' });
    const text = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    const leaks = ['ABCDE1234F', '2345 6789 0123', '9876543210', '9876543211', 'ZZZPZ9999Z', 'sk-should-not-appear', 'mail body'].filter((s) => text.includes(s));
    if (leaks.length) throw new Error('leaked: ' + leaks.join(', '));
    const entry = log.read(5)[0];
    if (!entry || entry.action !== 'x' || entry.fields[0] !== 'pan' || 'secret' in entry || 'body' in entry) throw new Error(JSON.stringify(entry));
    fs.rmSync(dir, { recursive: true, force: true });
    return 'values redacted, unknown keys dropped, field names kept';
  });

  await t.step('the audit trail only ever appends', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-audit-'));
    const log = AL.create({ dir });
    for (let i = 0; i < 5; i++) log.append({ action: 'n' + i });
    const lines = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('').split('\n').filter(Boolean);
    const newest = log.read(2).map((e) => e.action).join(',');
    fs.rmSync(dir, { recursive: true, force: true });
    if (lines.length !== 5 || newest !== 'n4,n3') throw new Error(lines.length + ' lines; newest ' + newest);
    return '5 appends → 5 lines, read newest first';
  });

  /* ---- step 2: the store rules, without a server ---- */
  const S2 = {
    team: TEAM.concat([{ id: 'U-HRA', name: 'HR Admin', role: 'Executive', scope: 'own', hrAccess: { admin: 1 } }]),
    hrLeave: [{ id: 'L1', userId: 'U-R1', approverId: 'U-TL' }, { id: 'L2', userId: 'U-R3', approverId: 'U-BM' }],
    notifications: [{ id: 'N1', userId: 'U-R1', by: 'U-TL' }, { id: 'N2', userId: 'U-R2', by: 'U-TL' }],
    auditLog: [{ id: 'A1', by: 'U-R2', module: 'CMS', recordId: 'C1' }, { id: 'A2', by: 'U-R3', module: 'CMS', recordId: 'C3' }],
    clients: [{ id: 'C1', rmName: 'U-R1', branch: 'A' }, { id: 'C3', rmName: 'U-R3', branch: 'B' }],
    settingsAudit: [{ id: 'S1', by: 'U-ADM' }],
    apiInbox: [{ id: 'Q1' }],
    sops: [{ id: 'P1' }],
  };
  const { ac: a2, raw: r2 } = make(S2);
  const P2 = (m) => a2.principal(user(20, 'user', m));
  const readIds = (p, key) => { const v = a2.readView(p, key, r2[key]); return v.refused ? 'refused' : JSON.parse(v.value).map((x) => x.id).join(','); };

  await t.step('HR leave: own, the approver, HR, and nobody else', async () => {
    const got = { r1: readIds(P2('U-R1'), 'hrLeave'), tl: readIds(P2('U-TL'), 'hrLeave'), r2: readIds(P2('U-R2'), 'hrLeave'), hr: readIds(P2('U-HRA'), 'hrLeave') };
    if (got.r1 !== 'L1' || got.tl !== 'L1' || got.r2 !== '' || got.hr !== 'L1,L2') throw new Error(JSON.stringify(got));
    return JSON.stringify(got);
  });

  await t.step('notifications: only your own to read, but anyone may send one to somebody else', async () => {
    const r1 = P2('U-R1');
    if (readIds(r1, 'notifications') !== 'N1') throw new Error(readIds(r1, 'notifications'));
    const sent = a2.mergeWrite(r1, 'notifications', r2.notifications, [{ id: 'N1', userId: 'U-R1', by: 'U-TL' }, { id: 'N3', userId: 'U-R3', by: 'U-R1' }]);
    const edited = a2.mergeWrite(r1, 'notifications', r2.notifications, JSON.parse(r2.notifications).map((n) => n.id === 'N2' ? Object.assign({}, n, { read: true }) : n));
    if (sent.violations.length || !edited.violations.some((v) => v.reason === 'edit_outside_scope')) throw new Error(JSON.stringify({ sent: sent.violations, edited: edited.violations }));
    if (sent.value.length !== 3) throw new Error('the merge lost a notification: ' + sent.value.length);
    return 'reads N1 only; sending N3 to RM Three allowed; marking RM Two’s as read refused';
  });

  await t.step('the audit log: lines about records you can see, your own lines; settings history for flag holders', async () => {
    const got = { r1: readIds(P2('U-R1'), 'auditLog'), r3: readIds(P2('U-R3'), 'auditLog'), sa_r1: readIds(P2('U-R1'), 'settingsAudit'), sa_pm: readIds(P2('U-PM'), 'settingsAudit') };
    if (got.r1 !== 'A1' || got.r3 !== 'A2' || got.sa_r1 !== '' || got.sa_pm !== 'S1') throw new Error(JSON.stringify(got));
    return JSON.stringify(got);
  });

  await t.step('system queues and unknown stores', async () => {
    const r1 = P2('U-R1');
    const q = readIds(r1, 'apiInbox');
    const unknown = a2.readView(r1, 'zzNoRule', '[{"id":"X"}]');
    const unknownW = a2.mergeWrite(r1, 'zzNoRule', '[]', [{ id: 'X' }]);
    const sops = a2.mergeWrite(r1, 'sops', r2.sops, [{ id: 'P1', title: 'changed' }]);
    if (q !== '' || !unknown.refused || !unknownW.violations.length || !sops.violations.length) throw new Error(JSON.stringify({ q, unknown, unknownW, sops: sops.violations }));
    return 'API inbox closed to an RM; a store with no rule refused both ways; SOP edit without a flag refused';
  });

  await t.step('a team write keeps private fields the writer could not see', async () => {
    const team = [{ id: 'U-R1', name: 'RM One', panNumber: 'ZZZPA1111A', monthlySalary: 5 }, { id: 'U-R2', name: 'RM Two', panNumber: 'ZZZPB2222B', monthlySalary: 6 }];
    const { ac: a3 } = make({ team });
    const p = a3.principal(user(30, 'user', 'U-R1'));
    const seen = JSON.parse(a3.readView(p, 'team', JSON.stringify(team)).value);
    const out = a3.mergeWrite(p, 'team', JSON.stringify(team), seen.map((m) => m.id === 'U-R1' ? Object.assign({}, m, { phone: '9000000004' }) : m));
    const r2v = out.value.find((m) => m.id === 'U-R2');
    if (seen.find((m) => m.id === 'U-R2').panNumber || r2v.panNumber !== 'ZZZPB2222B' || r2v.monthlySalary !== 6) throw new Error(JSON.stringify(out.value));
    return "RM Two's PAN and salary hidden on read, and kept on save";
  });

  await t.step('the wipe guard: two or more removed into empty, or over max(5, 10%); queues and upload rows exempt', async () => {
    const { ac: a4 } = make({ team: TEAM });
    const adm = a4.principal(user(40, 'admin', ''));
    const rm = a4.principal(user(41, 'user', 'U-R1'));
    const list = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: 'R' + i })));
    const cases = [
      [a4.shrinkCheck(rm, 'leads', list(1), [], undefined), null, 'last single record'],
      [!!a4.shrinkCheck(rm, 'leads', list(2), [], undefined), true, 'emptying two'],
      [a4.shrinkCheck(rm, 'leads', list(100), JSON.parse(list(100)).slice(10), undefined), null, 'removing 10 of 100 (the limit)'],
      [!!a4.shrinkCheck(rm, 'leads', list(100), JSON.parse(list(100)).slice(11), undefined), true, 'removing 11 of 100'],
      [!!a4.shrinkCheck(rm, 'leads', list(100), [{ id: 'NEW' }], undefined), true, 'a near-wipe with one new record'],
      [a4.shrinkCheck(adm, 'leads', list(100), [], '100'), null, 'administrator confirming 100'],
      [!!a4.shrinkCheck(adm, 'leads', list(100), [], '99'), true, 'administrator confirming too few'],
      [!!a4.shrinkCheck(rm, 'leads', list(100), [], '100'), true, 'an RM confirming'],
      [a4.shrinkCheck(rm, 'apiInbox', list(50), [], undefined), null, 'a queue drained'],
      [a4.shrinkCheck(rm, 'maRows.U1', list(50), [], undefined), null, 'per-upload rows replaced'],
      [a4.shrinkCheck(rm, 'aumMonthly', JSON.stringify([{ m: 1 }, { m: 2 }, { m: 3 }]), [{ m: 1 }, { m: 2 }, { m: 4 }], undefined), null, 'a list without ids rebuilt in place'],
      [!!a4.shrinkCheck(rm, 'settings', JSON.stringify({ a: 1, b: 2 }), {}, undefined), true, 'an object store with two keys emptied'],
      [a4.shrinkCheck(rm, 'settings', JSON.stringify({ a: 1 }), {}, undefined), null, 'an object store with one key emptied (same rule as a last record)'],
    ];
    const bad = cases.filter(([got, want]) => got !== want);
    if (bad.length) throw new Error(bad.map((c) => c[2]).join('; '));
    return cases.length + ' cases agree';
  });
});

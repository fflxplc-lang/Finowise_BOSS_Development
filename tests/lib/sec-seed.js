/* SYNTHETIC DATA FOR THE PHASE 1 STORE SUITES.

   Nothing here is a real person or a real client: every name starts "ZZ",
   every PAN starts ZZZ, every email is @sec.test. The team covers every kind
   of scope the page knows (own, team, branch, all), two branches, a reporting
   line two levels deep, an Admin by team role only, HR, and a permissions
   manager. The records are spread over them so that each rule has something
   to say yes and no to, including the awkward cases: a task given to a
   colleague, holdings imported by one RM for another's client, a call with
   no "logged by", a reply to a query, private fields on a team record.

     const seed = require('../lib/sec-seed');
     const data = seed.build(400);      // N clients; everything else scales from it
     await seed.load(admin, data);      // PUT every store, as the administrator
     const rmA = await seed.signIn(admin, 'U-RMA');
*/
const { account } = require('./sec-http');

const TEAM = [
  { id: 'U-ADM', name: 'ZZ Firm Admin', role: 'Admin', scope: 'all', branch: 'A', status: 'Active' },
  { id: 'U-TADM', name: 'ZZ Team Admin', role: 'Admin', scope: 'all', branch: 'A', status: 'Active' },
  { id: 'U-BMA', name: 'ZZ Branch Mgr A', role: 'Manager', scope: 'branch', branch: 'A', status: 'Active',
    perms: { CMS: { view: 1, edit: 1, create: 1 }, LMS: { view: 1, edit: 1 }, Team: { view: 1 } } },
  { id: 'U-TL', name: 'ZZ Team Lead', role: 'Senior Manager', scope: 'team', branch: 'A', status: 'Active',
    perms: { CMS: { view: 1, edit: 1, reassign: 1 }, LMS: { view: 1, edit: 1 } } },
  { id: 'U-RMA', name: 'ZZ RM A', role: 'Executive', scope: 'own', branch: 'A', parentUserId: 'U-TL', status: 'Active',
    perms: { CMS: { view: 1, edit: 1, create: 1, delete: 1 }, LMS: { view: 1, edit: 1, create: 1 }, DST: { view: 1, edit: 1, create: 1 },
      Meetings: { view: 1, edit: 1, create: 1 }, Transactions: { view: 1 } },
    panNumber: 'ZZZPA1111A', bankAccountNumber: '000011112222', monthlySalary: 50000 },
  { id: 'U-RMB', name: 'ZZ RM B', role: 'Executive', scope: 'own', branch: 'A', parentUserId: 'U-TL', status: 'Active',
    perms: { CMS: { view: 1, edit: 1 }, LMS: { view: 1 } },
    panNumber: 'ZZZPB2222B', bankAccountNumber: '000033334444', monthlySalary: 60000 },
  { id: 'U-RMC', name: 'ZZ RM C', role: 'Executive', scope: 'own', branch: 'B', status: 'Active', perms: { CMS: { view: 1, edit: 1 } } },
  { id: 'U-EXEC', name: 'ZZ Executive', role: 'Executive', scope: 'own', branch: 'A', status: 'Active', perms: {} },
  { id: 'U-ALL', name: 'ZZ Ops Head', role: 'Manager', scope: 'all', branch: 'A', status: 'Active', perms: { CMS: { view: 1 } } },
  { id: 'U-HR', name: 'ZZ HR', role: 'Executive', scope: 'own', branch: 'A', status: 'Active', hrAccess: { admin: 1 } },
  { id: 'U-PM', name: 'ZZ Permissions', role: 'Manager', scope: 'own', branch: 'A', status: 'Active',
    adminFlags: { managePermissions: 1 }, perms: { Team: { view: 1, edit: 1 } } },
  /* U-OPS holds Manage module settings: today it may also test and remove connectors in the page. */
  { id: 'U-OPS', name: 'ZZ Ops Settings', role: 'Manager', scope: 'own', branch: 'A', status: 'Active', adminFlags: { manageModuleSettings: 1 }, perms: {} },
];
/* Who owns records in each branch, in turn. */
const OWNERS_A = ['U-RMA', 'U-RMB', 'U-TL', 'U-BMA'];
const OWNERS_B = ['U-RMC'];

function build(n) {
  n = n || 400;
  const at = '2026-10-01T10:00:00.000Z';
  /* a team member's own email, as the Team Members screen records it (the same as their sign-in) */
  const d = { team: JSON.parse(JSON.stringify(TEAM)).map((m) => Object.assign({ email: email(m.id) }, m)), clients: [], leads: [], tasks: [], meetings: [], transactions: [],
    platformHoldings: [], platformSips: [], reviews: [], queries: [], queryReplies: [], callEntries: [], businessEntries: [],
    recommendations: [], projects: [], projectClients: [], projectTasks: [], partners: [], campaigns: [], campaignRecipients: [],
    communications: [], clientDocuments: [], moms: [], insPolicies: [], docLinks: [], auditLog: [], settingsAudit: [],
    hrLeave: [], hrAttendance: [], notifications: [], amcs: [], sops: [] };
  /* config is deliberately not seeded: the page builds its defaults into it on
     first load, and a partial config breaks that (see the AUM harness notes). */
  for (let i = 0; i < n; i++) {
    const branchB = i % 5 === 4;
    const owners = branchB ? OWNERS_B : OWNERS_A;
    const rm = owners[i % owners.length];
    const branch = branchB ? 'B' : 'A';
    const id = 'CMS-ZZ' + i;
    const client = { id, cmsName: 'ZZ Client ' + i, rmName: rm, branch, email: 'client' + i + '@sec.test', pan: 'ZZZPC' + String(1000 + (i % 9000)).padStart(4, '0') + 'C', createdAt: at };
    /* PANs where a field list would not think to look: a family member, a nominee */
    if (i % 4 === 0) client.familyMembers = [{ name: 'ZZ Spouse ' + i, relation: 'Spouse', pan: 'ZZZPF' + String(1000 + (i % 9000)).padStart(4, '0') + 'F' }];
    if (i % 8 === 0) client.nominees = [{ name: 'ZZ Nominee ' + i, share: '100', pan: 'ZZZPN' + String(1000 + (i % 9000)).padStart(4, '0') + 'N' }];
    d.clients.push(client);
    if (i % 2 === 0) d.leads.push({ id: 'LMS-ZZ' + i, leadName: 'ZZ Lead ' + i, assignedTo: rm, branch, createdAt: at,
      pan: 'ZZZPL' + String(1000 + (i % 9000)).padStart(4, '0') + 'L' });
    if (i % 3 === 0) d.tasks.push({ id: 'TSK-ZZ' + i, clientId: id, assignTo: rm, createdBy: rm, overallStatus: 'Not Started' });
    if (i % 10 === 1) d.tasks.push({ id: 'TSK-ZZG' + i, clientId: id, assignTo: branchB ? 'U-RMC' : 'U-RMB', createdBy: 'U-RMA', overallStatus: 'Not Started' });
    if (i % 4 === 0) d.meetings.push({ id: 'MTG-ZZ' + i, clientId: id, assignTo: rm, createdBy: rm, status: 'Scheduled' });
    if (i % 3 !== 2) d.transactions.push({ id: 'TXN-ZZ' + i, clientId: id, rmName: rm, status: 'Completed', transactionType: 'Purchase', amount: 1000 + i });
    if (i % 3 === 1) d.platformHoldings.push({ id: 'PFH-ZZ' + i, clientId: id, current: String(5000 + i), importedBy: i % 9 === 1 ? 'U-RMA' : 'U-ADM', branch, reportAsOn: '2026-10-31' });
    if (i % 6 === 2) d.platformSips.push({ id: 'PFS-ZZ' + i, clientId: id, amount: '1000', importedBy: 'U-ADM', branch });
    if (i % 5 === 0) d.reviews.push({ id: 'RMS-ZZ' + i, clientId: id, assignTo: i % 10 === 0 ? '' : rm, branch: '' });
    if (i % 7 === 0) {
      d.queries.push({ id: 'QRY-ZZ' + i, clientId: id, assignTo: '', subject: 'ZZ query' });
      d.queryReplies.push({ id: 'QRP-ZZ' + i, queryId: 'QRY-ZZ' + i, by: rm, text: 'ZZ reply' });
    }
    if (i % 3 === 0) d.callEntries.push({ id: 'CAL-ZZ' + i, clientId: id, loggedBy: i % 9 === 0 ? '' : rm, createdBy: rm, branch });
    if (i % 6 === 0) d.businessEntries.push({ id: 'DBT-ZZ' + i, clientId: id, createdBy: rm, amount: 500 });
    if (i % 8 === 0) d.recommendations.push({ id: 'REC-ZZ' + i, clientId: id, createdBy: rm, assignTo: rm });
    if (i % 4 === 0) d.communications.push({ id: 'COM-ZZ' + i, clientId: id, by: rm, branch, subject: 'ZZ mail' });
    if (i % 7 === 0) d.clientDocuments.push({ id: 'DOC-ZZ' + i, clientId: id, kind: 'KYC', name: 'zz.pdf' });
    if (i % 10 === 5) d.moms.push({ id: 'MOM-ZZ' + i, clientId: id, by: rm });
    if (i % 12 === 6) d.insPolicies.push({ id: 'INS-ZZ' + i, clientId: id, createdBy: rm });
    if (i % 11 === 0) d.docLinks.push({ id: 'DLK-ZZ' + i, clientId: id, createdBy: rm });
    if (i % 5 === 1) d.auditLog.push({ id: 'AUD-ZZ' + i, at, by: rm, module: 'CMS', recordId: id, action: 'ZZ edit',
      details: [{ field: 'PAN', oldValue: 'ZZZPO' + String(1000 + (i % 9000)).padStart(4, '0') + 'O', newValue: client.pan }] });
  }
  ['A', 'B'].forEach((b, k) => {
    const owner = b === 'A' ? 'U-RMA' : 'U-RMC';
    d.projects.push({ id: 'PRJ-ZZ' + b, name: 'ZZ Project ' + b, owner, branch: b });
    d.projectClients.push({ id: 'PCL-ZZ' + b, projectId: 'PRJ-ZZ' + b, clientId: b === 'A' ? 'CMS-ZZ1' : 'CMS-ZZ4' });
    d.projectTasks.push({ id: 'PTK-ZZ' + b, projectId: 'PRJ-ZZ' + b, assignTo: owner });
    d.partners.push({ id: 'PRT-ZZ' + b, name: 'ZZ Partner ' + b, createdBy: owner, branch: b });
    d.campaigns.push({ id: 'CMP-ZZ' + b, name: 'ZZ Campaign ' + b, createdBy: owner, branch: b });
    d.campaignRecipients.push({ id: 'CRC-ZZ' + b + k, campaignId: 'CMP-ZZ' + b, clientId: 'CMS-ZZ' + k });
  });
  d.settingsAudit.push({ id: 'SAU-ZZ1', at, by: 'U-ADM', field: 'ZZ setting' });
  d.hrLeave.push({ id: 'LVE-ZZA', userId: 'U-RMA', approverId: 'U-TL', status: 'Pending', from: '2026-12-01', to: '2026-12-01' });
  d.hrLeave.push({ id: 'LVE-ZZB', userId: 'U-RMB', approverId: 'U-BMA', status: 'Pending', from: '2026-12-02', to: '2026-12-02' });
  d.hrAttendance.push({ id: 'ATT-ZZA', userId: 'U-RMA', date: '2026-11-02', punchIn: '2026-11-02T09:00:00.000Z' });
  d.notifications.push({ id: 'NTF-ZZA', userId: 'U-RMA', title: 'ZZ for A', by: 'U-TL', at });
  d.notifications.push({ id: 'NTF-ZZB', userId: 'U-RMB', title: 'ZZ for B', by: 'U-TL', at });
  d.amcs.push({ id: 'AMC-ZZ1', name: 'ZZ AMC' });
  d.sops.push({ id: 'SOP-ZZ1', title: 'ZZ Opening an account' });
  return d;
}

/* HR stores have server rules of their own (attendance is append-only and
   checked against the punch rules; leave is checked for overlaps), so they
   are exercised by the unit cases in sec-principal, not seeded over HTTP. */
const NOT_SEEDED = new Set(['hrLeave', 'hrAttendance']);
async function load(admin, d) {
  for (const k of Object.keys(d)) {
    if (NOT_SEEDED.has(k)) continue;
    const r = await admin.save(k, d[k]);
    if (r.status !== 200) throw new Error('seeding ' + k + ' failed: ' + r.status + ' ' + r.text.slice(0, 200));
  }
}

const password = (id) => 'Passw0rd-' + id.toLowerCase();
const email = (id) => id.toLowerCase().replace(/[^a-z0-9]/g, '') + '@sec.test';
async function signIn(admin, id) {
  try { return await account(admin, id, email(id), password(id)); }
  catch (e) {                                     // already made earlier in this suite: just sign in
    const { login } = require('./sec-http');
    return login(email(id), password(id), admin.base);
  }
}

module.exports = { TEAM, build, load, signIn, email };

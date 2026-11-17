/* WHAT EACH PERSON MAY READ OF A STORE — PHASE 1, STEP 2.

   Before Phase 1 GET /api/storage/<store> handed the whole store to anyone
   signed in. The server now works out, record by record, what the page
   itself would show that person (access-control.js readView), and:
     report mode (the default, and the runner's server): serves the store
       as before and writes "would-scope" with a count in the audit trail;
     enforce mode (a second server started here): serves only that.
   Each case is checked both ways: what must come back, and what must not. */
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');

const ids = (list) => new Set(list.filter((r) => !r._stub).map((r) => r.id));
const N = 200;

secSuite(async (t) => {
  const data = seed.build(N);
  const truth = (fn) => new Set(data.clients.filter(fn).map((c) => c.id));

  /* ---- enforce mode, on a server of its own ---- */
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const admin = await srv.admin();
  await seed.load(admin, data);
  const as = {};
  for (const id of ['U-RMA', 'U-RMB', 'U-RMC', 'U-BMA', 'U-TL', 'U-EXEC', 'U-ALL', 'U-TADM', 'U-HR']) as[id] = await seed.signIn(admin, id);
  await admin.post('/api/users/sync', { memberId: 'U-GHOST', email: 'ghost@sec.test', password: 'Passw0rd-ghost-9' });
  const ghost = await srv.login('ghost@sec.test', 'Passw0rd-ghost-9');

  const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
  const clientsCase = async (who, want, label) => {
    const got = ids(await as[who].store('clients', []));
    if (!sameSet(got, want)) throw new Error(label + ': got ' + got.size + ', want ' + want.size);
    return got.size;
  };

  await t.step('an RM gets exactly their own clients, and nobody else’s', async () => {
    const a = await clientsCase('U-RMA', truth((c) => c.rmName === 'U-RMA'), 'RM A');
    const b = await clientsCase('U-RMB', truth((c) => c.rmName === 'U-RMB'), 'RM B');
    return 'RM A ' + a + ', RM B ' + b + ' — no overlap';
  });

  await t.step('a team lead gets their own and their reports’; a branch manager gets the branch', async () => {
    const tl = await clientsCase('U-TL', truth((c) => ['U-TL', 'U-RMA', 'U-RMB'].includes(c.rmName)), 'team lead');
    const bm = await clientsCase('U-BMA', truth((c) => c.branch === 'A'), 'branch manager');
    const c = await clientsCase('U-RMC', truth((x) => x.rmName === 'U-RMC'), 'RM C (branch B)');
    return 'team ' + tl + ', branch A ' + bm + ', RM C ' + c;
  });

  await t.step('scope all, and the team role Admin, still see every record (as the page does)', async () => {
    const all = truth(() => true);
    await clientsCase('U-ALL', all, 'scope all');
    await clientsCase('U-TADM', all, 'team Admin');
    const adm = ids(await admin.store('clients', []));
    if (!sameSet(adm, all)) throw new Error('administrator account');
    return all.size + ' each';
  });

  await t.step('an account linked to nobody reads no records', async () => {
    const c = await ghost.store('clients', []);
    const l = await ghost.store('leads', []);
    if (c.length || l.length) throw new Error(c.length + ' clients, ' + l.length + ' leads');
    return 'none';
  });

  await t.step('a client behind a visible record comes as a placeholder, without its details', async () => {
    const list = await as['U-RMA'].store('clients', []);
    const stubs = list.filter((r) => r._stub);
    const given = new Set(data.tasks.filter((x) => x.createdBy === 'U-RMA' && x.assignTo !== 'U-RMA').map((x) => x.clientId));
    if (!stubs.length || stubs.some((s) => s.cmsName !== 'Restricted record' || s.pan || s.rmName)) throw new Error(JSON.stringify(stubs.slice(0, 2)));
    if (stubs.some((s) => !given.has(s.id))) throw new Error('a placeholder for a client RM A has no record about');
    return stubs.length + ' placeholders ("Restricted record", no PAN, no owner)';
  });

  await t.step('records follow their client: transactions, holdings, documents, calls', async () => {
    const mine = truth((c) => c.rmName === 'U-RMA');
    const tx = await as['U-RMA'].store('transactions', []);
    const docs = await as['U-RMA'].store('clientDocuments', []);
    const hold = await as['U-RMA'].store('platformHoldings', []);
    const calls = await as['U-RMA'].store('callEntries', []);
    if (!tx.length || !docs.length || !hold.length || !calls.length) throw new Error('nothing to check: ' + [tx.length, docs.length, hold.length, calls.length]);
    if (tx.some((x) => !mine.has(x.clientId))) throw new Error('a transaction of another RM');
    if (docs.some((x) => !mine.has(x.clientId))) throw new Error('a document of another RM');
    if (calls.some((x) => x.loggedBy !== 'U-RMA')) throw new Error('a call not logged by RM A');
    /* holdings: of RM A's clients, plus those RM A imported (the export screen's rule) */
    const wantH = new Set(data.platformHoldings.filter((h) => mine.has(h.clientId) || h.importedBy === 'U-RMA').map((h) => h.id));
    if (!sameSet(new Set(hold.map((h) => h.id)), wantH)) throw new Error('holdings ' + hold.length + ' vs ' + wantH.size);
    return tx.length + ' transactions, ' + hold.length + ' holdings, ' + docs.length + ' documents, ' + calls.length + ' calls — all RM A’s';
  });

  await t.step('tasks: own, plus any task the person gave or held', async () => {
    const tasks = await as['U-RMB'].store('tasks', []);
    const want = new Set(data.tasks.filter((x) => x.assignTo === 'U-RMB' || x.createdBy === 'U-RMB' ||
      (data.clients.find((c) => c.id === x.clientId) || {}).rmName === 'U-RMB' && !x.assignTo).map((x) => x.id));
    const got = new Set(tasks.map((x) => x.id));
    if (!sameSet(got, want)) throw new Error('got ' + got.size + ' want ' + want.size);
    return got.size + ' tasks for RM B, including ' + data.tasks.filter((x) => x.assignTo === 'U-RMB' && x.createdBy === 'U-RMA').length + ' given by RM A';
  });

  await t.step('the team list: everyone’s name, but private fields only to the person and administrators', async () => {
    const tA = await as['U-RMA'].store('team', []);
    const tPM = await as['U-HR'].store('team', []);
    const tAdm = await admin.store('team', []);
    const f = (list, id) => list.find((m) => m.id === id) || {};
    const r = {
      count: tA.length,
      ownPan: f(tA, 'U-RMA').panNumber, otherPan: f(tA, 'U-RMB').panNumber, otherBank: f(tA, 'U-RMB').bankAccountNumber,
      otherSalary: f(tA, 'U-RMB').monthlySalary, hrSalary: f(tPM, 'U-RMB').monthlySalary, hrPan: f(tPM, 'U-RMB').panNumber,
      adminPan: f(tAdm, 'U-RMB').panNumber,
    };
    if (r.count !== data.team.length || r.ownPan !== 'ZZZPA1111A' || r.otherPan || r.otherBank || r.otherSalary
      || r.hrSalary !== 60000 || r.hrPan || r.adminPan !== 'ZZZPB2222B') throw new Error(JSON.stringify(r));
    return 'all ' + r.count + ' members; own PAN kept; another’s PAN/bank/salary withheld; HR sees salary but not PAN; admin sees all';
  });

  await t.step('settings and reference data stay readable by everyone', async () => {
    const sops = await as['U-EXEC'].store('sops', []);
    const amcs = await as['U-EXEC'].store('amcs', []);
    if (sops.length !== 1 || amcs.length !== 1) throw new Error(JSON.stringify({ sops: sops.length, amcs: amcs.length }));
    return 'SOPs and AMCs for an Executive with no permissions';
  });

  await t.step('logs: an RM sees audit lines about their own records, not the firm’s', async () => {
    const mine = truth((c) => c.rmName === 'U-RMA');
    const lines = await as['U-RMA'].store('auditLog', []);
    const sa = await as['U-RMA'].store('settingsAudit', []);
    if (!lines.length) throw new Error('nothing to check');
    const wrong = lines.filter((l) => !(l.by === 'U-RMA' || mine.has(l.recordId)));
    if (wrong.length || sa.length) throw new Error(wrong.length + ' foreign lines, ' + sa.length + ' settings lines');
    return lines.length + ' audit lines, all about RM A’s records; settings history withheld';
  });

  await t.step('a store with no rule is closed to everyone but the administrator account', async () => {
    await admin.save('zzUnknownStore', [{ id: 'X1' }]);
    const rm = await as['U-RMA'].get('/api/storage/zzUnknownStore');
    const ad = await admin.get('/api/storage/zzUnknownStore');
    if (rm.status !== 403 || ad.status !== 200) throw new Error(rm.status + ' / ' + ad.status);
    return 'RM 403, administrator 200';
  });

  await t.step('the audit trail says what was withheld, in counts', async () => {
    const e = ((await admin.get('/api/audit?limit=500')).json.entries || []).filter((x) => x.action === 'store.read' && x.outcome === 'scoped');
    const forA = e.find((x) => x.email === seed.email('U-RMA') && x.target === 'clients');
    if (!forA || !(forA.count > 0)) throw new Error(JSON.stringify(e.slice(0, 3)));
    if (JSON.stringify(e).includes('ZZ Client')) throw new Error('record values in the audit trail');
    return e.length + ' entries; e.g. clients for RM A: ' + forA.count + ' withheld';
  });

  /* ---- report mode: the runner's own server ---- */
  const radmin = await t.admin();
  await seed.load(radmin, data);
  const rA = await seed.signIn(radmin, 'U-RMA');
  await t.step('report mode serves the store as before, and records what it would withhold', async () => {
    const got = await rA.store('clients', []);
    const e = ((await radmin.get('/api/audit?limit=500')).json.entries || []).find((x) => x.action === 'store.read' && x.target === 'clients' && x.outcome === 'would-scope');
    if (got.length !== data.clients.length) throw new Error('report mode withheld records: ' + got.length);
    if (!e || e.count !== data.clients.length - truth((c) => c.rmName === 'U-RMA').size) throw new Error(JSON.stringify(e));
    return 'all ' + got.length + ' served; would withhold ' + e.count;
  });
});

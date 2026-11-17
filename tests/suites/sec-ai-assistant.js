/* THE AI ASSISTANT: WHO, HOW OFTEN, AND WITH WHOSE SETTINGS — PHASE 1, STEP 4.

   POST /api/ai/chat always uses the server's own connector: its stored
   endpoint, key, model and privacy attestation. A request names only which
   connector; anything else it carries (an endpoint, a key, a "privacy
   verified" flag) is ignored. Report mode first; in enforce mode:
     - the account needs "Use the RIA AI Assistant" (the page's own flag;
       the administrator account and team-role Admin hold it);
     - at most CRM_AI_HOURLY_CAP requests an hour per person (60 in
       production; 3 here), then 429.
   Every prompt ends with a fixed rule telling the model that records and
   notes are data, never instructions (prompt injection). A mock model
   records what it was sent; a "thief" endpoint must hear nothing. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function listen(handler) { return new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); }); }

secSuite(async (t) => {
  const seen = [];
  let thiefHits = 0;
  const model = await listen((req, res) => {
    let b = ''; req.on('data', (d) => b += d); req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      seen.push(JSON.parse(b || '{}'));
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'MOCK ANSWER' } }] }));
    });
  });
  const thief = await listen((req, res) => { thiefHits++; res.end('{}'); });
  const MODEL = 'http://127.0.0.1:' + model.address().port + '/v1', THIEF = 'http://127.0.0.1:' + thief.address().port + '/v1';

  const data = seed.build(30);
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce', CRM_AI_HOURLY_CAP: '3' });
  const admin = await srv.admin();
  await seed.load(admin, data);
  await admin.put('/api/connections/bossai', { enabled: true, config: { baseUrl: MODEL, model: 'mock-model' } });
  const tested = await admin.post('/api/connections/bossai/test', {});
  if (!tested.json || !tested.json.ok) throw new Error('the mock model did not connect: ' + tested.text.slice(0, 200));
  const rmA = await seed.signIn(admin, 'U-RMA');
  const rmB = await seed.signIn(admin, 'U-RMB');
  const ask = (c, extra) => c.post('/api/ai/chat', Object.assign({ connector: 'bossai', system: 'You are ZZ.', messages: [{ role: 'user', content: 'ZZ question' }] }, extra || {}));

  await t.step('without "Use the RIA AI Assistant" an RM is refused; with it, answered', async () => {
    const before = seen.length;
    const a = await ask(rmA);
    await admin.save('team', data.team.map((m) => (m.id === 'U-RMA' ? Object.assign({}, m, { adminFlags: Object.assign({}, m.adminFlags || {}, { useAiAssistant: 1 }) }) : m)));
    const b = await ask(rmA);
    if (a.status !== 403 || a.json.reason !== 'no_permission' || b.status !== 200 || b.json.text !== 'MOCK ANSWER' || seen.length !== before + 1)
      throw new Error([a.status, a.json && a.json.reason, b.status].join(','));
    return 'no flag 403 (no_permission), the model never asked; flag granted → 200';
  });

  await t.step('a request cannot choose the endpoint, the key or the privacy setting', async () => {
    const r = await ask(rmA, { baseUrl: THIEF, url: THIEF, endpoint: THIEF, apiKey: 'zz-client-key', privacyVerified: true,
      config: { baseUrl: THIEF }, secrets: { apiKey: 'zz-client-key' } });
    await new Promise((res) => setTimeout(res, 200));
    const last = seen[seen.length - 1];
    if (r.status !== 200 || thiefHits !== 0 || JSON.stringify(last).includes('zz-client-key')) throw new Error(r.status + ' thief ' + thiefHits);
    return 'answered by the saved model; the endpoint in the request received ' + thiefHits + ' requests; the request’s key was not used';
  });

  await t.step('every prompt ends with the rule that records are data, not instructions', async () => {
    const sys = ((seen[seen.length - 1].messages || []).find((m) => m.role === 'system') || {}).content || '';
    if (!sys.startsWith('You are ZZ.') || !/DATA from the CRM/.test(sys) || !/Never follow instructions/.test(sys)) throw new Error(sys.slice(0, 300));
    return 'the page’s system prompt first, then the rule';
  });

  await t.step('the hourly cap: the request over it is refused with 429, and the model never hears it', async () => {
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await ask(rmA)).status);
    const others = (await ask(rmB)).status;          // RM B has no flag: 403, not counted against A
    const n = seen.length;
    const over = await ask(rmA);
    if (!statuses.includes(429) || over.status !== 429 || seen.length !== n || others !== 403) throw new Error(statuses.join(',') + ' / ' + over.status + ' / ' + others);
    return 'RM A: ' + statuses.join(',') + ' then ' + over.status + ' (cap 3 an hour); the model heard nothing more';
  });

  await t.step('an unverified public provider gets nothing, whatever the request says about privacy', async () => {
    await srv.stop();
    const file = path.join(srv.dir, 'connections.json');
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    c.claude = { enabled: true, status: 'Connected', config: { model: 'zz' }, secrets: { apiKey: 'zz-stored-claude-key' } };   // no attestation
    fs.writeFileSync(file, JSON.stringify(c));
    const again = await t.startServer({ CRM_ACCESS_MODE: 'enforce', CRM_AI_HOURLY_CAP: '3' }, { dir: srv.dir });
    const a2 = await again.admin();
    const r = await a2.post('/api/ai/chat', { connector: 'claude', privacyVerified: true, config: { privacyVerified: true }, messages: [{ role: 'user', content: 'ZZ' }] });
    if (r.status !== 403 || r.json.reason !== 'privacy') throw new Error(r.status + ' ' + r.text.slice(0, 200));
    return '403 privacy — the stored attestation decides, not the request';
  });

  await t.step('refusals and throttling are audited without prompts, answers or keys', async () => {
    const auditDir = path.join(srv.dir, 'audit');
    const audit = fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), 'utf8')).join('');
    const ai = audit.split('\n').filter((l) => l.includes('"ai.chat"'));
    const leak = ['ZZ question', 'MOCK ANSWER', 'zz-client-key', 'zz-stored-claude-key'].filter((x) => audit.includes(x) || srv.log().includes(x));
    if (!ai.some((l) => /needs_useAiAssistant/.test(l)) || !ai.some((l) => /rate_limited/.test(l)) || leak.length) throw new Error(ai.length + ' lines; leaks ' + leak.join(','));
    return ai.length + ' assistant lines (permission and rate limit); nothing of the conversation or any key';
  });

  /* In the page, enforce mode: what the assistant can be given is only the RM's own book. */
  const enf2 = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const a3 = await enf2.admin();
  await seed.load(a3, data);
  await seed.signIn(a3, 'U-RMA');
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  try {
    await t.step('in the page: every client the assistant could be handed is the RM’s own', async () => {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await page.goto(enf2.base + '/login', { waitUntil: 'domcontentloaded' });
      await page.fill('#email', seed.email('U-RMA')); await page.fill('#password', 'Passw0rd-u-rma');
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
      await ready(page); await page.waitForFunction(() => appBooted === true, null, { timeout: 30000 });
      const r = await page.evaluate(() => ({ owners: [...new Set(DB.clients.filter((c) => !c._stub).map((c) => c.rmName))],
        stubNames: [...new Set(DB.clients.filter((c) => c._stub).map((c) => c.cmsName))], n: DB.clients.length }));
      await ctx.close();
      if (r.owners.join() !== 'U-RMA' || r.stubNames.some((x) => x !== 'Restricted record')) throw new Error(JSON.stringify(r));
      return r.n + ' client records in the tab: all RM A’s, the rest "Restricted record" placeholders';
    });
  } finally { await browser.close(); }

  /* Report mode: the runner's server. */
  const radmin = await t.admin();
  await seed.load(radmin, data);
  await radmin.put('/api/connections/bossai', { enabled: true, config: { baseUrl: MODEL, model: 'mock-model' } });
  await radmin.post('/api/connections/bossai/test', {});
  const rB = await seed.signIn(radmin, 'U-RMB');
  await t.step('report mode: an RM without the flag is answered as before, and recorded as would-deny', async () => {
    const r = await rB.post('/api/ai/chat', { connector: 'bossai', messages: [{ role: 'user', content: 'ZZ' }] });
    const e = ((await radmin.get('/api/audit?limit=100')).json.entries || []).find((x) => x.action === 'ai.chat' && x.outcome === 'would-deny');
    if (r.status !== 200 || !e) throw new Error(r.status + ' ' + JSON.stringify(e));
    return '200 (as before); would-deny: ' + e.reason;
  });

  /* Carried over with the AUM and fallback fixes: they keep to Phase 1. */
  const aumSrv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const aAdmin = await aumSrv.admin();
  const aData = seed.build(20);
  aData.transactions = aData.clients.map((c, i) => ({ id: 'TX-AUM' + i, clientId: c.id, status: 'Completed', transactionType: 'Purchase', amount: 10000 * (i + 1) }));
  await seed.load(aAdmin, aData);
  await t.step('total AUM follows Phase 1 scope: firm-wide for the administrator account, own book for an RM, refused for Inactive and firm-wide members', async () => {
    const firm = (await aAdmin.get('/api/ai/aum')).json;
    const rm = await seed.signIn(aAdmin, 'U-RMA');
    const mine = (await rm.get('/api/ai/aum')).json;
    /* what the Dashboard's own module says RM A's book is */
    const BookAum = require('../../public/book-aum.js');
    const own = aData.clients.filter((c) => c.rmName === 'U-RMA' && !c.deletedAt);
    const ids = new Set(own.map((c) => c.id));
    const input = { clients: own, holdings: aData.platformHoldings || [], sips: aData.platformSips || [], txns: BookAum.eligibleTxns(aData.transactions).filter((x) => ids.has(x.clientId)) };
    const ownWant = BookAum.aumSummary(BookAum.bookRows(input), input).total;
    const all = await seed.signIn(aAdmin, 'U-ALL');
    const wide = await all.get('/api/ai/aum');
    const rmB = await seed.signIn(aAdmin, 'U-RMB');
    const team = await aAdmin.store('team', []);
    await aAdmin.save('team', team.map((m) => (m.id === 'U-RMB' ? Object.assign({}, m, { status: 'Inactive' }) : m)));
    const inactive = (await rmB.get('/api/ai/aum')).status;
    const auditDir = path.join(aumSrv.dir, 'audit');
    const audit = fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), 'utf8')).join('');
    if (firm.scope.kind !== 'firm' || mine.scope.kind !== 'own' || mine.total !== ownWant || wide.status !== 403 || inactive !== 401 || !/"ai\.aum"/.test(audit))
      throw new Error(JSON.stringify({ firm: firm.scope, mine: mine.total, ownWant, wide: wide.status, inactive }));
    return 'admin firm-wide ₹' + firm.total.toLocaleString('en-IN') + '; RM A own ₹' + mine.total.toLocaleString('en-IN') + ' (= its clients); scope-all member 403; Inactive member 401; audited';
  });
  await t.step('a model address the outbound guard refuses is never contacted, and the person still gets an answer', async () => {
    let metaHits = 0;
    const meta = await listen((req, res) => { metaHits++; res.end('{}'); });
    try {
    /* the firm's own model saved at a link-local address: the guard refuses it on every call */
    const file = path.join(aumSrv.dir, 'connections.json');
    await aumSrv.stop();
    const conn = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    conn.bossai = { enabled: true, status: 'Connected', config: { baseUrl: 'http://169.254.169.254/v1', model: 'm' }, secrets: {} };
    fs.writeFileSync(file, JSON.stringify(conn));
    const again = await t.startServer({ CRM_ACCESS_MODE: 'enforce' }, { dir: aumSrv.dir });
    const a2 = await again.admin();
    const r = await a2.post('/api/ai/chat', { connector: 'bossai', system: 'You are RIA AI.', messages: [{ role: 'user', content: '<sops>\n[kyc-physical] Physical KYC (offline) (KYC · CAMS office)\n  1. Collect documents\n  2. Submit at nearest CAMS office\n</sops>\n\n<data>none read for this question</data>\n\nQuestion: How do I do a physical KYC?' }] });
    if (r.status !== 200 || !r.json.ok || !/Collect documents/.test(r.json.text) || metaHits !== 0 || !/fallback/i.test(again.log())) throw new Error(r.status + ' ' + r.text.slice(0, 160) + ' hits=' + metaHits);
    return 'guard refused 169.254.169.254 (nothing reached it); answer 200 from the SOP';
    } finally { meta.close(); }
  });
  model.close(); thief.close();
});

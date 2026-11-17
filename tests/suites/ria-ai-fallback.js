/* RIA AI ANSWERS EVEN WHEN THE AI PROVIDER CANNOT.

   The firm saw two errors in the assistant, in red, instead of an answer:
     "The provider did not answer within 15 seconds."
     "HTTP 503 — This model is currently experiencing high demand. Spikes in
      demand are usually temporary. Please try again later."
   and the record-planning step could hit either before the answer did.

   A stand-in provider (Gemini and Claude shapes) is put in front of a
   server of this suite's own, with short time budgets so a hang costs
   seconds, not minutes. It hangs, answers 503 or 429 with Gemini's own
   words, answers empty, or answers properly, on command. What has to hold:
     - a hang, a 503 or a 429, on the planning step and on the answer, still
       gives HTTP 200 with a real answer, inside the budget, and never the
       provider's error text;
     - "What should I do if a KYC is on hold?" is answered from the firm's
       own SOPs: the hold status, the Physical KYC steps, documents and TAT;
     - a question about the book is answered from the counts BOSS read;
     - total AUM is the Dashboard's Live AUM figure;
     - Gemini overloaded on its model is tried once on the fast model first,
       and a healthy provider's answer passes through untouched;
     - in the page, the same question shows the answer and no red error. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');
const signIn = require('../lib/signin');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const ROOT = path.join(__dirname, '..', '..');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.BOSS_PORT || 3000) + 520;
const MOCK_PORT = Number(process.env.BOSS_PORT || 3000) + 521;
const OVERLOAD = 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.';

/* ---- the stand-in provider ---- */
const mode = { 'gemini-2.5-pro': 'ok', 'gemini-2.0-flash': 'ok', claude: 'ok' };
const seen = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    const gm = req.url.match(/\/v1beta\/models\/([^:]+):generateContent/);
    const which = gm ? decodeURIComponent(gm[1]) : 'claude';
    seen.push(which);
    const m = mode[which] || 'ok';
    if (m === 'hang') return;                                                   // never answers
    res.setHeader('Content-Type', 'application/json');
    if (m === '503' || m === '429') {
      res.statusCode = Number(m);
      return res.end(JSON.stringify({ error: { code: Number(m), message: m === '503' ? OVERLOAD : 'Resource has been exhausted (e.g. check quota).', status: m === '503' ? 'UNAVAILABLE' : 'RESOURCE_EXHAUSTED' } }));
    }
    const text = m === 'empty' ? '' : 'MOCK MODEL ANSWER from ' + which;
    if (gm) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
    res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
  });
});

/* ---- a server of this suite's own ---- */
async function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ria-fallback-'));
  const users = path.join(dir, 'users.db');
  const run = (a) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'user.js')].concat(a), { env: Object.assign({}, process.env, { CRM_USERS_DB: users }), stdio: 'ignore' });
  run(['add', signIn.EMAIL, signIn.PASSWORD]); run(['role', signIn.EMAIL, 'admin']);
  const verified = { privacyVerified: true, privacyVerifiedBy: 'test', privacyVerifiedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, 'connections.json'), JSON.stringify({
    gemini: { enabled: true, status: 'Connected', config: Object.assign({ model: 'gemini-2.5-pro' }, verified), secrets: { apiKey: 'zz-gemini-key' } },
    claude: { enabled: false, status: 'Connected', config: Object.assign({ model: 'claude-test-model' }, verified), secrets: { apiKey: 'zz-claude-key' } },
  }));
  let log = '';
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, {
    PORT: String(PORT), CRM_DB_FILE: path.join(dir, 'data.json'), CRM_USERS_DB: users, CRM_CONNECTIONS_FILE: path.join(dir, 'connections.json'),
    CRM_REMINDERS: 'manual', CRM_BUSINESS_TZ: 'UTC', CRM_AI_PROVIDER_TEST_BASE: 'http://127.0.0.1:' + MOCK_PORT,
    CRM_AI_PLAN_BUDGET_MS: '2000', CRM_AI_ANSWER_BUDGET_MS: '3000' }) });
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const base = 'http://localhost:' + PORT;
  for (let i = 0; i < 150; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
  return { base, dir, log: () => log, stop: () => new Promise((r) => { if (child.exitCode !== null || child.signalCode !== null) return r(); child.once('exit', r); child.kill(); }) };
}
async function login(base) {
  const r = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: signIn.EMAIL, password: signIn.PASSWORD }).toString() });
  const cookie = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => /^finowise_session=/.test(c));
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: Object.assign({ Cookie: cookie }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
    return { status: res.status, json, text };
  };
  return { cookie, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
}

/* ---- what the page sends ---- */
const page = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SOPS = JSON.parse(page.match(/const BOSS_SOPS = (\[.*?\]);\n/s)[1]);
const sopText = (s) => {
  const docs = !s.d ? '' : Array.isArray(s.d) ? s.d.join('; ') : Object.keys(s.d).map((k) => k + ': ' + s.d[k].join(', ')).join(' | ');
  return ['[' + s.id + '] ' + s.t + ' (' + s.c + ' · ' + s.p + ')', s.s.map((x, i) => '  ' + (i + 1) + '. ' + x).join('\n'),
    docs ? '  Documents: ' + docs : '', s.tat ? '  TAT: ' + s.tat : '', (s.f || []).length ? '  Notes: ' + s.f.join(' / ') : ''].filter(Boolean).join('\n');
};
const KYC_Q = 'What should I do if a KYC is on hold?';
const kycAsk = () => ({ connector: 'gemini', system: 'You are RIA AI.\nHOW RIA AI ANSWERS\n...', maxTokens: 1200,
  messages: [{ role: 'user', content: '<sops>\n' + ['kyc-status-check', 'kyc-physical', 'kyc-fresh-ekyc', 'kyc-validation'].map((id) => sopText(SOPS.find((s) => s.id === id))).join('\n\n')
    + '\n</sops>\n\n<data>none read for this question</data>\n\nQuestion: ' + KYC_Q }] });
const SOURCES = '  clients (Clients) — columns: id, name, branch, rm, status, aum\n  leads (Leads) — columns: id, name, branch, assignedTo, status\n  meetings (Meetings) — columns: id, client, date, status';
const planAsk = (q) => ({ connector: 'gemini', temperature: 0, maxTokens: 600, messages: [{ role: 'user', content: q }],
  system: 'You are RIA AI.\n\nYou are deciding WHICH RECORDS BOSS should read to answer a question. You do not answer it.\nSources this user may read:\n' + SOURCES + '\n\nReturn ONLY a JSON object' });
const crmAsk = () => ({ connector: 'gemini', system: 'You are RIA AI.', maxTokens: 1200, messages: [{ role: 'user', content: '<data>\n'
  + JSON.stringify({ reads: [{ source: 'Clients', total: 12, groupBy: ['branch'], sum: ['aum'], groups: [{ key: 'Varanasi', branch: 'Varanasi', count: 7, aum: 1250000 }, { key: 'Mumbai', branch: 'Mumbai', count: 5, aum: 900000 }] }] })
  + '\n</data>\n\nQuestion: How many clients do we have branch-wise, with AUM?' }] });
const NEVER = /did not answer within|HTTP 50\d|HTTP 429|high demand|Spikes in demand|Resource has been exhausted/;

let failures = 0;
async function step(name, fn) {
  try { const note = await fn(); console.log('ok    ' + name + (note ? '  — ' + note : '')); }
  catch (e) { failures++; console.log('FAIL  ' + name + ' — ' + (e && e.message || e)); }
}
const timed = async (fn) => { const t0 = Date.now(); const r = await fn(); return Object.assign(r, { ms: Date.now() - t0 }); };

(async () => {
  await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
  const srv = await startServer();
  const admin = await login(srv.base);
  try {
    await step('(a) the provider hangs past the time budget: RIA AI answers the KYC question anyway, in time, without the timeout text', async () => {
      mode['gemini-2.5-pro'] = 'hang'; mode['gemini-2.0-flash'] = 'hang';
      const r = await timed(() => admin.post('/api/ai/chat', kycAsk()));
      if (r.status !== 200 || !r.json.ok || NEVER.test(r.text) || !/Physical KYC/.test(r.json.text) || !/\[kyc-status-check\]/.test(r.json.text) || r.ms > 4500)
        throw new Error(r.status + ' ' + r.ms + 'ms ' + r.text.slice(0, 200));
      return '200 in ' + r.ms + ' ms (budget 3 s): hold status, then the Physical KYC steps, documents and TAT';
    });

    await step('(a) a hang on the planning step gives a usable plan inside its budget', async () => {
      const r = await timed(() => admin.post('/api/ai/chat', planAsk('How many clients do we have branch-wise?')));
      const plan = JSON.parse(r.json.text);
      if (r.status !== 200 || r.ms > 3500 || !Array.isArray(plan.reads) || plan.reads[0].source !== 'clients' || plan.reads[0].groupBy[0] !== 'branch')
        throw new Error(r.status + ' ' + r.ms + 'ms ' + r.text.slice(0, 200));
      return '200 in ' + r.ms + ' ms (budget 2 s): ' + r.json.text;
    });

    await step('(b) HTTP 503 "high demand" on the planning step and on the answer: still 200 and the full answer', async () => {
      mode['gemini-2.5-pro'] = '503'; mode['gemini-2.0-flash'] = '503';
      const p = await admin.post('/api/ai/chat', planAsk(KYC_Q));
      const a = await admin.post('/api/ai/chat', kycAsk());
      const c = await admin.post('/api/ai/chat', crmAsk());
      const bad = [p, a, c].filter((x) => x.status !== 200 || !x.json.ok || NEVER.test(x.text));
      const plan = JSON.parse(p.json.text);
      if (bad.length || plan.reads.length !== 0 || !/Physical KYC/.test(a.json.text) || !/Varanasi: 7/.test(c.json.text) || !/₹12,50,000/.test(c.json.text))
        throw new Error(JSON.stringify({ bad: bad.map((x) => x.status), plan: p.json && p.json.text, crm: c.json && c.json.text.slice(0, 160) }));
      return 'plan (a how-to needs no records) 200; KYC answer 200; CRM counts 200 ("Varanasi: 7 (aum ₹12,50,000)")';
    });

    await step('(b) HTTP 429 on both models: still 200 with the answer', async () => {
      mode['gemini-2.5-pro'] = '429'; mode['gemini-2.0-flash'] = '429';
      const a = await admin.post('/api/ai/chat', kycAsk());
      const p = await admin.post('/api/ai/chat', planAsk('How many leads are pending this month?'));
      const plan = JSON.parse(p.json.text);
      if (a.status !== 200 || NEVER.test(a.text) || !/Physical KYC/.test(a.json.text) || p.status !== 200 || plan.reads[0].source !== 'leads')
        throw new Error(a.status + ' / ' + p.status + ' ' + p.text.slice(0, 160));
      return 'answer 200; plan 200 (' + JSON.stringify(plan.reads[0]) + ')';
    });

    await step('(b) an empty answer from the provider is answered from BOSS too', async () => {
      mode['gemini-2.5-pro'] = 'empty'; mode['gemini-2.0-flash'] = 'empty';
      const a = await admin.post('/api/ai/chat', kycAsk());
      if (a.status !== 200 || !/Physical KYC/.test(a.json.text)) throw new Error(a.status + ' ' + a.text.slice(0, 160));
      return '200 with the SOP answer';
    });

    await step('Gemini overloaded on its model is tried once on the fast model, whose answer is used', async () => {
      mode['gemini-2.5-pro'] = '503'; mode['gemini-2.0-flash'] = 'ok';
      const n = seen.length;
      const a = await admin.post('/api/ai/chat', kycAsk());
      const calls = seen.slice(n);
      if (a.status !== 200 || a.json.text !== 'MOCK MODEL ANSWER from gemini-2.0-flash' || calls.join() !== 'gemini-2.5-pro,gemini-2.0-flash' || a.json.fallback)
        throw new Error(JSON.stringify({ text: a.json && a.json.text, calls }));
      return 'calls: ' + calls.join(' → ') + '; the fast model answered';
    });

    await step('a healthy provider’s answer passes through untouched', async () => {
      mode['gemini-2.5-pro'] = 'ok';
      const a = await admin.post('/api/ai/chat', kycAsk());
      if (a.status !== 200 || a.json.text !== 'MOCK MODEL ANSWER from gemini-2.5-pro' || a.json.fallback) throw new Error(a.text.slice(0, 160));
      return 'model answer, no fallback';
    });

    await step('Claude answering 429 or hanging is answered from BOSS as well', async () => {
      const file = path.join(srv.dir, 'connections.json');
      void file;
      mode.claude = '429';
      const body = Object.assign(kycAsk(), { connector: 'claude' });
      /* Claude is switched on through the API, as an administrator would */
      await admin.put('/api/connections/claude', { enabled: true });
      const a = await admin.post('/api/ai/chat', body);
      mode.claude = 'hang';
      const b = await timed(() => admin.post('/api/ai/chat', body));
      if (a.status !== 200 || !/Physical KYC/.test(a.json.text) || b.status !== 200 || !/Physical KYC/.test(b.json.text) || b.ms > 4500 || NEVER.test(a.text + b.text))
        throw new Error([a.status, b.status, b.ms].join(' / ') + ' ' + (a.text + b.text).slice(0, 200));
      return '429 → 200; hang → 200 in ' + b.ms + ' ms';
    });

    await step('total AUM with the provider down is the Dashboard’s Live AUM figure, never a guess', async () => {
      mode['gemini-2.5-pro'] = '503'; mode['gemini-2.0-flash'] = '503';
      await admin.put('/api/storage/clients', { value: JSON.stringify([{ id: 'CMS-F1', cmsName: 'ZZ One', rmName: '', branch: 'Varanasi' }, { id: 'CMS-F2', cmsName: 'ZZ Two', rmName: '', branch: 'Mumbai' }]) });
      await admin.put('/api/storage/transactions', { value: JSON.stringify([{ id: 'TX-F1', clientId: 'CMS-F1', status: 'Completed', transactionType: 'Purchase', amount: 250000 },
        { id: 'TX-F2', clientId: 'CMS-F2', status: 'Completed', transactionType: 'Purchase', amount: 150000 }]) });
      const truth = await admin.get('/api/ai/aum');
      const a = await admin.post('/api/ai/chat', { connector: 'gemini', system: 'You are RIA AI.', messages: [{ role: 'user', content: '<data>none read for this question</data>\n\nQuestion: What is our total AUM by client holdings?' }] });
      const want = '₹' + Number(truth.json.total).toLocaleString('en-IN');
      if (a.status !== 200 || !truth.json.ok || !a.json.text.includes(want)) throw new Error(JSON.stringify({ truth: truth.json && truth.json.total, text: a.json && a.json.text.slice(0, 200) }));
      return 'answer gives ' + want + ', the same as GET /api/ai/aum';
    });

    await step('the server log shows the fallbacks and no prompt, answer or key', async () => {
      const log = srv.log();
      const fallbacks = (log.match(/\[ai\] #\d+ gemini fallback \(/g) || []).length;
      if (!fallbacks || /zz-gemini-key|zz-claude-key|KYC is on hold|MOCK MODEL ANSWER/.test(log)) throw new Error(fallbacks + ' fallback lines');
      return fallbacks + ' fallback lines (status and timing only)';
    });

    /* In the page itself. */
    mode['gemini-2.5-pro'] = '503'; mode['gemini-2.0-flash'] = '503';
    await admin.put('/api/connections/claude', { enabled: false });
    const browser = await pw.chromium.launch({ executablePath: CHROME });
    try {
      await step('in the page: the KYC question with Gemini overloaded shows the answer, and no red error', async () => {
        const pg = await (await browser.newContext()).newPage();
        await signIn(pg, srv.base); await ready(pg);
        const r = await pg.evaluate(async (q) => {
          await aiRefreshStatus(true);
          ai.draft = q;
          await aiSend();
          const last = ai.turns[ai.turns.length - 1] || {};
          return { error: ai.error, role: last.role, text: String(last.content || '') };
        }, KYC_Q);
        if (r.error || r.role !== 'assistant' || !/Physical KYC/.test(r.text) || NEVER.test(r.text) || /Market zone/.test(r.text)) throw new Error(JSON.stringify(r).slice(0, 300));
        return 'assistant answered (' + r.text.split('\n')[0].slice(0, 80) + '…); ai.error is empty';
      });
    } finally { await browser.close(); }
  } finally {
    await srv.stop(); mock.close();
    try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
    console.log(failures ? '\n' + failures + ' PROBLEM(S)' : '\nALL CLEAN');
    process.exitCode = failures ? 1 : 0;
  }
})();

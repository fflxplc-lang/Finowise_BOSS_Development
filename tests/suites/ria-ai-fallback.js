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
     - in the page, the same question shows the answer and no red error;
     - "DWT dikhao" / "open DWT" opens DWT at once, from the page and from
       the API, with no provider call and no "busy" text;
     - "give me suggestion of buckket strategy" is the firm's 3-bucket
       strategy with its schemes, provider up (the house view goes to it)
       or down (answered from BOSS);
     - "give me graphical representation of our clients" draws the chart;
     - Gemini failing on its model walks the chain gemini-2.5-flash →
       gemini-2.0-flash → gemini-1.5-flash, a 404 included;
     - no answer anywhere says "The AI service is busy";
     - "how many kycs are pending", "kitne kyc pending hain", "how many
       mandates are pending" give the exact count and the status-wise
       breakdown from the clients, with no SOP beside them;
     - the portfolio, risk & wealth engine: portfolio analysis (donut),
       buy/sell/hold/switch and risky-to-safe, tax harvesting, cross-sell
       and up-sell, risk (Sharpe, beta, σ, μ ± σ), GAB / buckets / HUF /
       legacy, projections (fan chart), each with its exact figures from
       a synthetic client, several charts in one answer, and the PDF
       report (a real %PDF- file, on request and from the button). */
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
const GEMINI = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const mode = { claude: 'ok' };
const gemini = (m) => GEMINI.forEach((g) => { mode[g] = m; });
gemini('ok');
const seen = [];
const bodies = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; }); req.on('end', () => {
    const gm = req.url.match(/\/v1beta\/models\/([^:]+):generateContent/);
    const which = gm ? decodeURIComponent(gm[1]) : 'claude';
    seen.push(which); bodies.push(body);
    const m = mode[which] || 'ok';
    if (m === 'hang') return;                                                   // never answers
    res.setHeader('Content-Type', 'application/json');
    if (m === '404') { res.statusCode = 404; return res.end(JSON.stringify({ error: { code: 404, message: 'models/' + which + ' is not found for API version v1beta.', status: 'NOT_FOUND' } })); }
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
    if (p === '/api/ai/chat') everyText.push(text);
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
const NEVER = /did not answer within|HTTP 50\d|HTTP 429|high demand|Spikes in demand|Resource has been exhausted|AI service is busy|AI service was busy/;
const BUSY = /AI service is busy|AI service was busy/;
/* What the page sends: its open rules, with the pages this person may open. */
const PAGES_SYS = 'You are RIA AI.\nOPENING A SCREEN\n    OPEN: cms <client id from <data>> <tab>     tabs: overview, portfolio, goals\n'
  + '    OPEN: <page>                               pages: dashboard (Dashboard), lms (LMS · Lead Management System), cms (CMS · Client Management System), '
  + 'dwt (DWT · Daily Working Tracker), business (DBT · Daily Business Tracker), meetings (Meetings), partners (Partners), queries (QMS · Query Management)';
const chatAsk = (q, system) => ({ connector: 'gemini', system: system || PAGES_SYS, maxTokens: 1200,
  messages: [{ role: 'user', content: '<data>none read for this question</data>\n\nQuestion: ' + q }] });
const everyText = [];

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
      gemini('hang');
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
      gemini('503');
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
      gemini('429');
      const a = await admin.post('/api/ai/chat', kycAsk());
      const p = await admin.post('/api/ai/chat', planAsk('How many leads are pending this month?'));
      const plan = JSON.parse(p.json.text);
      if (a.status !== 200 || NEVER.test(a.text) || !/Physical KYC/.test(a.json.text) || p.status !== 200 || plan.reads[0].source !== 'leads')
        throw new Error(a.status + ' / ' + p.status + ' ' + p.text.slice(0, 160));
      return 'answer 200; plan 200 (' + JSON.stringify(plan.reads[0]) + ')';
    });

    await step('(b) an empty answer from the provider is answered from BOSS too', async () => {
      gemini('empty');
      const a = await admin.post('/api/ai/chat', kycAsk());
      if (a.status !== 200 || !/Physical KYC/.test(a.json.text)) throw new Error(a.status + ' ' + a.text.slice(0, 160));
      return '200 with the SOP answer';
    });

    await step('Gemini overloaded on its model is tried next on gemini-2.5-flash, whose answer is used', async () => {
      gemini('ok'); mode['gemini-2.5-pro'] = '503';
      const n = seen.length;
      const a = await admin.post('/api/ai/chat', kycAsk());
      const calls = seen.slice(n);
      if (a.status !== 200 || a.json.text !== 'MOCK MODEL ANSWER from gemini-2.5-flash' || calls.join() !== 'gemini-2.5-pro,gemini-2.5-flash' || a.json.fallback)
        throw new Error(JSON.stringify({ text: a.json && a.json.text, calls }));
      return 'calls: ' + calls.join(' → ') + '; gemini-2.5-flash answered';
    });

    await step('the whole chain: 503 → 404 → 503 → gemini-1.5-flash answers', async () => {
      mode['gemini-2.5-pro'] = '503'; mode['gemini-2.5-flash'] = '404'; mode['gemini-2.0-flash'] = '503'; mode['gemini-1.5-flash'] = 'ok';
      const n = seen.length;
      const a = await admin.post('/api/ai/chat', kycAsk());
      const calls = seen.slice(n);
      if (a.status !== 200 || a.json.text !== 'MOCK MODEL ANSWER from gemini-1.5-flash' || calls.join() !== GEMINI.join() || a.json.fallback)
        throw new Error(JSON.stringify({ text: a.json && a.json.text, calls }));
      return 'calls: ' + calls.join(' → ');
    });

    await step('a healthy provider’s answer passes through untouched', async () => {
      gemini('ok');
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

    await step('"DWT dikhao" and "open DWT" through the API: OPEN: dwt at once, no provider call, no busy text', async () => {
      gemini('503');
      const n = seen.length;
      const a = await timed(() => admin.post('/api/ai/chat', chatAsk('DWT dikhao')));
      const b = await timed(() => admin.post('/api/ai/chat', chatAsk('open DWT')));
      const c = await admin.post('/api/ai/chat', chatAsk('mom kholo'));
      const d = await admin.post('/api/ai/chat', chatAsk('take me to dbt'));
      const calls = seen.slice(n);
      if (a.status !== 200 || !/^OPEN: dwt$/m.test(a.json.text) || !/\*\*DWT \(Daily Working Tracker\)\*\* khol diya hai\./.test(a.json.text)
        || !/^OPEN: dwt$/m.test(b.json.text) || !/^Opened \*\*DWT \(Daily Working Tracker\)\*\*\./.test(b.json.text)
        || !/^OPEN: meetings$/m.test(c.json.text) || !/^OPEN: business$/m.test(d.json.text) || calls.length || BUSY.test(a.text + b.text))
        throw new Error(JSON.stringify({ a: a.json && a.json.text, b: b.json && b.json.text, c: c.json && c.json.text, d: d.json && d.json.text, calls }));
      return 'Hinglish "' + a.json.text.split('\n')[0] + '" in ' + a.ms + ' ms; English "' + b.json.text.split('\n')[0] + '" in ' + b.ms + ' ms; MoM → meetings, DBT → business; 0 provider calls';
    });

    await step('"give me suggestion of buckket strategy", provider down: the 3-bucket strategy with Finowise schemes', async () => {
      gemini('503');
      const a = await admin.post('/api/ai/chat', chatAsk('give me suggestion of buckket strategy'));
      const t = (a.json && a.json.text) || '';
      const need = [/Bucket 1 — 0–2 years · Liquidity/, /Bucket 2 — 3–6 years · Stability/, /Bucket 3 — 7\+ years · Growth/, /ABSL Liquid/, /ICICI Pru Liquid/,
        /Mirae Asset Arbitrage/, /ICICI Pru All Seasons Bond/, /Kotak Aggressive Hybrid/, /Bandhan Flexi Cap/, /HDFC Value/, /SWP/, /STP/];
      const missing = need.filter((re) => !re.test(t)).map(String);
      if (a.status !== 200 || missing.length || NEVER.test(a.text)) throw new Error(JSON.stringify({ missing, t: t.slice(0, 300) }));
      return 'three buckets, each with its categories and schemes, then how to run it';
    });

    await step('…and Hinglish, typo-tolerant: "3 bucket strategy batao", "retirement buket kya hai"', async () => {
      const a = await admin.post('/api/ai/chat', chatAsk('3 bucket strategy batao'));
      const b = await admin.post('/api/ai/chat', chatAsk('retirement buket kya hai'));
      if (!/Finowise ki 3-Bucket Strategy/.test(a.json.text) || !/Bucket 3/.test(b.json.text) || NEVER.test(a.text + b.text)) throw new Error((a.text + b.text).slice(0, 300));
      return 'both answered from the house view';
    });

    await step('the Fund Basket by risk profile × horizon, and the 18-category scheme list, provider down', async () => {
      const a = await admin.post('/api/ai/chat', chatAsk('fund basket for moderately aggressive investor 7-10 years'));
      const b = await admin.post('/api/ai/chat', chatAsk('recommended scheme list'));
      if (!/Moderately Aggressive · 7-10 Years\*\*: Equity 75 \/ Debt 25/.test(a.json.text) || !/Parag Parikh Flexi Cap 20%/.test(a.json.text)
        || !/18 categories/.test(b.json.text) || !/^18\. \*\*Value \/ Contra/m.test(b.json.text)) throw new Error((a.json.text + '\n' + b.json.text).slice(0, 400));
      return 'Moderately Aggressive · 7–10Y cell; 18 categories listed';
    });

    await step('provider up: the house view goes to the model with the question, and its answer passes through', async () => {
      gemini('ok');
      const n = bodies.length;
      const a = await admin.post('/api/ai/chat', chatAsk('give me suggestion of buckket strategy'));
      const sent = bodies.slice(n).join('');
      if (a.json.text !== 'MOCK MODEL ANSWER from gemini-2.5-pro' || !/FINOWISE HOUSE VIEW/.test(sent) || !/Mirae Asset Arbitrage/.test(sent)) throw new Error(a.text.slice(0, 200));
      const k = await admin.post('/api/ai/chat', kycAsk());
      const plain = bodies.slice(-1)[0];
      if (/FINOWISE HOUSE VIEW/.test(plain)) throw new Error('the house view was sent with a KYC question');
      void k;
      return 'house view sent for the bucket question, not for the KYC one';
    });

    await step('total AUM with the provider down is the Dashboard’s Live AUM figure, never a guess', async () => {
      gemini('503');
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
    gemini('503');
    await admin.put('/api/connections/claude', { enabled: false });
    /* Eight synthetic clients with known KYC and mandate statuses. */
    const KYC = ['Validated', 'Validated', 'Validated', 'Registered', 'Registered', 'On Hold', 'Not Registered', ''];
    const MANDATE = ['Approved', 'Approved', 'Pending Approval', 'Pending Approval', 'Pending Approval', 'Not Initiated', 'Rejected', ''];
    await admin.put('/api/storage/clients', { value: JSON.stringify(KYC.map((k, i) => ({ id: 'CMS-K' + i, cmsName: 'ZZ Kyc ' + i, rmName: '', branch: i % 2 ? 'Varanasi' : 'Mumbai',
      kycStatus: k, mandateStatus: MANDATE[i] }))) });
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

      const pg = await (await browser.newContext()).newPage();
      await signIn(pg, srv.base); await ready(pg);
      const ask = (q) => pg.evaluate(async (q) => {
        await aiRefreshStatus(true);
        ai.open = true; aiDrawPanel();
        ai.draft = q;
        const input = document.getElementById('aiInput');          // with the panel open, aiSend reads the box
        if(input) input.value = q;
        const t0 = performance.now();
        await aiSend();
        const ms = performance.now() - t0;
        const last = ai.turns[ai.turns.length - 1] || {};
        const box = document.getElementById('aiTurns');
        return { ms: Math.round(ms * 10) / 10, error: ai.error, role: last.role, text: String(last.content || ''), opened: last.opened || null, view: currentView,
          chart: !!last.chart, chartDom: !!(box && box.querySelector('.boss-chart')), chartTitle: last.chart ? last.chart.title : '', html: box ? box.innerText : '' };
      }, q);

      await step('in the page: "DWT dikhao" opens DWT at once — Hinglish answer, ↗ Opened chip, no provider call, under 50 ms', async () => {
        const n = seen.length;
        const r = await ask('DWT dikhao');
        if (r.error || r.view !== 'dwt' || !r.opened || r.opened.view !== 'dwt' || r.text !== '**DWT (Daily Working Tracker)** khol diya hai.' || seen.length !== n
          || r.ms > 50 || !/Opened/.test(r.html) || BUSY.test(r.html)) throw new Error(JSON.stringify(r).slice(0, 400));
        return 'on ' + r.view + ' in ' + r.ms + ' ms; "' + r.text + '"; chip shown; 0 provider calls';
      });

      await step('in the page: "open DWT" — English answer, DWT open', async () => {
        await pg.evaluate(() => navigate('dashboard'));
        const n = seen.length;
        const r = await ask('open DWT');
        if (r.error || r.view !== 'dwt' || r.text !== 'Opened **DWT (Daily Working Tracker)**.' || seen.length !== n || r.ms > 50) throw new Error(JSON.stringify(r).slice(0, 400));
        return '"' + r.text + '" in ' + r.ms + ' ms';
      });

      await step('in the page: "Daily Business Tracker dikhao", "QMS kholo", "setup kholo" open their screens', async () => {
        const a = await ask('Daily Business Tracker dikhao');
        const b = await ask('QMS kholo');
        const c = await ask('setup kholo');
        if (a.view !== 'business' || b.view !== 'queries' || c.view !== 'settings' || !/DBT \(Daily Business Tracker\)/.test(a.text) || !/QMS \(Query Management\)/.test(b.text))
          throw new Error(JSON.stringify([a, b, c].map((x) => ({ view: x.view, text: x.text }))));
        return [a, b, c].map((x) => x.view).join(', ');
      });

      await step('in the page: "give me suggestion of buckket strategy", provider down — the 3-bucket strategy, no busy text', async () => {
        gemini('503');
        const r = await ask('give me suggestion of buckket strategy');
        if (r.error || !/Bucket 1/.test(r.text) || !/ABSL Arbitrage/.test(r.text) || !/Bucket 3/.test(r.text) || NEVER.test(r.text) || BUSY.test(r.html)) throw new Error(JSON.stringify(r).slice(0, 400));
        return r.text.split('\n')[0];
      });

      await step('in the page: "give me graphical representation of our clients" draws the chart in the chat panel', async () => {
        await pg.evaluate(() => navigate('dashboard'));
        const r = await ask('give me graphical representation of our clients');
        if (r.error || !r.chart || !r.chartDom || NEVER.test(r.text) || BUSY.test(r.html)) throw new Error(JSON.stringify(r).slice(0, 400));
        return 'boss-chart drawn: "' + r.chartTitle + '"; ' + r.text.split('\n')[0].slice(0, 80);
      });

      const SOP_NOISE = /\[iin-pending\]|Here is what to do|The process that applies|Related: \[/;
      await step('in the page: "how many kycs are pending" — 5 of 8 clients, status by status, no SOP', async () => {
        gemini('503');
        const r = await ask('how many kycs are pending');
        const last = await pg.evaluate(() => { const t = ai.turns[ai.turns.length - 1]; return { sops: (t.sops || []).length }; });
        const need = [/\*\*5 of 8 clients\*\* are pending: their KYC Status is not Validated\./, /- Validated: 3/, /- Registered: 2/, /- On Hold: 1/, /- Not Registered: 1/, /- Not recorded: 1/];
        const missing = need.filter((re) => !re.test(r.text)).map(String);
        if (r.error || missing.length || SOP_NOISE.test(r.text) || last.sops || NEVER.test(r.text)) throw new Error(JSON.stringify({ missing, sops: last.sops, text: r.text }).slice(0, 500));
        return r.text.split('\n')[0] + ' (then every status; 0 SOPs attached)';
      });

      await step('in the page: "kitne kyc pending hain" — the same count, in Hinglish', async () => {
        const r = await ask('kitne kyc pending hain');
        if (r.error || !/\*\*8 mein se 5 clients\*\* ka KYC Status Validated nahi hai \(pending\)\./.test(r.text) || !/- On Hold: 1/.test(r.text) || SOP_NOISE.test(r.text))
          throw new Error(r.text.slice(0, 400));
        return r.text.split('\n')[0];
      });

      await step('in the page: "how many mandates are pending" — 6 of 8 clients, Pending Approval 3', async () => {
        const r = await ask('how many mandates are pending');
        if (r.error || !/\*\*6 of 8 clients\*\* are pending: their Mandate Status is not Approved\./.test(r.text) || !/- Pending Approval: 3/.test(r.text) || !/- Approved: 2/.test(r.text) || SOP_NOISE.test(r.text))
          throw new Error(r.text.slice(0, 400));
        return r.text.split('\n')[0];
      });

      await step('in the page, provider up: the model is sent the counts and no SOPs for "how many kycs are pending"', async () => {
        gemini('ok');
        const n = bodies.length;
        const r = await ask('how many kycs are pending');
        /* The question as sent (the user turn), not the system prompt, whose rules mention <sops> by name. */
        const asked = bodies.slice(n).map((b) => { try { return (JSON.parse(b).contents || []).map((c) => (c.parts || []).map((x) => x.text).join('')).join('\n'); } catch (e) { return ''; } }).join('\n');
        if (r.text !== 'MOCK MODEL ANSWER from gemini-2.5-pro' || bodies.length - n !== 1 || !/countSummary/.test(asked) || !/KYC Status is not Validated/.test(asked) || /<sops>/.test(asked))
          throw new Error(JSON.stringify({ text: r.text, calls: bodies.length - n, sops: /<sops>/.test(asked), count: /countSummary/.test(asked) }));
        gemini('503');
        return 'one call, with <data> holding the count; no <sops>';
      });

      /* ---- the portfolio, risk & wealth engine ---- */
      const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
      const H = [['Parag Parikh Flexi Cap Reg Gr', 400000, 600000, daysAgo(1500)], ['HSBC Midcap Reg Gr', 200000, 320000, daysAgo(1000)],
        ['Bandhan Small Cap Reg Gr', 250000, 400000, daysAgo(150)], ['ICICI Pru Liquid Reg Gr', 300000, 310000, daysAgo(400)],
        ['HDFC Corporate Bond Reg Gr', 150000, 165000, daysAgo(1800)], ['DSP Value Reg Gr', 100000, 90000, daysAgo(600)]];
      const clients = KYC.map((k, i) => ({ id: 'CMS-K' + i, cmsName: 'ZZ Kyc ' + i, rmName: '', branch: i % 2 ? 'Varanasi' : 'Mumbai', kycStatus: k, mandateStatus: MANDATE[i] }));
      clients.push({ id: 'CMS-I1', cmsName: 'ZZ Intel Client', rmName: '', branch: 'Mumbai', riskProfile: 'Moderate', dob: '1975-05-01', taxStatus: 'Individual', kycStatus: 'Validated' });
      await admin.put('/api/storage/clients', { value: JSON.stringify(clients) });
      await admin.put('/api/storage/platformHoldings', { value: JSON.stringify(H.map((h, i) => ({ id: 'PFH-I' + i, clientId: 'CMS-I1', schemeName: h[0], invested: h[1], current: h[2], purchaseDate: h[3] }))) });
      await admin.put('/api/storage/platformSips', { value: JSON.stringify([{ id: 'PFS-I1', clientId: 'CMS-I1', schemeName: 'Parag Parikh Flexi Cap Reg Gr', monthlyAmount: 5000, amount: 5000 }]) });
      const TOTAL = 1885000, SIP = 5000;
      const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
      const fv = (r, n) => { const i = r / 1200; return TOTAL * Math.pow(1 + r / 100, n) + SIP * ((Math.pow(1 + i, n * 12) - 1) / i) * (1 + i); };
      const pg2 = await (await browser.newContext({ acceptDownloads: true })).newPage();
      await signIn(pg2, srv.base); await ready(pg2);
      const askI = (q) => pg2.evaluate(async (q) => {
        await aiRefreshStatus(true);
        ai.open = true; aiDrawPanel();
        const input = document.getElementById('aiInput'); ai.draft = q; if(input) input.value = q;
        await aiSend();
        const i = ai.turns.length - 1, last = ai.turns[i] || {};
        const box = document.getElementById('aiTurns');
        const cards = box ? [...box.querySelectorAll('.ria-chart')].filter((el) => el.closest('#aiTurns')) : [];
        return { i, error: ai.error, text: String(last.content || ''), charts: (last.charts || []).map((c) => ({ kind: c.kind, module: c.module, title: c.title, sub: c.sub || '' })),
          intel: last.intel ? { total: last.intel.total, modules: last.intel.modules, scope: last.intel.scope } : null, pdf: last.pdf || null,
          dom: cards.slice(-(last.charts || []).length || 0).map((el) => ({ kind: el.dataset.kind, svg: el.querySelector('svg') ? el.querySelector('svg').getAttribute('class') : '', text: el.textContent })),
          pdfButton: !!(box && box.querySelector('.ria-pdf')), html: box ? box.innerText : '' };
      }, q);
      const clean = (r) => { if (r.error || NEVER.test(r.text) || BUSY.test(r.html)) throw new Error('error or busy: ' + (r.error || r.text.slice(0, 200))); };

      await step('portfolio analysis: asset classes, concentration and return vs reference, with a donut chart', async () => {
        gemini('503');
        const r = await askI('portfolio analysis of ZZ Intel Client');
        clean(r);
        const donut = r.dom.find((d) => d.kind === 'donut');
        if (!r.intel || r.intel.total !== TOTAL || !donut || donut.svg !== 'ria-donut' || !/Equity 74\.8%, Liquid\/Cash 16\.4%, Debt 8\.8%/.test(r.text) || !r.pdfButton)
          throw new Error(JSON.stringify({ intel: r.intel, charts: r.charts.map((c) => c.kind), text: r.text.slice(0, 400) }));
        return 'total ' + inr(TOTAL) + '; Equity 74.8 / Liquid 16.4 / Debt 8.8; donut drawn; ' + r.charts.length + ' charts; PDF button shown';
      });

      await step('buy / sell / hold / switch and risky-to-safe: switch ₹2,48,750, exit load ₹1,382, with the comparison chart and the governance note', async () => {
        const r = await askI('buy sell hold switch and risky to safe switch for ZZ Intel Client');
        clean(r);
        const sw = r.charts.find((c) => /Risky-to-safe/.test(c.title));
        const share = 248750 / 720000, tax = Math.round((120000 * share * 12.5 + 150000 * share * 20) / 100);
        if (!sw || !/₹2,48,750/.test(sw.sub) || !/₹1,382/.test(sw.sub) || !sw.sub.includes(inr(tax)) || !r.charts.some((c) => /Buy \/ Sell \/ Hold \/ Switch/.test(c.title))
          || !/human advisor & client approval is mandatory/.test(r.text) || !r.dom.some((d) => d.svg === 'ria-bars'))
          throw new Error(JSON.stringify({ charts: r.charts, text: r.text.slice(0, 500) }));
        return 'small + mid 38.2% vs 25% ceiling → switch ₹2,48,750; load ₹1,382; tax ' + inr(tax);
      });

      await step('tax harvesting: ₹1,25,000 tax-free, ₹15,625 saved, ₹1,95,000 still taxable, ₹10,000 loss — before/after chart', async () => {
        const r = await askI('tax harvesting for ZZ Intel Client');
        clean(r);
        const c = r.charts.find((x) => x.module === 'tax');
        if (!c || !/Book ₹1,25,000 of long-term gain tax-free/.test(r.text) || !/about ₹15,625 saved; taxable gain remaining ₹1,95,000/.test(r.text) || !/Losses of ₹10,000/.test(r.text)
          || !/Unrealised equity gain ₹4,70,000/.test(r.text)) throw new Error(JSON.stringify({ c, text: r.text.slice(0, 600) }));
        return 'gain ₹4,70,000 (LT ₹3,20,000, ST ₹1,50,000) → harvest ₹1,25,000, save ₹15,625';
      });

      await step('cross-sell & up-sell: SIP step-up, idle cash, protection, GAB, 7 Events, HUF, LA MF, diversification', async () => {
        const r = await askI('cross sell up sell opportunities for ZZ Intel Client');
        clean(r);
        const need = [/SIP step-up \/ top-up: 1 \(₹14,000\)/, /idle cash → STP into Flexi Cap \/ Multi-Asset: 1 \(₹1,21,500\)/, /FSL \/ protection/, /GAB \(Golden Age Blueprint\)/, /7 Events blueprint/,
          /HUF folio/, /LA MF \(loan against mutual funds\): 1 \(₹6,34,500\)/, /Multi-Asset \/ Gold \/ Debt diversification/];
        const missing = need.filter((re) => !re.test(r.text)).map(String);
        if (missing.length || !r.charts.some((c) => c.module === 'opportunities')) throw new Error(JSON.stringify({ missing, text: r.text.slice(0, 700) }));
        return '8 opportunities, each with its amount where there is one';
      });

      await step('risk analysis: Sharpe, beta, μ, σ and the μ ± σ spread drawn on the risk card', async () => {
        const r = await askI('risk analysis sharpe beta standard deviation of ZZ Intel Client');
        clean(r);
        const card = r.dom.find((d) => d.kind === 'risk');
        const m = r.text.match(/Sharpe ratio (-?[\d.]+) · Beta \(β\) ([\d.]+) · Expected return \(μ\) ([\d.]+)% · Standard deviation \(σ\) ([\d.]+)%/);
        if (!m || !card || card.svg !== 'ria-risk' || !/μ − σ/.test(card.text) || !/μ \+ σ/.test(card.text) || !/Sharpe ratio/.test(card.text) || !/not computed from NAV history/.test(r.text))
          throw new Error(JSON.stringify({ card, text: r.text.slice(0, 500) }));
        const [mu, sigma, sharpe] = [Number(m[3]), Number(m[4]), Number(m[1])];
        if (Math.abs(sharpe - (mu - 6.5) / sigma) > 0.02) throw new Error('Sharpe ' + sharpe + ' is not (μ − 6.5) / σ');
        return 'Sharpe ' + m[1] + ', β ' + m[2] + ', μ ' + m[3] + '%, σ ' + m[4] + '%; spread drawn';
      });

      await step('GAB, bucket strategy, HUF ("huff suggestion"), trust & legacy: buckets on the real corpus, with a donut', async () => {
        const r = await askI('GAB bucket strategy huff suggestion and trust legacy planning for ZZ Intel Client');
        clean(r);
        const need = [/Bucket 1 · 0–2Y Immediate cashflow & emergency: ₹1,88,500/, /Bucket 2 · 3–6Y Stability & income refill: ₹3,77,000/, /Bucket 3 · 7Y\+ Wealth growth: ₹13,19,500/,
          /GAB SWP income: ₹6,283 to ₹7,854 a month/, /HUF \(Hindu Undivided Family\)/, /Private Family Trust/, /0 of 1 client have a nominee on file/];
        const missing = need.filter((re) => !re.test(r.text)).map(String);
        if (missing.length || !r.dom.some((d) => d.kind === 'donut' && /Bucket strategy/.test(d.text))) throw new Error(JSON.stringify({ missing, text: r.text.slice(0, 700) }));
        return 'buckets ₹1,88,500 / ₹3,77,000 / ₹13,19,500; SWP ₹6,283–₹7,854 a month';
      });

      await step('future projection: 3 to 20 years at 9 / 12 / 15%, as a fan chart', async () => {
        const r = await askI('future projection of ZZ Intel Client');
        clean(r);
        const ten = '10 years: ' + inr(fv(9, 10)) + ' / ' + inr(fv(12, 10)) + ' / ' + inr(fv(15, 10));
        const line = r.dom.find((d) => d.kind === 'line');
        if (!r.text.includes(ten) || !line || line.svg !== 'ria-line' || !/20Y/.test(line.text)) throw new Error(JSON.stringify({ ten, text: r.text.slice(0, 600) }));
        return ten;
      });

      await step('the book: "risk analysis of our book" covers every visible client', async () => {
        const r = await askI('risk analysis of our book');
        clean(r);
        if (!r.intel || r.intel.scope.kind !== 'book' || r.intel.scope.clients !== 9 || !r.charts.some((c) => c.kind === 'risk')) throw new Error(JSON.stringify(r.intel));
        return r.intel.scope.label;
      });

      await step('one question, every chart, and the PDF report — on request and from the button — is a real PDF', async () => {
        const auto = pg2.waitForEvent('download', { timeout: 15000 });
        const r = await askI('complete portfolio analysis of ZZ Intel Client with pdf');
        clean(r);
        const kinds = new Set(r.charts.map((c) => c.kind)), mods = new Set(r.charts.map((c) => c.module));
        if (r.charts.length < 9 || !['donut', 'hbar', 'risk', 'line'].every((k) => kinds.has(k)) || mods.size < 7 || r.dom.length !== r.charts.length || !r.pdf || !r.pdf.filename)
          throw new Error(JSON.stringify({ charts: r.charts.map((c) => c.module + ':' + c.kind), dom: r.dom.length, pdf: r.pdf }));
        const d1 = await auto;
        const f1 = fs.readFileSync(await d1.path());
        const press = pg2.waitForEvent('download', { timeout: 15000 });
        await pg2.evaluate(() => { const b = [...document.querySelectorAll('#aiTurns .ria-pdf')].pop(); b.click(); });
        const d2 = await press;
        const f2 = fs.readFileSync(await d2.path());
        const info = await pg2.evaluate((i) => { const b = bossTurnPdfBlocks(i); const raw = pdfRender(b, { footer: RIA_PDF_FOOT });
          return { head: raw.slice(0, 5), blocks: b.length, kinds: [...new Set(b.map((x) => x.t))], text: b.map((x) => [x.text, x.label, x.value, x.title].concat((x.items || []).map((it) => it.label)).filter(Boolean).join(' ')).join(' | ') }; }, r.i);
        const want = ['RIA AI Advisory Report', 'ZZ Intel Client', 'Executive summary', 'Asset allocation', 'Tax harvesting', 'Risk analytics', 'Bucket strategy', 'Future projection',
          'Cross-sell', 'Std dev (sigma)', 'Mean return (mu)', 'Generated by RIA AI from live BOSS records. Human advisor approval required before execution.'];
        const missing = want.filter((w) => !info.text.includes(w));
        if (f1.slice(0, 5).toString() !== '%PDF-' || f2.slice(0, 5).toString() !== '%PDF-' || info.head !== '%PDF-' || missing.length || !['donut', 'bars', 'table', 'cards', 'meter'].every((k) => info.kinds.includes(k)))
          throw new Error(JSON.stringify({ h1: f1.slice(0, 8).toString(), h2: f2.slice(0, 8).toString(), missing, kinds: info.kinds }));
        return r.charts.length + ' charts across ' + mods.size + ' modules; PDF ' + d1.suggestedFilename() + ' (' + f1.length + ' bytes, ' + info.blocks + ' blocks) on request and ' + f2.length + ' bytes from the button';
      });
    } finally { await browser.close(); }
    await step('no answer anywhere in this run said "The AI service is busy"', async () => {
      const busy = everyText.filter((t) => BUSY.test(t));
      if (busy.length) throw new Error(busy.length + ' answers: ' + busy[0].slice(0, 200));
      return everyText.length + ' API answers checked';
    });
  } finally {
    await srv.stop(); mock.close();
    try { fs.rmSync(srv.dir, { recursive: true, force: true }); } catch (e) { /* temp */ }
    console.log(failures ? '\n' + failures + ' PROBLEM(S)' : '\nALL CLEAN');
    process.exitCode = failures ? 1 : 0;
  }
})();

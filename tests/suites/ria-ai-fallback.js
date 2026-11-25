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
       report (a real %PDF- file, on request and from the button);
     - the master prompt naming all seven analyses, "tax harvesting" and
       "HUF suggestion" in it, is the seven analyses — never a count of
       clients by tax status — and its PDF is the advisory deck (banner,
       KPI cards, panels, donut + table, side-by-side donuts, multi-colour
       bars, vector lines, the bell curve), with none of the noise lines;
     - "clients by tax status" reads the PAN's fourth letter where the
       tax status is blank;
     - a long answer opens at its start: the question at the top of the
       panel, the first line of the answer in view — not the bottom of the
       last chart — and a dashboard tab click does not move the panel;
     - the guided desk: a greeting, six category tiles and a ☰ button;
       Check Status → Mandate Status → PAN → the client's mandate, IIN, bank
       and SIPs, with buttons for what next, no model call; a name two
       clients share gives a list to click; "Varanasi" finds "Varanasi
       Branch", and the DOB list comes with its charts and an Excel file;
     - personal data and shared names: "Priya ka date of birth aur PAN card
       no batao" with four Priyas lists them by full name (a "Mrs." prefix
       included), and the one picked — clicked or typed by number — gets
       her DOB, age, PAN, mobile, email, branch, RM, KYC, mandate and AUM;
       a unique client's DOB and PAN come back directly; "Priya ka
       portfolio" waits for the pick and then answers for that client;
     - any slice: "Varanasi branch ke clients date wise", "… March / May
       birthday wale", "… pending KYC", "… 60+ age wale" — the branch as
       the records spell it, rows in date (or birthday) order, a dashboard
       and Excel / CSV / PDF; and "Date-wise" among a branch's buttons;
       also "1 Oct se 18 Nov tak … transactions", "… AUM above 10 lakh",
       leads in "October 2026" and "last month", business and calls;
     - one investor filed as three rows (a platform upload holding the AUM,
       two later imports holding the DOB, address, UCC, nominee, KYC,
       mandate and RM, named "<name> - <PAN>"): the full name gives one
       merged profile; "Maurya ka DOB batao" lists distinct people by full
       name; the Varanasi DOB list has the investor once. Synthetic values
       in the shape of the live case. */
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

    await step('a missing-field filter answered by BOSS when the provider cannot: "Total Clients | Clients without Mobile Number", then Client ID | Client Name | Branch | Status', async () => {
      gemini('503');
      const f = { field: 'Mobile Number', status: 'Not Recorded / Missing', totalBook: 5348, matchingCount: 27,
        rows: Array.from({ length: 25 }, (_, i) => ({ id: 'CMS-ZZ' + i, name: 'ZZ No Mobile ' + i, branch: i % 2 ? 'Varanasi' : '', pan: i % 3 ? '******' + (1000 + i) + 'Z' : 'Not recorded', status: 'Mobile Number: Missing' })) };
      const r = await admin.post('/api/ai/chat', { connector: 'gemini', system: 'You are RIA AI.', maxTokens: 1200,
        messages: [{ role: 'user', content: '<data>\n' + JSON.stringify({ attributeFilter: f }) + '\n</data>\n\nQuestion: jiska mobile no add nhi hai usko filter krke list do' }] });
      const t = (r.json && r.json.text) || '';
      const lines = t.split('\n');
      if (r.status !== 200 || !r.json.fallback || lines[0] !== '**Total Clients:** 5,348 | **Clients without Mobile Number:** 27' || !t.includes('| Client ID | Client Name | Branch | Status |')
        || !t.includes('| CMS-ZZ0 | ZZ No Mobile 0 | Not recorded | Mobile Number: Missing |') || lines.filter((l) => /^\| CMS-ZZ/.test(l)).length !== 25
        || !/Showing 25 of 27\. The full list is in the Excel \/ CSV export/.test(t) || /\[[a-z]+-[a-z-]+\]/.test(t) || /\*{6}/.test(t)) throw new Error(t.slice(0, 600));
      gemini('ok');
      return lines[0].replace(/\*\*/g, '') + '; 25 table rows; "Showing 25 of 27" with the export; no SOP, no PAN';
    });

    await step('a client list read by the planner, answered by BOSS when the provider cannot: the list, and no SIP SOP under it', async () => {
      gemini('503');
      const sop = SOPS.find((x) => x.id === 'txn-sip') || SOPS.find((x) => /sip/i.test(x.id));
      const r = await admin.post('/api/ai/chat', { connector: 'gemini', system: 'You are RIA AI.', maxTokens: 1200,
        messages: [{ role: 'user', content: '<sops>\n' + sopText(sop) + '\n</sops>\n\n<data>\n' + JSON.stringify({ reads: [{ source: 'Clients', total: 2, rows: [{ name: 'ZZ List One', branch: 'Pune', sip: 0 }, { name: 'ZZ List Two', branch: 'Delhi', sip: 0 }] }] })
          + '\n</data>\n\nQuestion: I want that clients who have not SIP?' }] });
      const t = (r.json && r.json.text) || '';
      gemini('ok');
      if (r.status !== 200 || !/ZZ List One/.test(t) || new RegExp('\\[' + sop.id + '\\]').test(t) || /Investor Search|Here is what to do|The process that applies/.test(t)) throw new Error(t.slice(0, 600));
      return 'the two clients; no [' + sop.id + '] steps';
    });

    await step('one client’s portfolio and one branch’s book, answered by BOSS when the provider cannot', async () => {
      gemini('503');
      const cpa = { client: { id: 'CMS-ZZP', name: 'ZZ Portfolio Person', branch: 'Pune', rm: 'ZZ RM', riskProfile: 'Moderate' }, totalAum: 2500000, totalSip: 10000, holdingsCount: 2,
        allocation: { equity: { value: 2000000, pct: 80 }, debt: { value: 500000, pct: 20 }, hybrid: { value: 0, pct: 0 }, gold: { value: 0, pct: 0 }, liquid: { value: 0, pct: 0 }, unclassified: { value: 0, pct: 0 } },
        schemes: [{ name: 'ZZ Flexi Cap', category: 'Flexi Cap', folio: 'F1', currentValue: 2000000 }, { name: 'ZZ Short Duration', category: 'Short Duration', folio: '—', currentValue: 500000 }] };
      const ask = (data, q) => admin.post('/api/ai/chat', { connector: 'gemini', system: 'You are RIA AI.', maxTokens: 1200, messages: [{ role: 'user', content: '<data>\n' + JSON.stringify(data) + '\n</data>\n\nQuestion: ' + q }] });
      const a = await ask({ clientPortfolioAnalysis: cpa }, 'iska portfolio analysis do');
      const b = await ask({ branchAnalysis: { branch: 'Pune', totalClients: 2, totalAum: 4500000, totalSip: 10000, topClients: [{ id: 'CMS-ZZP', name: 'ZZ Portfolio Person', aum: 2500000 }] } }, 'Pune branch ka portfolio analysis do');
      gemini('ok');
      const t1 = (a.json && a.json.text) || '', t2 = (b.json && b.json.text) || '';
      if (!t1.startsWith('**📊 Portfolio Analysis: ZZ Portfolio Person (CMS-ZZP)**') || !t1.includes('• **Total Portfolio (AUM):** ₹25,00,000 | **Monthly SIP:** ₹10,000') || !t1.includes('- Equity: 80% (₹20,00,000)')
        || !t1.includes('| ZZ Flexi Cap | Flexi Cap | F1 | ₹20,00,000 |') || !/above the 40–60% band for a Moderate investor/.test(t1) || /\[[a-z]+-[a-z-]+\]/.test(t1))
        throw new Error('client: ' + t1.slice(0, 700));
      if (!t2.startsWith('**🏢 Pune Branch Portfolio Summary**') || !t2.includes('• **Total Branch AUM:** ₹45,00,000') || !t2.includes('| CMS-ZZP | ZZ Portfolio Person | ₹25,00,000 |')) throw new Error('branch: ' + t2.slice(0, 500));
      return 'portfolio: header, AUM / SIP, allocation, scheme table, verdict (equity 80% above the Moderate band); branch: summary and top clients';
    });

    await step('scheme signals, goal gap and mature clients from the quartile matrix, answered by BOSS when the provider cannot', async () => {
      gemini('503');
      const data = { schemeSignals: { client: { id: 'CMS-ZZQ', name: 'ZZ Quartile Person' }, source: 'Firm 10-year quartile consistency matrix (2014–2023), as supplied by the firm',
          switches: [{ scheme: 'DSP Midcap Fund', current: 260000, signal: 'DSP Midcap Fund (₹2.6 L) ranked Bottom in 2020, 2021, 2022. Switch to Motilal Oswal Midcap Fund (90% consistency).' }],
          deRisk: [], watch: [], holds: [{ scheme: 'Kotak Flexi Cap Fund', current: 610000 }], notCovered: ['ZZ Unknown Fund'], freshAllocation: 'Fresh SIPs to top-quartile picks: Parag Parikh Flexi Cap / Mirae Asset Large & Midcap.' },
        goalGap: { client: 'ZZ Quartile Person', goals: [{ goal: 'Child education', target: 2500000, year: '2034', years: 7.6, rate: 12, sipNeeded: 17420 }], currentSip: 5000, corpus: 1600000, sipNeededTotal: 17420, sipGap: 12420, note: 'Illustrative.' },
        matureRebalancing: { total: 1, totalValue: 800000, clients: [{ name: 'ZZ Senior', age: 61, yearsToGoal: null, midSmallValue: 800000, schemes: ['Kotak Midcap Fund'] }], strategy: '15% Liquid / 35% Corporate Debt / 50% Growth Equity.' } };
      const r = await admin.post('/api/ai/chat', { connector: 'gemini', system: 'You are RIA AI.', maxTokens: 1200, messages: [{ role: 'user', content: '<data>\n' + JSON.stringify(data) + '\n</data>\n\nQuestion: iska switch analysis do aur goal gap batao' }] });
      gemini('ok');
      const t = (r.json && r.json.text) || '';
      if (!t.includes('**🔴 Switch alerts (1):**') || !/Switch to Motilal Oswal Midcap Fund/.test(t) || !t.includes('**🟢 Core holds (1):** Kotak Flexi Cap Fund (₹6,10,000)') || !/Not in the matrix .*ZZ Unknown Fund/.test(t)
        || !t.includes('| Child education | ₹25,00,000 | 2034 (7.6 yrs @ 12%) | ₹17,420/mo |') || !t.includes('**Gap:** ₹12,420/mo') || !t.includes('**🧓 Mature clients to de-risk: 1**') || /\[[a-z]+-[a-z-]+\]/.test(t))
        throw new Error(t.slice(0, 900));
      return 'switch alerts, core holds, not covered, goal table with the gap, mature clients and the bucket strategy; no SOP';
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
        const d = await pg.evaluate(() => { const t = ai.turns[ai.turns.length - 1]; const box = document.getElementById('aiTurns');
          return { kinds: (t.charts || []).map((c) => c.kind + (c.suggest ? ':suggest' : '')), labels: ((t.charts || []).find((c) => c.kind === 'donut') || { items: [] }).items.map((i) => i.label),
            donut: !!(box && box.querySelector('.ria-dash .ria-donut')), pdf: !!(box && box.querySelector('.ria-pdf')) }; });
        if (r.error || !r.chart || !r.chartDom || NEVER.test(r.text) || BUSY.test(r.html) || !d.donut || !d.pdf || !['kpis', 'donut', 'hbar:suggest'].every((k) => d.kinds.includes(k)) || d.labels.includes('—'))
          throw new Error(JSON.stringify({ r: r.text.slice(0, 200), d }));
        return '"' + r.chartTitle + '" as a dashboard: ' + d.kinds.join(' + ') + ' (' + d.labels.join(', ') + ')';
      });

      const SOP_NOISE = /\[iin-pending\]|Here is what to do|The process that applies|Related: \[/;
      await step('in the page: "how many kycs are pending" — 5 of 8 clients, status by status, no SOP', async () => {
        gemini('503');
        const r = await ask('how many kycs are pending');
        const last = await pg.evaluate(() => { const t = ai.turns[ai.turns.length - 1]; return { sops: (t.sops || []).length }; });
        const need = [/\*\*5 of 8 clients\*\* are pending: their KYC Status is not Validated\./, /- KYC validated: 3/, /- KRA registered — validation pending: 2/,
          /- On hold \/ rejected — physical KYC needed: 1/, /- Not registered — fresh eKYC needed: 1/, /- PAN & KYC missing — fresh eKYC needed: 1/];
        const missing = need.filter((re) => !re.test(r.text)).map(String);
        const d = await pg.evaluate(() => { const t = ai.turns[ai.turns.length - 1]; const box = document.getElementById('aiTurns');
          return { kinds: (t.charts || []).map((c) => c.kind + (c.suggest ? ':suggest' : '')), donutLabels: ((t.charts || []).find((c) => c.kind === 'donut') || { items: [] }).items.map((i) => i.label),
            actions: ((t.charts || []).find((c) => c.suggest) || { rows: [] }).rows.map((x) => x.label + ' ' + x.values[0]), dom: box ? box.querySelectorAll('.ria-dash .ria-donut').length : 0,
            plainBar: !!(box && [...box.querySelectorAll('.boss-chart')].some((el) => !el.classList.contains('ria-chart'))), pdf: !!(box && box.querySelector('.ria-pdf')) }; });
        if (r.error || missing.length || SOP_NOISE.test(r.text) || last.sops || NEVER.test(r.text)) throw new Error(JSON.stringify({ missing, sops: last.sops, text: r.text }).slice(0, 500));
        if (!['kpis', 'donut', 'hbar:suggest'].every((k) => d.kinds.includes(k)) || d.donutLabels.some((l) => /^(—|Not recorded)$/.test(l)) || !d.dom || d.plainBar || !d.pdf
          || !d.actions.includes('Start fresh eKYC 2') || !d.actions.includes('Complete KRA validation 2') || !d.actions.includes('Do physical KYC 1'))
          throw new Error(JSON.stringify(d));
        return r.text.split('\n')[0] + ' — dashboard: ' + d.kinds.join(' + ') + '; actions ' + d.actions.join(', ') + '; no "—", no plain bar chart, PDF button';
      });

      await step('in the page: "kitne kyc pending hain" — the same count, in Hinglish', async () => {
        const r = await ask('kitne kyc pending hain');
        if (r.error || !/\*\*8 mein se 5 clients\*\* ka KYC Status Validated nahi hai \(pending\)\./.test(r.text) || !/- On hold \/ rejected — physical KYC needed: 1/.test(r.text) || SOP_NOISE.test(r.text))
          throw new Error(r.text.slice(0, 400));
        return r.text.split('\n')[0];
      });

      await step('in the page: "how many mandates are pending" — 6 of 8 clients, Pending Approval 3', async () => {
        const r = await ask('how many mandates are pending');
        if (r.error || !/\*\*6 of 8 clients\*\* are pending: their Mandate Status is not Approved\./.test(r.text) || !/- Pending approval: 3/.test(r.text) || !/- Mandate approved: 2/.test(r.text)
          || !/- Onboarding — mandate not started: 2/.test(r.text) || !/Follow up mandate approval: 3/.test(r.text) || SOP_NOISE.test(r.text))
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
      clients.push({ id: 'CMS-H1', cmsName: 'ZZ Huf Family', rmName: '', branch: 'Varanasi', pan: 'ABCHF1234K' }, { id: 'CMS-P1', cmsName: 'ZZ Pan Person', rmName: '', branch: 'Delhi', pan: 'ABCPE4321L' });
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
          chartsFull: (last.charts || []).map((c) => ({ kind: c.kind, title: c.title, badge: c.badge })),
          dom: cards.slice(-(last.charts || []).length || 0).map((el) => ({ kind: el.dataset.kind, svg: el.querySelector('svg') ? el.querySelector('svg').getAttribute('class') : '', text: el.textContent })),
          pdfButton: !!(box && box.querySelector('.ria-pdf')), html: box ? box.innerText : '' };
      }, q);
      const clean = (r) => { if (r.error || NEVER.test(r.text) || BUSY.test(r.html)) throw new Error('error or busy: ' + (r.error || r.text.slice(0, 200))); };

      await step('portfolio analysis: asset classes, concentration and return vs reference, with a donut chart', async () => {
        gemini('503');
        const r = await askI('portfolio analysis of ZZ Intel Client');
        clean(r);
        r.charts.forEach((c, k) => { c.badge = r.chartsFull[k].badge; });
        const donut = r.dom.find((d) => d.kind === 'donut');
        const area = r.charts.find((c) => c.kind === 'area');
        if (!area || !/Beating the Nifty 50 reference by \+0\.5% a year/.test(area.badge || '') || !r.dom.some((d) => d.svg === 'ria-area')) throw new Error('area chart: ' + JSON.stringify(area && { badge: area.badge, sub: area.sub }));
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
          || !r.dom.some((d) => d.kind === 'donut2' && d.svg === 'ria-donut2' && /Suggested/.test(d.text))
          || !/human advisor & client approval is mandatory/.test(r.text) || !r.dom.some((d) => d.svg === 'ria-bars'))
          throw new Error(JSON.stringify({ charts: r.charts, text: r.text.slice(0, 500) }));
        return 'small + mid 38.2% vs 25% ceiling → switch ₹2,48,750; load ₹1,382; tax ' + inr(tax);
      });

      await step('tax harvesting: ₹1,25,000 tax-free, ₹15,625 saved, ₹1,95,000 still taxable, ₹10,000 loss — before/after chart', async () => {
        const r = await askI('tax harvesting for ZZ Intel Client');
        clean(r);
        const c = r.charts.find((x) => x.module === 'tax');
        if (!c || !/Book ₹1,25,000 of long-term gain tax-free/.test(r.text) || !/about ₹15,625 saved; taxable gain remaining ₹1,95,000/.test(r.text) || !/Losses of ₹10,000/.test(r.text)
          || !/Unrealised equity gain ₹4,70,000/.test(r.text) || !r.charts.some((x) => x.kind === 'donut' && x.module === 'tax')) throw new Error(JSON.stringify({ c, text: r.text.slice(0, 600) }));
        const liab = await pg2.evaluate(() => ai.turns[ai.turns.length - 1].intel.tax.liability);
        if (liab.before !== 70000 || liab.after !== 54375) throw new Error('liability ' + JSON.stringify(liab));
        return 'gain ₹4,70,000 (LT ₹3,20,000, ST ₹1,50,000) → harvest ₹1,25,000, save ₹15,625';
      });

      await step('cross-sell & up-sell: SIP step-up, idle cash, protection, GAB, 7 Events, HUF, LA MF, diversification', async () => {
        const r = await askI('cross sell up sell opportunities for ZZ Intel Client');
        clean(r);
        const need = [/SIP step-up \/ top-up: 1 \(₹14,000\)/, /idle cash → STP into Flexi Cap \/ Multi-Asset: 1 \(₹1,21,500\)/, /FSL \/ protection/, /GAB \(Golden Age Blueprint\)/, /7 Events blueprint/,
          /HUF folio/, /LA MF \(loan against mutual funds\): 1 \(₹6,34,500\)/, /Multi-Asset \/ Gold \/ Debt diversification/];
        const missing = need.filter((re) => !re.test(r.text)).map(String);
        if (missing.length || !r.charts.some((c) => c.module === 'opportunities' && c.kind === 'donut') || !r.charts.some((c) => c.module === 'opportunities' && c.kind === 'hbar')) throw new Error(JSON.stringify({ missing, text: r.text.slice(0, 700) }));
        return '8 opportunities, each with its amount where there is one';
      });

      await step('risk analysis: Sharpe, beta, μ, σ and the μ ± σ spread drawn on the risk card', async () => {
        const r = await askI('risk analysis sharpe beta standard deviation of ZZ Intel Client');
        clean(r);
        const card = r.dom.find((d) => d.kind === 'risk');
        const m = r.text.match(/Sharpe ratio (-?[\d.]+) · Beta \(β\) ([\d.]+) · Expected return \(μ\) ([\d.]+)% · Standard deviation \(σ\) ([\d.]+)%/);
        const kp = r.dom.find((d) => d.kind === 'kpis' && /Sharpe ratio/.test(d.text) && /Volatility \(σ\)/.test(d.text));
        const contrib = r.charts.find((c) => c.kind === 'donut' && /Where the risk comes from/.test(c.title));
        if (!m || !card || card.svg !== 'ria-risk' || !/μ − σ/.test(card.text) || !/μ \+ σ/.test(card.text) || !kp || !contrib || !/not computed from NAV history/.test(r.text))
          throw new Error(JSON.stringify({ card, text: r.text.slice(0, 500) }));
        const [mu, sigma, sharpe] = [Number(m[3]), Number(m[4]), Number(m[1])];
        if (Math.abs(sharpe - (mu - 6.5) / sigma) > 0.02) throw new Error('Sharpe ' + sharpe + ' is not (μ − 6.5) / σ');
        return 'Sharpe ' + m[1] + ', β ' + m[2] + ', μ ' + m[3] + '%, σ ' + m[4] + '%; spread drawn';
      });

      await step('GAB, bucket strategy, HUF ("huff suggestion"), trust & legacy: buckets on the real corpus, with a donut', async () => {
        const r = await askI('GAB bucket strategy huff suggestion and trust legacy planning for ZZ Intel Client');
        clean(r);
        const need = [/Bucket 1 · Immediate cash \(0–2Y\) \(15%\): ₹2,82,750/, /Bucket 2 · Medium-term stability \(3–6Y\) \(35%\): ₹6,59,750/, /Bucket 3 · Long-term growth \(7Y\+\) \(50%\): ₹9,42,500/,
          /GAB SWP income: ₹6,283 to ₹7,854 a month/, /₹9,425 at 6%/, /HUF \(Hindu Undivided Family\)/, /Private Family Trust/, /0 of 1 client have a nominee on file/];
        const missing = need.filter((re) => !re.test(r.text)).map(String);
        const titles = r.charts.map((c) => c.title).join(' | ');
        if (missing.length || !r.dom.some((d) => d.kind === 'donut' && /Recommended 3-bucket split/.test(d.text)) || !/Recommended scheme allocation/.test(titles) || !/monthly SWP income/.test(titles)
          || !/HUF: tax saving it adds/.test(titles) || !/Legacy readiness/.test(titles)) throw new Error(JSON.stringify({ missing, titles, text: r.text.slice(0, 700) }));
        return 'split 15/35/50 → ₹2,82,750 / ₹6,59,750 / ₹9,42,500; charts: ' + r.charts.length + ' (split donut, scheme allocation, SWP, HUF, legacy)';
      });

      await step('future projection: 3 to 20 years at 9 / 12 / 15%, as a fan chart', async () => {
        const r = await askI('future projection of ZZ Intel Client');
        clean(r);
        const ten = '10 years: ' + inr(fv(9, 10)) + ' / ' + inr(fv(12, 10)) + ' / ' + inr(fv(15, 10));
        const line = r.dom.find((d) => d.kind === 'line');
        if (!r.text.includes(ten) || !line || line.svg !== 'ria-line' || !/20Y/.test(line.text) || !r.charts.some((c) => c.kind === 'donut' && /money put in vs wealth gained/.test(c.title)))
          throw new Error(JSON.stringify({ ten, text: r.text.slice(0, 600) }));
        return ten;
      });

      await step('the book: "risk analysis of our book" covers every visible client', async () => {
        const r = await askI('risk analysis of our book');
        clean(r);
        if (!r.intel || r.intel.scope.kind !== 'book' || r.intel.scope.clients !== 11 || !r.charts.some((c) => c.kind === 'risk')) throw new Error(JSON.stringify(r.intel));
        return r.intel.scope.label;
      });

      const sugg = async (q, want) => {
        const r = await askI(q);
        clean(r);
        const kinds = r.charts.map((c) => c.kind), has = (k) => kinds.includes(k);
        const bad = want.filter((k) => !has(k));
        if (bad.length || !(has('donut') || has('donut2')) || !r.pdfButton || r.dom.length !== r.charts.length) throw new Error(JSON.stringify({ q, kinds, bad, scope: r.intel && r.intel.scope }));
        return r;
      };
      await step('suggestion questions draw their suggestions: "give me suggestion of buckket strategy" (no client) — the 15/35/50 split on ₹1 crore', async () => {
        const r = await sugg('give me suggestion of buckket strategy', ['kpis', 'donut', 'hbar']);
        if (r.intel.scope.kind !== 'model' || !/₹15,00,000/.test(r.text) || !/₹35,00,000/.test(r.text) || !/₹50,00,000/.test(r.text) || !/ABSL Arbitrage/.test(r.text))
          throw new Error(JSON.stringify({ scope: r.intel.scope, text: r.text.slice(0, 500) }));
        return r.charts.map((c) => c.kind).join(' + ') + ' on ' + r.intel.scope.label;
      });
      await step('"suggestions of GAB, huff, trust, legacy" — split donut, scheme allocation, SWP and HUF charts', async () => {
        const r = await sugg('suggestions of GAB, huff, trust, legacy', ['donut', 'hbar']);
        const t = r.charts.map((c) => c.title).join(' | ');
        if (r.intel.scope.kind !== 'model' || !/HUF: tax saving it adds/.test(t) || !/monthly SWP income/.test(t)) throw new Error(t);
        return r.charts.length + ' charts';
      });
      await step('"risky to safe switch" across the book — current vs suggested donuts and the action charts', async () => {
        const r = await sugg('risky to safe switch', ['donut2', 'hbar']);
        if (r.intel.scope.kind !== 'book') throw new Error(JSON.stringify(r.intel.scope));
        return r.charts.map((c) => c.kind).join(' + ');
      });
      await step('"tax harvesting" across the book — the gain pie and before / after', async () => {
        const r = await sugg('tax harvesting', ['donut', 'hbar']);
        return r.charts.map((c) => c.kind).join(' + ');
      });
      await step('"complete risk analysis" is the risk analysis: KPI cards, risk card, contribution donut', async () => {
        const r = await sugg('complete risk analysis', ['kpis', 'risk', 'donut']);
        if (r.intel.modules.join() !== 'risk') throw new Error(r.intel.modules.join());
        return r.charts.map((c) => c.kind).join(' + ');
      });

      await step('a multi-chart answer opens at its start: the question at the top of the panel, never the bottom of the last chart', async () => {
        await askI('portfolio analysis of ZZ Intel Client');
        const m = await pg2.evaluate(() => {
          const box = document.getElementById('aiTurns'), b = box.getBoundingClientRect();
          const me = [...box.querySelectorAll('.ai-turn.ai-me')].pop(), bot = [...box.querySelectorAll('.ai-turn.ai-bot')].pop();
          const q = me.getBoundingClientRect(), a = bot.querySelector('.ai-bubble').getBoundingClientRect();
          return { qTop: Math.round(q.top - b.top), aTop: Math.round(a.top - b.top), view: Math.round(b.height), scrollTop: Math.round(box.scrollTop),
            bottom: Math.round(box.scrollHeight - box.clientHeight), turns: box.querySelectorAll('.ai-turn').length };
        });
        if (m.turns < 6 || m.bottom < 400 || m.qTop < 0 || m.qTop > 24 || m.aTop < 0 || m.aTop > m.view - 30 || m.bottom - m.scrollTop < 300) throw new Error(JSON.stringify(m));
        /* A tab inside the dashboard leaves the panel where it is. */
        const tab = await pg2.evaluate(() => {
          const box = document.getElementById('aiTurns'), dash = [...box.querySelectorAll('.ria-dash')].pop();
          const btn = [...dash.querySelectorAll('.ria-dash-tab')].find((x) => x.textContent === 'Pie');
          btn.scrollIntoView({ block: 'center' });
          const before = btn.getBoundingClientRect().top; btn.click();
          const after = btn.getBoundingClientRect().top;
          const shown = [...dash.querySelectorAll('.ria-chart')].filter((el) => el.style.display !== 'none').map((el) => el.dataset.group);
          return { moved: Math.round(after - before), atBottom: Math.round(box.scrollHeight - box.clientHeight - box.scrollTop) < 2, shown: [...new Set(shown)] };
        });
        if (Math.abs(tab.moved) > 2 || tab.shown.some((g) => g !== 'pie' && g !== 'kpis')) throw new Error(JSON.stringify(tab));
        return 'question ' + m.qTop + 'px from the top, answer starts at ' + m.aTop + 'px of ' + m.view + 'px; ' + (m.bottom - m.scrollTop) + 'px of charts below; the Pie tab moved the panel ' + tab.moved + 'px';
      });

      const MASTER = 'Show complete portfolio analysis, asset allocation donut chart, buy sell hold switch, risky to safe switch, tax harvesting, cross selling and up selling, complete risk analysis (Sharpe ratio, Beta, Standard Deviation), GAB bucket strategy, HUF suggestion, trust and legacy planning, and future portfolio projection with graphical charts and PDF';
      await step('the master prompt (with "tax harvesting" and "HUF suggestion" in it) is all seven analyses, never "Tax Status (Clients)", and its PDF is the advisory deck', async () => {
        const dl = pg2.waitForEvent('download', { timeout: 20000 });
        const r = await askI(MASTER);
        clean(r);
        const f = fs.readFileSync(await (await dl).path());
        const info = await pg2.evaluate((i) => { const t = ai.turns[i]; const b = bossTurnPdfBlocks(i);
          return { chart: t.chart ? t.chart.title : null, mods: t.intel ? t.intel.modules : [], kinds: [...new Set(b.map((x) => x.t))], first: b[0] && b[0].t,
            text: b.map((x) => [x.text, x.title, x.subtitle, x.label, x.value].concat((x.rows || []).flat ? (x.rows || []).flat().map(String) : [], (x.lines || [])).filter(Boolean).join(' ')).join(' | '),
            content: t.content, dom: document.getElementById('aiTurns').innerText, sections: document.querySelectorAll('#aiTurns .ria-dash .ria-sec').length }; }, r.i);
        const kinds = new Set(r.charts.map((c) => c.module + ':' + c.kind));
        const need = ['portfolio:donut', 'portfolio:area', 'actions:donut2', 'tax:hbar', 'tax:donut', 'risk:risk', 'plan:donut', 'plan:hbar', 'opportunities:hbar', 'projection:line'];
        const missing = need.filter((k) => !kinds.has(k));
        const NOISE = /Tax Status \(Clients\)|99\.9% Not recorded|Market zone: not set|\(drawn below\)|could not be read from the scheme name/;
        if (info.chart || info.mods.length !== 7 || missing.length || NOISE.test(info.content + info.dom + info.text) || info.first !== 'banner' || info.sections < 7
          || !['banner', 'cards', 'panel', 'donutTable', 'donutPair', 'gbars', 'lines', 'bell'].every((k) => info.kinds.includes(k)) || f.slice(0, 5).toString() !== '%PDF-')
          throw new Error(JSON.stringify({ chart: info.chart, mods: info.mods, missing, kinds: info.kinds, first: info.first, sections: info.sections, noise: (info.content + info.dom + info.text).match(NOISE) }));
        return info.mods.length + ' analyses, ' + r.charts.length + ' charts in ' + info.sections + ' sections; PDF ' + f.length + ' bytes opening on the banner; no tax-status chart, no noise';
      });
      await step('"tax status wise chart of clients": tax status read from the PAN where it is blank, never "Not recorded"', async () => {
        const r = await askI('tax status wise chart of clients');
        clean(r);
        const d = await pg2.evaluate(() => { const t = ai.turns[ai.turns.length - 1]; return ((t.charts || []).find((c) => c.kind === 'donut') || { items: [] }).items.map((i) => i.label + ' ' + i.value); });
        if (!d.includes('HUF (from PAN) 1') || !d.includes('Individual (from PAN) 1') || !d.includes('Individual 1') || d.some((l) => /Not recorded/.test(l))) throw new Error(JSON.stringify(d));
        return d.join(', ');
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
        const want = ['Freedom LifeX Wealth Advisory Report', 'ZZ Intel Client', 'Executive summary', 'Asset allocation', 'Tax harvesting', 'Risk analytics', 'Future projection',
          'Cross-sell', 'Std dev (sigma)', 'Mean return (mu)', 'Recommended 3-bucket split', 'Current vs suggested', 'Generated by RIA AI from live BOSS records. Human advisor approval required before execution.'];
        const missing = want.filter((w) => !info.text.includes(w));
        if (f1.slice(0, 5).toString() !== '%PDF-' || f2.slice(0, 5).toString() !== '%PDF-' || info.head !== '%PDF-' || missing.length
          || !['banner', 'cards', 'panel', 'donutTable', 'donutPair', 'gbars', 'lines', 'bell', 'table', 'meter'].every((k) => info.kinds.includes(k)))
          throw new Error(JSON.stringify({ h1: f1.slice(0, 8).toString(), h2: f2.slice(0, 8).toString(), missing, kinds: info.kinds }));
        return r.charts.length + ' charts across ' + mods.size + ' modules; PDF ' + d1.suggestedFilename() + ' (' + f1.length + ' bytes, ' + info.blocks + ' blocks) on request and ' + f2.length + ' bytes from the button';
      });

      /* ---- the guided desk ---- */
      const deskClients = clients.concat([
        { id: 'CMS-D1', cmsName: 'ZZ Ravi Kumar', rmName: '', branch: 'Varanasi Branch', createdAt: '2026-10-05T10:00:00.000Z', pan: 'ABCPK1234Q', mobile: '9876500001', canIinNo: 'IIN5001', mandateStatus: 'Approved',
          mandateType: 'E-Mandate', bankName: 'HDFC Bank', ifsc: 'HDFC0001234', accNo: '123456789012', dob: '1960-03-15', kycStatus: 'Validated' },
        { id: 'CMS-D2', cmsName: 'ZZ Amit Verma', rmName: '', branch: 'Mumbai', pan: 'ABCPV2222R', dob: '1990-07-02' },
        { id: 'CMS-D3', cmsName: 'ZZ Amit Shah', rmName: '', branch: 'Pune', pan: 'ABCPS3333T', kycStatus: 'On Hold' },
        { id: 'CMS-D4', cmsName: 'ZZ Varanasi One', rmName: '', branch: 'Varanasi Branch', dob: '1985-01-20', createdAt: '2026-09-01T10:00:00.000Z' },
        { id: 'CMS-D5', cmsName: 'ZZ Varanasi Two', rmName: '', branch: 'Varanasi Branch', dob: '1950-11-05', createdAt: '2026-11-02T10:00:00.000Z' },
        { id: 'CMS-D6', cmsName: 'ZZ Varanasi Three', rmName: '', branch: 'Varanasi' },
        { id: 'CMS-PR1', cmsName: 'Mrs. Priya Sharma', rmName: '', branch: 'Mumbai', pan: 'ABCPS1111S', mobile: '9811100001', email: 'priya.s@example.test', dob: '1980-04-10' },
        { id: 'CMS-PR2', cmsName: 'Priya Verma', rmName: '', branch: 'Delhi', pan: 'ABCPV2222V', mobile: '9811100002', email: 'priya.v@example.test', dob: '1985-06-21', kycStatus: 'Validated' },
        { id: 'CMS-PR3', cmsName: 'Priya Nair', rmName: '', branch: 'Pune', pan: 'ABCPN4444N', mobile: '9811100003', email: 'priya.n@example.test', dob: '1992-02-02',
          kycStatus: 'Validated', mandateStatus: 'Approved', firstNomineeName: 'Ravi Nair', firstNomineeRelation: 'Spouse', mailingCity: 'Pune', mailingState: 'Maharashtra' },
        { id: 'CMS-PR4', cmsName: 'Priya Gupta', rmName: '', branch: 'Lucknow', pan: 'ABCPG5555G', mobile: '9811100004', email: 'priya.g@example.test', dob: '1975-12-30' }]);
      await admin.put('/api/storage/clients', { value: JSON.stringify(deskClients) });
      await admin.put('/api/storage/platformSips', { value: JSON.stringify([{ id: 'PFS-I1', clientId: 'CMS-I1', schemeName: 'Parag Parikh Flexi Cap Reg Gr', monthlyAmount: 5000, amount: 5000 },
        { id: 'PFS-D1', clientId: 'CMS-D1', schemeName: 'HDFC Flexi Cap Reg Gr', monthlyAmount: 5000, amount: 5000, sipDate: 10 }]) });
      const lm = new Date(); lm.setDate(1); lm.setMonth(lm.getMonth() - 1);
      const lastMonthDay = (d) => new Date(lm.getFullYear(), lm.getMonth(), d, 12).toISOString();
      await admin.put('/api/storage/transactions', { value: JSON.stringify([
        { id: 'TX-S1', clientId: 'CMS-D1', initiatedDate: '2026-10-10', transactionType: 'Purchase', amount: 50000, status: 'Completed' },
        { id: 'TX-S2', clientId: 'CMS-D1', initiatedDate: '2026-11-25', transactionType: 'SIP', amount: 5000, status: 'Pending' },
        { id: 'TX-S3', clientId: 'CMS-D2', initiatedDate: '2026-10-12', transactionType: 'Purchase', amount: 70000, status: 'Completed' }]) });
      await admin.put('/api/storage/platformHoldings', { value: JSON.stringify(H.map((h, i) => ({ id: 'PFH-I' + i, clientId: 'CMS-I1', schemeName: h[0], invested: h[1], current: h[2], purchaseDate: h[3] }))
        .concat([{ id: 'PFH-D1', clientId: 'CMS-D1', schemeName: 'HDFC Flexi Cap Reg Gr', invested: 1000000, current: 1500000 }])) });
      const sliceLeads = [
        { id: 'LMS-S1', firstName: 'ZZ Lead', lastName: 'Oct A', branch: 'Mumbai', createdAt: '2026-10-20T10:00:00.000Z' },
        { id: 'LMS-S2', firstName: 'ZZ Lead', lastName: 'Oct B', branch: 'Mumbai', createdAt: '2026-10-03T10:00:00.000Z' },
        { id: 'LMS-S3', firstName: 'ZZ Lead', lastName: 'Last Month', branch: 'Mumbai', createdAt: lastMonthDay(15) },
        { id: 'LMS-S4', firstName: 'ZZ Lead', lastName: 'Pune', branch: 'Pune', createdAt: '2026-10-05T10:00:00.000Z' }];
      await admin.put('/api/storage/leads', { value: JSON.stringify(sliceLeads) });
      await admin.put('/api/storage/businessEntries', { value: JSON.stringify([
        { id: 'DBT-S1', entryDate: '2026-11-03', product: 'Mutual Fund', transactionType: 'Lumpsum', amount: 200000, branch: 'Varanasi Branch', clientId: 'CMS-D1' },
        { id: 'DBT-S2', entryDate: '2026-10-21', product: 'Mutual Fund', transactionType: 'SIP', amount: 10000, branch: 'Varanasi Branch', clientId: 'CMS-D4' },
        { id: 'DBT-S3', entryDate: '2026-10-22', product: 'Insurance', transactionType: 'New', amount: 30000, branch: 'Mumbai' }]) });
      await admin.put('/api/storage/callEntries', { value: JSON.stringify([
        { id: 'CALL-S1', callDate: '2026-11-04', callType: 'Outbound', outcome: 'Connected', branch: 'Varanasi Branch', clientId: 'CMS-D1' },
        { id: 'CALL-S2', callDate: '2026-11-05', callType: 'Inbound', outcome: 'Callback', branch: 'Pune' }]) });
      const pg3 = await (await browser.newContext({ acceptDownloads: true })).newPage();
      await signIn(pg3, srv.base); await ready(pg3);
      await pg3.evaluate(async () => { await aiRefreshStatus(true); ai.turns = []; ai.open = true; aiDrawPanel(); });
      const click = (sel, text) => pg3.evaluate(async ({ sel, text }) => {
        const el = [...document.querySelectorAll(sel)].reverse().find((b) => b.textContent.replace(/\s+/g, ' ').trim().includes(text));
        if (!el) throw new Error('no button "' + text + '"');
        const t0 = performance.now(); el.click(); await new Promise((r) => setTimeout(r, 30));
        return Math.round(performance.now() - t0 - 30);
      }, { sel, text });
      const lastBot = () => pg3.evaluate(() => { const t = ai.turns[ai.turns.length - 1] || {}; return { role: t.role, text: String(t.content || ''), ui: t.ui ? { kind: t.ui.kind, items: (t.ui.items || []).map((i) => i.label) } : null,
        actions: (t.actions || []).map((a) => a.label), table: t.table ? { title: t.table.title, cols: t.table.cols, rows: t.table.rows } : null, charts: (t.charts || []).map((c) => c.kind + ':' + c.title) }; });
      const typeIn = (q) => pg3.evaluate(async (q) => { const el = document.getElementById('aiInput'); el.value = q; ai.draft = q; const t0 = performance.now(); await aiSend(); return Math.round(performance.now() - t0); }, q);

      await step('the desk: "Hi <name>! Happy Morning / Afternoon / Evening.", six category tiles, and a ☰ menu button beside the input', async () => {
        const r = await pg3.evaluate(() => ({ greet: (document.querySelector('#aiTurns .ria-greet') || {}).textContent || '', tiles: [...document.querySelectorAll('#aiTurns .ria-tile .ria-tile-t')].map((x) => x.textContent),
          menu: !!document.querySelector('.ai-compose .ria-menu-btn') }));
        const want = ['Most Asked', 'Check Status', 'Statements & Reports', 'Portfolio & Advisory', 'Self Service & SOPs', 'Help & Support'];
        if (!/^Hi .+! Happy (Morning|Afternoon|Evening)\.$/.test(r.greet) || r.tiles.join() !== want.join() || !r.menu) throw new Error(JSON.stringify(r));
        await click('.ai-compose .ria-menu-btn', '☰');
        const b = await lastBot();
        if (!b.ui || b.ui.kind !== 'menu') throw new Error('☰ did not draw the menu: ' + JSON.stringify(b));
        return '"' + r.greet + '"; tiles: ' + r.tiles.join(' · ') + '; ☰ draws the menu again';
      });

      await step('Check Status → Mandate Status → 3. PAN Number → the PAN: mandate, IIN, bank and SIPs, with what-next buttons, no model call', async () => {
        const n = seen.length;
        await click('#aiTurns .ria-tile', 'Check Status');
        const subs = await pg3.evaluate(() => [...[...document.querySelectorAll('#aiTurns .ria-desk')].pop().querySelectorAll('.ria-sub')].map((x) => x.textContent.trim()));
        const ms = await click('#aiTurns .ria-sub', 'Mandate Status');
        const pick = await lastBot();
        if (!/Hi, I can instantly help you with \*\*Mandate Status\*\* of investors\. Click on any one to continue:/.test(pick.text) || pick.ui.items.length !== 6 || pick.ui.items[2] !== '3. PAN Number' || ms > 20)
          throw new Error(JSON.stringify({ subs, pick, ms }));
        await click('#aiTurns .ria-sub', '3. PAN Number');
        const ask = await lastBot();
        if (!/Please enter \*\*PAN No\.\*\* to continue/.test(ask.text)) throw new Error(ask.text);
        const ms2 = await typeIn('ABCPK1234Q');
        const a = await lastBot();
        const need = [/\*\*ZZ Ravi Kumar\*\*/, /\*\*Mandate status:\*\* Mandate approved/, /\*\*Mandate type:\*\* E-Mandate/, /\*\*Bank:\*\* HDFC Bank · IFSC HDFC0001234 · A\/c ending 9012/,
          /\*\*IIN \/ UCC:\*\* IIN5001/, /\*\*Active SIPs:\*\* 1 — ₹5,000 a month/];
        const missing = need.filter((re) => !re.test(a.text)).map(String);
        const acts = ['KYC & IIN Status', 'Mandate Status', 'Active SIPs', 'Transactions', 'Portfolio & Risk Charts', '⬇ Download PDF', '↗ Open Account', '☰ Main Menu'];
        if (missing.length || acts.some((x) => !a.actions.includes(x)) || seen.length !== n || /ABCPK1234Q/.test(a.text)) throw new Error(JSON.stringify({ missing, a, calls: seen.length - n }));
        await click('#aiTurns .ria-act', 'Active SIPs');
        const sip = await lastBot();
        if (!sip.table || sip.table.rows[0][0] !== 'HDFC Flexi Cap Reg Gr') throw new Error(JSON.stringify(sip));
        return 'sub-options: ' + subs.length + '; options in ' + ms + ' ms; answer in ' + ms2 + ' ms, 0 model calls; PAN shown masked; Active SIPs → ' + sip.table.rows[0][0];
      });

      await step('1. Investor Name with a name two clients share → a list to click → the client picked', async () => {
        await click('.ai-compose .ria-menu-btn', '☰');
        await click('#aiTurns .ria-tile', 'Check Status');
        await click('#aiTurns .ria-sub', 'KYC & Account Opening Status');
        await click('#aiTurns .ria-sub', '1. Investor Name');
        await typeIn('ZZ Amit');
        const list = await lastBot();
        if (!list.ui || list.ui.items.length !== 2 || !/Found \*\*2 clients\*\* matching ‘ZZ Amit’\. Click the exact client \(by full name\)/.test(list.text) || !list.ui.items.every((x) => /ZZ Amit/.test(x))) throw new Error(JSON.stringify(list));
        await click('#aiTurns .ria-sub', 'ZZ Amit Shah');
        const a = await lastBot();
        if (!/\*\*ZZ Amit Shah\*\*/.test(a.text) || !/\*\*KYC status:\*\* On hold \/ rejected — physical KYC needed/.test(a.text)) throw new Error(a.text);
        return list.ui.items.join(' | ') + ' → ZZ Amit Shah: KYC on hold';
      });

      await step('"Varanasi branch ke clients ka date of birth wise data dikhao": "Varanasi" and "Varanasi Branch" alike, DOB table, age / birth-month charts, Excel', async () => {
        const n = seen.length;
        await typeIn('Varanasi branch ke clients ka date of birth wise data dikhao');
        const a = await lastBot();
        const names = a.table ? a.table.rows.map((r) => r[0]) : [];
        const want = deskClients.filter((c) => /varanasi/i.test(c.branch || '')).length;          // "Varanasi" and "Varanasi Branch"
        if (!a.table || a.table.rows.length !== want || names.slice(0, 3).join() !== 'ZZ Varanasi One,ZZ Ravi Kumar,ZZ Varanasi Two' || !a.table.cols.includes('Age group')
          || !a.table.rows.slice(3).every((r) => r[4] === 'DOB not on file') || !a.table.rows.some((r) => r[6] === 'Varanasi') || !a.table.rows.some((r) => r[6] === 'Varanasi Branch')
          || !a.charts.some((c) => /^donut:Age group/.test(c)) || !a.charts.some((c) => /^hbar:Birth month/.test(c)) || seen.length !== n) throw new Error(JSON.stringify(a));
        const dl = pg3.waitForEvent('download', { timeout: 10000 });
        await click('#aiTurns .ria-act', '⬇ Download Excel');
        const f = fs.readFileSync(await (await dl).path());
        const read = await pg3.evaluate(() => aiReadSource('clients', { where: [{ col: 'branch', op: 'eq', value: 'Varanasi' }], cols: ['name', 'branch', 'dob', 'ageGroup', 'birthMonth'] }));
        if (f.slice(0, 2).toString() !== 'PK' || read.total !== want) throw new Error('excel ' + f.slice(0, 2) + ' / read ' + read.total);
        return want + ' clients ("Varanasi" + "Varanasi Branch"), birthday order: ' + names.slice(0, 3).join(', ') + ', then no DOB; Excel ' + f.length + ' bytes; aiReadSource branch = "Varanasi" → ' + read.total;
      });

      await step('the same list the guided way: Statements & Reports → Branch-wise Client / DOB Report → 5. Branch / RM → the Varanasi chip', async () => {
        await click('.ai-compose .ria-menu-btn', '☰');
        await click('#aiTurns .ria-tile', 'Statements & Reports');
        await click('#aiTurns .ria-sub', 'Branch-wise Client / DOB Report');
        await click('#aiTurns .ria-sub', '5. Branch / RM Name');
        const chips = await lastBot();
        if (!chips.ui || !chips.ui.items.some((x) => /^Varanasi Branch \(3\)$/.test(x))) throw new Error(JSON.stringify(chips));
        await click('#aiTurns .ria-sub', 'Varanasi Branch (3)');
        const a = await lastBot();
        const want = deskClients.filter((c) => /varanasi/i.test(c.branch || '')).length;
        if (!a.table || a.table.rows.length !== want || !a.actions.includes('DOB & Age List') || !a.actions.includes('⬇ Download Excel')) throw new Error(JSON.stringify(a).slice(0, 400));
        return 'chips: ' + chips.ui.items.slice(0, 4).join(', ') + ' → ' + a.table.rows.length + ' clients';
      });

      const riaDateText = (d) => { const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']; const [y, mo, da] = d.split('-'); return da + ' ' + m[+mo - 1] + ' ' + y; };
      const ageOf = (d) => { const b = new Date(d), n = new Date(); let a = n.getFullYear() - b.getFullYear(); const m = n.getMonth() - b.getMonth(); if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--; return a; };
      await step('"Priya ka date of birth aur PAN card no batao" with four Priyas: all four by full name to click, then her DOB, age, PAN, mobile, email, branch, KYC, mandate, AUM', async () => {
        const n = seen.length;
        await typeIn('Priya ka date of birth aur PAN card no batao');
        const list = await lastBot();
        const names = list.ui ? list.ui.items : [];
        if (!/Found \*\*4 clients\*\* matching ‘priya’\. Click the exact client \(by full name\) to continue:/.test(list.text) || names.length !== 4
          || !names.some((x) => /^\d\. Mrs\. Priya Sharma · Mumbai · CMS-PR1 · PAN: …111S · Mob: …0001 · DOB 10 Apr 1980$/.test(x)) || !names.some((x) => /Priya Nair · Pune/.test(x)))
          throw new Error(JSON.stringify(list));
        await click('#aiTurns .ria-sub', 'Priya Nair');
        const a = await lastBot();
        const need = ['**Priya Nair — Date of Birth:** 02 Feb 1992 (Age: ' + ageOf('1992-02-02') + ' yrs) · **PAN:** ABCPN4444N', '**Client Personal & KYC Profile**',
          '**Mobile no.:** 9811100003', '**Email ID:** priya.n@example.test', '**Branch:** Pune', '**KYC status:** KYC validated', '**Mandate status:** Mandate approved',
          '**Nominee:** Ravi Nair (Spouse)', '**Address:** Pune, Maharashtra', '**Total AUM:**', '**Relationship manager:**'];
        const missing = need.filter((x) => !a.text.includes(x));
        if (missing.length || !a.text.startsWith(need[0]) || !a.actions.includes('Personal Profile & DOB / PAN') || !a.actions.includes('↗ Open Account') || seen.length !== n) throw new Error(JSON.stringify({ missing, text: a.text.slice(0, 400), calls: seen.length - n }));
        return names.length + ' listed (' + names.map((x) => x.split(' · ')[0].replace(/^\d\. /, '')).join(', ') + '); picked Priya Nair → ' + need[0].replace(/\*\*/g, '');
      });

      await step('the list answered by number: "Priya ka mobile number" → "2" → that Priya, mobile first', async () => {
        await typeIn('Priya ka mobile number');
        const list = await lastBot();
        const second = list.ui.items[1].split(' · ')[0].replace(/^2\. /, '');
        await typeIn('2');
        const a = await lastBot();
        if (!a.text.startsWith('**' + second + ' — Mobile:** 981110000') || !/\*\*Client Personal & KYC Profile\*\*/.test(a.text)) throw new Error(JSON.stringify({ second, text: a.text.slice(0, 300) }));
        return '"2" → ' + a.text.split('\n')[0].replace(/\*\*/g, '');
      });

      await step('a unique client: "ZZ Ravi Kumar ka DOB aur PAN card no batao" → DOB and PAN at once', async () => {
        await typeIn('ZZ Ravi Kumar ka DOB aur PAN card no batao');
        const a = await lastBot();
        const want = '**ZZ Ravi Kumar — Date of Birth:** 15 Mar 1960 (Age: ' + ageOf('1960-03-15') + ' yrs) · **PAN:** ABCPK1234Q';
        if (!a.text.startsWith(want) || a.ui) throw new Error(a.text.slice(0, 300));
        return want.replace(/\*\*/g, '');
      });

      await step('"Priya ka portfolio": the question waits for the pick, then is answered for that Priya', async () => {
        gemini('503');
        await typeIn('Priya ka portfolio dikhao aur analysis karo');
        const list = await lastBot();
        if (!list.ui || list.ui.items.length !== 4) throw new Error(JSON.stringify(list));
        await click('#aiTurns .ria-sub', 'Priya Gupta');
        await pg3.waitForFunction(() => !ai.busy, null, { timeout: 15000 });
        const r = await pg3.evaluate(() => { const t = ai.turns[ai.turns.length - 1]; const u = ai.turns[ai.turns.length - 2];
          return { text: String(t.content || ''), user: u && u.content, scope: t.intel ? t.intel.scope.label : '', forced: ai.forceClient }; });
        if (!/Priya Gupta/.test(r.text + r.scope) || /Priya (Sharma|Verma|Nair)/.test(r.text) || r.forced) throw new Error(JSON.stringify(r).slice(0, 400));
        return 'answered for ' + (r.scope || 'Priya Gupta') + ' after the pick';
      });

      const varanasi = deskClients.filter((c) => /varanasi/i.test(c.branch || ''));
      const sliceOf = async (q) => { await typeIn(q); return lastBot(); };
      const isSlice = (a) => a.table && a.actions.includes('⬇ Download Excel') && a.actions.includes('⬇ Download CSV') && a.actions.includes('⬇ Download PDF');
      await step('"Varanasi branch ke clients date wise dikhao": every Varanasi / Varanasi Branch client, in the order they were added, with a dashboard and downloads', async () => {
        const n = seen.length;
        const a = await sliceOf('Varanasi branch ke clients date wise dikhao');
        const names = a.table ? a.table.rows.map((r) => r[0]) : [];
        if (!isSlice(a) || !/^\*\*Varanasi branch — Date-wise clients \(\d+ records\):\*\*/.test(a.text) || a.table.rows.length !== varanasi.length || names.slice(0, 3).join() !== 'ZZ Varanasi One,ZZ Ravi Kumar,ZZ Varanasi Two'
          || a.table.cols[1] !== 'Date added' || !a.charts.some((c) => /^donut:KYC status/.test(c)) || !a.charts.some((c) => /^hbar:Month-wise/.test(c)) || seen.length !== n) throw new Error(JSON.stringify(a).slice(0, 500));
        return a.text.split('\n')[0].replace(/\*\*/g, '') + ' — first: ' + names.slice(0, 3).join(', ');
      });
      await step('"Varanasi branch ke March birthday wale clients" → the March birthday; "… May …" → none, said so', async () => {
        const a = await sliceOf('Varanasi branch ke March birthday wale clients');
        if (!isSlice(a) || a.table.rows.length !== 1 || a.table.rows[0][0] !== 'ZZ Ravi Kumar' || a.table.cols[1] !== 'Date of birth' || !/Birthday mar/i.test(a.text)) throw new Error(JSON.stringify(a).slice(0, 400));
        const b = await sliceOf('Varanasi branch ke May birthday wale clients');
        if (!b.table || b.table.rows.length !== 0 || !/Nothing in your visible records matches all of these filters/.test(b.text)) throw new Error(JSON.stringify(b).slice(0, 400));
        return 'March: ZZ Ravi Kumar; May: none';
      });
      await step('"Varanasi branch ke pending KYC clients" and "… 60+ age wale clients": branch and status, branch and age', async () => {
        const a = await sliceOf('Varanasi branch ke pending KYC clients');
        const want = varanasi.filter((c) => c.kycStatus !== 'Validated').length;
        if (!isSlice(a) || a.table.rows.length !== want || a.table.rows.some((r) => r[6] === 'KYC validated') || !/Pending KYC/.test(a.text)) throw new Error(JSON.stringify(a).slice(0, 400));
        const b = await sliceOf('Varanasi branch ke 60+ age wale clients');
        const names = b.table ? b.table.rows.map((r) => r[0]).sort().join() : '';
        if (!isSlice(b) || names !== 'ZZ Ravi Kumar,ZZ Varanasi Two' || !/Age 60\+/.test(b.text)) throw new Error(JSON.stringify(b).slice(0, 400));
        return 'pending KYC: ' + want + ' of ' + varanasi.length + '; 60+: ' + names;
      });
      await step('"1 Oct se 18 Nov tak Varanasi branch ke transactions" and "Varanasi branch clients with AUM above 10 lakh"', async () => {
        const a = await sliceOf('1 Oct se 18 Nov tak Varanasi branch ke transactions');
        if (!isSlice(a) || a.table.rows.length !== 1 || a.table.rows[0][0] !== 'ZZ Ravi Kumar' || a.table.rows[0][4] !== '₹50,000' || a.table.cols[1] !== 'Date') throw new Error(JSON.stringify(a).slice(0, 400));
        const b = await sliceOf('Varanasi branch clients with AUM above 10 lakh');
        /* a list by money: Client ID | Client Name | Branch | Mobile | AUM | Monthly SIP, counted against the book */
        if (b.table.rows.length !== 1 || b.table.rows[0][1] !== 'ZZ Ravi Kumar' || b.table.rows[0][4] !== '₹15,00,000' || !/AUM above 10 lakh/.test(b.text) || !/^📊 \*\*Total Clients in Book:\*\* \d+ \| \*\*Matching Clients:\*\* 1 \|/.test(b.text)
          || !b.actions.includes('📄 Download PDF (1 clients)') || !b.actions.includes('📊 Download Excel (.xlsx)')) throw new Error(JSON.stringify(b).slice(0, 400));
        return 'transactions 1 Oct–18 Nov: ' + a.table.rows.length + ' (₹50,000); AUM > ₹10 lakh: ZZ Ravi Kumar';
      });
      await step('leads by period: "Mumbai branch mein October 2026 ke leads date wise" and "… last month ke leads date wise"', async () => {
        const a = await sliceOf('Mumbai branch mein October 2026 ke leads date wise');
        const octWant = sliceLeads.filter((l) => l.branch === 'Mumbai' && l.createdAt.slice(0, 7) === '2026-10').map((l) => l.firstName + ' ' + l.lastName).sort((x, y) => x.localeCompare(y));
        const got = a.table ? a.table.rows.map((r) => r[0]) : [];
        if (!isSlice(a) || got.slice().sort().join() !== octWant.join() || got[0] !== 'ZZ Lead Oct B' || a.table.cols[1] !== 'Date added') throw new Error(JSON.stringify({ octWant, a }).slice(0, 500));
        const b = await sliceOf('Mumbai branch mein last month ke leads date wise');
        const lmKey = lm.getFullYear() + '-' + String(lm.getMonth() + 1).padStart(2, '0');
        const lmWant = sliceLeads.filter((l) => l.branch === 'Mumbai' && l.createdAt.slice(0, 7) === lmKey).length;
        if (!isSlice(b) || b.table.rows.length !== lmWant || !b.table.rows.some((r) => r[0] === 'ZZ Lead Last Month')) throw new Error(JSON.stringify({ lmWant, b }).slice(0, 500));
        return 'October 2026: ' + got.join(', ') + ' (oldest first); last month: ' + lmWant;
      });
      await step('business and calls: "Varanasi branch ka business date wise" and "Varanasi branch ke calls date wise"', async () => {
        const a = await sliceOf('Varanasi branch ka business date wise');
        if (!isSlice(a) || a.table.rows.length !== 2 || a.table.cols[0] !== 'Date' || a.table.rows[0][3] !== '₹10,000') throw new Error(JSON.stringify(a).slice(0, 400));
        const b = await sliceOf('Varanasi branch ke calls date wise');
        if (!isSlice(b) || b.table.rows.length !== 1 || b.table.rows[0][2] !== 'Connected') throw new Error(JSON.stringify(b).slice(0, 400));
        return 'business: ' + a.table.rows.map((r) => r[0] + ' ' + r[3]).join(', ') + '; calls: ' + b.table.rows.length;
      });
      await step('the guided desk: a branch\u2019s "Date-wise (created date)" button gives the same date-wise list', async () => {
        await click('.ai-compose .ria-menu-btn', '☰');
        await click('#aiTurns .ria-tile', 'Statements & Reports');
        await click('#aiTurns .ria-sub', 'Branch-wise Client / DOB Report');
        await click('#aiTurns .ria-sub', '5. Branch / RM Name');
        await click('#aiTurns .ria-sub', 'Varanasi Branch (');
        await click('#aiTurns .ria-act', 'Date-wise (created date)');
        const a = await lastBot();
        if (!isSlice(a) || a.table.rows.length !== varanasi.length || a.table.rows[0][0] !== 'ZZ Varanasi One' || !/Date-wise clients/.test(a.text)) throw new Error(JSON.stringify(a).slice(0, 400));
        return a.text.split('\n')[0].replace(/\*\*/g, '');
      });

      /* ---- one investor, three rows ---- */
      const VPAN = 'ABCPM3852Z';
      const splitRows = [
        { id: 'CMS-FZSM04857', cmsName: 'Vishal Kumar Maurya', rmName: '', branch: 'Varanasi Branch', pan: VPAN, mobile: '9800000001', email: 'vishal.m@example.test',
          createdAt: '2026-11-06T09:00:00.000Z', source: 'Platform upload · Finowise' },
        { id: 'CMS-2G3H35738', cmsName: 'Vishal Kumar Maurya - ' + VPAN, pan: VPAN, dob: '2001-08-14', branchName: 'Varanasi', rmName: 'Shubham', uccNo: '5014000001',
          mailingStreet: 'S/O: ZZ TEST MAURYA,ZZ VILLAGE,VARANASI,UTTAR PRADESH,221003', mailingCity: 'VARANASI', mailingState: 'UTTAR PRADESH', mailingZip: '221003',
          firstNomineeName: 'Renu Maurya', firstNomineeRelation: 'Mother', firstNomineeDob: '1977-03-12', createdAt: '2026-11-19T05:49:55.000Z' },
        { id: 'CMS-XMHVI0245', cmsName: 'Vishal Kumar Maurya - ' + VPAN, pan: VPAN, dob: '2001-08-14', branch: 'Varanasi', branchName: 'Varanasi', rmName: 'USR-GUWU16332', uccNo: '5014000001',
          mailingStreet: 'S/O: ZZ TEST MAURYA,ZZ VILLAGE,VARANASI,UTTAR PRADESH,221003', kycStatus: 'Validated', accountActivated: 'Yes', mandateType: 'E-Mandate',
          mandateStatus: 'Approved', firstNomineeName: 'Renu Maurya', createdAt: '2026-11-19T05:58:10.000Z' }];
      const otherMauryas = [
        { id: 'CMS-MS1', cmsName: 'Sunil Kumar Maurya', rmName: '', branch: 'Lucknow', pan: 'ABCPM1111M', mobile: '9800000002', dob: '1970-01-01' },
        { id: 'CMS-MA1', cmsName: 'Mr. Anil Maurya', rmName: '', branch: 'Delhi', pan: 'ABCPM2222N', mobile: '9800000003' },
        { id: 'CMS-PH1', cmsName: 'ZZ Placeholder Pan', rmName: '', branch: 'Delhi', pan: VPAN }];          // another person on the same PAN (a typo / dummy PAN)
      const splitPut = await admin.put('/api/storage/clients', { value: JSON.stringify(deskClients.concat(splitRows, otherMauryas)) });
      if (splitPut.status !== 200) throw new Error('clients not saved: ' + splitPut.status + ' ' + splitPut.text.slice(0, 200));
      /* added to what is there: the store refuses a save that drops records */
      const heldGot = await admin.get('/api/storage/platformHoldings'); const heldNow = JSON.parse((heldGot.json && heldGot.json.value) || '[]');
      if (!heldNow.length) throw new Error('could not read the holdings: ' + heldGot.status);
      const heldPut = await admin.put('/api/storage/platformHoldings', { value: JSON.stringify(heldNow.concat([{ id: 'PFH-V1', clientId: 'CMS-FZSM04857', schemeName: 'HDFC Flexi Cap Reg Gr', invested: 80000, current: 87494 }])) });
      if (heldPut.status !== 200) throw new Error('holdings not saved: ' + heldPut.status + ' ' + heldPut.text.slice(0, 200));
      await pg3.reload(); await ready(pg3);
      await pg3.evaluate(async () => { await aiRefreshStatus(true); ai.turns = []; ai.open = true; aiDrawPanel(); });
      const vAge = ageOf('2001-08-14');
      const vNeed = ['**Client Personal & KYC Profile**', '**Full name:** Vishal Kumar Maurya\n', '**Date of birth:** 14 Aug 2001 (Age: ' + vAge + ' yrs)', '**PAN card no.:** ' + VPAN,
        '**Client ID / Code:** 5014000001', '**IIN / UCC no.:** 5014000001 (activated: Yes)', '**KYC status:** KYC validated', '**Mandate status:** Mandate approved (E-Mandate)',
        '**Nominee:** Renu Maurya (Mother, DOB 12 Mar 1977)', '**Address:** S/O: ZZ TEST MAURYA,ZZ VILLAGE,VARANASI,UTTAR PRADESH,221003\n', '**Relationship manager:** Shubham',
        '**Branch:** Varanasi', '**Mobile no.:** 9800000001', '**Total AUM:** ₹87,494'];
      const vCheck = (a) => { const missing = vNeed.filter((x) => !a.text.includes(x)); if (missing.length || /not recorded/.test(a.text.split('**Anniversary')[0]) || /- ABCPM/.test(a.text)) throw new Error(JSON.stringify({ missing, text: a.text.slice(0, 900) })); };
      await step('one investor in three rows: "Vishal Kumar Maurya" and "Vishal Kumar Maurya ka date of birth batao" give one merged profile (DOB, PAN, UCC, KYC, mandate, nominee, address, RM, AUM)', async () => {
        const n = seen.length;
        await typeIn('Vishal Kumar Maurya');
        const a = await lastBot(); vCheck(a);
        await typeIn('Vishal Kumar Maurya ka date of birth batao');
        const b = await lastBot(); vCheck(b);
        if (!b.text.startsWith('**Vishal Kumar Maurya — Date of Birth:** 14 Aug 2001 (Age: ' + vAge + ' yrs)') || seen.length !== n) throw new Error(b.text.slice(0, 300));
        return b.text.split('\n')[0].replace(/\*\*/g, '') + '; RM Shubham, KYC validated, mandate approved (E-Mandate), AUM ₹87,494';
      });
      await step('"Maurya ka DOB batao" with three Mauryas (one of them in three rows): each person once, by full name, with branch, PAN and DOB; clicking Vishal gives the merged profile', async () => {
        await typeIn('Maurya ka DOB batao');
        const list = await lastBot();
        const items = list.ui ? list.ui.items : [];
        if (!/Found \*\*3 clients\*\* matching/.test(list.text) || items.length !== 3 || items.filter((x) => /Vishal Kumar Maurya/.test(x)).length !== 1
          || !items.some((x) => /^\d\. Vishal Kumar Maurya · Varanasi · 5014000001 · PAN: …852Z · Mob: …0001 · DOB 14 Aug 2001 · AUM /.test(x))
          || !items.some((x) => /Sunil Kumar Maurya · Lucknow/.test(x)) || !items.some((x) => /Anil Maurya · Delhi/.test(x)) || items.some((x) => /- ABCPM/.test(x))) throw new Error(JSON.stringify(list));
        await click('#aiTurns .ria-sub', 'Vishal Kumar Maurya');
        const a = await lastBot(); vCheck(a);
        if (!a.text.startsWith('**Vishal Kumar Maurya — Date of Birth:** 14 Aug 2001')) throw new Error(a.text.slice(0, 300));
        return items.map((x) => x.split(' · ')[0].replace(/^\d\. /, '')).join(', ') + ' → Vishal: DOB 14 Aug 2001, UCC 5014000001';
      });
      await step('"Varanasi branch ke clients ka date of birth wise data dikhao": the three-row investor once, with the DOB; the planner and Analytics count people, not rows', async () => {
        await typeIn('Varanasi branch ke clients ka date of birth wise data dikhao');
        const a = await lastBot();
        const vRows = a.table ? a.table.rows.filter((r) => /Vishal/.test(r[0])) : [];
        const want = deskClients.filter((c) => /varanasi/i.test(c.branch || '')).length + 1;
        if (!a.table || a.table.rows.length !== want || vRows.length !== 1 || vRows[0][0] !== 'Vishal Kumar Maurya' || !vRows[0].includes(riaDateText('2001-08-14'))) throw new Error(JSON.stringify({ want, rows: a.table && a.table.rows }));
        const r = await pg3.evaluate(() => ({ read: aiReadSource('clients', { where: [{ col: 'name', op: 'contains', value: 'Vishal' }], cols: ['name', 'branch', 'rm', 'aum'] }),
          analytics: analyticsRecords('clients').filter((c) => /Vishal/.test(c.cmsName)).length,
          ids: (analyticsRecords('clients').find((c) => /Vishal/.test(c.cmsName))._ids || []).slice().sort().join(),
          apart: analyticsRecords('clients').filter((c) => c.cmsName === 'ZZ Placeholder Pan' && !c._ids).length, dossier: bossClientDossier(riaVisible().find((c) => /Vishal/.test(c.cmsName))) }));
        const row = r.read.rows && r.read.rows[0];
        if (r.read.total !== 1 || r.analytics !== 1 || r.ids !== 'CMS-2G3H35738,CMS-FZSM04857,CMS-XMHVI0245' || r.apart !== 1 || !row || JSON.stringify(row).indexOf('Shubham') < 0 || JSON.stringify(row).indexOf('87494') < 0 || /ABCPM3852Z/.test(JSON.stringify(r.dossier))
          || r.dossier.aum !== 87494 || r.dossier.dob !== '2001-08-14') throw new Error(JSON.stringify(r).slice(0, 700));
        return want + ' Varanasi clients, Vishal once (DOB ' + riaDateText('2001-08-14') + '); planner: 1 row, RM Shubham, AUM 87494; dossier PAN stays masked; a different name on the same PAN stays a separate person';
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

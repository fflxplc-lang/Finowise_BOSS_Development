/* RIA AI'S PYTHON ENGINE, THROUGH BOSS (28-11-2026).

   The Python engine (ria_engine/) runs beside the Node server; RIA AI asks it,
   through /api/ria/engine/*, for model portfolios, rebalancing, the book
   report and a client's portfolio analysis — and keeps answering the old way
   when it is not running.

   Steps:
     0. engine not running: /api/ria/engine/health says ok:false and "model portfolio
        …" is answered without it.
     1. engine started (python3 -m ria_engine.server, its own SQLite file in the
        suite's work folder); two synthetic clients with holdings.
     2. "model portfolio moderate 6 years 10 lakh lumpsum and 15k sip" → the
        engine's fund-basket portfolio, in rupees, Hold / Reduce words only.
     3. "<client> ka portfolio analysis" → the engine's analysis (Switch for a
        bottom-quartile fund, Reduce above 25%); its "Rebalance" button → the
        engine's rebalancing plan.
     4. "book report" → AUM, SIP book, clients to act on.
     5. the routes: 401 without a session; a client outside the records → 404;
        the engine's database kept the analyses and the portfolio.
     6. engine stopped mid-conversation: the next engine question falls back
        to the usual answer, no error shown.

   Synthetic clients only (ZZ …). */
const path = require('path');
const http = require('http');
const {spawn} = require('child_process');
const {suite} = require('../lib/harness');
const PORT = Number(process.env.BOSS_PORT || 3000);
const ROOT = path.join(__dirname, '..', '..');
const ENGINE_PORT = 8765;
const DBFILE = path.join(ROOT, 'tests', '.work', 'ria-engine-suite.sqlite');
const ai_engine_error = a => /RIA AI engine|Python engine/i.test(a.content || '');
const getJson = (port, p) => new Promise((res) => { http.get({host: '127.0.0.1', port, path: p}, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { let j = null; try { j = JSON.parse(b); } catch(e){} res({status: r.statusCode, body: j}); }); }).on('error', () => res({status: 0})); });

suite(async t => {
  await t.home();
  let engine = null;
  const startEngine = async () => {
    try { require('fs').unlinkSync(DBFILE); } catch(e){}
    engine = spawn('python3', ['-m', 'ria_engine.server'], {cwd: ROOT, env: Object.assign({}, process.env, {RIA_ENGINE_PORT: String(ENGINE_PORT), RIA_ENGINE_DB: DBFILE, RIA_ENGINE_TOKEN: ''}), stdio: ['ignore', 'ignore', 'pipe']});
    let err = ''; engine.stderr.on('data', d => { err += d; });
    for(let i = 0; i < 50; i++){ const h = await getJson(ENGINE_PORT, '/health'); if(h.status === 200) return h.body; await t.wait(200); }
    throw new Error('the engine did not start: ' + err.slice(-500));
  };
  const stopEngine = async () => { if(engine){ engine.kill('SIGTERM'); engine = null; for(let i = 0; i < 25; i++){ if((await getJson(ENGINE_PORT, '/health')).status === 0) return; await t.wait(200); } } };
  const ask = async (q) => { await t.eval(async (q) => { const el = document.getElementById('aiInput'); if(el){ el.disabled = false; el.value = q; } ai.draft = q; await aiSend(); }, q);
    return t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {content: x.content || '', engine: x.engine || null, actions: (x.actions || []).map(a => a.label)}; }); };
  try {
    await t.step('0. engine not running: health says so (no error logged), and a portfolio question is answered the usual way', async () => {
      await stopEngine();
      const r = await t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiTogglePanel(); aiClearTurns();
        const h = await fetch('/api/ria/engine/health', {headers: apiHeaders()}); const j = await h.json(); riaEng.up = null; return {status: h.status, ok: j.ok, up: await riaEngStatus(true)}; });
      if(r.status !== 200 || r.ok !== false || r.up !== false) throw new Error(JSON.stringify(r));
      const a = await ask('model portfolio moderate 6 years 10 lakh');
      if(a.engine) throw new Error('answered by the engine while it is down: ' + JSON.stringify(a).slice(0, 300));
      return 'health: ok:false (200, nothing logged); RIA AI answered without the engine';
    });

    await t.step('1. engine started with its own database; two synthetic clients with holdings', async () => {
      const h = await startEngine();
      if(!h.quartiles || !h.basket || h.quartile_rows < 1000) throw new Error(JSON.stringify(h));
      const ids = await t.eval(async () => {
        const mk = (name, pan, risk, dob) => { const c = {id: uid('CMS'), cmsName: name, rmName: '', branch: 'Pune', dob, pan, riskProfile: risk, createdAt: new Date().toISOString()}; initState('CMS', c); DB.clients.push(c); return c.id; };
        const a = mk('ZZ Asha Engine', 'ZZZPE1111E', 'Aggressive', '1980-05-01'), b = mk('ZZ Bhavesh Engine', 'ZZZPE2222E', 'Conservative', '1962-02-02');
        const h = (id, c, s, inv, cur) => ({id, clientId: c, platform: 'Finowise', schemeName: s, invested: inv, current: cur, purchaseDate: '2021-01-01'});
        DB.platformHoldings = DB.platformHoldings.concat([h('PFH-ZZE-1', a, 'Quant Flexi Cap Gr Reg Plan', 400000, 700000), h('PFH-ZZE-2', a, 'Tata Flexi Cap Reg Gr', 300000, 280000),
          h('PFH-ZZE-3', a, 'ICICI Pru Corp Bond Gr', 200000, 230000), h('PFH-ZZE-4', b, 'Quant Flexi Cap Gr Reg Plan', 500000, 900000), h('PFH-ZZE-5', b, 'ICICI Pru Corp Bond Gr', 50000, 60000)]);
        DB.platformSips = (DB.platformSips || []).concat([{id: 'PFS-ZZE-1', clientId: a, schemeName: 'Quant Flexi Cap Gr Reg Plan', monthlyAmount: 10000, status: 'Active'}]);
        await save('clients'); await save('platformHoldings'); await save('platformSips');
        riaEng.up = null; const up = await riaEngStatus(true);
        return {a, b, up};
      });
      if(!ids.up) throw new Error('the page does not see the engine: ' + JSON.stringify(ids));
      t.ids = ids;
      return 'engine ' + h.version + ' (Python ' + h.python + '), quartile sheet ' + h.quartile_rows + ' rows, fund basket loaded; the page sees it';
    });

    await t.step('2. a model portfolio from the fund basket, in rupees', async () => {
      const a = await ask('model portfolio moderate 6 years 10 lakh lumpsum and 15k sip');
      if(a.engine !== 'build' || !/Model portfolio — Moderate · 5-7 Years/.test(a.content) || !/\| Scheme \| Share \| Lumpsum \| SIP \/ month \|/.test(a.content)
        || !/₹10\.00 L/.test(a.content) || /\bBuy\b|\bSell\b/.test(a.content)) throw new Error(JSON.stringify(a).slice(0, 700));
      return a.content.split('\n')[0] + ' · ' + (a.content.match(/\n\| [^\n]+/g) || []).length + ' table rows';
    });

    await t.step('3. a client\'s portfolio analysis by the engine; its Rebalance button gives the plan', async () => {
      const a = await ask('ZZ Asha Engine ka portfolio analysis');
      if(a.engine !== 'analyze' || !/Portfolio analysis — ZZ Asha Engine/.test(a.content) || !/\| Tata Flexi Cap Reg Gr \|[^\n]*\| Switch \|/.test(a.content)
        || !/\| Quant Flexi Cap Gr Reg Plan \|[^\n]*\| Reduce \|/.test(a.content) || !a.actions.some(l => /^⚖️ Rebalance ZZ Asha Engine/.test(l))) throw new Error(JSON.stringify(a).slice(0, 900));
      await t.eval(async () => { const t = ai.turns[ai.turns.length - 1]; const k = t.actions.findIndex(x => /^⚖️ Rebalance/.test(x.label)); await riaFollow(ai.turns.length - 1, k); });
      for(let i = 0; i < 50; i++){ if(await t.eval(() => (ai.turns[ai.turns.length - 1] || {}).engine === 'rebalance')) break; await t.wait(200); }
      const r = await t.eval(() => ai.turns[ai.turns.length - 1].content);
      if(!/Rebalance — ZZ Asha Engine\*\* \(Aggressive/.test(r)) throw new Error(r.slice(0, 500));
      return 'Switch Tata Flexi Cap (bottom quartile), Reduce Quant Flexi Cap (57%); rebalance: ' + r.split('\n')[1];
    });

    await t.step('4. the book report', async () => {
      const a = await ask('book report');
      if(a.engine !== 'book' || !/Book report/.test(a.content) || !/SIP book ₹10,000/.test(a.content) || !/ZZ Asha Engine/.test(a.content)) throw new Error(JSON.stringify(a).slice(0, 700));
      return a.content.split('\n').find(l => /^\*\*AUM/.test(l));
    });

    await t.step('5. the routes refuse without a session and outside the records; the engine kept what it did', async () => {
      t.expectConsole(/status of 404/);
      const anon = await new Promise((res) => { const rq = http.request({host: '127.0.0.1', port: PORT, path: '/api/ria/engine/book/report', method: 'POST', headers: {'Content-Type': 'application/json'}}, r => res(r.statusCode)); rq.end('{}'); });
      const r = await t.eval(async () => {
        const nf = await fetch('/api/ria/engine/client/analyze', {method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, apiHeaders()), body: JSON.stringify({client_id: 'CMS-NOT-HERE'})});
        const pf = await (await fetch('/api/ria/engine/portfolios', {method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, apiHeaders()), body: '{}'})).json();
        return {nf: nf.status, portfolios: (pf.portfolios || []).length};
      });
      const h = await getJson(ENGINE_PORT, '/health');
      if(anon !== 401 || r.nf !== 404 || !(h.body.db.analyses >= 3)) throw new Error(JSON.stringify({anon, r, db: h.body.db}));
      return 'no session → 401; unknown client → 404; engine database: ' + JSON.stringify(h.body.db);
    });

    await t.step('6. the engine stops: the next engine question falls back to the usual answer, no error', async () => {
      await stopEngine();
      t.expectConsole(/status of 503/);
      const a = await ask('book report');
      const err = await t.eval(() => ai.error || '');
      /* the usual path: here, with no model connected, that is the usual "no AI connector" notice — never an engine error */
      if(a.engine || /engine/i.test(err) || /^⚠/.test(a.content) || ai_engine_error(a)) throw new Error(JSON.stringify({a, err}).slice(0, 500));
      return 'answered the usual way without the engine (' + (err || a.content.split('\n')[0]).slice(0, 80) + ')';
    });
  } finally { await stopEngine(); }
});

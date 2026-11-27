/* RIA AI PORTFOLIO DIAGNOSTICS — PILLARS, CLUTTER, DRIFT, TAX; 3-TAB WORKBOOK AND EXECUTIVE PDF (27-11-2026).

   An external client's broker export ("dmart latest 1.xls": Stock Name,
   Sector, ISIN, Qty, Avg. Buy Price, LTP — no invested or current value)
   with an anchor stock over 25%, core stocks in profit and in deep loss, a
   gold ETF, two flexi cap funds (one bottom-quartile) and eight micro-tail
   stocks under ₹50,000.

   Steps:
     1. the parse: invested and current value worked from Qty × Avg / LTP,
        P&L per row; tiers Anchor / Core / Mid / Micro-tail; Reduce for the
        anchor, Hold for a stock in profit, Review for a deep loss, Switch
        for the bottom-quartile fund, the micro-tail consolidated; drift
        "Rebalancing required" and the missing debt buffer.
     2. the research workbook has three tabs — Executive Summary (KPIs,
        action summary, drift table), Holdings & Signals, Action & Cleanup
        Plan (Priority 1–4) — with only the four action words.
     3. the Executive PDF downloads, a real PDF, with no Buy or Sell.
     4. the four follow-ups on the file: micro-tail clutter, tax harvesting
        and LTCG, current vs target drift, 10-year projection and the
        protection checklist.
     5. a CRM client: the same diagnostics from their positions ("… ki
        micro-cap clutter dikhao", then "iska drift check karo"), with the
        workbook and PDF but no import file; "tax harvesting for <client>"
        alone keeps its portfolio-intelligence answer.

   Synthetic data only. */
const fs = require('fs');
const {suite} = require('../lib/harness');
const BAD = /\b(Buy|BUY|Sell|SELL)\b/;

suite(async t => {
  await t.home();
  const fresh = () => t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiClearDesk(); aiTogglePanel(); try { await aiRefreshStatus(true); } catch(e){} aiClearTurns(); });
  const last = () => t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {content: x.content || '', view: x.upView || null, actions: (x.actions || []).map(a => a.label), files: x.upFiles ? Object.keys(x.upFiles) : []}; });
  const ask = async (q) => { await t.eval(async (q) => { const el = document.getElementById('aiInput'); if(el){ el.disabled = false; el.value = q; } ai.draft = q; await aiSend(); }, q); return last(); };
  const download = async (label) => {
    const dl = t.page.waitForEvent('download', {timeout: 20000});
    await t.eval((label) => { const b = [...document.querySelectorAll('#aiTurns .ria-act')].reverse().find(x => x.textContent.trim().indexOf(label) === 0); if(!b) throw new Error('no button ' + label); b.click(); }, label);
    const d = await dl; return {name: d.suggestedFilename(), buf: fs.readFileSync(await d.path())};
  };
  const readXlsxAll = (buf) => t.eval(async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const s = await xlsxSheets(u.buffer); return s.map(x => ({name: x.name, rows: x.rows.map(r => Array.from(r, v => v == null ? '' : v))})); }, buf.toString('base64'));

  const HEAD = ['Stock Name', 'Sector', 'ISIN', 'Qty', 'Avg. Buy Price', 'LTP'];
  const ROWS = [['Reliance Industries Ltd', 'Energy', 'INE002A01018', 400, 2000, 2900], ['HDFC Bank Ltd', 'Banking', 'INE040A01034', 300, 1400, 1650],
    ['Infosys Ltd', 'IT', 'INE009A01021', 200, 1700, 1300], ['Tata Motors Ltd', 'Auto', 'INE155A01022', 150, 900, 980],
    ['Nippon India ETF Gold BeES', 'Gold', 'INF204KB17I5', 3000, 50, 60], ['Parag Parikh Flexi Cap Fund Direct Growth', 'Mutual Fund', 'INF879O01027', 2000, 60, 75],
    ['Kotak Flexi Cap Fund Regular Growth', 'Mutual Fund', '', 1000, 60, 70]]
    .concat(Array.from({length: 8}, (_, i) => ['ZZ Tail Co ' + (i + 1) + ' Ltd', 'Misc', '', 10, 3000, i % 2 ? 2400 : 3600]));

  await t.step('1. the broker export: values worked out, tiers, actions, clutter and drift', async () => {
    await fresh();
    const bytes = await t.eval(([cols, rows]) => Array.from(xlsxBuild([{name: 'Holdings', cols, rows}])), [HEAD, ROWS]);
    await t.page.setInputFiles('#riaUpFile', {name: 'dmart latest 1.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from(bytes)});
    await t.wait(150);
    await t.eval(async () => { await aiSend(); });
    for(let i = 0; i < 80; i++){ if(!(await t.eval(() => ai.busy))) break; await t.wait(250); }
    const r = await t.eval(() => { const u = ai.upload; if(!u) return null; const by = n => u.up.rows.find(r => r.name.indexOf(n) === 0) || {};
      const pick = r => ({inv: r.invested, cur: r.current, pnl: r.pnlPct, w: r.weightPct, tier: r.tier, a: r.action, to: r.target, bucket: r.bucket});
      return {n: u.up.rows.length, rel: pick(by('Reliance')), hdfc: pick(by('HDFC Bank')), infy: pick(by('Infosys')), ppfas: pick(by('Parag Parikh')), gold: pick(by('Nippon India ETF Gold')),
        tails: u.up.rows.filter(r => r.tier === 'Micro-tail').map(r => r.action), diag: {tail: u.x.diag.tail, rebalance: u.x.diag.rebalance, noDebt: u.x.diag.noDebt, top1: u.x.diag.top1, dup: u.x.diag.dupCats.map(g => g.category),
        stocks: (u.x.diag.buckets.find(b => b.bucket === 'Direct Stocks') || {}).flag}, content: ai.turns[ai.turns.length - 1].content}; });
    if(!r || r.n !== 15) throw new Error('rows: ' + JSON.stringify(r && r.n));
    if(r.rel.inv !== 800000 || r.rel.cur !== 1160000 || r.rel.pnl !== 45 || r.rel.tier !== 'Anchor' || r.rel.a !== 'Reduce') throw new Error('Reliance ' + JSON.stringify(r.rel));
    if(r.hdfc.a !== 'Hold' || r.hdfc.tier !== 'Core' || r.infy.a !== 'Review' || r.infy.pnl !== -23.5 || r.ppfas.a !== 'Switch' || !/Quant Flexi Cap/.test(r.ppfas.to) || r.gold.bucket !== 'Gold / Silver ETFs')
      throw new Error(JSON.stringify({hdfc: r.hdfc, infy: r.infy, ppfas: r.ppfas, gold: r.gold}));
    if(r.tails.length !== 8 || r.tails.some(a => !['Reduce', 'Review'].includes(a)) || !r.tails.includes('Reduce') || !r.tails.includes('Review') || r.diag.tail.n !== 8
      || !r.diag.rebalance || !r.diag.noDebt || !r.diag.stocks || !/Reliance/.test(r.diag.top1.name) || !r.diag.dup.length) throw new Error(JSON.stringify({tails: r.tails, diag: r.diag}));
    if(BAD.test(r.content) || !/Micro-tail:\*\* 8 holdings/.test(r.content) || !/Rebalancing required/.test(r.content)) throw new Error(r.content.slice(0, 800));
    return 'Reliance ₹8 L → ₹11.6 L (+45%) Anchor ' + r.rel.w + '% → Reduce; HDFC Bank Core Hold; Infosys −23.5% Review; PPFAS → Switch to Quant Flexi Cap; 8 micro-tail (' + r.diag.tail.pct + '% of capital) consolidated; drift: rebalancing required, no debt buffer';
  });

  await t.step('2. the research workbook: Executive Summary, Holdings & Signals, Action & Cleanup Plan', async () => {
    const wb = await download('📊 Research workbook (.xlsx)');
    const W = await readXlsxAll(wb.buf);
    const sheet = n => (W.find(x => x.name === n) || {rows: []}).rows, txt = rows => rows.map(r => r.join(' | ')).join('\n');
    const S = sheet('Executive Summary'), H = sheet('Holdings & Signals'), P = sheet('Action & Cleanup Plan');
    if(W.map(x => x.name).join('|') !== 'Executive Summary|Holdings & Signals|Action & Cleanup Plan') throw new Error('sheets: ' + W.map(x => x.name));
    const s = txt(S), p = txt(P);
    if(!/Total invested \(₹\) \| 2.*\n/.test(s) && !/Total invested/.test(s)) throw new Error('summary: ' + s.slice(0, 400));
    if(!/Top-1 single position risk \(%\) \| [\d.]+ — Reliance Industries Ltd/.test(s) || !/Top-5 weight \(%\)/.test(s) || !/Micro-tail clutter \(<₹50k \/ <1%\) \| 8 holdings/.test(s)
      || !/Action \| Holdings \| Value \(₹\) \| Weight \(%\) \| Strategic mandate/.test(s) || !['Hold', 'Reduce', 'Switch', 'Review'].every(a => S.some(r => r[0] === a))
      || !/Bucket \| Current value \(₹\) \| Current weight \(%\) \| Target band \(%\) \| Drift \(%\) \| Rebalancing/.test(s) || !/Direct Stocks \|.*Rebalancing required/.test(s)
      || !/No debt \/ liquid \/ arbitrage holding/.test(s) || !/Sector exposure/.test(s)) throw new Error('summary: ' + s.slice(0, 1400));
    if(H.length !== 16 || H[0][3] !== 'Pillar Tier' || H[0][10] !== 'Action' || H.slice(1).some(r => !['Hold', 'Reduce', 'Switch', 'Review'].includes(r[10])) || !H.some(r => /Reliance/.test(r[1]) && r[3] === 'Anchor'))
      throw new Error('holdings: ' + JSON.stringify(H.slice(0, 3)));
    if(!/Priority 1 — concentration & de-risk \| Reduce \| Reliance Industries Ltd/.test(p) || !/Priority 2 — micro-tail & tail cleanup \| (Reduce|Review) \| ZZ Tail Co/.test(p)
      || !/Priority 3 — quartile switches & consolidation \| Switch \| Parag Parikh Flexi Cap Fund Direct Growth → /.test(p) || !/Priority 3 .* \| Switch \| Flexi/i.test(p)
      || !/Priority 4 — tax & protection checklist \| Review \| Tax: LTCG ₹1.25 L harvest check/.test(p) || !/Emergency fund \(6 months of expenses\)/.test(p) || !/KYC & nominee status/.test(p)
      || P.slice(1).some(r => !['Hold', 'Reduce', 'Switch', 'Review'].includes(r[1]))) throw new Error('plan: ' + p.slice(0, 1500));
    if(BAD.test(JSON.stringify(W))) throw new Error('Buy / Sell in the workbook: ' + (JSON.stringify(W).match(new RegExp('.{60}' + BAD.source + '.{60}')) || [])[0]);
    return wb.name + ' (' + wb.buf.length + ' B): 3 tabs; ' + S.length + ' summary rows, ' + (H.length - 1) + ' holdings, ' + (P.length - 1) + ' plan items; only the four words';
  });

  await t.step('3. the Executive PDF', async () => {
    const pdf = await download('📄 Download Executive PDF');
    const raw = pdf.buf.toString('latin1');
    if(raw.slice(0, 4) !== '%PDF' || !/^RIA_Executive_Diagnostic_dmart_latest_1_.*\.pdf$/.test(pdf.name) || pdf.buf.length < 8000) throw new Error(JSON.stringify({name: pdf.name, n: pdf.buf.length, head: raw.slice(0, 8)}));
    const words = ['Critical audit findings', 'Pillar allocation vs clutter', 'Current vs target allocation', 'Execution playbook', 'Phased implementation plan', 'Tax harvesting', '10-year indicative growth projection'];
    const missing = words.filter(w => raw.indexOf(w) < 0);
    if(missing.length) throw new Error('sections not found in the PDF text: ' + missing.join(', '));
    if(BAD.test(raw.replace(/\/[A-Za-z]+/g, ' '))) throw new Error('Buy / Sell in the PDF: ' + (raw.match(new RegExp('.{40}' + BAD.source + '.{40}')) || [])[0]);
    return pdf.name + ' (' + pdf.buf.length + ' B): KPI cards, audit findings, pillars, drift, playbook, phases, tax, 10-year projection; no Buy / Sell';
  });

  await t.step('4. the four follow-ups on the file', async () => {
    const a = await ask('micro-cap clutter aur chote holdings dikhao');
    const b = await ask('tax harvesting aur LTCG calculation do');
    const c = await ask('current vs target allocation aur drift check karo');
    const d = await ask('10 year projection aur protection checklist do');
    if(!/^\*\*🧹 Micro-tail clutter — dmart latest 1\.xls\*\*/.test(a.content) || !/\*\*8 holdings under ₹50,000 or 1%\*\* make up only \*\*[\d.]+% of capital\*\*/.test(a.content) || !a.view || a.view.rows.length !== 8)
      throw new Error('clutter: ' + a.content.slice(0, 400));
    if(!/^\*\*🧾 Tax harvesting & LTCG/.test(b.content) || !/\| Unrealized gains \| ₹/.test(b.content) || !/up to ₹1,25,000/.test(b.content) || !/₹1,25,000 per PAN\*\*, ₹2.5 L across two family PANs/.test(b.content) || !/Consolidation:/.test(b.content))
      throw new Error('tax: ' + b.content.slice(0, 600));
    if(!/^\*\*⚖️ Current vs target allocation/.test(c.content) || !/\| Direct Stocks \| ₹[\d,]+ \| [\d.]+% \| 5–15% \| \+[\d.]+% \| ⚠ Rebalancing required \|/.test(c.content) || !/\*\*No debt \/ liquid \/ arbitrage\*\*/.test(c.content))
      throw new Error('drift: ' + c.content.slice(0, 700));
    if(!/^\*\*📈 10-year projection & protection checklist/.test(d.content) || !/\| 10 \| ₹[\d,]+ \| ₹[\d,]+ \| ₹[\d,]+ \|/.test(d.content) || !/Emergency fund/.test(d.content) || !/Term insurance/.test(d.content) || !/Health insurance/.test(d.content) || !/nominee/i.test(d.content))
      throw new Error('projection: ' + d.content.slice(0, 600));
    if([a, b, c, d].some(x => BAD.test(x.content) || !x.actions.includes('📄 Download Executive PDF'))) throw new Error('Buy / Sell or no PDF button');
    return 'clutter (8 rows), tax (₹1.25 L LTCG, consolidation), drift (Direct Stocks over band, no debt buffer), 10-year projection + protection checklist';
  });

  await t.step('5. a CRM client: the same diagnostics from their positions; the plain tax question keeps its own answer', async () => {
    await fresh();
    const id = await t.eval(async () => {
      const yr = new Date().getFullYear();
      const c = {id: uid('CMS'), cmsName: 'ZZ Diag Client', rmName: '', branch: 'Pune', dob: (yr - 58) + '-05-05', pan: 'ABCPD1234D', createdAt: new Date().toISOString()};
      initState('CMS', c); DB.clients.push(c);
      const H = [['DSP Midcap Fund Regular Growth', 300000, 420000], ['Kotak Flexi Cap Fund Regular Growth', 600000, 900000], ['ICICI Prudential Balanced Advantage Fund Growth', 250000, 300000],
        ['ZZ Tiny Fund Regular Growth', 30000, 26000]];
      DB.platformHoldings = (DB.platformHoldings || []).concat(H.map(([s, inv, cur], i) => ({id: 'PFH-DG' + i, clientId: c.id, platform: 'Finowise', schemeName: s, invested: inv, current: cur})));
      await save('clients'); await save('platformHoldings'); return c.id;
    });
    const a = await ask('ZZ Diag Client ki micro-cap clutter aur chote holdings dikhao');
    const b = await ask('iska drift check karo');
    const plain = await t.eval(() => !!riaDiagClientFor('tax harvesting for ZZ Diag Client'));
    if(!/^\*\*🧹 Micro-tail clutter — ZZ Diag Client\*\*/.test(a.content) || !a.view || a.view.rows.length !== 1 || !/ZZ Tiny Fund/.test(a.view.rows[0].name) || a.view.rows[0].action !== 'Reduce'
      || a.files.join() !== 'research,pdf' || a.actions.some(x => /Clean import/.test(x)))
      throw new Error('clutter: ' + JSON.stringify({c: a.content.slice(0, 300), rows: a.view && a.view.rows, files: a.files}));
    if(!/^\*\*⚖️ Current vs target allocation — ZZ Diag Client\*\*/.test(b.content) || plain || [a, b].some(x => BAD.test(x.content))) throw new Error(JSON.stringify({drift: b.content.slice(0, 300), plain}));
    return 'clutter: ZZ Tiny Fund (₹26,000, losing) → Reduce; "iska drift check karo" → the same client’s drift table; workbook + PDF, no import file; "tax harvesting for <client>" left to portfolio intelligence';
  });
});

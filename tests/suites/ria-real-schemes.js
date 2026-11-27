/* RIA AI reads the client's real schemes, remembers who "iska" is, and
   answers a switch question with the quartile sheet (27-11-2026).

   What boss.finowise.com showed before this:
     - a client whose Detailed Portfolio lists DSP Midcap, Motilal Oswal BAF
       and Kotak Flexi Cap came out of RIA AI as "Others (platform sleeve)
       49.4%" / "Equity (platform sleeve) 42.3%", and "No scheme-level
       holdings to read signals from" — the multi-asset upload's sleeve
       summary was all it read;
     - "Pradeep … ka portfolio review do" then "iska switch signals kya
       hai?" forgot Pradeep and listed other clients' signals, under the
       generic SWP / STP / Switch SOP;
     - "Portfolio checks the CRM computed" printed "- <client>: " with
       nothing after the colon.

   Steps:
     setup. three synthetic clients and the stand-in model. ZZ Pradeep
        Patekar's holdings exist only as a multi-asset upload's scheme rows,
        and maSyncCrm writes the sleeve summary exactly as an import does;
        ZZ Aaditya Other and ZZ Aaradhya Other hold a fund off the policy's
        list and a holding with no scheme name.
     1. RIA AI's positions, the policy signals, the RIA Insight box and the
        quartile verdicts read Pradeep's three schemes — no platform sleeve.
     2. "ZZ Pradeep Patekar ka portfolio review do", then "iska switch
        signals kya hai?": the second question is about Pradeep only, its
        <data> has his quartile schemeSignals (DSP Midcap → Switch), no
        other client and no book-wide portfolioSignals, and the SWP / STP /
        Switch SOP is not sent in its place.
     3. A book-wide "kis client ka kya switch karna hai" after Clear: every
        client listed has something to act on; the holding with no scheme
        name is named as such.
     4. The built-in answer never prints "- <client>: " with nothing after it.

   Synthetic clients only. */
const http = require('http');
const path = require('path');
const {suite} = require('../lib/harness');

const MOCK_PORT = Number(process.env.BOSS_PORT || 3000) + 334;
const seen = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if(req.url.endsWith('/models')) return res.end(JSON.stringify({data:[{id:'mock-model'}]}));
    const j = JSON.parse(body || '{}');
    seen.push(j);
    const sys = ((j.messages||[]).find(m=>m.role==='system')||{}).content || '';
    const reply = (text) => res.end(JSON.stringify({choices:[{message:{role:'assistant', content:text}}]}));
    if(/WHICH RECORDS/.test(sys)) return reply(JSON.stringify({reads:[], client:null}));
    reply('MOCK ANSWER');
  });
});
const lastUser = (j) => { const m = (j.messages || []).filter(x => x.role === 'user'); return (m[m.length - 1] || {}).content || ''; };
const dataOf = (txt) => { const m = String(txt).match(/<data>\s*([\s\S]*?)\s*<\/data>/); try { return m ? JSON.parse(m[1]) : null; } catch(e){ return null; } };

suite(async t => {
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
  const ask = (q) => t.eval(async (q) => { const el = document.getElementById('aiInput'); el.value = q; ai.draft = q; await aiSend(); }, q);
  let ids = null;

  await t.step('setup: ZZ Pradeep Patekar held only as multi-asset scheme rows; two other clients; the stand-in model', async () => {
    ids = await t.eval(async (port) => {
      await fetch('/api/connections/bossai', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({enabled:true, config:{baseUrl:'http://127.0.0.1:'+port+'/v1', model:'mock-model'}})});
      await fetch('/api/connections/bossai/test', {method:'POST', headers: apiHeaders()});
      const mk = (name, pan) => { const c = {id: uid('CMS'), cmsName: name, rmName: '', branch: 'Pune', dob: '1981-04-04', pan, createdAt: new Date().toISOString()}; initState('CMS', c); DB.clients.push(c); return c.id; };
      const p = mk('ZZ Pradeep Patekar', 'ABCPP1234P'), a = mk('ZZ Aaditya Other', 'ABCPA1234A'), b = mk('ZZ Aaradhya Other', 'ABCPB1234B');
      /* Pradeep: only the upload's scheme rows (what Detailed Portfolio reads) */
      const now = new Date().toISOString();
      DB.assetUploads = (DB.assetUploads || []).concat([{id: 'AU-ZZRS', seq: 951, kind: 'aum', platform: 'Finowise', product: 'MF', version: 1, at: now, snapshotDate: now.slice(0, 10)}]);
      const R = [['DSP Midcap Fund Regular Growth', 'Equity', 220000, 260000, 6.1], ['Motilal Oswal Balanced Advantage Fund Regular Growth', 'Hybrid', 300000, 340000, 7.17],
        ['Kotak Flexi Cap Fund Regular Growth', 'Equity', 400000, 610000, 14.2]];
      DB['assetRows.AU-ZZRS'] = R.map(([scheme, cat, inv, cur, x], i) => ({cid: p, client_name: 'ZZ Pradeep Patekar', pan: 'ABCPP1234P', product: 'MF', platform: 'Finowise', platform_key: 'finowise',
        asset_class: 'Mutual Fund', security_name: scheme, category: cat, identifier: 'F-ZZ-' + i, invested: inv, current_value: cur, xirr: x, level: 'scheme'}));
      if(typeof maInvalidate === 'function') maInvalidate();
      await maSyncCrm();
      /* the others: a fund off the policy's list, and a holding with no scheme name (the blank-colon case) */
      DB.platformHoldings = DB.platformHoldings.concat([
        {id: 'PFH-ZZRS-A', clientId: a, platform: 'Finowise', schemeName: 'ZZ Unlisted Midcap Fund Regular Growth', invested: 100000, current: 150000},
        {id: 'PFH-ZZRS-B', clientId: b, platform: 'Finowise', invested: 90000, current: 120000}]);
      await save('clients'); await save('platformHoldings');
      const summ = DB.platformHoldings.filter(h => h.clientId === p);
      return {p, a, b, summ: summ.map(h => ({src: h.source, scheme: h.schemeName || '', sleeves: Object.keys(h.sleeves || {})}))};
    }, MOCK_PORT);
    if(ids.summ.length !== 1 || ids.summ[0].src !== 'multiasset' || ids.summ[0].scheme || !ids.summ[0].sleeves.length)
      throw new Error('the upload did not leave a sleeve summary as an import does: ' + JSON.stringify(ids.summ));
    return 'Pradeep: 3 scheme rows, and the sleeve summary maSyncCrm writes (' + ids.summ[0].sleeves.join(', ') + '); two other clients';
  });

  await t.step('1. positions, policy signals, RIA Insight and quartile verdicts read the three schemes — no platform sleeve', async () => {
    const r = await t.eval((id) => {
      const c = riaPersonById(id) || DB.clients.find(x => x.id === id);
      const pos = riaPositions(c).map(p => ({s: p.scheme, v: Math.round(p.current), cls: p.cls, folio: p.folio || ''}));
      const sig = lexiClientSignals(c).rows.map(r => r.scheme + ' → ' + r.action);
      /* the review page's RIA Insight box where the page has one (production); its same lines from riaIntel where it does not (TEST) */
      const ins = typeof riaReviewInsight === 'function' ? riaReviewInsight([id]) : (() => { const x = riaIntel('complete portfolio analysis', [c]);
        return {lines: riaFindings(x).map(([k, v]) => k + ': ' + v).concat(((x.actions || {}).list || []).map(a => a.action + ' — ' + a.scheme + ': ' + (a.why || '')))}; })();
      const ss = bossSchemeSignals(c);
      const dossier = JSON.stringify(bossClientDossier(c).holdings || []);
      return {pos, sig, lines: ins.lines, sw: ss.switches.map(x => x.scheme), dossier};
    }, ids.p);
    const sleeve = JSON.stringify(r).match(/platform sleeve|investor total/);
    if(sleeve) throw new Error('a sleeve is still read: ' + JSON.stringify(r).slice(0, 600));
    const names = r.pos.map(p => p.s).sort().join(' | ');
    if(r.pos.length !== 3 || !/DSP Midcap/.test(names) || !/Motilal Oswal Balanced Advantage/.test(names) || !/Kotak Flexi Cap/.test(names)) throw new Error('positions: ' + JSON.stringify(r.pos));
    if(r.pos.reduce((n, p) => n + p.v, 0) !== 1210000) throw new Error('value counted twice or lost: ' + JSON.stringify(r.pos));
    if(!r.pos.every(p => /^F-ZZ-/.test(p.folio))) throw new Error('folio lost: ' + JSON.stringify(r.pos));
    if(r.sig.length !== 3 || r.sig.some(s => /^—/.test(s))) throw new Error('policy signals: ' + JSON.stringify(r.sig));
    const bss = r.lines.find(l => /^Hold \/ Reduce \/ Switch:/.test(l)) || '';
    if(!/^Hold \/ Reduce \/ Switch: Hold 0, Reduce 1, Switch 2, Review 0/.test(bss) || !r.lines.some(l => /^Switch — DSP Midcap/.test(l)) || !r.lines.some(l => /^Reduce — Kotak Flexi Cap/.test(l))
      || r.lines.some(l => /\b(Buy|Sell)\b/.test(l))) throw new Error('RIA Insight: ' + JSON.stringify(r.lines));
    if(r.sw.length !== 2 || !r.sw.some(s => /DSP Midcap/.test(s))) throw new Error('quartile switches: ' + JSON.stringify(r.sw));
    if(!/DSP Midcap/.test(r.dossier)) throw new Error('the dossier for the model lacks the schemes: ' + r.dossier.slice(0, 300));
    return '3 schemes, ₹12.10 L, folios kept; policy signals on 3 schemes; Insight "' + bss + '"; quartile switches: ' + r.sw.join(', ');
  });

  await t.step('2. "…ka portfolio review do" then "iska switch signals kya hai?": Pradeep only, his quartile signals, no SOP in their place', async () => {
    await t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiClearDesk(); aiTogglePanel(); await aiRefreshStatus(true); aiClearTurns(); });
    await ask('ZZ Pradeep Patekar ka portfolio review do');
    const n = seen.length;
    await ask('iska switch signals kya hai?');
    const calls = seen.slice(n);
    if(!calls.length) throw new Error('no model call for the follow-up: ' + JSON.stringify(await t.eval(() => ({status: ai.status, turns: ai.turns.map(x => x.role + ': ' + String(x.content).slice(0, 300))}))));
    const u = lastUser(calls[calls.length - 1]), d = dataOf(u) || {};
    const r = {active: await t.eval(() => ai.activeClient), clients: (d.clients || []).map(c => c.name || (c.fields || {}).name || ''),
      sw: ((d.schemeSignals || {}).switches || []).map(x => x.scheme), who: ((d.schemeSignals || {}).client || {}).name, book: !!d.portfolioSignals,
      others: /ZZ Aaditya Other|ZZ Aaradhya Other/.test(u), sop: /SWP \/ STP \/ Switch/.test(u)};
    if(r.active !== ids.p || r.who !== 'ZZ Pradeep Patekar' || !r.sw.some(s => /DSP Midcap/.test(s)) || r.book || r.others || r.sop)
      throw new Error(JSON.stringify(r) + ' :: ' + u.slice(0, 500));
    return 'about ' + r.who + '; switches ' + r.sw.join(', ') + '; no other client, no book signals, no SWP / STP / Switch SOP';
  });

  await t.step('3. book-wide "kis client ka kya switch karna hai": nobody listed with a blank, the nameless holding named', async () => {
    await t.eval(() => aiClearTurns());
    const n = seen.length;
    await ask('kis client ka kya switch karna hai');
    const calls = seen.slice(n);
    const d = calls.length ? dataOf(lastUser(calls[calls.length - 1])) || {} : {};
    const ps = d.portfolioSignals || [];
    const blank = ps.filter(x => !(x.funds || []).length && !(x.rebalance || []).length);
    const b = ps.find(x => x.client === 'ZZ Aaradhya Other');
    if(!ps.length || blank.length || !b || !b.funds.some(f => /a holding with no scheme name/.test(f))) throw new Error(JSON.stringify(ps).slice(0, 700));
    return ps.length + ' client(s) listed, each with something to act on; ' + b.client + ': ' + b.funds[0];
  });

  await t.step('4. the built-in answer never prints "- <client>: " with nothing after it', async () => {
    const builtin = require(path.join(__dirname, '..', '..', 'ria-builtin.js'));
    const data = {portfolioSignals: [{client: 'ZZ Empty One', funds: [], rebalance: []}, {client: 'ZZ Full Two', funds: ['Switch: ZZ Fund (off the list)'], rebalance: []}]};
    const msg = '<data>\n' + JSON.stringify(data) + '\n</data>\n\nQuestion: kis client ka kya switch karna hai';
    const out = builtin.chat([{role: 'system', content: 'x'}, {role: 'user', content: msg}]);
    const text = typeof out === 'string' ? out : (out && (out.text || out.content || out.answer)) || JSON.stringify(out);
    if(/- ZZ Empty One:\s*(\n|$)/.test(text) || /ZZ Empty One/.test(text) || !/- ZZ Full Two: Switch: ZZ Fund/.test(text)) throw new Error(text.slice(0, 600));
    return 'empty client left out; "- ZZ Full Two: Switch: ZZ Fund (off the list)"';
  });
  } finally { mock.close(); }
});

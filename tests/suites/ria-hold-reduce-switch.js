/* HOLD / REDUCE / SWITCH / REVIEW — RIA AI NEVER SAYS "BUY" OR "SELL" (27-11-2026).

   Every portfolio action RIA AI gives — chat, the review sheet's cards,
   the PDF report, RIA findings, the client page's signals card, the
   Analytics signals, the built-in answer — is one of four:
     Hold    a consistent quartile record that suits the client;
     Reduce  one holding above 25% of the portfolio, or mid / small cap for
             a client 55+ or with a goal within 3 years;
     Switch  Bottom quartile in 2 of the last 3 years, to the top peer of
             the same section of the firm's sheet;
     Review  no name / ISIN, too new, a mixed or weakening record, not in
             the sheet, or the policy list and the sheet disagreeing.

   Steps:
     setup. ZZ Vocab Investor (45, RMS) and ZZ Vocab External (61, at
        "Ready to Convert to RMS"), each with mutual fund holdings.
     1. each holding's action, for both clients: Switch for DSP Midcap,
        Reduce for a 40% holding and for the 61-year-old's mid cap,
        Review for a fund the sheet does not cover, Hold for a consistent
        one — and nothing outside the four.
     2. the complete analysis (findings, charts, actions list, the PDF
        report's text) and the built-in answer to it carry only the four
        words and never "Buy" or "Sell".
     3. the client page's signals card, Analytics and the welcome menu.
     4. the review sheet's cards for the external client.
     5. the model is told the rule, and a model answer that still labels
        an action "Buy" / "Sell" is put right ("Buy Now Pay Later" in a
        sentence is left alone).

   Synthetic clients only. */
const path = require('path');
const {suite} = require('../lib/harness');
const BAD = /\b(Buy|BUY|Sell|SELL)\b/;

suite(async t => {
  await t.home();
  let ids = null;

  await t.step('setup: an RMS client (45) and an external client at "Ready to Convert to RMS" (61), with mutual fund holdings', async () => {
    ids = await t.eval(async () => {
      const yr = new Date().getFullYear();
      const mk = (name, dob, pan, ext) => { const c = {id: uid('CMS'), cmsName: name, rmName: '', branch: 'Pune', dob, pan, createdAt: new Date().toISOString()}; initState('CMS', c);
        if(ext) c[RECORD_STATE_FIELD.CMS] = 'readyForRMS'; DB.clients.push(c); return c.id; };
      const a = mk('ZZ Vocab Investor', (yr - 45) + '-03-03', 'ABCPV1234V', false), b = mk('ZZ Vocab External', (yr - 61) + '-04-04', 'ABCPE1234E', true);
      const H = [[a, 'DSP Midcap Fund Regular Growth', 150000, 180000], [a, 'Kotak Flexi Cap Fund Regular Growth', 300000, 400000], [a, 'Motilal Oswal Midcap Fund Regular Growth', 120000, 200000],
        [a, 'ZZ Unknown Thematic Fund Regular Growth', 100000, 120000], [a, 'ICICI Prudential Balanced Advantage Fund Growth', 90000, 100000],
        [b, 'Motilal Oswal Midcap Fund Regular Growth', 200000, 300000], [b, 'DSP Midcap Fund Regular Growth', 100000, 110000], [b, 'HDFC Liquid Fund Regular Growth', 400000, 420000],
        [b, 'ICICI Prudential Balanced Advantage Fund Growth', 300000, 320000]];
      DB.platformHoldings = (DB.platformHoldings || []).concat(H.map(([cid, scheme, inv, cur], i) => ({id: 'PFH-VC' + i, clientId: cid, platform: 'Finowise', schemeName: scheme, invested: inv, current: cur})));
      const now = new Date().toISOString();
      DB.assetUploads = (DB.assetUploads || []).concat([{id: 'AU-ZZVC', seq: 961, kind: 'aum', platform: 'Finowise', product: 'MF', version: 1, at: now, snapshotDate: now.slice(0, 10)}]);
      DB['assetRows.AU-ZZVC'] = H.filter(h => h[0] === b).map(([cid, scheme, inv, cur]) => ({cid, client_name: 'ZZ Vocab External', pan: 'ABCPE1234E', product: 'MF', platform: 'Finowise', platform_key: 'finowise',
        security_name: scheme, category: 'Equity', invested: inv, current_value: cur, level: 'scheme'}));
      await save('clients'); await save('platformHoldings');
      return {a, b, stage: stateOf('CMS', DB.clients.find(c => c.id === b))};
    });
    if(ids.stage !== 'readyForRMS') throw new Error('stage ' + ids.stage);
    return 'two clients; the external one at Ready to Convert to RMS';
  });

  await t.step('1. one action per holding, from the four only — for the RMS client and the external one', async () => {
    const r = await t.eval((ids) => {
      const of = id => { const c = riaPersonById(id) || DB.clients.find(x => x.id === id); return {lexi: lexiClientSignals(c).rows.map(x => [x.scheme.split(' ').slice(0, 2).join(' '), x.action, x.weightPct]),
        ss: bossSchemeSignals(c)}; };
      const A = of(ids.a), B = of(ids.b);
      return {A: A.lexi, B: B.lexi, keysA: Object.keys(A.ss), ssB: {sw: B.ss.switches.map(x => x.scheme), red: B.ss.reduce.map(x => x.scheme), rev: B.ss.review.map(x => x.scheme), hold: B.ss.holds.map(x => x.scheme)}};
    }, ids);
    const all = r.A.concat(r.B);
    if(all.some(x => !['Hold', 'Reduce', 'Switch', 'Review'].includes(x[1]))) throw new Error('outside the four: ' + JSON.stringify(all));
    const act = (list, s) => (list.find(x => x[0] === s) || [])[1];
    const want = [[r.A, 'DSP Midcap', 'Switch'], [r.A, 'Kotak Flexi', 'Reduce'], [r.A, 'ZZ Unknown', 'Review'], [r.B, 'Motilal Oswal', 'Reduce'], [r.B, 'DSP Midcap', 'Switch']];
    const bad = want.filter(([l, s, a]) => act(l, s) !== a);
    if(bad.length || r.keysA.some(k => /buy|sell/i.test(k)) || !r.ssB.red.some(s => /Motilal Oswal Midcap/.test(s))) throw new Error(JSON.stringify({bad: bad.map(([l, s, a]) => [s, a, act(l, s)]), r}));
    return 'RMS: ' + r.A.map(x => x[0] + ' ' + x[1]).join(', ') + ' | external (61): ' + r.B.map(x => x[0] + ' ' + x[1]).join(', ');
  });

  let intelText = '';
  await t.step('2. the complete analysis, its PDF report and the built-in answer: only Hold / Reduce / Switch / Review', async () => {
    const r = await t.eval((ids) => {
      const out = {};
      [['A', ids.a], ['B', ids.b]].forEach(([k, id]) => {
        const c = riaPersonById(id) || DB.clients.find(x => x.id === id);
        const x = riaIntel('complete portfolio analysis', [c]);
        const f = riaFindings(x);
        ai.turns.push({role: 'assistant', content: 'synthetic', intel: x, charts: x.charts});
        const blocks = bossTurnPdfBlocks(ai.turns.length - 1);
        ai.turns.pop();
        out[k] = {f, label: (f.find(([n]) => /Reduce/.test(n)) || [])[0], counts: x.actions.counts, acts: (x.actions.list || []).map(a => a.action),
          charts: x.charts.map(ch => ch.title + ' ' + (ch.sub || '') + ' ' + JSON.stringify(ch.rows || '')).join(' | '), pdf: JSON.stringify(blocks), intelAi: riaIntelForAi(x)};
      });
      return out;
    }, ids);
    for(const k of ['A', 'B']){
      const x = r[k];
      const text = JSON.stringify(x.f) + ' ' + x.charts + ' ' + x.pdf;
      if(x.label !== 'Hold / Reduce / Switch' || Object.keys(x.counts).join() !== 'Hold,Reduce,Switch,Review' || x.acts.some(a => !['Reduce', 'Switch', 'Review'].includes(a)) || BAD.test(text)
        || !/Hold \/ Reduce \/ Switch/.test(x.pdf)) throw new Error(k + ': ' + JSON.stringify({label: x.label, counts: x.counts, acts: x.acts, bad: (text.match(new RegExp('.{60}' + BAD.source + '.{60}')) || [])[0]}));
    }
    const builtin = require(path.join(__dirname, '..', '..', 'ria-builtin.js'));
    const msg = '<data>\n' + JSON.stringify({intel: r.A.intelAi}) + '\n</data>\n\nQuestion: complete portfolio analysis — kya buy aur kya sell karna hai';
    const out = builtin.chat([{role: 'system', content: 'x'}, {role: 'user', content: msg}]);
    intelText = typeof out === 'string' ? out : (out && (out.text || out.content || out.answer)) || JSON.stringify(out);
    if(BAD.test(intelText) || !/\*\*2\. Hold \/ Reduce \/ Switch\*\*/.test(intelText) || !/Actions: Hold \d+, Reduce \d+, Switch \d+, Review \d+/.test(intelText)) throw new Error(intelText.slice(0, 900));
    return 'findings "' + r.A.label + '": ' + JSON.stringify(r.A.counts) + '; external ' + JSON.stringify(r.B.counts) + '; PDF and built-in answer clean of Buy / Sell';
  });

  await t.step('3. the client page\'s signals card, Analytics and the welcome menu', async () => {
    const r = await t.eval(async (ids) => {
      navigate('cms', ids.b); await new Promise(r => setTimeout(r, 400));
      const card = [...document.querySelectorAll('.boss-ins')].map(e => e.innerText).find(x => /RIA AI SIGNALS/.test(x)) || '';
      navigate('analytics'); await new Promise(r => setTimeout(r, 400));
      const an = (document.getElementById('anSignals') || {}).innerText || '';
      const menu = JSON.stringify(typeof RIA_MENU !== 'undefined' ? RIA_MENU : '') + ' ' + (typeof riaMenuHtml === 'function' ? riaMenuHtml() : '');
      navigate('dashboard');
      return {card, an, menu};
    }, ids);
    if(!r.card || BAD.test(r.card) || !/\b(Reduce|Switch|Review|Hold)\b/.test(r.card)) throw new Error('card: ' + r.card.slice(0, 500));
    if(BAD.test(r.an)) throw new Error('analytics: ' + (r.an.match(new RegExp('.{80}' + BAD.source + '.{80}')) || [])[0]);
    if(/Buy \/ Sell/.test(r.menu) || !/Hold \/ Reduce \/ Switch/.test(r.menu)) throw new Error('menu: ' + (r.menu.match(/.{60}(Buy|Hold \/ Reduce).{60}/) || [])[0]);
    return 'signals card, Analytics and the welcome menu use the four words';
  });

  await t.step('4. the review sheet\'s cards for the external client: Reduce / Switch / Review / Hold, never Buy or Sell', async () => {
    const r = await t.eval(async (id) => {
      ReviewReport.open(id, 'individual');
      for(let i = 0; i < 60; i++){ await new Promise(r => setTimeout(r, 250)); if(document.querySelectorAll('#xlTabs .xl-tab').length) break; }
      const tab = [...document.querySelectorAll('#xlTabs .xl-tab')].find(x => /Detailed Portfolio/i.test(x.textContent));
      if(!tab) return {err: 'no Detailed Portfolio'};
      tab.click(); await new Promise(r => setTimeout(r, 300));
      const openAll = document.querySelector('[data-fold="open"]'); if(openAll) openAll.click(); await new Promise(r => setTimeout(r, 300));
      const rias = [...document.querySelectorAll('#xlHost .cv-ria')].map(e => e.textContent);
      const x = document.getElementById('rrOverlay'); if(x) x.remove();
      return {rias};
    }, ids.b);
    if(r.err) throw new Error(r.err);
    if(!r.rias.length || r.rias.some(s => BAD.test(s) || !/^RIA: (🔴 Switch|🟠 Reduce|⚪ Review|🟡 Review|🟢 Hold)/.test(s)) || !r.rias.some(s => /🟠 Reduce/.test(s))) throw new Error(JSON.stringify(r.rias));
    return r.rias.length + ' cards: ' + r.rias.map(s => s.replace(/^RIA: /, '').split(' — ')[0]).join(', ');
  });

  await t.step('5. the model is told the four words; a "Buy" / "Sell" label in its answer is put right, a sentence is not', async () => {
    const r = await t.eval(() => ({rule: /Never recommend "Buy" or "Sell"/.test(BOSS_ANSWER_RULES) && /only Hold, Reduce, Switch or Review/.test(BOSS_ANSWER_RULES),
      fixed: riaActionWords('**Buy / Sell / Hold / Switch**\n- Buy: HDFC Flexi Cap\n- Sell: XYZ Fund\n| Scheme | Action |\n| ABC | Sell |\n| DEF | Buy |\n**Buy** more now\nBuy: later\nUse Buy Now Pay Later sparingly.')}));
    if(!r.rule) throw new Error('the rule is not in the answer brief');
    const want = '**Hold / Reduce / Switch**\n- Review: HDFC Flexi Cap\n- Reduce: XYZ Fund\n| Scheme | Action |\n| ABC | Reduce |\n| DEF | Review |\n**Review** more now\nReview: later\nUse Buy Now Pay Later sparingly.';
    if(r.fixed !== want) throw new Error(JSON.stringify(r.fixed));
    return 'rule in the brief; labels rewritten, "Buy Now Pay Later" untouched';
  });
});

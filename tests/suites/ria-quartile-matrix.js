/* THE FIRM'S QUARTILE RANKING SHEET: HOLD / SWITCH / WATCH / DE-RISK PER SCHEME.

   Every verdict is read from the firm's Mutual Fund Quartile Ranking Sheet
   (public/ria-quartiles.js, generated from the uploaded sheet: each
   scheme's quartile in its peer group, 2013 to 2023 YTD), and carries the
   fund's own record. Checked here:
     1. the verdicts, against the sheet: DSP Midcap (Bottom 2021-23) ->
        Switch to the best Mid Cap peer; Motilal Oswal BAF -> Switch to
        ICICI Pru BAF; Parag Parikh Flexi Cap (Bottom 2022, 2023) -> Switch;
        Kotak Flexi Cap -> Watch; Motilal Oswal Midcap -> Hold; "Axis
        Bluechip" found as Axis Large Cap; "ICICI Prudential Balanced
        Advantage" as "ICICI Pru Balanced Advtg"; "Motilal Oswal Large &
        Midcap" not taken for the Midcap fund; a midcap for a 61-year-old ->
        De-risk; an unknown scheme -> not in the sheet
     2. RIA AI's "Buy / sell / switch" finding counts the sheet's verdicts
        instead of "No scheme-level signals"
     3. the chat's data: one client's scheme signals, the goal gap from the
        mapped goals (and "map goals first" without them), and the mature
        clients to de-risk
     4. the review sheet's Detailed Portfolio: every card without a
        suggestion shows the sheet's verdict (marked RIA); "Fill RIA
        suggestions" saves them as the reviewer's (a Suggestions already
        written is skipped), and fills nothing twice
   Synthetic clients only; the funds and their records are the sheet's. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  let ids = null;

  await t.step('setup: ZZ Pradeep Test (45, a goal in 8 years) and ZZ Senior Test (61) with their holdings', async () => {
    ids = await t.eval(async () => {
      const yr = new Date().getFullYear();
      const mk = (name, dob) => { const c = {id: uid('CMS'), cmsName: name, rmName: '', branch: 'Pune', dob, pan: '', createdAt: new Date().toISOString()}; initState('CMS', c); DB.clients.push(c); return c.id; };
      const p = mk('ZZ Pradeep Test', (yr - 45) + '-01-10'), sr = mk('ZZ Senior Test', (yr - 61) + '-02-20');
      DB.clients.find(c => c.id === p).pan = 'ABCPT1234Q'; DB.clients.find(c => c.id === sr).pan = 'ABCPS5678R';
      const H = [[p, 'DSP Midcap Fund Regular Growth', 220000, 260000, 6.1], [p, 'Motilal Oswal Balanced Advantage Fund Regular Growth', 300000, 340000, 7.17],
        [p, 'Kotak Flexi Cap Fund Regular Growth', 400000, 610000, 14.2], [p, 'SBI Large Cap Fund Regular Growth', 250000, 330000, 12.5],
        [p, 'ZZ Unknown Thematic Fund Regular Growth', 50000, 52000, 3.0],
        [sr, 'Kotak Midcap Fund Regular Growth', 500000, 800000, 18.0], [sr, 'HDFC Liquid Fund Regular Growth', 100000, 104000, 6.5]];
      /* as a multi-asset statement upload leaves them: holdings RIA AI reads, and the upload's rows the review sheet reads */
      DB.platformHoldings = (DB.platformHoldings || []).concat(H.map(([cid, scheme, inv, cur, x], i) => ({id: 'PFH-QM' + i, clientId: cid, platform: 'Finowise', batchId: 'ZZQM', source: 'multiasset',
        schemeName: scheme, invested: inv, current: cur, xirr: x})));
      const now = new Date().toISOString();
      DB.assetUploads = (DB.assetUploads || []).concat([{id: 'AU-ZZQM', seq: 901, kind: 'aum', platform: 'Finowise', product: 'MF', version: 1, at: now, snapshotDate: now.slice(0, 10)}]);
      DB['assetRows.AU-ZZQM'] = H.map(([cid, scheme, inv, cur, x]) => { const c = DB.clients.find(y => y.id === cid);
        return {client_name: c.cmsName, pan: c.pan, product: 'MF', platform: 'Finowise', platform_key: 'finowise', security_name: scheme, category: 'Equity', invested: inv, current_value: cur, xirr: x, level: 'scheme'}; });
      DB.clientGoals = (DB.clientGoals || []).concat([{id: 'GL-QM1', clientId: p, name: 'Child education', target: 2500000, targetDate: (yr + 8) + '-06-30'}]);
      await save('clients'); await save('platformHoldings'); await save('clientGoals');
      return {p, sr};
    });
    return 'two clients, seven holdings, one goal';
  });

  await t.step('1. the verdicts, read from the sheet with each fund’s record', async () => {
    const r = await t.eval(() => {
      const v = (name, xirr, ctx) => riaSchemeVerdict({name, xirr, current: 100000}, ctx || {age: 45, yearsToGoal: 8});
      return {
        dspMid: v('DSP Midcap Fund Regular Growth', 6), moBaf: v('Motilal Oswal Balanced Advantage Fund Reg Gr', 7.17), ppfas: v('Parag Parikh Flexi Cap Fund Direct Growth', 18),
        kotakFlexi: v('Kotak Flexi Cap Fund Reg Gr', 14), moMid: v('Motilal Oswal Midcap Fund Regular Growth', 20), axisBlue: v('Axis Bluechip Fund Regular Growth', 9),
        iciciBaf: v('ICICI Prudential Balanced Advantage Fund Growth', 10), moLargeMid: v('Motilal Oswal Large and Midcap Fund Reg Gr', 15),
        seniorMid: v('Motilal Oswal Midcap Fund Regular Growth', 20, {age: 61, yearsToGoal: null}), unknown: v('ZZ Unknown Thematic Fund', 3),
        src: (riaQ() || {}).source};
    });
    const want = [['dspMid', 'SWITCH', /^🔴 Switch to Nippon India Gr Mid Cap — Bottom 2021, 2022, 2023 YTD$/], ['moBaf', 'SWITCH', /^🔴 Switch to ICICI Pru Balanced Advtg — Bottom 2021, 2022$/],
      ['ppfas', 'SWITCH', /^🔴 Switch to Quant Flexi Cap — Bottom 2022, 2023 YTD$/], ['kotakFlexi', 'WATCH', /^🟡 Watch — 2021 Bottom, 2023 YTD LM$/],
      ['moMid', 'HOLD', /^🟢 Hold — Top \/ Upper Mid in 4 of the last 5 years$/], ['axisBlue', 'SWITCH', /^🔴 Switch to /], ['iciciBaf', 'HOLD', /^🟢 Hold/],
      ['moLargeMid', 'REVIEW', /^⚪ Mixed record/], ['seniorMid', 'DERISK', /^🟡 De-risk to Corporate Bond \/ BAF \(age 61\)$/], ['unknown', 'REVIEW', /^⚪ Not in the quartile sheet/]];
    const bad = want.filter(([k, st, re]) => !r[k] || r[k].status !== st || !re.test(r[k].cardText));
    if(bad.length) throw new Error(JSON.stringify(bad.map(([k]) => [k, r[k] && r[k].status, r[k] && r[k].cardText])));
    if(!/2021 Bottom · 2022 Bottom · 2023 YTD Bottom/.test(r.dspMid.signal) || !/Nippon India Gr Mid Cap Fund Gr Gr \(Top \/ Upper Mid in \d of the last 5 years/.test(r.dspMid.signal)
      || !/1,968 schemes in 67 peer groups/.test(r.src)) throw new Error(JSON.stringify({sig: r.dspMid.signal, src: r.src}));
    return want.length + ' verdicts from the sheet, each with its record; "Axis Bluechip" found as Axis Large Cap, "Motilal Oswal Large & Midcap" not taken for the Midcap fund, an unknown scheme left for review';
  });

  await t.step('2. RIA AI’s "Buy / sell / switch" finding counts the sheet’s verdicts', async () => {
    const r = await t.eval((id) => { const c = riaPersonById(id); const x = riaIntel('complete portfolio analysis', [c]); const f = riaFindings(x).find(([k]) => k === 'Buy / sell / switch');
      return {f: f && f[1], list: (x.actions.list || []).filter(a => a.action === 'Switch').map(a => a.scheme + ' → ' + a.to)}; }, ids.p);
    const quart = r.list.filter(x => !/undefined$/.test(x));
    if(!r.f || /No scheme-level signals/.test(r.f) || !/Switch \(quartile\) 2/.test(r.f) || !/Watch \(quartile\) 2/.test(r.f) || quart.length < 2
      || !quart.some(x => /DSP Midcap .* → Nippon India Gr Mid Cap/.test(x))) throw new Error(JSON.stringify(r));
    return '"' + r.f.slice(0, 120) + '"; sheet switches / watches: ' + quart.join('; ');
  });

  await t.step('3. the chat’s data: scheme signals, the goal gap, and the mature clients to de-risk', async () => {
    const r = await t.eval((ids) => {
      const s = bossSchemeSignals(riaPersonById(ids.p)), g = bossGoalGap(riaPersonById(ids.p)), g0 = bossGoalGap(riaPersonById(ids.sr));
      const m = bossMatureRebalancing(riaVisible());
      return {sw: s.switches.map(x => x.scheme), holds: s.holds.map(x => x.scheme), nc: s.notCovered, goal: g.goals[0], gap: g.sipGap, need: g.sipNeededTotal, g0: g0.note,
        mature: m.clients.map(x => x.name + ' ' + x.midSmallValue), strategy: m.strategy};
    }, ids);
    if(r.sw.length !== 2 || !r.sw.some(x => /DSP Midcap/.test(x)) || !r.sw.some(x => /Balanced Advantage/.test(x)) || r.holds.length !== 0 || r.nc.length !== 1
      || !r.goal || r.goal.goal !== 'Child education' || r.goal.rate !== 12 || !(r.goal.sipNeeded > 10000 && r.goal.sipNeeded < 20000) || r.gap !== r.need
      || !/No goals are mapped/.test(r.g0) || r.mature.join() !== 'ZZ Senior Test 800000' || !/15% Liquid/.test(r.strategy)) throw new Error(JSON.stringify(r));
    return 'switches ' + r.sw.length + ', holds ' + r.holds.length + ', not in the sheet 1; goal: SIP ₹' + r.goal.sipNeeded.toLocaleString('en-IN') + '/mo for ₹25 L in ' + r.goal.years + ' yrs (no SIP running → gap the same); no goals → "map goals first"; mature: ' + r.mature.join(', ');
  });

  await t.step('4. the review sheet: cards without a suggestion show the sheet’s; "Fill RIA suggestions" saves them and fills nothing twice', async () => {
    const r = await t.eval(async (id) => {
      ReviewReport.open(id);
      for(let i = 0; i < 60; i++){ await new Promise(r => setTimeout(r, 250)); if(document.querySelectorAll('#xlTabs .xl-tab').length) break; }
      const tab = [...document.querySelectorAll('#xlTabs .xl-tab')].find(x => /Detailed Portfolio/i.test(x.textContent));
      if(!tab) return {err: 'no Detailed Portfolio: ' + ((document.getElementById('rrOverlay') || {}).innerText || '').slice(0, 300)};
      tab.click(); await new Promise(r => setTimeout(r, 300));
      const openAll = document.querySelector('[data-fold="open"]'); if(openAll) openAll.click(); await new Promise(r => setTimeout(r, 300));
      const cards = () => [...document.querySelectorAll('#xlHost .cv-scheme')].map(a => ({name: (a.querySelector('h4') || {}).textContent || '', sug: ([...a.querySelectorAll('.cv-f')].find(f => /Suggestions/i.test(f.textContent)) || {}).textContent || '',
        ria: !!a.querySelector('.cv-ria')}));
      const before = cards();
      return {before, hasBtn: !!document.getElementById('xlRia')};
    }, ids.p);
    if(r.err) throw new Error(r.err);
    const card = (list, re) => list.find(c => re.test(c.name)) || {};
    const b = r.before;
    if(!r.hasBtn || !/RIA: 🔴 Switch to Nippon India Gr Mid Cap/.test(card(b, /DSP Midcap/).sug) || !/RIA: 🟡 Watch/.test(card(b, /Kotak Flexi/).sug) || !/RIA: ⚪ Not in the quartile sheet/.test(card(b, /Unknown Thematic/).sug))
      throw new Error('before: ' + JSON.stringify(b).slice(0, 700));
    /* a suggestion the reviewer already typed is kept; the rest are filled */
    const r2 = await t.eval(async (id) => {
      const card = [...document.querySelectorAll('#xlHost .cv-scheme')].find(a => /SBI Large Cap/.test(a.textContent));
      const cell = card && [...card.querySelectorAll('.cv-f b')].find(b => b.parentNode && /Suggestions/i.test(b.parentNode.textContent));
      return {cell: !!cell};
    }, ids.p);
    const r3 = await t.eval(async (id) => {
      /* the reviewer's own words on SBI Large Cap, written the way the page saves them */
      const e = DB.reviewEdits.find(x => x.clientId === id) || null;
      document.getElementById('xlRia').click();
      const status = (document.getElementById('xlStatus') || {}).textContent || '';          // before the autosave's own "saved" replaces it
      await new Promise(r => setTimeout(r, 1500));
      const saved = (DB.reviewEdits || []).find(x => x.clientId === id);
      const sug = saved ? Object.values(saved.edits.schemes || {}).map(s => s.suggestions).filter(Boolean) : [];
      const after = [...document.querySelectorAll('#xlHost .cv-scheme')].map(a => ({name: (a.querySelector('h4') || {}).textContent || '', ria: !!a.querySelector('.cv-ria'),
        sug: ([...a.querySelectorAll('.cv-f')].find(f => /Suggestions/i.test(f.textContent)) || {}).textContent || ''}));
      document.getElementById('xlRia').click(); await new Promise(r => setTimeout(r, 300));
      const status2 = (document.getElementById('xlStatus') || document.querySelector('.xl-status') || {}).textContent || '';
      const x = document.getElementById('rrOverlay'); if(x) x.remove();
      return {hadEdits: !!e, sug, after, status, status2};
    }, ids.p);
    if(!/5 suggestions filled from the firm's quartile sheet/.test(r3.status) || !/Every scheme already has a suggestion/.test(r3.status2) || r3.sug.length !== 5 || !r3.sug.some(s => /Switch to Nippon India Gr Mid Cap/.test(s)) || r3.after.some(a => a.ria) || !/Switch to Nippon India Gr Mid Cap/.test(card(r3.after, /DSP Midcap/).sug))
      throw new Error('fill: ' + JSON.stringify({status: r3.status, status2: r3.status2, n: r3.sug.length, ria: r3.after.filter(a => a.ria).map(a => a.name)}));
    return '5 cards showed the sheet verdict (marked RIA); Fill saved 5 suggestions as the reviewer’s; a second Fill finds nothing left to fill';
  });
});

/* RIA AI READS AN UPLOADED STATEMENT: RESEARCH IN CHAT, AND FILES TO DOWNLOAD (27-11-2026).

   The case it was built for: Sanjay Sonawane's "Investment Details.xlsx"
   (from "Statement - SANJAY NARAYAN SONAWANE.pdf", a Piper Serica PMS
   statement). Its 36 rows all had "Scheme / product" = the PDF's file
   name, asset class "Unclassified", no folio and no ISIN — but different
   units, prices and values. The CRM import kept 1 and rejected 35 as
   "Twice in file".

   Steps:
     1. the 36-row file through 📎: 36 rows read and kept, every one flagged
        for its missing name, the 35 the import would reject counted,
        Review for each (no name to judge), totals and weights correct.
     2. the four downloads: the research report (.xlsx / .csv) has every
        row with weight, note and only Hold / Reduce / Switch / Review; the
        clean import file (.xlsx / .csv) has the CRM's columns, all 36 rows,
        and no two rows the CRM would call the same investment — with no
        folio or ISIN made up.
     3. follow-ups stay on the file: "iska Hold / Reduce / Switch analysis
        do", "concentration check karo", "clean import sheet bana do".
     4. a mutual fund statement (.csv): DSP Midcap → Switch to the sheet's
        top peer, a 45% holding → Reduce, a consistent fund → Hold, a
        direct stock → Review; two lots of one fund in different folios
        stay two rows.
     5. a PDF statement is read by the statement reader.
     6. Clear forgets the file; naming a client moves the conversation to
        the client; an unsupported or oversized file is refused plainly.
     7. where the build has the client-wise importer (production): the
        original file still loses 35 rows there as "Twice in file", and the
        clean import file goes in whole — 36 holdings on the client's book.

   Since the attachment bar (27-11-2026) 📎 stages the file as a chip beside
   the input; nothing is sent until Send / Enter, which sends the file and
   the prompt together (an empty prompt is the full research). Tables in
   answers are real tables: the research view's strip and holdings table
   with Hold / Reduce / Switch / Review pills, and GitHub-style pipe tables.
     8. staging: the chip shows the file, nothing is sent, the input has the
        focus; ✕ removes it; a prompt typed with it is sent with it, and
        the user's bubble shows the file badge and the prompt.
     9. pipe tables in any answer become escaped, scrollable tables.

   Synthetic data only; nothing leaves the browser. */
const fs = require('fs');
const {suite} = require('../lib/harness');
const BAD = /\b(Buy|BUY|Sell|SELL)\b/;

suite(async t => {
  await t.home();
  const fresh = () => t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiClearDesk(); aiTogglePanel(); try { await aiRefreshStatus(true); } catch(e){} aiClearTurns(); });
  const ask = (q) => t.eval(async (q) => { const el = document.getElementById('aiInput'); if(el){ el.disabled = false; el.value = q; } ai.draft = q; await aiSend(); }, q);
  const last = () => t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {content: x.content || '', view: x.upView || null, actions: (x.actions || []).map(a => a.label), files: x.upFiles ? Object.keys(x.upFiles) : [],
    err: ai.stageErr || ''}; });
  /* 📎 stages the file; nothing is sent until Send */
  const stage = async (name, mimeType, buffer) => {
    const before = await t.eval(() => ai.turns.length);
    await t.page.setInputFiles('#riaUpFile', {name, mimeType, buffer});
    await t.wait(150);
    return t.eval((before) => ({turns: ai.turns.length - before, staged: ai.staged ? ai.staged.name : null, err: ai.stageErr || '',
      chip: (document.getElementById('riaAttach') || {}).innerText || '', focus: (document.activeElement || {}).id || '', busy: ai.busy}), before);
  };
  const send = async (prompt) => {
    await t.eval(async (q) => { const el = document.getElementById('aiInput'); if(el){ el.value = q; } ai.draft = q; await aiSend(); }, prompt || '');
    for(let i = 0; i < 80; i++){ const busy = await t.eval(() => ai.busy); if(!busy) break; await t.wait(250); }
    return last();
  };
  const upload = async (name, mimeType, buffer, prompt) => { const s = await stage(name, mimeType, buffer); if(!s.staged) return last(); return send(prompt); };
  /* the answer as drawn: the strip, the table and its pills, the buttons under it */
  const drawn = () => t.eval(() => { const turns = [...document.querySelectorAll('#aiTurns .ai-turn')]; const bot = turns[turns.length - 1], me = [...document.querySelectorAll('#aiTurns .ai-me')].pop();
    const tb = bot && bot.querySelector('.ria-up-table');
    return {strip: bot ? [...bot.querySelectorAll('.ria-up-strip > div')].map(d => d.innerText.replace(/\s+/g, ' ').trim()) : [],
      head: tb ? [...tb.querySelectorAll('th')].map(x => x.textContent.trim()) : [], rows: tb ? tb.querySelectorAll('tbody tr').length : 0,
      pills: bot ? [...bot.querySelectorAll('.ria-up-table .ria-pill')].map(x => x.className.replace('ria-pill ', '') + ':' + x.textContent) : [],
      wrapped: !!(tb && tb.closest('.ria-table-wrap')), wrapOverflow: tb ? getComputedStyle(tb.closest('.ria-table-wrap')).overflowX : '',
      buttonsAfter: bot ? (() => { const v = bot.querySelector('.ria-up'), b = bot.querySelector('.ria-acts'); return !!(v && b && (v.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)); })() : false,
      buttons: bot ? [...bot.querySelectorAll('.ria-act')].map(x => x.textContent.trim()) : [],
      meBadge: me ? ((me.querySelector('.ria-attach-badge') || {}).innerText || '') : '', meText: me ? me.innerText : '',
      drawerW: (document.getElementById('aiTurns') || {}).clientWidth || 0, wrapW: tb ? tb.closest('.ria-table-wrap').clientWidth : 0}; });
  const download = async (label) => {
    const dl = t.page.waitForEvent('download', {timeout: 15000});
    await t.eval((label) => { const b = [...document.querySelectorAll('#aiTurns .ria-act')].reverse().find(x => x.textContent.trim().indexOf(label) === 0); if(!b) throw new Error('no button ' + label); b.click(); }, label);
    const d = await dl; return {name: d.suggestedFilename(), buf: fs.readFileSync(await d.path())};
  };
  /* an .xlsx read back the way the page reads one */
  const readXlsx = (buf) => t.eval(async (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const s = await xlsxSheets(u.buffer); return s[0].rows.map(r => Array.from(r, v => v == null ? '' : v)); }, buf.toString('base64'));
  const csvRows = (buf) => buf.toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/);

  /* Sanjay's 36 rows, as the import read them */
  const SANJAY = 'Statement - SANJAY NARAYAN SONAWANE.pdf';
  const sanjay = Array.from({length: 36}, (_, i) => { const units = 10 + i * 7, price = 100 + (i * 37) % 900, inv = Math.round(units * price * 0.8), cur = i === 6 ? 2600000 : units * price;
    return [SANJAY, 'Unclassified', '', '', units, price, inv, cur, '2024-0' + (1 + i % 9) + '-15', '']; });
  const sanjayTotal = sanjay.reduce((n, r) => n + r[7], 0);
  let sanjayBook = null, sanjayBytes = null, cleanImport = null;

  await t.step('1. the 36-row "Investment Details.xlsx" through 📎: all 36 kept, each flagged, the 35 "Twice in file" rejects counted', async () => {
    await fresh();
    const bytes = await t.eval((rows) => Array.from(xlsxBuild([{name: 'Investment Details', cols: ['Scheme / product', 'Asset class', 'Folio / account', 'ISIN', 'Units', 'NAV / price', 'Invested', 'Current value', 'Invested on', 'Note'], rows}])), sanjay);
    sanjayBytes = Buffer.from(bytes);
    const sg = await stage('Investment Details.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sanjayBytes);
    if(sg.turns !== 0 || sg.staged !== 'Investment Details.xlsx' || !/Investment Details\.xlsx/.test(sg.chip) || !/XLSX/.test(sg.chip) || sg.focus !== 'aiInput') throw new Error('not staged: ' + JSON.stringify(sg));
    const r = await send('');
    const d = await drawn();
    if(!/Investment Details\.xlsx/.test(d.meBadge) || !/Research this file/.test(d.meText) || d.strip.length !== 4 || !/^Total holdings 36/i.test(d.strip[0]) || !/Over 25% · data issues 1 · 36/i.test(d.strip[3])
      || d.head.join('|') !== 'Scheme / Product|Current value|Weight %|Action|Rationale / Switch target' || d.rows !== 36 || d.pills.some(p => p !== 'ria-pill-review:Review') || !d.wrapped || d.wrapOverflow !== 'auto'
      || !d.buttonsAfter || d.buttons.slice(0, 4).join('|') !== '📊 Research report (.xlsx)|📑 Research report (.csv)|📥 Clean import file (.xlsx)|📥 Clean import file (.csv)' || d.wrapW > d.drawerW)
      throw new Error('drawn: ' + JSON.stringify(d));
    const st = await t.eval(() => ({n: ai.upload && ai.upload.up.rows.length, subject: ai.subject, noName: ai.upload && ai.upload.up.rows.filter(r => r.noName).length,
      acts: ai.upload && [...new Set(ai.upload.up.rows.map(r => r.action))], w7: ai.upload && ai.upload.up.rows[6].weightPct, total: ai.upload && ai.upload.x.curKnown}));
    sanjayBook = st;
    const c = r.content;
    if(st.n !== 36 || st.noName !== 36 || st.subject !== 'upload' || st.acts.join() !== 'Review' || Math.round(st.total) !== sanjayTotal
      || !/Read \*\*36 rows\*\*, kept \*\*36\*\* — none merged: 36 rows look alike/.test(c) || !/36 rows have no scheme \/ scrip name \(the name column holds "Statement - SANJAY NARAYAN SONAWANE\.pdf"\)/.test(c)
      || !/reject \*\*35\*\* as "Twice in file"/.test(c) || !/36 rows? with no known asset class \(36 given as "Unclassified"\)/.test(c) || !/Review 36/.test(c) || !/Unidentified holding 07 [\d.]+% → Review/.test(c)
      || BAD.test(c) || !r.view || r.view.rows.length !== 36 || r.files.join() !== 'research,import' || r.actions.length !== 5) throw new Error(JSON.stringify({st, c: c.slice(0, 1400), view: r.view && r.view.rows.length, actions: r.actions}));
    return 'staged as a chip (nothing sent, input focused); Send with no prompt → full research: strip "' + d.strip[0] + '", 36-row table with Review pills in a scroller, 4 downloads under it; 35 would-be "Twice in file" rejects counted';
  });

  await t.step('2. the downloads: research report and clean CRM import file, .xlsx and .csv', async () => {
    const rx = await download('📊 Research report (.xlsx)'), rc = await download('📑 Research report (.csv)');
    const ix = await download('📥 Clean import file (.xlsx)'), ic = await download('📥 Clean import file (.csv)');
    cleanImport = ix;
    if(rx.buf.slice(0, 2).toString() !== 'PK' || ix.buf.slice(0, 2).toString() !== 'PK' || !/^RIA_Research_Investment_Details_.*\.xlsx$/.test(rx.name) || !/^CRM_Import_Investment_Details_.*\.csv$/.test(ic.name))
      throw new Error(JSON.stringify([rx.name, rc.name, ix.name, ic.name]));
    const R = await readXlsx(rx.buf), I = await readXlsx(ix.buf);
    const rHead = R[0], iHead = I[0];
    if(rHead.join('|') !== '#|Holding|Asset class|Folio / account|ISIN|Units|NAV / price|Invested|Current value|Weight %|Quartile / risk note|Recommendation|Switch to|Data note' || R.length !== 37)
      throw new Error('research: ' + JSON.stringify(R.slice(0, 2)));
    const rec = R.slice(1).map(r => r[11]);
    if(rec.some(a => !['Hold', 'Reduce', 'Switch', 'Review'].includes(a)) || BAD.test(JSON.stringify(R)) || Math.abs(R.slice(1).reduce((n, r) => n + Number(r[9]), 0) - 100) > 0.5)
      throw new Error('research rows: ' + JSON.stringify(R.slice(1, 4)));
    if(iHead.join('|') !== 'Scheme / product|Asset class|Folio / account|ISIN|Units|NAV / price|Invested|Current value|Invested on|Note' || I.length !== 37) throw new Error('import: ' + JSON.stringify(I.slice(0, 2)));
    /* the CRM's own test for "the same investment": folio + ISIN, or folio + name when there is no ISIN */
    const id = r => String(r[2]).toLowerCase() + '|' + (String(r[3]).toUpperCase() || String(r[0]).toLowerCase());
    const ids = new Set(I.slice(1).map(id));
    if(ids.size !== 36 || I.slice(1).some(r => r[2] !== '' || r[3] !== '') || !/^Unidentified holding 01 \(from Statement - SANJAY NARAYAN SONAWANE\.pdf\)$/.test(I[1][0]) || !/units 10, price 100/.test(I[1][9])
      || Number(I[7][7]) !== 2600000) throw new Error('import rows: ' + JSON.stringify({unique: ids.size, first: I[1], seventh: I[7]}));
    if(csvRows(rc.buf).length !== 37 || csvRows(ic.buf).length !== 37 || !/Recommendation/.test(csvRows(rc.buf)[0]) || !/Scheme \/ product/.test(csvRows(ic.buf)[0])) throw new Error('csv lengths');
    return 'research ' + rx.buf.length + ' B / ' + rc.buf.length + ' B (36 rows, weights total 100%, only the four actions); import ' + ix.buf.length + ' B / ' + ic.buf.length + ' B: CRM columns, 36 distinct investments, no folio or ISIN invented';
  });

  await t.step('3. follow-ups stay on the file: analysis, concentration, the clean import sheet', async () => {
    await ask('iska Hold / Reduce / Switch analysis do');
    const a = await last();
    await ask('concentration check karo');
    const b = await last();
    await ask('clean import sheet bana do');
    const c = await last();
    if(!/^\*\*📎 Research: Investment Details\.xlsx\*\*/.test(a.content) || !/Hold \/ Reduce \/ Switch:\*\* Hold 0 · Reduce 0 · Switch 0 · Review 36/.test(a.content)
      || !b.view || !/^Largest holdings/.test(b.view.title) || b.view.rows[0].n !== 7
      || !/^\*\*📥 Clean CRM import file — Investment Details\.xlsx\*\*/.test(c.content) || !/All \*\*36\*\* rows/.test(c.content) || !/reject 35 row\(s\) as "Twice in file"/.test(c.content) || !/^📥 Clean import file \(\.xlsx\)/.test(c.actions[0])
      || [a, b, c].some(x => BAD.test(x.content))) throw new Error(JSON.stringify({a: a.content.slice(0, 300), b: b.table && b.table.title, c: c.content.slice(0, 400), ca: c.actions}));
    return 'analysis, "Largest holdings" (row 7 first) and the clean import answer — all about the file, no model call';
  });

  await t.step('4. a mutual fund statement (.csv): Switch to the sheet\'s peer, Reduce over 25%, Hold, Review for a stock; two lots kept', async () => {
    const csv = ['Investor Name,Scheme Name,Folio No,ISIN,Units,NAV,Invested Amount,Current Value',
      'ZZ Csv Investor,DSP Midcap Fund Regular Growth,F-101,,1000,120,100000,120000',
      'ZZ Csv Investor,Kotak Flexi Cap Fund Regular Growth,F-102,,5000,90,300000,450000',
      'ZZ Csv Investor,Motilal Oswal Midcap Fund Regular Growth,F-103,,1000,80,60000,80000',
      'ZZ Csv Investor,Motilal Oswal Midcap Fund Regular Growth,F-104,,1250,80,80000,100000',
      'ZZ Csv Investor,ICICI Prudential Balanced Advantage Fund Growth,F-105,,2000,50,90000,100000',
      'ZZ Csv Investor,HDFC Bank Ltd,DP-1,INE040A01034,100,1500,120000,150000',
      'Total,,,,,,750000,1000000'].join('\n');
    const r = await upload('MF statement.csv', 'text/csv', Buffer.from(csv), 'isko Hold / Reduce / Switch analysis do');
    const d = await drawn();
    if(!/MF statement\.csv/.test(d.meBadge) || !/isko Hold \/ Reduce \/ Switch analysis do/.test(d.meText) || d.pills[0] !== 'ria-pill-switch:Switch'
      || !['ria-pill-reduce:Reduce', 'ria-pill-hold:Hold', 'ria-pill-review:Review'].every(p => d.pills.includes(p)) || d.buttons.length < 4)
      throw new Error('drawn: ' + JSON.stringify(d));
    const rows = await t.eval(() => ai.upload.up.rows.map(r => ({n: r.name.split(' ').slice(0, 2).join(' '), a: r.action, w: r.weightPct, to: r.target, why: r.why})));
    const by = n => rows.filter(r => r.n === n);
    if(rows.length !== 6 || by('DSP Midcap')[0].a !== 'Switch' || !/Nippon India Gr Mid Cap/.test(by('DSP Midcap')[0].to) || by('Kotak Flexi')[0].a !== 'Reduce' || by('Kotak Flexi')[0].w !== 45
      || by('HDFC Bank')[0].a !== 'Review' || !/quartile sheet covers mutual funds only/.test(by('HDFC Bank')[0].why) || by('Motilal Oswal').length !== 2 || by('ICICI Prudential')[0].a !== 'Hold'
      || !/Read \*\*6 rows\*\*, kept \*\*6\*\* — none merged\./.test(r.content) || !/Kotak Flexi Cap Fund Regular Growth 45% → Reduce/.test(r.content) || BAD.test(r.content))
      throw new Error(JSON.stringify({rows, c: r.content.slice(0, 900)}));
    return 'file + "isko Hold / Reduce / Switch analysis do" in one bubble; pills Switch first: ' + d.pills.map(p => p.split(':')[1]).join(', ') + ' | ' + rows.map(x => x.n + ' ' + x.a + ' (' + x.w + '%)').join(', ') + '; the Total line skipped';
  });

  await t.step('5. a PDF statement is read by the statement reader', async () => {
    const bytes = await t.eval(() => { const raw = pdfRender([{t: 'h2', text: 'Holding Statement'}, {t: 'table', cols: [{label: 'Scheme Name', w: 3}, {label: 'ISIN', w: 2}, {label: 'Units', w: 1}, {label: 'NAV', w: 1}, {label: 'Current Value', w: 1}],
        rows: [['DSP Midcap Fund Regular Growth', 'INF740K01797', '1000', '120', '120000'], ['Kotak Flexi Cap Fund Regular Growth', 'INF174K01336', '5000', '90', '450000'], ['HDFC Liquid Fund Regular Growth', 'INF179K01UY4', '100', '4500', '450000']]}], {title: 'ZZ statement'});
      return Array.from(raw, ch => ch.charCodeAt(0) & 0xFF); });
    const r = await upload('ZZ Holding Statement.pdf', 'application/pdf', Buffer.from(bytes));
    const rows = await t.eval(() => ai.upload && ai.upload.up.name === 'ZZ Holding Statement.pdf' ? ai.upload.up.rows.map(r => ({n: r.name, a: r.action, v: r.current})) : null);
    if(!rows || rows.length !== 3 || !rows.some(x => /DSP Midcap/.test(x.n) && x.a === 'Switch') || !/Read \*\*3 rows\*\*/.test(r.content)) throw new Error(JSON.stringify({rows, c: r.content.slice(0, 600)}));
    return rows.map(x => x.n.split(' ').slice(0, 2).join(' ') + ' ' + x.a).join(', ');
  });

  await t.step('6. Clear forgets the file; naming a client moves on; an unsupported or oversized file is refused plainly', async () => {
    const r = await t.eval(async () => {
      const out = {};
      out.beforeClear = riaUpFollowUp('concentration check karo');
      aiClearTurns();
      out.afterClear = riaUpFollowUp('concentration check karo') || !!ai.upload;
      return out;
    });
    const bad = await stage('notes.txt', 'text/plain', Buffer.from('hello'));
    const big = await stage('big.csv', 'text/csv', Buffer.alloc(11 * 1024 * 1024, 65));
    const moved = await t.eval(() => { ai.upload = {up: {rows: [], name: 'x'}, x: {}}; ai.subject = 'upload'; const a = riaUpFollowUp('iska analysis do'); const c = DB.clients.find(x => !x.deletedAt);
      riaSetActiveClient(c); return {a, b: riaUpFollowUp('iska analysis do'), subject: ai.subject}; });
    if(!r.beforeClear || r.afterClear || bad.staged || bad.turns || !/reads \.xlsx, \.xls, \.csv and \.pdf files/.test(bad.err) || big.staged || !/reads files up to 10 MB/.test(big.err) || !moved.a || moved.b || moved.subject !== 'client')
      throw new Error(JSON.stringify({r, bad, big, moved}));
    return 'Clear forgets it; a named client takes over; .txt and an 11 MB file refused on the attachment bar, nothing staged or sent';
  });

  await t.step('7. production\'s client-wise importer: the original file loses 35 rows as "Twice in file"; the clean import file goes in whole', async () => {
    if(!(await t.eval(() => typeof cwiOpen === 'function' && typeof cwiRead === 'function'))) return 'this build has no client-wise importer (TEST) — skipped';
    const cid = await t.eval(async () => { const c = {id: uid('CMS'), cmsName: 'ZZ Sanjay Upload Test', pan: 'ZZSAN1234S', branch: (DB.config.branches || ['Varanasi'])[0], rmName: currentUser,
      createdAt: new Date().toISOString(), createdBy: currentUser}; initState('CMS', c); DB.clients.push(c); await save('clients'); return c.id; });
    const pick = async (buffer, name) => {
      await t.eval((cid) => { cwiOpen(cid); }, cid); await t.wait(200);
      await t.eval(() => { const sel = document.getElementById('cwiPlatform'); const o = [...sel.options].find(x => /pms/i.test(x.value + ' ' + x.text)) || [...sel.options].find(x => x.value === 'mf-finowise') || [...sel.options].find(x => x.value);
        sel.value = o.value; cwi.platformId = o.value; document.getElementById('cwiKind').value = 'aum'; cwi.kind = 'aum'; });
      await t.page.setInputFiles('#cwiFile', {name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer});
      await t.eval(async () => { await cwiRead(); });
      for(let i = 0; i < 60; i++){ const s = await t.eval(() => cwi && !cwi.busy ? cwi.step : 'busy'); if(s !== 'busy') break; await t.wait(150); }
      return t.eval(() => ({step: cwi.step, err: cwi.err, platform: cwi.platformId, n: cwi.rows.length, dup: cwi.rows.filter(r => r.status === 'dup').length, fresh: cwi.rows.filter(r => r.status === 'new').length,
        invalid: cwi.rows.filter(r => r.status === 'invalid').length, needs: !!cwi.needsChoice}));
    };
    const orig = await pick(sanjayBytes, 'Investment Details.xlsx');
    await t.eval(() => cwiClose());
    const clean = await pick(cleanImport.buf, cleanImport.name);
    if(orig.step !== 'preview' || orig.n !== 36 || orig.dup !== 35) throw new Error('the original file did not reproduce the 35 "Twice in file": ' + JSON.stringify(orig));
    if(clean.step !== 'preview' || clean.n !== 36 || clean.dup || clean.invalid || clean.fresh !== 36) throw new Error('clean file: ' + JSON.stringify(clean));
    if(clean.needs) await t.eval(() => { cwi.confirm = true; cwiDraw(); });
    const can = await t.eval(() => cwiCanImport());
    if(!can.ok) throw new Error('import blocked: ' + JSON.stringify(can));
    await t.eval(async () => { await cwiImport(); }); await t.wait(500);
    const book = await t.eval((cid) => { try { cwiClose(); } catch(e){} maInvalidate(); const st = maState(); const rows = st.holdings.filter(r => r._c.ck === 'c:' + cid);
      return {n: rows.length, total: Math.round(rows.reduce((n, r) => n + Number(r.current_value || 0), 0)), names: rows.slice(0, 2).map(r => r.security_name)}; }, cid);
    if(book.n !== 36 || book.total !== sanjayTotal) throw new Error('after import: ' + JSON.stringify(book) + ' want 36 / ' + sanjayTotal);
    return 'original: 36 read, ' + orig.dup + ' "Twice in file" (the reported failure, reproduced) | clean file: 36 new, 0 twice, 0 incomplete → imported: ' + book.n + ' holdings, ₹' + book.total.toLocaleString('en-IN') + ' on the book (platform ' + clean.platform + ')';
  });

  await t.step('8. staging: ✕ removes the file; a typed prompt goes with the file; nothing goes before Send', async () => {
    await fresh();
    const a = await stage('MF statement.csv', 'text/csv', Buffer.from('Scheme Name,Units,NAV,Current Value\nDSP Midcap Fund Regular Growth,10,100,1000\n'));
    await t.eval(() => { document.querySelector('#riaAttach .ria-attach-x').click(); });
    const gone = await t.eval(() => ({staged: ai.staged, chip: !!document.getElementById('riaAttach'), turns: ai.turns.length}));
    if(a.turns || !a.staged || gone.staged || gone.chip || gone.turns) throw new Error(JSON.stringify({a, gone}));
    /* Enter in the input sends the staged file with what was typed */
    await stage('MF statement.csv', 'text/csv', Buffer.from('Scheme Name,Units,NAV,Current Value\nDSP Midcap Fund Regular Growth,10,100,1000\nKotak Flexi Cap Fund Regular Growth,5,100,500\n'));
    await t.page.fill('#aiInput', 'concentration check karo');
    await t.page.press('#aiInput', 'Enter');
    for(let i = 0; i < 80; i++){ const busy = await t.eval(() => ai.busy); if(!busy) break; await t.wait(250); }
    const r = await last(), d = await drawn();
    const st = await t.eval(() => ({staged: ai.staged, chip: !!document.getElementById('riaAttach'), users: ai.turns.filter(x => x.role === 'user').length}));
    if(st.staged || st.chip || st.users !== 1 || !/MF statement\.csv/.test(d.meBadge) || !/concentration check karo/.test(d.meText) || !r.view || !/^Largest holdings/.test(r.view.title) || d.rows !== 2)
      throw new Error(JSON.stringify({st, d, title: r.view && r.view.title}));
    return '✕ removed the chip with nothing sent; Enter sent file + "concentration check karo" as one message → "' + r.view.title + '", chip cleared';
  });

  await t.step('9. pipe tables in any answer become escaped, scrollable tables', async () => {
    const r = await t.eval(() => { const h = aiFormat('Intro **bold**\n| Scheme | Value | Action |\n|---|---:|---|\n| ZZ <script>x</script> Fund | ₹1,20,000 | Hold |\n| Kotak | 45% | Reduce |\nAfter'); return h; });
    if(!/^Intro <b>bold<\/b><div class="ria-table-wrap"><table class="ria-md-table">/.test(r) || !/<th>Scheme<\/th><th>Value<\/th><th>Action<\/th>/.test(r) || /<script>/.test(r) || !/&lt;script&gt;/.test(r)
      || !/<td class="num">₹1,20,000<\/td>/.test(r) || !/<td class="num">45%<\/td>/.test(r) || !/<\/table><\/div>After$/.test(r)) throw new Error(r);
    return 'header, right-aligned figures, escaped cells, text around the table kept';
  });
});

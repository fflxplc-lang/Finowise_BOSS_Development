/* SOP GUIDES: STEPS IN CHAT, AND THE DECK IN A READ-ONLY VIEWER (27-11-2026).

   sop-registry.json holds the firm's SOP decks (over a hundred) as steps; a
   deck's PDF, once on the server, opens from RIA AI in an in-page viewer
   that draws each page on a canvas — no download, no print — and is only
   ever served to a signed-in user.

   Steps:
     1. the registry loads (every guide, none with a PDF on a fresh server);
        "nomination ka process kya hai" is answered with the guide's numbered
        steps; with no PDF yet an admin is offered to add it.
     2. an admin adds the guide's PDF (a synthetic 3-page one); a file that
        is not a PDF, or a name the registry does not know, is refused.
     3. asked again, the answer carries "📄 View Visual SOP Guide
        (Read-Only)"; it opens the viewer: a canvas, "1 / 3", next / back,
        zoom and Fit width, close — no download / print / save control, no
        <a download>, no iframe / embed / object; right-click and Ctrl+S /
        Ctrl+P are refused; Escape closes it.
     4. the PDF and the registry are refused without a session (401); served
        to a signed-in user inline, nosniff, never cached; a path out of the
        folder or an unregistered name is a 404.
     5. Self Service & SOPs › All SOP Guides lists them all, the filter finds
        "PAN update", and picking it answers with its steps; a model answer that
        leaned on a mapped SOP (nft-nominee) offers the visual guide.
     6. an admin adds several PDFs at once: each goes to the guide whose file
        name it carries (case, spaces and _ / - ignored); an unknown name is
        listed as not added; the list's admin button counts what is missing.
     7. staff phrasing across the guides finds the right one (English and
        Hinglish), and data questions ("DWT dikhao", "top 10 clients by AUM")
        are not taken for an SOP.

   Synthetic PDF only — no real deck is in the repo or the tests. */
const http = require('http');
const {suite} = require('../lib/harness');
const PORT = Number(process.env.BOSS_PORT || 3000);
const N = require('../../sop-registry.json').sops.length;
const get = (p) => new Promise((res, rej) => { http.get({host: '127.0.0.1', port: PORT, path: p}, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({status: r.statusCode, body: b, headers: r.headers})); }).on('error', rej); });

suite(async t => {
  await t.home();
  const fresh = () => t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiClearDesk(); aiTogglePanel(); try { await aiRefreshStatus(true); } catch(e){} aiClearTurns(); });
  const ask = async (q) => { await t.eval(async (q) => { const el = document.getElementById('aiInput'); if(el){ el.disabled = false; el.value = q; } ai.draft = q; await aiSend(); }, q);
    return t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {content: x.content || '', actions: (x.actions || []).map(a => a.label), sopDoc: x.sopDoc || null}; }); };
  const FILE = 'Nomination_SOP.pdf';

  await t.step('1. the registry, and an SOP question answered with the guide\'s steps', async () => {
    await fresh();
    const reg = await t.eval(async () => (await riaSopLoad(true)).map(s => ({id: s.id, file: s.pdfFile, on: s.available, steps: s.steps.length})));
    if(reg.length !== N || N < 100 || reg.some(s => s.on) || !reg.some(s => s.file === 'Nomination_SOP.pdf')) throw new Error(JSON.stringify(reg));
    const r = await ask('nomination ka process kya hai');
    if(r.sopDoc !== 'nomination-sop' || !/^\*\*📘 SOP: Nominee updation \/ addition \(CAMS nomination form\)\*\*/.test(r.content) || !/\n1\. Search "CAMS Nomination Form"/.test(r.content) || !/\n8\. Documents: self-attested PAN and Aadhaar/.test(r.content)
      || r.actions.includes('📄 View Visual SOP Guide (Read-Only)') || !r.actions.includes('⬆ Add the visual guide (PDF)')) throw new Error(JSON.stringify(r).slice(0, 700));
    return reg.length + ' guides (' + reg.map(s => s.steps).join('/') + ' steps); the nomination steps, numbered; no PDF yet → an admin may add it';
  });

  await t.step('2. an admin adds the PDF; not-a-PDF and unregistered names are refused', async () => {
    /* the refusals below are asked for: the browser logs them as failed loads */
    t.expectConsole(/status of 400/, /status of 404/);
    const r = await t.eval(async (file) => {
      const raw = pdfRender([{t: 'band', text: 'ZZ Synthetic SOP — page 1'}, {t: 'pagebreak'}, {t: 'band', text: 'ZZ page 2'}, {t: 'pagebreak'}, {t: 'band', text: 'ZZ page 3'}], {title: 'ZZ synthetic guide'});
      const bytes = new Uint8Array(raw.length); for(let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xFF;
      const put = (name, body) => fetch('/api/sops/pdf/' + encodeURIComponent(name), {method: 'PUT', headers: Object.assign({'Content-Type': 'application/pdf'}, apiHeaders()), body}).then(async x => ({s: x.status, j: await x.json().catch(() => ({}))}));
      const notPdf = await put(file, new TextEncoder().encode('hello, this is not a pdf at all — just text pretending to be one, long enough to pass the size floor of the route here.'));
      const unknown = await put('Some_Other_Guide.pdf', bytes);
      const ok = await put(file, bytes);
      const reg = await riaSopLoad(true);
      return {notPdf: notPdf.s, unknown: unknown.s, ok: ok.s, bytes: ok.j.bytes, on: (reg.find(s => s.pdfFile === file) || {}).available};
    }, FILE);
    if(r.notPdf !== 400 || r.unknown !== 404 || r.ok !== 200 || !r.on) throw new Error(JSON.stringify(r));
    return 'added (' + r.bytes + ' B, into the data folder); not-a-PDF → 400, unregistered name → 404';
  });

  await t.step('3. the read-only viewer: canvas, pages, zoom, close — and no download, print or save', async () => {
    const r = await ask('nominee update kaise kare');
    if(!r.actions.includes('📄 View Visual SOP Guide (Read-Only)')) throw new Error('no View button: ' + JSON.stringify(r.actions));
    await t.eval(() => { const b = [...document.querySelectorAll('#aiTurns .ria-act')].reverse().find(x => x.textContent.trim() === '📄 View Visual SOP Guide (Read-Only)'); b.click(); });
    for(let i = 0; i < 60; i++){ if(await t.eval(() => /\d+ \/ \d+/.test((document.getElementById('riaSopPage') || {}).textContent || ''))) break; await t.wait(200); }
    const v = await t.eval(async () => {
      const ov = document.getElementById('riaSopViewer'), canvas = document.getElementById('riaSopCanvas');
      const page = () => document.getElementById('riaSopPage').textContent, zoom = () => document.getElementById('riaSopZoom').textContent;
      const out = {open: !!ov, canvas: !!(canvas && canvas.width > 100 && canvas.height > 100), p1: page(), z1: zoom()};
      const click = k => ov.querySelector('[data-k="' + k + '"]').click(), wait = () => new Promise(r => setTimeout(r, 400));
      click('next'); await wait(); out.p2 = page();
      click('prev'); await wait(); out.p3 = page();
      click('in'); await wait(); out.z2 = zoom();
      click('fit'); await wait(); out.z3 = zoom();
      out.controls = [...ov.querySelectorAll('button')].map(b => (b.textContent + ' ' + (b.title || '') + ' ' + (b.getAttribute('aria-label') || '')).trim());
      out.forbidden = !!ov.querySelector('a[download], a[href], iframe, embed, object');
      const ctx = new MouseEvent('contextmenu', {bubbles: true, cancelable: true}); canvas.dispatchEvent(ctx); out.ctxBlocked = ctx.defaultPrevented;
      const kp = new KeyboardEvent('keydown', {key: 'p', ctrlKey: true, bubbles: true, cancelable: true}); document.dispatchEvent(kp); out.printBlocked = kp.defaultPrevented;
      const ks = new KeyboardEvent('keydown', {key: 's', metaKey: true, bubbles: true, cancelable: true}); document.dispatchEvent(ks); out.saveBlocked = ks.defaultPrevented;
      out.select = getComputedStyle(ov).userSelect;
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})); await wait();
      out.closed = !document.getElementById('riaSopViewer');
      return out;
    });
    const bad = v.controls.filter(c => /download|print|save|export|open in/i.test(c));
    if(!v.open || !v.canvas || v.p1 !== '1 / 3' || v.p2 !== '2 / 3' || v.p3 !== '1 / 3' || v.z1 !== 'Fit' || !/^\d+%$/.test(v.z2) || v.z3 !== 'Fit' || bad.length || v.forbidden
      || !v.ctxBlocked || !v.printBlocked || !v.saveBlocked || v.select !== 'none' || !v.closed) throw new Error(JSON.stringify(v));
    return 'canvas, ' + v.p1 + ' → ' + v.p2 + ' → ' + v.p3 + ', zoom ' + v.z2 + ' / Fit; controls: ' + v.controls.map(c => c.split(' ')[0]).join(' ') + '; right-click, Ctrl+P, ⌘+S refused; Escape closes';
  });

  await t.step('4. no session, no guide; signed in: inline, nosniff, never cached; traversal and unregistered names 404', async () => {
    const anonPdf = await get('/api/sops/pdf/' + FILE), anonReg = await get('/api/sops/registry');
    const r = await t.eval(async (file) => {
      const h = apiHeaders();
      const ok = await fetch('/api/sops/pdf/' + file, {headers: h});
      const head = {status: ok.status, type: ok.headers.get('content-type'), disp: ok.headers.get('content-disposition'), sniff: ok.headers.get('x-content-type-options'), cache: ok.headers.get('cache-control')};
      const trav = await fetch('/api/sops/pdf/..%2F..%2Fdata.json', {headers: h}), trav2 = await fetch('/api/sops/pdf/' + encodeURIComponent('../server.js'), {headers: h});
      const other = await fetch('/api/sops/pdf/Not_Registered.pdf', {headers: h}), missing = await fetch('/api/sops/pdf/PAN_updation_SOP.pdf', {headers: h});
      return {head, trav: trav.status, trav2: trav2.status, other: other.status, missing: missing.status};
    }, FILE);
    if(anonPdf.status !== 401 || anonReg.status !== 401 || /%PDF/.test(anonPdf.body)) throw new Error('anonymous: ' + JSON.stringify({pdf: anonPdf.status, reg: anonReg.status}));
    if(r.head.status !== 200 || r.head.type !== 'application/pdf' || !/^inline/.test(r.head.disp || '') || r.head.sniff !== 'nosniff' || !/no-store/.test(r.head.cache || '')
      || ![400, 404].includes(r.trav) || ![400, 404].includes(r.trav2) || r.other !== 404 || r.missing !== 404) throw new Error(JSON.stringify(r));
    return 'anonymous → 401 (PDF and registry); signed in → 200 ' + r.head.type + ', ' + r.head.disp + ', nosniff, ' + r.head.cache + '; traversal ' + r.trav + '/' + r.trav2 + ', unregistered 404, no PDF yet 404';
  });

  await t.step('5. All SOP Guides in Self Service: the list, the filter, a pick; a model answer citing a mapped SOP offers the guide', async () => {
    await fresh();
    const r = await t.eval(async () => {
      riaShowMenu();
      const ti = ai.turns.length - 1, cat = RIA_MENU.find(c => c.id === 'self'), k = cat.subs.findIndex(s => s[0] === 'sopall');
      await riaSubPick(ti, 'self', k); await new Promise(r => setTimeout(r, 300));
      const box = [...document.querySelectorAll('#aiTurns .ria-soplist')].pop();
      const items = () => [...box.querySelectorAll('.ria-sop-item')].filter(b => !b.hidden).map(b => b.querySelector('.ria-sop-t').textContent);
      const all = items(), badges = [...box.querySelectorAll('.ria-sop-b.on')].length;
      const f = box.querySelector('.ria-sop-filter'); f.value = 'pan update'; f.dispatchEvent(new Event('input', {bubbles: true}));
      const pan = items(), cats = [...box.querySelectorAll('.ria-sop-cat')].filter(c => !c.hidden).length;
      [...box.querySelectorAll('.ria-sop-item')].find(b => !b.hidden && /PAN update/.test(b.textContent)).click(); await new Promise(r => setTimeout(r, 200));
      const last = ai.turns[ai.turns.length - 1];
      const mapped = riaSopDocsFor({sops: [{id: 'nft-nominee'}]}).map(s => s.id), none = riaSopDocsFor({sops: [{id: 'kyc-fresh-ekyc'}]}).length;
      return {label: cat.subs[k][1], all, badges, pan, cats, answer: last.content.split('\n')[0], acts: (last.actions || []).map(a => a.label), mapped, none};
    });
    if(r.label !== '📚 All SOP Guides (Read-Only)' || r.all.length !== N || r.badges !== 1 || !r.pan.length || r.pan.length > 4 || !r.pan.some(x => /PAN update/.test(x)) || r.answer !== '**📘 SOP: PAN update / correction**'
      || r.mapped.join() !== 'nomination-sop' || r.none) throw new Error(JSON.stringify(r));
    return r.all.length + ' guides listed (1 with its PDF); filter "pan update" → ' + r.pan.join(' / ') + ' → its steps; nft-nominee answers offer the nomination guide';
  });

  await t.step('6. several PDFs at once: matched by file name, an unknown one reported; the admin button counts what is missing', async () => {
    const r = await t.eval(async () => {
      const raw = pdfRender([{t: 'band', text: 'ZZ Synthetic SOP'}], {title: 'ZZ synthetic guide'});
      const bytes = new Uint8Array(raw.length); for(let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 0xFF;
      const list = await riaSopLoad(true), a = list.find(s => s.id === 'pan-updation-sop'), b = list.find(s => s.id === 'nri-account-opening');
      await riaSopBrowse(); const btn = ((ai.turns[ai.turns.length - 1].actions || [])[0] || {}).label || '';
      const files = [new File([bytes], a.pdfFile.toLowerCase().replace(/_/g, ' '), {type: 'application/pdf'}), new File([bytes], b.pdfFile.replace(/_/g, '-'), {type: 'application/pdf'}), new File([bytes], 'ZZ Unknown Guide.pdf', {type: 'application/pdf'})];
      await riaSopBulkUpload(files);
      const after = await riaSopLoad(true), last = ai.turns[ai.turns.length - 1].content;
      return {btn, last, on: after.filter(s => s.available).map(s => s.id).sort()};
    });
    if(!/^⬆ Add visual guides \(several PDFs\) — \d+ missing$/.test(r.btn) || !/^✅ Added 2 visual guides\. 3 of \d+ guides now have one\./.test(r.last) || !/ZZ Unknown Guide\.pdf — no guide has this file name/.test(r.last)
      || r.on.join() !== 'nomination-sop,nri-account-opening,pan-updation-sop') throw new Error(JSON.stringify(r));
    return r.btn + '; ' + r.last.split('\n')[0] + ' — the unknown file reported';
  });

  await t.step('7. staff phrasing finds the right guide; data questions are not taken for an SOP', async () => {
    const CASES = [
      ['nominee change online kaise kare', 'change-add-nominee-online-sop'], ['nominee delete karna hai process', 'nomination-opt-out-sop'],
      ['bank account change online mf central', 'change-of-bank-ac-through-mf-central-sop-online'], ['bank change offline process', 'change-of-bank-sop'],
      ['email change online process', 'change-of-email-id-through-mf-central-sop-online'], ['minor to major process', 'minor-attains-major-sop'],
      ['transmission process death of unit holder', 'transmission-of-units-on-death-of-unit-holder'], ['cas kaise nikale', 'consoliadetd-account-statement-cas-sop-mf-central'],
      ['nj sip cancellation offline form', 'nj-sip-cancellation-stop-request-offline-sop'], ['nj sip cancel online process', 'sop-nj-sip-cancellation'],
      ['pms closure process', 'nj-pms-closure-offline-sop'], ['e-mandate aadhaar se kaise kare', 'mandate-registration-e-mandate-aadhar-card-1'],
      ['anand rathi redemption process', 'redemption'], ['lic family chart kaise banaye', 'lic-family-chart-sop'], ['sip pause kaise kare', 'sip-pause-through-finowise-platform'],
      ['DWT dikhao', null], ['top 10 clients by AUM', null], ['how many sips were cancelled this month', null], ['show redemption of client Ramesh last month', null], ['Signal Sharma ke portfolio mein kya buy, hold ya sell karna hai?', null]];
    const r = await t.eval(async (cases) => { const list = await riaSopLoad(true); return cases.map(([q, want]) => { const g = riaSopFor(q, list); return {q, want, got: g ? g.id : null}; }); }, CASES);
    const bad = r.filter(x => x.got !== x.want);
    if(bad.length) throw new Error(JSON.stringify(bad));
    const tie = await ask('sip kaise lagaye new scheme');
    if(!/^\*\*📘 SOP: SIP registration in a new scheme/.test(tie.content) || !tie.actions.some(l => /^📘 SIP registration in a new scheme/.test(l)) || !/Not the one\?/.test(tie.content)) throw new Error(JSON.stringify(tie).slice(0, 600));
    return (r.length - 5) + ' phrasings → the right guide; 5 data questions → no SOP; a tie answers with the best and offers the other (' + tie.actions.find(l => /^📘/.test(l)) + ')';
  });
});

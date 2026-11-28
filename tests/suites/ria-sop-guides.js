/* SOP GUIDES: THE MATCHED GUIDE'S STEPS, AND ITS DECK SCROLLING READ-ONLY BELOW THEM (28-11-2026).

   sop-registry.json holds the firm's SOP decks (over a hundred) as steps. An
   SOP question is answered with the one guide that matched: its numbered
   steps and — once its PDF is on the server — every page of the deck,
   stacked, in a read-only box that scrolls right under the steps (and full
   screen from "Expand Full View"). No list of every guide and nothing about
   uploading appears in chat; administrators manage the PDFs in Setup › SOP
   Visual Guides.

   Steps:
     1. the registry loads (every guide, none with a PDF on a fresh server);
        "nomination ka process kya hai" is answered with the guide's numbered
        steps — and no "All SOP Guides", no upload button, no admin hint.
     2. an admin adds the guide's PDF (a synthetic 3-page one); a file that
        is not a PDF, or a name the registry does not know, is refused.
     3. asked again, the answer carries the deck inline: three pages, each on
        a canvas, stacked in a box that scrolls (overflow-y auto); it
        survives the conversation being redrawn; no download / print / save
        control, no <a>, iframe, embed or object; right-click and Ctrl+P are
        refused in it; "Expand Full View" scrolls the same pages full screen,
        with zoom, and Escape closes it.
     4. the PDF and the registry are refused without a session (401); served
        to a signed-in user inline, nosniff, never cached; a path out of the
        folder or an unregistered name is a 404.
     5. Self Service has no "All SOP Guides"; Setup › SOP Visual Guides lists
        every guide with its status and the bulk upload for an administrator,
        and nothing for anyone else; a model answer that leaned on a mapped
        SOP (nft-nominee) still offers that one guide.
     6. an admin adds several PDFs at once there: each goes to the guide whose
        file name it carries (case, spaces and _ / - ignored); an unknown name
        is reported, not guessed.
     7. staff phrasing finds the right guide (English and Hinglish) — general
        KYC questions find Individual KYC, HUF only when HUF is named — and
        data questions are not taken for an SOP.

   Synthetic PDFs only — no real deck is in the repo or the tests. */
const http = require('http');
const {suite} = require('../lib/harness');
const PORT = Number(process.env.BOSS_PORT || 3000);
const N = require('../../sop-registry.json').sops.length;
const get = (p) => new Promise((res, rej) => { http.get({host: '127.0.0.1', port: PORT, path: p}, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({status: r.statusCode, body: b, headers: r.headers})); }).on('error', rej); });

suite(async t => {
  await t.home();
  const fresh = () => t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiClearDesk(); aiTogglePanel(); try { await aiRefreshStatus(true); } catch(e){} aiClearTurns(); });
  const ask = async (q) => { await t.eval(async (q) => { const el = document.getElementById('aiInput'); if(el){ el.disabled = false; el.value = q; } ai.draft = q; await aiSend(); }, q);
    return t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {content: x.content || '', actions: (x.actions || []).map(a => a.label), sopDoc: x.sopDoc || null, inline: !!x.sopInline}; }); };
  const FILE = 'Nomination_SOP.pdf';
  const synthPdf = pages => t.eval((pages) => {
    const blocks = []; for(let i = 1; i <= pages; i++){ if(i > 1) blocks.push({t: 'pagebreak'}); blocks.push({t: 'band', text: 'ZZ Synthetic SOP — page ' + i}); }
    const raw = pdfRender(blocks, {title: 'ZZ synthetic guide'});
    return Array.from(raw, ch => ch.charCodeAt(0) & 0xFF);
  }, pages);
  const BAD = /All SOP Guides|Add the visual guide|admins only|No visual guide is on the server|Add visual guides/i;

  await t.step('1. the registry, and an SOP question answered with that guide\'s steps only — no list, no upload, no admin hint', async () => {
    await fresh();
    const reg = await t.eval(async () => (await riaSopLoad(true)).map(s => ({id: s.id, file: s.pdfFile, on: s.available, steps: s.steps.length, req: (s.requires || []).length, exc: (s.excludes || []).length, pages: s.pages})));
    if(reg.length !== N || N < 108 || reg.some(s => s.on) || !reg.some(s => s.file === 'Nomination_SOP.pdf') || reg.some(s => !(s.pages > 0))
      || !reg.find(s => s.id === 'huf-physical-kyc').req || !reg.find(s => s.id === 'individual-kyc-sop-change-of-address').exc) throw new Error(JSON.stringify(reg).slice(0, 400));
    const r = await ask('nomination ka process kya hai');
    if(r.sopDoc !== 'nomination-sop' || !/^\*\*📘 SOP: Nominee updation \/ addition \(CAMS nomination form\)\*\*/.test(r.content) || !/\n1\. Search "CAMS Nomination Form"/.test(r.content) || !/\n8\. Documents: self-attested PAN and Aadhaar/.test(r.content)
      || r.inline || BAD.test(r.content) || r.actions.some(l => BAD.test(l))) throw new Error(JSON.stringify(r).slice(0, 700));
    const staff = await t.eval(() => { const real = window.isAdmin; window.isAdmin = () => false; riaSopAnswer(riaSopById('nomination-sop')); window.isAdmin = real; return ai.turns[ai.turns.length - 1].content; });
    if(!/Admin note: this guide's PDF is not on the server yet/.test(r.content) || /Admin note|not on the server|Setup/.test(staff)) throw new Error('admin note: ' + JSON.stringify({admin: r.content.slice(-200), staff: staff.slice(-200)}));
    return reg.length + ' guides; the nomination steps, numbered; actions: ' + r.actions.join(' / ') + ' — nothing about uploading or browsing every guide (an admin alone is told the PDF is missing)';
  });

  await t.step('2. an admin adds the PDF; not-a-PDF and unregistered names are refused', async () => {
    t.expectConsole(/status of 400/, /status of 404/);
    const bytes = await synthPdf(3);
    const r = await t.eval(async ({file, arr}) => {
      const bytes = new Uint8Array(arr);
      const put = (name, body) => fetch('/api/sops/pdf/' + encodeURIComponent(name), {method: 'PUT', headers: Object.assign({'Content-Type': 'application/pdf'}, apiHeaders()), body}).then(async x => ({s: x.status, j: await x.json().catch(() => ({}))}));
      const notPdf = await put(file, new TextEncoder().encode('hello, this is not a pdf at all — just text pretending to be one, long enough to pass the size floor of the route here.'));
      const unknown = await put('Some_Other_Guide.pdf', bytes);
      const ok = await put(file, bytes);
      const reg = await riaSopLoad(true);
      return {notPdf: notPdf.s, unknown: unknown.s, ok: ok.s, bytes: ok.j.bytes, on: (reg.find(s => s.pdfFile === file) || {}).available};
    }, {file: FILE, arr: bytes});
    if(r.notPdf !== 400 || r.unknown !== 404 || r.ok !== 200 || !r.on) throw new Error(JSON.stringify(r));
    return 'added (' + r.bytes + ' B, into the data folder); not-a-PDF → 400, unregistered name → 404';
  });

  await t.step('3. the deck inline under the steps: every page stacked on canvases, scrolling, read-only — and full view scrolls the same', async () => {
    const r = await ask('nominee update kaise kare');
    if(!r.inline || r.sopDoc !== 'nomination-sop' || BAD.test(r.content) || r.actions.some(l => BAD.test(l)) || !/The SOP file itself is right below these steps/.test(r.content)) throw new Error('no inline guide: ' + JSON.stringify(r).slice(0, 500));
    for(let i = 0; i < 60; i++){ if(await t.eval(() => [...document.querySelectorAll('#aiTurns .ria-sopi canvas')].filter(c => c.width > 100).length >= 3)) break; await t.wait(200); }
    const v = await t.eval(async () => {
      const box = [...document.querySelectorAll('#aiTurns .ria-sopi')].pop(), sc = box.querySelector('.ria-sopi-scroll');
      const canvases = [...sc.querySelectorAll('canvas')], st = getComputedStyle(sc);
      const out = {pages: canvases.length, drawn: canvases.filter(c => c.width > 100 && c.height > 100).length, labels: [...sc.querySelectorAll('.ria-sopp-no')].map(x => x.textContent),
        overflow: st.overflowY, maxH: st.maxHeight, stacked: canvases.length > 1 && canvases[1].getBoundingClientRect().top > canvases[0].getBoundingClientRect().bottom - 1,
        head: box.querySelector('.ria-sopi-n').textContent, select: getComputedStyle(box).userSelect};
      out.forbidden = !!box.querySelector('a, iframe, embed, object');
      out.controls = [...box.querySelectorAll('button')].map(b => (b.textContent + ' ' + (b.title || '')).trim());
      const ctx = new MouseEvent('contextmenu', {bubbles: true, cancelable: true}); canvases[0].dispatchEvent(ctx); out.ctxBlocked = ctx.defaultPrevented;
      box.focus(); const kp = new KeyboardEvent('keydown', {key: 'p', ctrlKey: true, bubbles: true, cancelable: true}); document.dispatchEvent(kp); out.printBlocked = kp.defaultPrevented;
      sc.scrollTop = 60; aiDrawPanel(); await new Promise(r => setTimeout(r, 100));
      const again = [...document.querySelectorAll('#aiTurns .ria-sopi')].pop();
      out.sameAfterRedraw = again === box && again.querySelector('canvas').width > 100;
      return out;
    });
    const bad = v.controls.filter(c => /download|print|save|export|open in/i.test(c));
    if(v.pages !== 3 || v.drawn !== 3 || v.labels.join('|') !== 'Page 1 of 3|Page 2 of 3|Page 3 of 3' || v.overflow !== 'auto' || v.maxH === 'none' || !v.stacked || !/3 pages/.test(v.head)
      || v.forbidden || bad.length || !v.ctxBlocked || !v.printBlocked || v.select !== 'none' || !v.sameAfterRedraw) throw new Error(JSON.stringify(v));
    await t.eval(() => { [...document.querySelectorAll('#aiTurns .ria-sopi-x')].pop().click(); });
    for(let i = 0; i < 60; i++){ if(await t.eval(() => [...document.querySelectorAll('#riaSopBody canvas')].filter(c => c.width > 100).length >= 1 && /Page \d+ \/ 3/.test((document.getElementById('riaSopPage') || {}).textContent || ''))) break; await t.wait(200); }
    const m = await t.eval(async () => {
      const ov = document.getElementById('riaSopViewer'), body = document.getElementById('riaSopBody');
      const zoom = () => document.getElementById('riaSopZoom').textContent, wait = () => new Promise(r => setTimeout(r, 500));
      const out = {open: !!ov, pages: body.querySelectorAll('canvas').length, overflow: getComputedStyle(body).overflowY, page1: document.getElementById('riaSopPage').textContent, z1: zoom()};
      body.scrollTop = body.scrollHeight; await wait(); out.pageEnd = document.getElementById('riaSopPage').textContent;
      ov.querySelector('[data-k="in"]').click(); await wait(); out.z2 = zoom();
      ov.querySelector('[data-k="fit"]').click(); await wait(); out.z3 = zoom();
      out.controls = [...ov.querySelectorAll('button')].map(b => (b.textContent + ' ' + (b.title || '') + ' ' + (b.getAttribute('aria-label') || '')).trim());
      out.forbidden = !!ov.querySelector('a, iframe, embed, object');
      const ks = new KeyboardEvent('keydown', {key: 's', metaKey: true, bubbles: true, cancelable: true}); document.dispatchEvent(ks); out.saveBlocked = ks.defaultPrevented;
      document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true})); await wait();
      out.closed = !document.getElementById('riaSopViewer');
      return out;
    });
    const badM = m.controls.filter(c => /download|print|save|export|open in/i.test(c));
    if(!m.open || m.pages !== 3 || m.overflow !== 'auto' || m.page1 !== 'Page 1 / 3' || m.pageEnd !== 'Page 3 / 3' || m.z1 !== 'Fit' || !/^\d+%$/.test(m.z2) || m.z3 !== 'Fit' || badM.length || m.forbidden || !m.saveBlocked || !m.closed) throw new Error(JSON.stringify(m));
    return 'inline: ' + v.labels.join(', ') + ' stacked, scrolls (max-height ' + v.maxH + '), kept across a redraw; right-click and Ctrl+P refused; full view: ' + m.page1 + ' → scrolled to ' + m.pageEnd + ', zoom ' + m.z2 + ' / Fit; Escape closes';
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

  await t.step('5. no "All SOP Guides" in chat; Setup › SOP Visual Guides for an administrator only; a mapped SOP still offers its one guide', async () => {
    await fresh();
    const r = await t.eval(async () => {
      const self = RIA_MENU.find(c => c.id === 'self'), subs = self.subs.map(s => s[1]);
      await riaSopLoad(true);
      navigate('settings', 'sopguides'); await new Promise(r => setTimeout(r, 400));
      const rows = document.querySelectorAll('#sopGuideTable tbody tr').length, bulk = (document.getElementById('sopBulkBtn') || {}).textContent || '';
      const onRow = [...document.querySelectorAll('#sopGuideTable tbody tr')].find(tr => /Nomination_SOP\.pdf/.test(tr.textContent));
      const realAdmin = window.isAdmin; window.isAdmin = () => false;
      const asStaff = renderSettingsSopGuides();
      window.isAdmin = realAdmin;
      const mapped = riaSopDocsFor({sops: [{id: 'nft-nominee'}]}).map(s => s.id), none = riaSopDocsFor({sops: [{id: 'kyc-fresh-ekyc'}]}).length;
      navigate('dashboard');
      return {subs, rows, bulk, onRow: onRow ? onRow.textContent.replace(/\s+/g, ' ') : '', asStaff, mapped, none};
    });
    if(r.subs.some(l => /All SOP Guides/i.test(l)) || r.rows !== N || !/Add visual guides/.test(r.bulk) || !/On the server/.test(r.onRow) || !/View \(read-only\)/.test(r.onRow)
      || !/Only an administrator/.test(r.asStaff) || /sopGuideTable|sopBulkBtn/.test(r.asStaff) || r.mapped.join() !== 'nomination-sop' || r.none) throw new Error(JSON.stringify(r).slice(0, 700));
    return 'Self Service: ' + r.subs.length + ' tiles, no All SOP Guides; Setup lists ' + r.rows + ' guides with "' + r.bulk.trim() + '"; staff see only "Only an administrator…"; nft-nominee answers offer the nomination guide';
  });

  await t.step('6. several PDFs at once in Setup: matched by file name, an unknown one reported', async () => {
    const bytes = await synthPdf(1);
    const r = await t.eval(async (arr) => {
      const bytes = new Uint8Array(arr);
      const list = await riaSopLoad(true), a = list.find(s => s.id === 'pan-updation-sop'), b = list.find(s => s.id === 'nri-account-opening');
      const files = [new File([bytes], a.pdfFile.toLowerCase().replace(/_/g, ' '), {type: 'application/pdf'}), new File([bytes], b.pdfFile.replace(/_/g, '-'), {type: 'application/pdf'}), new File([bytes], 'ZZ Unknown Guide.pdf', {type: 'application/pdf'})];
      const res = await riaSopBulkUpload(files);
      const after = await riaSopLoad(true);
      return {res, on: after.filter(s => s.available).map(s => s.id).sort()};
    }, bytes);
    if(!r.res || r.res.done.length !== 2 || r.res.skipped.length !== 1 || !/ZZ Unknown Guide\.pdf — no guide has this file name/.test(r.res.skipped[0]) || r.res.available !== 3
      || r.on.join() !== 'nomination-sop,nri-account-opening,pan-updation-sop') throw new Error(JSON.stringify(r));
    return 'added ' + r.res.done.join(' + ') + '; "' + r.res.skipped[0] + '"; ' + r.res.available + ' of ' + r.res.total + ' guides have their PDF';
  });

  await t.step('7. staff phrasing finds the right guide; KYC goes to Individual KYC unless HUF is named; data questions are not taken for an SOP', async () => {
    const CASES = [
      ['physical KYC process steps documents', 'individual-kyc-sop-change-of-address'], ['KYC process', 'individual-kyc-sop-change-of-address'], ['kyc kaise kare', 'individual-kyc-sop-change-of-address'],
      ['huf kyc process', 'huf-physical-kyc'], ['non-individual kyc process', 'huf-physical-kyc'], ['ckyc kin number kaise nikale', 'ckyc-portal-kin-no'],
      ['nominee change online kaise kare', 'change-add-nominee-online-sop'], ['nominee delete karna hai process', 'nomination-opt-out-sop'],
      ['bank account change online mf central', 'change-of-bank-ac-through-mf-central-sop-online'], ['bank change offline process', 'change-of-bank-sop'],
      ['email change online process', 'change-of-email-id-through-mf-central-sop-online'], ['minor to major process', 'minor-attains-major-sop'],
      ['transmission process death of unit holder', 'transmission-of-units-on-death-of-unit-holder'], ['cas kaise nikale', 'consoliadetd-account-statement-cas-sop-mf-central'],
      ['nj sip cancellation offline form', 'nj-sip-cancellation-stop-request-offline-sop'], ['nj sip cancel online process', 'sop-nj-sip-cancellation'],
      ['pms closure process', 'nj-pms-closure-offline-sop'], ['e-mandate aadhaar se kaise kare', 'mandate-registration-e-mandate-aadhar-card-1'],
      ['nflx aadhaar mandate process', 'final-aadhar-sop-with-logo-br'], ['anand rathi redemption process', 'redemption'], ['lic family chart kaise banaye', 'lic-family-chart-sop'],
      ['sip pause kaise kare', 'sip-pause-through-finowise-platform'],
      ['DWT dikhao', null], ['top 10 clients by AUM', null], ['how many sips were cancelled this month', null], ['show redemption of client Ramesh last month', null],
      ['Signal Sharma ke portfolio mein kya buy, hold ya sell karna hai?', null]];
    const r = await t.eval(async (cases) => { const list = await riaSopLoad(true); return cases.map(([q, want]) => { const g = riaSopFor(q, list); return {q, want, got: g ? g.id : null}; }); }, CASES);
    const bad = r.filter(x => x.got !== x.want);
    if(bad.length) throw new Error(JSON.stringify(bad));
    const tie = await ask('sip kaise lagaye new scheme');
    if(!/^\*\*📘 SOP: SIP registration in a new scheme/.test(tie.content) || !tie.actions.some(l => /^📘 SIP registration in a new scheme/.test(l)) || !/Not the one\?/.test(tie.content) || tie.actions.some(l => BAD.test(l))) throw new Error(JSON.stringify(tie).slice(0, 600));
    return (r.length - 5) + ' phrasings → the right guide (physical KYC → Individual KYC); 5 data questions → no SOP; a tie answers with the best and offers the other';
  });
});

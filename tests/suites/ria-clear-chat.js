/* RIA AI: CLEAR CHAT STARTS A NEW CONVERSATION.

   Reported: after a client's details were asked for, Clear, and then
   "Show me all clients whose mobile number is not added", RIA AI kept
   answering about the client from before. Each step below asks something
   in one conversation, clears, asks something else, and then reads what
   the page actually sent to the model (a stand-in that records every
   request) and what it showed: nothing of the old conversation may be in
   either, unless the new question independently matches it.

     1. client A → Clear → client B
     2. client details (account opened from the answer) → Clear → "clients
        whose mobile number is not added"
     3. missing mobile → Clear → missing email
     4. client search → Clear → a general finance question
     5. Clear while an old answer is still being written: the old answer
        never lands in the new conversation, and the new one is not held up
     6. Clear, then refresh the page
     7. nothing of a conversation is kept in browser storage to come back
     8. "jiska mobile no add nhi hai usko filter krke list do" after a client
        and Clear: the book's total, how many lack a mobile, and who, as
        Client ID | Client Name | Branch | Status
     9. missing DOB and missing PAN the same way; "<client> ka PAN batao,
        nahi mil raha" stays a question about that client
    10. the model path: a missing-field question hands over the book's
        filter (attributeFilter, PAN masked), never a client from before
    11. "I want that clients who have not SIP?" and "give me all clients who
        are invest more than equal to 20 Lakh": only the matching clients,
        counted against the book with their total AUM, biggest first, no
        model call, no SOP, no market text; PDF / Excel / CSV of every
        matching client with full details
    12. the client this conversation is about: "ZZ Alpha Clientone ki details"
        then "iska DOB batao" / "iska portfolio analysis do" are that client
        only (no firm-wide signals); naming another client moves it; Clear
        forgets it; "Pune branch ka portfolio analysis do" is that branch only

   Synthetic clients only. */
const http = require('http');
const {suite} = require('../lib/harness');

const MOCK_PORT = Number(process.env.BOSS_PORT || 3000) + 333;
const seen = [];
let slowRelease = null;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if(req.url.endsWith('/models')) return res.end(JSON.stringify({data:[{id:'mock-model'}]}));
    const j = JSON.parse(body || '{}');
    seen.push(j);
    const sys = ((j.messages||[]).find(m=>m.role==='system')||{}).content || '';
    const u = ((j.messages||[])[(j.messages||[]).length-1]||{}).content || '';
    const reply = (text) => res.end(JSON.stringify({choices:[{message:{role:'assistant', content:text}}]}));
    if(/WHICH RECORDS/.test(sys)){
      const read = /mobile/i.test(u) ? {source:'clients', where:[{col:'mobile', op:'eq', value:''}], cols:['name','mobile','branch']}
                 : /e-?mail/i.test(u) ? {source:'clients', where:[{col:'email', op:'eq', value:''}], cols:['name','email','branch']}
                 : {source:'clients', groupBy:['branch']};
      return reply(JSON.stringify({reads:[read], client:null}));
    }
    /* An answer that takes its time, released by the test. */
    if(/Question: .*SLOW/.test(u)) { slowRelease = () => reply('STALE ANSWER from the old conversation'); return; }
    const names = (u.match(/"name":"([^"]+)"/g) || []).map(x=>x.slice(8, -1));
    reply('MOCK ANSWER' + (names.length ? ' about ' + names.join(', ') : ''));
  });
});
const sent = (from) => seen.slice(from).map(j => JSON.stringify(j.messages || [])).join('\n');

const CLIENTS = [
  {id:'CMS-CC-A', cmsName:'ZZ Alpha Clientone', branch:'Pune', mobile:'9800000101', email:'alpha@example.test', pan:'ABCPA1111A', dob:'1980-01-01', rmName:''},
  {id:'CMS-CC-B', cmsName:'ZZ Bravo Clienttwo', branch:'Pune', mobile:'9800000102', email:'', pan:'ABCPB2222B', rmName:''},
  {id:'CMS-CC-N1', cmsName:'ZZ Nomobile One', branch:'Mumbai', mobile:'', email:'n1@example.test', pan:'ABCPN3333N', dob:'1990-03-03', rmName:''},
  {id:'CMS-CC-N2', cmsName:'ZZ Nomobile Two', branch:'Delhi', email:'', rmName:''}];

suite(async t => {
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
  const ask = (q) => t.eval(async (q) => { const el = document.getElementById('aiInput'); el.value = q; ai.draft = q; await aiSend(); }, q);
  const shown = () => t.eval(() => ({text: ai.turns.map(x => x.content + ' ' + JSON.stringify(x.table || '') + ' ' + JSON.stringify(x.clients || '')).join('\n'),
    panel: (document.querySelector('#aiTurns') || {}).textContent || '', turns: ai.turns.length}));
  const clear = () => t.eval(() => { const b = [...document.querySelectorAll('#aiPanel button, .ai-panel button, button')].find(x => x.textContent.trim() === 'Clear' && x.getAttribute('onclick') === 'aiClearTurns()');
    if(!b) throw new Error('no Clear button'); if(b.disabled) throw new Error('Clear is disabled'); b.click(); });
  const fresh = async () => { await t.eval(async () => { aiCloseP(); navigate('dashboard'); ai.turns = []; aiClearDesk(); aiTogglePanel(); await aiRefreshStatus(true); }); };

  await t.step('setup: four synthetic clients and the stand-in model', async () => {
    const r = await t.eval(async ({port, clients}) => {
      const put = await fetch('/api/storage/clients', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()), body: JSON.stringify({value: JSON.stringify(clients)})});
      await fetch('/api/connections/bossai', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({enabled:true, config:{baseUrl:'http://127.0.0.1:'+port+'/v1', model:'mock-model'}})});
      const test = await (await fetch('/api/connections/bossai/test', {method:'POST', headers: apiHeaders()})).json();
      /* AUM and SIP as BOSS counts them: platform holdings and SIPs. */
    const H = [{id:'PFH-CC-A', clientId:'CMS-CC-A', schemeName:'ZZ Flexi Cap', invested:2000000, current:2500000},
      {id:'PFH-CC-B', clientId:'CMS-CC-B', schemeName:'ZZ Large Cap', invested:1500000, current:2000000},
      {id:'PFH-CC-N1', clientId:'CMS-CC-N1', schemeName:'ZZ Liquid', invested:500000, current:500000}];
    const S = [{id:'PFS-CC-A', clientId:'CMS-CC-A', schemeName:'ZZ Flexi Cap', monthlyAmount:10000}, {id:'PFS-CC-N1', clientId:'CMS-CC-N1', schemeName:'ZZ Liquid', monthlyAmount:2000}];
    const h = await fetch('/api/storage/platformHoldings', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()), body: JSON.stringify({value: JSON.stringify(H)})});
    const sp = await fetch('/api/storage/platformSips', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()), body: JSON.stringify({value: JSON.stringify(S)})});
    return {put: put.status === 200 && h.status === 200 && sp.status === 200 ? 200 : [put.status, h.status, sp.status], test};
    }, {port: MOCK_PORT, clients: CLIENTS});
    if(r.put !== 200 || (!r.test.ok && !/Connected/.test(JSON.stringify(r.test)))) throw new Error(JSON.stringify(r));
    await t.home();
    const n = await t.eval(() => DB.clients.filter(c => /^CMS-CC-/.test(c.id)).length);
    if(n !== 4) throw new Error(n + ' clients');
    return '4 clients, model connected';
  });

  const noneOf = (hay, names) => names.filter(n => new RegExp(n).test(hay));
  /* Conversation 2's question, after Clear: what was sent, what was shown. */
  const afterClear = async (q) => { await clear(); const n = seen.length; await ask(q); const b = await shown(); return {sent: sent(n), text: b.text, turns: b.turns, calls: seen.length - n}; };
  const missingMobile = (r, label) => {
    const all = r.sent + ' ' + r.text, leak = noneOf(all, ['Alpha', 'Bravo']);
    if(leak.length) throw new Error(label + ': ' + leak.join(', ') + ' in conversation 2 — sent: ' + r.sent.slice(0, 500) + ' || shown: ' + r.text.slice(0, 500));
    if(!/ZZ Nomobile One/.test(all) || !/ZZ Nomobile Two/.test(all)) throw new Error(label + ': not the clients without a mobile — ' + all.slice(0, 600));
    if(!/mobile number not added/i.test(r.text)) throw new Error(label + ': not read as a filter on the mobile number — ' + r.text.slice(0, 300));
    return r;
  };

  await t.step('2. the reported case: "ZZ Alpha Clientone ki complete details" → "↗ Open Account" → Clear → "Show me all clients whose mobile number is not added"', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone ki complete details dikhao');
    const a = await shown();
    if(!/ZZ Alpha Clientone/.test(a.text) || !/9800000101/.test(a.text)) throw new Error('conversation 1 did not answer about the client: ' + a.text.slice(0, 300));
    await t.eval(() => { const b = [...document.querySelectorAll('#aiTurns .ria-act')].reverse().find(x => /Open Account/.test(x.textContent)); if(!b) throw new Error('no Open Account'); b.click(); });
    await t.wait(150);
    const opened = await t.eval(() => ({view: currentView, id: clientDetailId}));
    if(opened.view !== 'cms' || opened.id !== 'CMS-CC-A') throw new Error('the account did not open: ' + JSON.stringify(opened));
    const r = missingMobile(await afterClear('Show me all clients whose mobile number is not added'), 'opened from the answer');
    return 'conversation 1 about ZZ Alpha Clientone; after Clear: ZZ Nomobile One, ZZ Nomobile Two (' + r.calls + ' model calls), ZZ Alpha Clientone nowhere though its page is still open';
  });
  await t.step('2b. the client opened from the chat ("ZZ Alpha Clientone ka portfolio kholo") — this is what leaked before — → Clear → missing mobile', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone ka portfolio kholo');
    const ctx = await t.eval(() => ({id: clientDetailId, rec: ai.context && ai.context.recordName}));
    if(ctx.id !== 'CMS-CC-A' || !/Alpha/.test(ctx.rec || '')) throw new Error('not opened: ' + JSON.stringify(ctx));
    const r = missingMobile(await afterClear('Show me all clients whose mobile number is not added'), 'opened from the chat');
    const head = await t.eval(() => (document.querySelector('#aiPanel .ai-sub, .ai-sub') || {}).textContent || '');
    if(/Alpha/.test(head)) throw new Error('the header still names the old client: ' + head);
    return 'ZZ Nomobile One, ZZ Nomobile Two; header: "' + head + '"';
  });
  await t.step('2c. the panel opened again on the client’s page → Clear → missing mobile; then "is client ka kya pending hai" still means the client on screen', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone ki complete details dikhao');
    await t.eval(() => { navigate('cms', 'CMS-CC-A'); aiCloseP(); aiTogglePanel(); });
    missingMobile(await afterClear('Show me all clients whose mobile number is not added'), 'panel reopened on the page');
    /* Through the model: the screen's record is not the subject of a question about the book… */
    const n0 = seen.length;
    await ask('How many clients are there in each branch?');
    const book = sent(n0);
    if(/Alpha/.test(book)) throw new Error('a book question carried the old client: ' + book.slice(0, 500));
    /* …and is when the question points at it. */
    const n = seen.length;
    await ask('Is client ka kya pending hai?');
    const out = sent(n);
    if(!/ZZ Alpha Clientone/.test(out)) throw new Error('"is client" no longer means the client on screen: ' + out.slice(0, 400));
    return 'missing mobile clean; a book question clean; "is client ka" → ZZ Alpha Clientone, on purpose';
  });

  await t.step('1. client A → Clear → client B: B only, in what is sent and what is shown', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone ka portfolio kholo');
    await ask('ZZ Alpha Clientone ka mobile number batao');
    const r = await afterClear('ZZ Bravo Clienttwo ka DOB aur PAN batao');
    if(r.turns !== 2 || !/ZZ Bravo Clienttwo/.test(r.text) || !/ABCPB2222B/.test(r.text) || /Alpha/.test(r.text + r.sent)) throw new Error(JSON.stringify(r).slice(0, 700));
    const n = seen.length;
    await ask('ZZ Bravo Clienttwo ka kya pending hai?');
    const out = sent(n);
    if(!/ZZ Bravo Clienttwo/.test(out) || /Alpha/.test(out)) throw new Error('model was sent: ' + out.slice(0, 600));
    return 'B’s DOB and PAN; the model question carried ZZ Bravo Clienttwo only (history: ' + (JSON.parse(JSON.stringify(seen[seen.length - 1].messages)).length - 2) + ' earlier turns, none from before Clear)';
  });

  await t.step('3. missing mobile → Clear → missing email: the email filter only', async () => {
    await fresh();
    missingMobile(await afterClear('Show me all clients whose mobile number is not added'), 'first conversation');
    const r = await afterClear('Show me all clients whose email is not added');
    const all = r.sent + ' ' + r.text;
    if(!/email not added/i.test(r.text) || !/ZZ Bravo Clienttwo/.test(all) || !/ZZ Nomobile Two/.test(all) || /ZZ Nomobile One|Alpha|mobile number not added/i.test(all))
      throw new Error(all.slice(0, 700));
    return 'email not added: ZZ Bravo Clienttwo, ZZ Nomobile Two; nothing of the mobile filter';
  });

  await t.step('4. client search → Clear → a general finance question: no client and no record context sent', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone ka portfolio kholo');
    const r = await afterClear('What is the difference between SIP and lumpsum investment?');
    if(r.calls < 1 || /Alpha|CMS-CC-A|9800000101|the record open is/.test(r.sent)) throw new Error('sent: ' + r.sent.slice(0, 700));
    const last = seen[seen.length - 1].messages;
    if(last.length !== 2) throw new Error(last.length + ' messages sent; expected the system brief and the question only');
    return r.calls + ' model call(s): the brief and the question, nothing of ZZ Alpha Clientone';
  });

  await t.step('5. Clear while an old answer is still coming: Clear works, the new conversation answers, the old answer never lands', async () => {
    await fresh();
    slowRelease = null;
    await t.eval(() => { const el = document.getElementById('aiInput'); el.value = 'ZZ Alpha Clientone ke baare mein SLOW batao'; ai.draft = el.value; window.__oldSend = aiSend(); });
    for(let i = 0; i < 100 && !slowRelease; i++) await t.wait(50);
    if(!slowRelease) throw new Error('the old question never reached the model');
    const busy = await t.eval(() => ai.busy);
    if(!busy) throw new Error('the old question was not in progress');
    await clear();
    await ask('What is a mutual fund?');
    const mid = await shown();
    if(mid.turns !== 2 || !/MOCK ANSWER/.test(mid.text) || /SLOW|Alpha/.test(mid.text)) throw new Error('new conversation: ' + mid.text.slice(0, 400));
    slowRelease();
    await t.eval(() => window.__oldSend);
    await t.wait(400);
    const end = await t.eval(() => ({text: ai.turns.map(x => x.content).join(' | '), n: ai.turns.length, busy: ai.busy, err: ai.error}));
    if(/STALE|SLOW|Alpha/.test(end.text) || end.n !== 2 || end.busy || end.err) throw new Error(JSON.stringify(end));
    return 'old answer released after Clear and dropped; the new conversation kept its 2 turns: "' + end.text.slice(0, 80) + '"';
  });

  await t.step('6. Clear, then refresh: the conversation is gone, and the client’s page opened again is not taken as the subject of a book question', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone ka portfolio kholo');
    await clear();
    await t.page.reload({waitUntil: 'domcontentloaded'});
    await require('../lib/ready')(t.page);
    const after = await t.eval(() => ({turns: ai.turns.length, flow: ai.flow, ctx: ai.context, force: ai.forceClient || null}));
    if(after.turns || after.flow || after.force) throw new Error(JSON.stringify(after));
    await t.eval(async () => { navigate('cms', 'CMS-CC-A'); aiTogglePanel(); await aiRefreshStatus(true); });
    const n = seen.length;
    await ask('Show me all clients whose mobile number is not added');
    const b = await shown();
    missingMobile({sent: sent(n), text: b.text, turns: b.turns, calls: seen.length - n}, 'after refresh, on the client’s page');
    return 'after refresh: 0 turns; on ZZ Alpha Clientone’s page the missing-mobile list is still only ZZ Nomobile One, ZZ Nomobile Two';
  });

  await t.step('7. nothing of a conversation is kept in browser storage to come back', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone ki complete details dikhao');
    const st = await t.eval(() => { const dump = (s) => { const o = {}; for(let i = 0; i < s.length; i++){ const k = s.key(i); o[k] = s.getItem(k); } return o; };
      return {local: dump(localStorage), session: dump(sessionStorage)}; });
    const hay = JSON.stringify(st);
    if(/Alpha|9800000101|complete details/.test(hay)) throw new Error('kept: ' + hay.slice(0, 500));
    await clear();
    const cleared = await t.eval(() => ({turns: ai.turns.length, flow: ai.flow, force: ai.forceClient || null, sel: ai.selection, report: ai.report, busy: ai.busy}));
    if(cleared.turns || cleared.flow || cleared.force || cleared.sel || cleared.report || cleared.busy) throw new Error(JSON.stringify(cleared));
    return Object.keys(st.local).length + ' localStorage / ' + Object.keys(st.session).length + ' sessionStorage keys, none with the conversation; after Clear every conversation field is empty';
  });

  const lastTable = () => t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {text: String(x.content || ''), cols: x.table ? x.table.cols : null, rows: x.table ? x.table.rows : [], book: riaVisible().length}; });
  const attrCheck = (a, field, want) => {
    const head = '**Total Clients:** ' + a.book.toLocaleString('en-IN') + ' | **Clients without ' + field + ':** ' + want.length;
    const names = a.rows.map(r => r[1]).sort();
    if(a.text.indexOf(head) !== 0 || JSON.stringify(a.cols) !== JSON.stringify(['Client ID', 'Client Name', 'Branch', 'Status']) || names.join() !== want.slice().sort().join()
      || a.rows.some(r => r[3] !== field + ': Missing') || /Alpha/.test(a.text + JSON.stringify(a.rows)))
      throw new Error(field + ': ' + JSON.stringify({head, a}).slice(0, 700));
    return head.replace(/\*\*/g, '');
  };

  await t.step('8. "ZZ Alpha Clientone" → Clear → "jiska mobile no add nhi hai usko filter krke list do": the total, the count, and the clients without a mobile, nothing of ZZ Alpha', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone');
    await ask('ZZ Alpha Clientone ka portfolio kholo');
    await clear();
    const n = seen.length;
    await ask('jiska mobile no add nhi hai usko filter krke list do');
    const a = await lastTable();
    const head = attrCheck(a, 'Mobile Number', ['ZZ Nomobile One', 'ZZ Nomobile Two']);
    if(/Alpha/.test(sent(n))) throw new Error('sent: ' + sent(n).slice(0, 400));
    return head + '; rows: ' + a.rows.map(r => r[0] + ' ' + r[1]).join(', ') + ' (' + (seen.length - n) + ' model calls)';
  });

  await t.step('9. "clients without DOB" and "bina PAN wale clients ki list do"; "ZZ Alpha Clientone ka PAN batao, nahi mil raha" is still about ZZ Alpha', async () => {
    await fresh();
    const dob = (await afterClear('clients without DOB'), await lastTable());
    const h1 = attrCheck(dob, 'Date of Birth', ['ZZ Bravo Clienttwo', 'ZZ Nomobile Two']);
    await afterClear('bina PAN wale clients ki list do');
    const h2 = attrCheck(await lastTable(), 'PAN', ['ZZ Nomobile Two']);
    await afterClear('Show me all clients whose email is not added');
    const h3 = attrCheck(await lastTable(), 'Email', ['ZZ Bravo Clienttwo', 'ZZ Nomobile Two']);
    await afterClear('ZZ Alpha Clientone ka PAN batao, nahi mil raha');
    const one = await lastTable();
    if(/Total Clients/.test(one.text) || !/ZZ Alpha Clientone/.test(one.text) || !/ABCPA1111A/.test(one.text)) throw new Error('the client question became a filter: ' + one.text.slice(0, 400));
    return [h1, h2, h3].join('; ') + '; the single-client question answered with ZZ Alpha’s PAN';
  });

  await t.step('10. the model path: "jiska mobile no add nhi hai" sends the book’s filter (PAN masked), "ZZ Alpha Clientone ka PAN nahi hai kya" sends ZZ Alpha', async () => {
    await fresh();
    const n = seen.length;
    await t.eval(async () => { ai.turns.push({role:'user', content:'jiska mobile no add nhi hai'}); await bossRunChat('jiska mobile no add nhi hai'); });
    const u = seen.length > n ? seen[seen.length - 1].messages.slice(-1)[0].content : '';
    const data = JSON.parse((u.match(/<data>\n([\s\S]*?)\n<\/data>/) || [])[1] || '{}');
    const f = data.attributeFilter || {};
    if(f.field !== 'Mobile Number' || f.matchingCount !== 2 || (f.rows || []).map(r => r.name).sort().join() !== 'ZZ Nomobile One,ZZ Nomobile Two' || data.clients || /Alpha/.test(u)
      || (f.rows || []).some(r => r.pan !== 'Not recorded' && !/^\*+/.test(r.pan))) throw new Error(u.slice(0, 700));
    if(!/attributeFilter, open with "\*\*Total Clients:\*\*/.test(seen[seen.length - 1].messages[0].content)) throw new Error('the answer rules do not say how to lay it out');
    const n2 = seen.length;
    await t.eval(async () => { ai.turns.push({role:'user', content:'ZZ Alpha Clientone ka PAN nahi hai kya?'}); await bossRunChat('ZZ Alpha Clientone ka PAN nahi hai kya?'); });
    const u2 = seen.slice(n2).map(j => j.messages.slice(-1)[0].content).join('\n');
    if(/attributeFilter/.test(u2) || !/ZZ Alpha Clientone/.test(u2)) throw new Error(u2.slice(0, 500));
    return 'attributeFilter: Mobile Number, ' + f.matchingCount + ' of ' + f.totalBook + ', PAN masked; the one-client question carried ZZ Alpha’s dossier, no filter';
  });

  const listTurn = () => t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {text: String(x.content || ''), cols: x.table ? x.table.cols : null, rows: x.table ? x.table.rows : [], show: x.table && x.table.show,
    actions: (x.actions || []).map(a => a.label), ex: x.exportReport ? {total: x.exportReport.total, cols: x.exportReport.cols, rows: x.exportReport.rows} : null}; });
  const NOISE = /\[txn-sip\]|\[policy-valuation-matrix\]|NIFTY|Investor Search|Market zone/;

  await t.step('11a. "I want that clients who have not SIP?": only the clients without a SIP, counted against the book, no model call, no SOP or market text', async () => {
    await fresh();
    const n = seen.length;
    await ask('I want that clients who have not SIP?');
    const a = await listTurn();
    const names = a.rows.map(r => r[1]);
    const head = '📊 **Total Clients in Book:** 4 | **Matching Clients:** 2 | **Total AUM:** ₹20,00,000 | **Monthly SIP:** ₹0';
    if(a.text.indexOf(head) !== 0 || names.join() !== 'ZZ Bravo Clienttwo,ZZ Nomobile Two' || !/no SIP/i.test(a.text) || NOISE.test(a.text) || seen.length !== n
      || JSON.stringify(a.cols) !== JSON.stringify(['Client ID', 'Client Name', 'Branch', 'Mobile', 'AUM', 'Monthly SIP']) || a.rows.some(r => r[5] !== '₹0')
      || !a.actions.includes('📄 Download PDF (2 clients)') || !a.actions.includes('📊 Download Excel (.xlsx)') || !a.actions.includes('📑 Download CSV'))
      throw new Error(JSON.stringify({head, a, calls: seen.length - n}).slice(0, 900));
    return head.replace(/\*\*/g, '') + '; ' + names.join(', ') + '; 0 model calls';
  });

  await t.step('11b. "give me all clients who are invest more than equal to 20 Lakh": the ₹25 lakh and the exactly-₹20 lakh client, biggest first, total AUM', async () => {
    await fresh();
    const n = seen.length;
    await ask('give me all clients who are invest more than equal to 20 Lakh');
    const a = await listTurn();
    const head = '📊 **Total Clients in Book:** 4 | **Matching Clients:** 2 | **Total AUM:** ₹45,00,000 | **Monthly SIP:** ₹10,000';
    if(a.text.indexOf(head) !== 0 || a.rows.map(r => r[1] + ' ' + r[4]).join() !== 'ZZ Alpha Clientone ₹25,00,000,ZZ Bravo Clienttwo ₹20,00,000' || !/AUM at least 20 lakh/.test(a.text)
      || !/Highest AUM first/.test(a.text) || NOISE.test(a.text) || seen.length !== n || a.show !== 8) throw new Error(JSON.stringify({head, a, calls: seen.length - n}).slice(0, 900));
    /* the other ways of saying it, and "above" is strictly above */
    const more = [];
    for(const [q, want] of [['clients with 20 lakh se jyada investment', 'ZZ Alpha Clientone'], ['portfolio >= 20L wale clients', 'ZZ Alpha Clientone,ZZ Bravo Clienttwo'],
      ['clients with SIP at least 5000', 'ZZ Alpha Clientone'], ['clients jinka AUM 5 lakh or less hai', 'ZZ Nomobile One,ZZ Nomobile Two']]){
      await ask(q); const b = await listTurn(); const got = b.rows.map(r => r[1]).sort().join();
      if(got !== want) throw new Error(q + ' → ' + got + ' (want ' + want + ')'); more.push(q + ' → ' + b.rows.length);
    }
    return head.replace(/\*\*/g, '') + '; ' + more.join('; ');
  });

  await t.step('11c. the downloads: PDF, Excel and CSV of every matching client with mobile, email, branch, RM, AUM, SIP and stage', async () => {
    await fresh();
    await ask('give me all clients who are invest more than equal to 20 Lakh');
    const a = await listTurn();
    if(!a.ex || a.ex.total !== 2 || JSON.stringify(a.ex.cols) !== JSON.stringify(['Client ID', 'Client Name', 'Mobile', 'Email', 'Branch', 'RM', 'AUM (₹)', 'Monthly SIP (₹)', 'Stage'])
      || a.ex.rows[0][3] !== 'alpha@example.test' || a.ex.rows[0][6] !== 2500000) throw new Error(JSON.stringify(a.ex));
    const fs = require('fs'), got = {};
    for(const [label, key] of [['📄 Download PDF', 'pdf'], ['📊 Download Excel', 'xlsx'], ['📑 Download CSV', 'csv']]){
      const dl = t.page.waitForEvent('download', {timeout: 15000});
      await t.eval((label) => { const b = [...document.querySelectorAll('#aiTurns .ria-act')].reverse().find(x => x.textContent.indexOf(label) === 0); if(!b) throw new Error('no ' + label); b.click(); }, label);
      const d = await dl; got[key] = {name: d.suggestedFilename(), buf: fs.readFileSync(await d.path())};
    }
    const csv = got.csv.buf.toString('utf8');
    if(got.pdf.buf.slice(0, 4).toString() !== '%PDF' || got.xlsx.buf.slice(0, 2).toString() !== 'PK' || !/\.pdf$/.test(got.pdf.name) || !/\.xlsx$/.test(got.xlsx.name)
      || !/Client ID.*Client Name.*Mobile.*Email.*Branch.*RM.*AUM.*Monthly SIP.*Stage/.test(csv.split('\n')[0]) || !/ZZ Alpha Clientone/.test(csv) || !/ZZ Bravo Clienttwo/.test(csv) || /ZZ Nomobile/.test(csv))
      throw new Error(JSON.stringify({pdf: got.pdf.name, xlsx: got.xlsx.name, csv: csv.slice(0, 300)}));
    /* a big list still makes its PDF: 3,000 synthetic rows, in memory only */
    const big = await t.eval(() => { const rows = Array.from({length: 3000}, (_, i) => ['CMS-ZZ' + i, 'ZZ Synthetic ' + i, '98000' + String(i).padStart(5, '0'), 'zz' + i + '@example.test', 'Pune', 'Unassigned', 100000 + i, 0, 'Active']);
      ai.turns.push({role:'assistant', content:'synthetic', exportReport: {title:'ZZ big list', total: 3000, totalBook: 3000, totalAum: 1, totalSip: 0,
        cols:['Client ID', 'Client Name', 'Mobile', 'Email', 'Branch', 'RM', 'AUM (₹)', 'Monthly SIP (₹)', 'Stage'], rows}});
      const t0 = performance.now(); const r = bossDownloadTurnReport(ai.turns.length - 1, 'pdf'); return {ms: Math.round(performance.now() - t0), r}; });
    if(!big.r || big.r.rows !== 3000 || big.ms > 20000) throw new Error(JSON.stringify(big));
    return 'PDF ' + got.pdf.buf.length + ' B, Excel ' + got.xlsx.buf.length + ' B, CSV with the 9 columns and both clients; a 3,000-row PDF in ' + big.ms + ' ms';
  });

  await t.step('11d. the chat itself, given the same question, answers from the records too: no planner, no model call, no SOP', async () => {
    await fresh();
    const n = seen.length;
    await t.eval(async () => { ai.turns.push({role:'user', content:'I want that clients who have not SIP?'}); await bossRunChat('I want that clients who have not SIP?'); });
    const a = await listTurn();
    if(seen.length !== n || a.rows.map(r => r[1]).join() !== 'ZZ Bravo Clienttwo,ZZ Nomobile Two' || NOISE.test(a.text)) throw new Error(JSON.stringify({calls: seen.length - n, a}).slice(0, 600));
    return 'bossRunChat → the same list, ' + (seen.length - n) + ' model calls';
  });

  const lastData = (from) => { const j = seen.slice(from).filter(x => !/WHICH RECORDS/.test(((x.messages || []).find(m => m.role === 'system') || {}).content || '')).pop();
    const u = j ? j.messages[j.messages.length - 1].content : ''; try { return JSON.parse((u.match(/<data>\n([\s\S]*?)\n<\/data>/) || [])[1] || '{}'); } catch(e) { return {}; } };

  await t.step('12a. "ZZ Alpha Clientone ki details dikhao" makes ZZ Alpha the conversation’s client; "iska DOB batao" answers for ZZ Alpha from the records', async () => {
    await fresh();
    await ask('ZZ Alpha Clientone ki details dikhao');
    const ac = await t.eval(() => ai.activeClient);
    const n = seen.length;
    await ask('iska DOB batao');
    const a = await t.eval(() => String((ai.turns[ai.turns.length - 1] || {}).content || ''));
    if(ac !== 'CMS-CC-A' || !/^\*\*ZZ Alpha Clientone — Date of Birth:\*\* 01 Jan 1980/.test(a) || seen.length !== n) throw new Error(JSON.stringify({ac, a: a.slice(0, 200), calls: seen.length - n}));
    return 'activeClient CMS-CC-A; "iska DOB batao" → ' + a.split('\n')[0].replace(/\*\*/g, '');
  });

  await t.step('12b. "iska portfolio analysis do" → ZZ Alpha’s portfolio only: her AUM, allocation and schemes; no other client, no firm-wide signals', async () => {
    const n = seen.length;
    await ask('iska portfolio analysis do');
    const d = lastData(n), out = sent(n), p = d.clientPortfolioAnalysis || {};
    if(!p.client || p.client.id !== 'CMS-CC-A' || p.totalAum !== 2500000 || p.totalSip !== 10000 || (p.allocation.equity || {}).pct !== 100 || (p.schemes[0] || {}).name !== 'ZZ Flexi Cap'
      || d.portfolioSignals || !d.intel || (d.intel.scope || {}).clientId !== 'CMS-CC-A' || /ZZ Bravo|ZZ Nomobile/.test(out)) throw new Error(JSON.stringify({p, signals: !!d.portfolioSignals, scope: d.intel && d.intel.scope}).slice(0, 700));
    return 'clientPortfolioAnalysis: ' + p.client.name + ', AUM ₹25,00,000, SIP ₹10,000, equity 100%, ' + p.holdingsCount + ' scheme; intel scoped to her; no portfolioSignals';
  });

  await t.step('12c. "ZZ Bravo Clienttwo ka AUM kya hai" moves the conversation to ZZ Bravo — her AUM, not the firm’s total', async () => {
    const n = seen.length;
    await ask('ZZ Bravo Clienttwo ka AUM kya hai');
    const ac = await t.eval(() => ai.activeClient), d = lastData(n), out = sent(n);
    const shown = await t.eval(() => ai.turns.slice(-1)[0].content || '');
    if(ac !== 'CMS-CC-B' || !(d.clients || []).some(c => c.id === 'CMS-CC-B') || (d.clients || []).some(c => c.id === 'CMS-CC-A') || /Total firm AUM|AUM in your scope/.test(shown)) throw new Error(JSON.stringify({ac, clients: (d.clients || []).map(c => c.id), shown: shown.slice(0, 200)}));
    const n2 = seen.length;
    await ask('inka portfolio analysis do');
    const d2 = lastData(n2);
    if(((d2.clientPortfolioAnalysis || {}).client || {}).id !== 'CMS-CC-B') throw new Error('follow-up after the move: ' + JSON.stringify(d2.clientPortfolioAnalysis || null).slice(0, 300));
    return 'activeClient CMS-CC-B; her dossier sent; "inka portfolio analysis do" → ZZ Bravo';
  });

  await t.step('12d. Clear forgets the conversation’s client: "clients without mobile" reads the whole book; "iska portfolio analysis do" names nobody', async () => {
    await t.eval(() => navigate('dashboard'));           // no client page behind the panel: only the conversation could name one
    await clear();
    const ac = await t.eval(() => ai.activeClient);
    await ask('clients without mobile');
    const a = await t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {text: String(x.content || ''), rows: x.table ? x.table.rows.map(r => r[1]) : []}; });
    const n = seen.length;
    await ask('iska portfolio analysis do');
    const d = lastData(n);
    if(ac !== null || !/^\*\*Total Clients:\*\* 4 \| \*\*Clients without Mobile Number:\*\* 2/.test(a.text) || a.rows.sort().join() !== 'ZZ Nomobile One,ZZ Nomobile Two'
      || d.clientPortfolioAnalysis || (d.clients || []).length) throw new Error(JSON.stringify({ac, a, cpa: d.clientPortfolioAnalysis, clients: d.clients}).slice(0, 600));
    return 'activeClient null; missing mobile: 2 of 4 (whole book); the pronoun alone named nobody';
  });

  await t.step('12e. "Pune branch ka portfolio analysis do" and "Pune branch ka portfolio": Pune’s clients only — not Mumbai, not Delhi, not the firm', async () => {
    await fresh();
    const n = seen.length;
    await ask('Pune branch ka portfolio analysis do');
    const d = lastData(n), out = sent(n), b = d.branchAnalysis || {};
    const n2 = seen.length;
    await ask('Pune branch ka portfolio');
    const d2 = lastData(n2);
    if(b.branch !== 'Pune' || b.totalClients !== 2 || b.totalAum !== 4500000 || b.topClients.map(c => c.name).join() !== 'ZZ Alpha Clientone,ZZ Bravo Clienttwo'
      || !d.intel || !/^Pune branch \(2 clients\)/.test((d.intel.scope || {}).label || '') || /ZZ Nomobile/.test(out) || d.clientPortfolioAnalysis
      || ((d2.branchAnalysis || {}).totalClients !== 2)) throw new Error(JSON.stringify({b, scope: d.intel && d.intel.scope, b2: d2.branchAnalysis}).slice(0, 700));
    return 'branchAnalysis: Pune, 2 clients, AUM ₹45,00,000, top ZZ Alpha / ZZ Bravo; intel "' + d.intel.scope.label + '"; Mumbai and Delhi clients absent';
  });

  await t.step('CRM records untouched: the four clients are as they were saved', async () => {
    const r = await t.eval(async () => { const j = await (await fetch('/api/storage/clients', {headers: apiHeaders()})).json(); return JSON.parse(j.value); });
    const ours = r.filter(c => /^CMS-CC-/.test(c.id));
    const diff = CLIENTS.filter(c => { const g = ours.find(x => x.id === c.id); return !g || ['cmsName','mobile','email','pan','branch'].some(k => (g[k] || '') !== (c[k] || '')); });
    if(ours.length !== 4 || diff.length) throw new Error(JSON.stringify({n: ours.length, diff}));
    return '4 clients, unchanged';
  });

  } finally { mock.close(); }
});

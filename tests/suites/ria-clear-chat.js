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
      return {put: put.status, test};
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

  await t.step('CRM records untouched: the four clients are as they were saved', async () => {
    const r = await t.eval(async () => { const j = await (await fetch('/api/storage/clients', {headers: apiHeaders()})).json(); return JSON.parse(j.value); });
    const ours = r.filter(c => /^CMS-CC-/.test(c.id));
    const diff = CLIENTS.filter(c => { const g = ours.find(x => x.id === c.id); return !g || ['cmsName','mobile','email','pan','branch'].some(k => (g[k] || '') !== (c[k] || '')); });
    if(ours.length !== 4 || diff.length) throw new Error(JSON.stringify({n: ours.length, diff}));
    return '4 clients, unchanged';
  });

  } finally { mock.close(); }
});

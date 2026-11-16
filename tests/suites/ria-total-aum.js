/* "WHAT IS THE TOTAL FIRM AUM?" IS A SUM, NOT A GUESS.

   RIA AI used to answer it from a client table cut to 150 rows — and said
   so, or worse, summed the manual AUM field nobody keeps. The figure now
   comes from public/book-aum.js, the same file the Dashboard's Live AUM card
   is built from, worked out on the server over every record in scope
   (GET /api/ai/aum), and the assistant only says what came back.

   What has to hold: the Dashboard, the endpoint and a sum worked out here
   from first principles agree to the rupee; what the Dashboard leaves out
   (pending, rejected, deleted, Main summaries, the ledger of a client who
   has a platform report) stays out; the assistant asks no model and shows
   no table; and a question that is not a firm total is not routed here. */
const {suite} = require('../lib/harness');

const SEED = async ()=>{
  const now = new Date().toISOString();
  const add = (c)=>{ if(DB.clients.some(x=>x.id === c.id)) return; initState('CMS', c); DB.clients.push(c); };
  for(let i = 0; i < 40; i++){
    const id = 'CMS-TAUM' + i;
    add({id, cmsName:'ZZ Taum ' + i, rmName: currentUser, branch: ['Varanasi','Mumbai','Pune'][i % 3],
         aum: String(1000 + i), createdAt: now});            // the manual field — must be ignored
    if(i % 4 === 0){                                          // platform report, sleeves + remainder
      DB.platformHoldings.push({id:'PFH-TAUM' + i, clientId:id, platform:'nj', current: String(200000 + i * 1000),
        sleeves:{Equity:{current: String(100000 + i * 100)}, Debt:{current:'50000'}}, reportAsOn:'2026-10-31'});
      if(i % 8 === 0) DB.transactions.push({id:'TXN-TAUMB' + i, clientId:id, status:'Completed',
        transactionType:'Purchase', amount: 777777});         // has a report too: ledger NOT added
    } else {
      DB.transactions.push({id:'TXN-TAUM' + i, clientId:id, status:'Completed', transactionType:'Purchase', amount: 50000 + i});
      if(i % 5 === 0) DB.transactions.push({id:'TXN-TAUMR' + i, clientId:id, status:'Completed', transactionType:'Redemption', amount: 10000});
      if(i % 3 === 0) DB.transactions.push({id:'TXN-TAUMP' + i, clientId:id, status:'Submitted', transactionType:'Purchase', amount: 999999});
      if(i % 7 === 0) DB.transactions.push({id:'TXN-TAUMX' + i, clientId:id, status:'Rejected', transactionType:'Purchase', amount: 888888});
      if(i % 9 === 0) DB.transactions.push({id:'TXN-TAUMD' + i, clientId:id, status:'Completed', transactionType:'Purchase', amount: 666666, deletedAt: now});
      if(i % 11 === 0){
        DB.transactions.push({id:'TXN-TAUMM' + i, clientId:id, status:'Completed', transactionType:'Purchase', amount: 555555, txnRollup: true});
        DB.transactions.push({id:'TXN-TAUMC' + i, clientId:id, status:'Completed', transactionType:'Purchase', amount: 5555, mainTransactionId:'TXN-TAUMM' + i});
      }
    }
  }
  /* a deleted client with a report, and a deleted report on a live one */
  add({id:'CMS-TAUMDEL', cmsName:'ZZ Taum Deleted', rmName: currentUser, branch:'Pune', deletedAt: now, createdAt: now});
  DB.platformHoldings.push({id:'PFH-TAUMDEL', clientId:'CMS-TAUMDEL', platform:'nj', current:'444444', reportAsOn:'2026-10-31'});
  DB.platformHoldings.push({id:'PFH-TAUMGONE', clientId:'CMS-TAUM1', platform:'nj', current:'333333', deletedAt: now});
  await save('clients'); await save('platformHoldings'); await save('transactions');
  return true;
};

/* The book as a person would add it up, written out here so it is not
   the code under test checking itself. */
const BY_HAND = ()=>{
  const n = v => Number(String(v || '0').replace(/[^0-9.-]/g, '')) || 0;
  const vis = mdClients(); let total = 0;
  vis.forEach(c=>{
    const h = DB.platformHoldings.filter(x=>!x.deletedAt && x.clientId === c.id);
    if(h.length) h.forEach(x=>{
      const sl = Object.values(x.sleeves || {}).filter(v=>n(v.current) || n(v.invested));
      const cov = sl.reduce((s, v)=>s + n(v.current), 0); total += cov;
      const rest = n(x.current) - cov; if(Math.round(rest) !== 0) total += rest;
    });
    else DB.transactions.filter(t=>t.clientId === c.id && !t.deletedAt && t.status === 'Completed' && !t.txnRollup)
      .forEach(t=>{ total += /redemption/i.test(t.transactionType || '') ? -n(t.amount) : n(t.amount); });
  });
  return total;
};

suite(async t => {
  await t.home();
  const chat = [];
  t.page.on('request', r=>{ if(r.url().includes('/api/ai/chat')) chat.push(r.url()); });

  await t.step('the Dashboard reads its book from the shared file', async () => {
    const r = await t.eval(async ()=>{
      const src = await (await fetch('/book-aum.js')).text();
      return {loaded: typeof BookAum === 'object' && typeof BookAum.bookRows === 'function', version: BookAum.VERSION,
              same: src.indexOf("VERSION: '" + BookAum.VERSION + "'") >= 0};
    });
    if(!r.loaded || !r.same) throw new Error(JSON.stringify(r));
    return 'book-aum.js v' + r.version + ' loaded by the page, served from the same file the server requires';
  });

  let dash = 0;
  await t.step('Live AUM = the book added up by hand, with what must stay out left out', async () => {
    await t.eval(SEED);
    await t.wait(600);
    const r = await t.eval((h)=>{
      const rows = mdBookRows().filter(x=>x.aum);
      return {dash: rows.reduce((s, x)=>s + x.aum, 0), hand: eval('(' + h + ')')(),
              manual: DB.clients.filter(c=>!c.deletedAt).reduce((s, c)=>s + numVal(c.aum), 0)};
    }, BY_HAND.toString());
    if(Math.abs(r.dash - r.hand) > 0.005) throw new Error('Dashboard ' + r.dash + ' vs by hand ' + r.hand);
    if(Math.abs(r.dash - r.manual) < 1) throw new Error('the total looks like the manual AUM field');
    dash = r.dash;
    return 'Live AUM ' + Math.round(r.dash).toLocaleString('en-IN') + ' = by hand; pending, rejected, deleted, Main, and the ledger of clients with a report all excluded';
  });

  await t.step('the server works out the same figure, with its date, source, scope and notes', async () => {
    const r = await t.eval(async ()=>{ const x = await fetch('/api/ai/aum', {headers: apiHeaders()}); return {status: x.status, b: await x.json()}; });
    if(r.status !== 200 || !r.b.ok) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(r.b));
    if(Math.abs(r.b.total - dash) > 0.005) throw new Error('server ' + r.b.total + ' vs Dashboard ' + dash);
    if(r.b.scope.kind !== 'firm') throw new Error('the administrator was given scope ' + r.b.scope.kind);
    if(!r.b.computedAt || !r.b.source || !r.b.dataDate || !(r.b.notes || []).length) throw new Error('date, source or notes missing');
    if(/ZZ Taum|CMS-TAUM/.test(JSON.stringify(r.b))) throw new Error('the response carries client rows');
    return Math.round(r.b.total).toLocaleString('en-IN') + ' firm-wide; ' + r.b.notes.length + ' notes; platform as on ' + JSON.stringify(r.b.dataDate.platformAsOn);
  });

  await t.step('"What is the total firm AUM?" is answered from that figure, with no model and no table', async () => {
    const r = await t.eval(async ()=>{
      const was = ai.turns.length; ai.turns.push({role:'user', content:'What is the total firm AUM?'});
      const routed = riaTotalAumIntent('What is the total firm AUM?');
      await riaTotalAumTurn();
      const turn = ai.turns.slice(was).pop() || {};
      return {routed, text: turn.content || '', total: turn.aum && turn.aum.total, firm: money(turn.aum ? turn.aum.total : 0)};
    });
    if(!r.routed) throw new Error('the question was not routed to the total');
    if(Math.abs(r.total - dash) > 0.005) throw new Error('assistant ' + r.total + ' vs Dashboard ' + dash);
    if(r.text.indexOf('Total firm AUM: ' + r.firm) !== 0) throw new Error('answer begins: ' + r.text.slice(0, 80));
    if(!/Data date:/.test(r.text) || !/Scope:/.test(r.text) || !/Notes:/.test(r.text)) throw new Error('date, scope or notes missing from the answer');
    if(/truncat|first 150/i.test(r.text)) throw new Error('the answer mentions a truncated table');
    if(chat.length) throw new Error(chat.length + ' call(s) went to the AI provider');
    return r.text.split('\n')[0] + ' — no provider call';
  });

  await t.step('only a firm total is routed there', async () => {
    const r = await t.eval(()=>{
      const yes = ['What is the total firm AUM?', 'total AUM', 'hamara total aum kitna hai', 'What is our overall AUM?'];
      const no = ['What is the AUM of ZZ Taum 3?', 'What is the Pune branch AUM?', 'Show branch-wise AUM', 'AUM growth this month',
                  'Compare AUM by RM', 'Generate an AUM report', 'top clients by AUM', 'SIP book total'];
      return {missed: yes.filter(q=>!riaTotalAumIntent(q)), wrong: no.filter(q=>riaTotalAumIntent(q))};
    });
    if(r.missed.length || r.wrong.length) throw new Error(JSON.stringify(r));
    return '4 total questions routed; client, branch, breakdown, growth, comparison, report, ranking and SIP questions not';
  });

  await t.step('a "total" with nothing to group by is a total over every client, not a 150-row list', async () => {
    const r = await t.eval(()=>{
      const s = bossDoReads([{source:'clients', sum:['aum']}])[0];
      const g = bossDoReads([{source:'clients', groupBy:['branch'], sum:['aum']}])[0];
      return {rows: (s.rows || []).length, total: s.total, aum: s.sums && s.sums.aum, clients: mdClients().length,
              grouped: g.groups.reduce((n, x)=>n + (x.aum || 0), 0)};
    });
    if(r.rows) throw new Error('a list of ' + r.rows + ' rows came back');
    if(r.total !== r.clients) throw new Error('counted ' + r.total + ' of ' + r.clients + ' clients');
    if(Math.abs(r.aum - dash) > 0.005 || Math.abs(r.grouped - dash) > 0.005) throw new Error('sum ' + r.aum + ' / grouped ' + r.grouped + ' vs Dashboard ' + dash);
    return r.clients + ' clients summed: ' + Math.round(r.aum).toLocaleString('en-IN') + ' — the Dashboard figure, not the manual field';
  });
});

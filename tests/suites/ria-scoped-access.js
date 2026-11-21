/* RIA AI SEES WHAT THE ROLE'S OWN CMS LIST SHOWS — NO LESS, NO MORE.

   Reported (TEST, a non-admin role): on Aaradhya Maurya's own CMS page,
   "aardhya maurya ka DOB kya hain?" and "aaradhya maurya ka date of birth
   kya hain" got "the record is not available in the current context" and
   an unrelated SOP. Every CMS screen and the record door decide whose a
   client is by its RM (rmName); RIA AI's client list, its name lookup for
   the model and its "may the model see this client" gate used assignedTo,
   which imported clients leave blank — so an RM on "own" scope could open
   the page and RIA AI could see nobody. Checked here, as two executives on
   "own" scope:
     1. RIA AI's clients are exactly the executive's CMS list (theirs, not a
        colleague's), in the desk, the planner's source, Analytics and the
        gate for the model
     2. "aaradhya maurya ka date of birth kya hain" → her DOB
     3. "aardhya maurya ka DOB kya hain?" (a letter short) → her, not every Maurya
     4. on her page, "is client ka kya pending hai?" sends her record to the model
     5. a colleague's client is not found, and nothing of it reaches the model
     6. the colleague sees their own client and not hers
     7. an Admin still sees everyone
   Synthetic data only. */
const http = require('http');
const {suite} = require('../lib/harness');

const MOCK_PORT = Number(process.env.BOSS_PORT || 3000) + 335;
const seen = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => body += d);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if(req.url.endsWith('/models')) return res.end(JSON.stringify({data:[{id:'mock-model'}]}));
    const j = JSON.parse(body || '{}'); seen.push(j);
    const sys = ((j.messages||[]).find(m=>m.role==='system')||{}).content || '';
    res.end(JSON.stringify({choices:[{message:{role:'assistant', content: /WHICH RECORDS/.test(sys) ? '{"reads":[],"client":null}' : 'MOCK ANSWER'}}]}));
  });
});
const sent = (from) => seen.slice(from).map(j => JSON.stringify(j.messages || [])).join('\n');

suite(async t => {
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
  await t.home();
  let who = null;
  /* Act as one of the executives: the page's own user switch, as mapped-access does. */
  const as = (id) => t.eval(async (id) => { window.__adminUser = window.__adminUser || currentUser; currentUser = id || window.__adminUser; riaConsolidateCache = null;
    aiCloseP(); navigate('dashboard'); aiClearTurns(); aiTogglePanel(); await aiRefreshStatus(true); }, id);
  const ask = (q) => t.eval(async (q) => { const el = document.getElementById('aiInput'); el.value = q; ai.draft = q; await aiSend(); }, q);
  const last = () => t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {text: String(x.content || ''), ui: x.ui ? (x.ui.items || []).map(i => i.label) : null}; });

  await t.step('setup: two executives on "own" scope; Aaradhya Maurya and Vishal Kumar Maurya are one’s, ZZ Other Client the other’s; RM set, assignedTo blank as imported', async () => {
    who = await t.eval(async (port) => {
      const mk = name => { const m = {id: uid('TM'), name, role: roleList()[2] || 'Executive', status:'Active', scope:'own', branch:'Varanasi',
        email: name.replace(/\s+/g, '.').toLowerCase() + '@zz.in', adminFlags: Object.assign(fullAdminFlags(false), {useAiAssistant: true}), perms: fullPerms(true), createdAt: new Date().toISOString()}; DB.team.push(m); return m.id; };
      const mine = mk('ZZ RM Mine'), theirs = mk('ZZ RM Theirs');
      await save('team');
      const now = new Date().toISOString();
      [{id:'CMS-SC-A', cmsName:'Aaradhya Maurya', rmName: mine, branch:'Varanasi', dob:'2004-03-15', pan:'ABCPM1212A', kycStatus:'Validated', mobile:'9800001212'},
       {id:'CMS-SC-V', cmsName:'Vishal Kumar Maurya', rmName: mine, branch:'Varanasi', dob:'2002-11-09', pan:'ABCPM3852Z', mobile:'9800003852'},
       {id:'CMS-SC-O', cmsName:'ZZ Other Client', rmName: theirs, branch:'Varanasi', dob:'1980-01-01', pan:'ABCPO3434O', mobile:'9800003434'}]
        .forEach(c => { c.createdAt = now; c.assignedTo = ''; initState('CMS', c); DB.clients.push(c); });
      await save('clients');
      await fetch('/api/connections/bossai', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({enabled:true, config:{baseUrl:'http://127.0.0.1:'+port+'/v1', model:'mock-model'}})});
      await fetch('/api/connections/bossai/test', {method:'POST', headers: apiHeaders()});
      return {mine, theirs};
    }, MOCK_PORT);
    return 'ZZ RM Mine and ZZ RM Theirs, both "own"';
  });

  await t.step('1. as ZZ RM Mine: RIA AI’s clients are exactly the CMS list — in the desk, the planner, Analytics and the gate for the model', async () => {
    await as(who.mine);
    const r = await t.eval(() => {
      const cms = visibleRecords(DB.clients, c => c.rmName, c => c.branch).map(c => c.cmsName).sort();
      return {cms, ria: riaVisible().map(c => c.cmsName).sort(), analytics: (analyticsRecords('clients') || []).map(c => c.cmsName).sort(),
        planner: aiReadSource('clients', {cols: ['name']}).rows.map(x => x.name).sort(), named: bossClientsNamedIn('Aaradhya Maurya').map(c => c.cmsName),
        gate: {mine: bossCanSeeClient(DB.clients.find(c => c.id === 'CMS-SC-A')), theirs: bossCanSeeClient(DB.clients.find(c => c.id === 'CMS-SC-O'))},
        door: recordOpenToMe('CMS', 'CMS-SC-A')};
    });
    const want = 'Aaradhya Maurya,Vishal Kumar Maurya';
    if(r.cms.join() !== want || r.ria.join() !== want || r.analytics.join() !== want || r.planner.join() !== want || r.named.join() !== 'Aaradhya Maurya'
      || !r.gate.mine || r.gate.theirs || !r.door) throw new Error(JSON.stringify(r));
    return 'CMS list = RIA desk = planner = Analytics = ' + want + '; the gate opens to hers, not the colleague’s';
  });

  await t.step('2. as ZZ RM Mine: "aaradhya maurya ka date of birth kya hain" → her date of birth, from the records', async () => {
    const n = seen.length;
    await ask('aaradhya maurya ka date of birth kya hain');
    const a = await last();
    if(!/^\*\*Aaradhya Maurya — Date of Birth:\*\* 15 Mar 2004/.test(a.text) || /not available|SOP/.test(a.text) || seen.length !== n) throw new Error(JSON.stringify({a, calls: seen.length - n}).slice(0, 500));
    return a.text.split('\n')[0].replace(/\*\*/g, '');
  });

  await t.step('3. as ZZ RM Mine: "aardhya maurya ka DOB kya hain?" (a letter short) → her, not every Maurya', async () => {
    await ask('aardhya maurya ka DOB kya hain?');
    const a = await last();
    if(!/^\*\*Aaradhya Maurya — Date of Birth:\*\* 15 Mar 2004/.test(a.text) || /Vishal/.test(a.text) || a.ui) throw new Error(JSON.stringify(a).slice(0, 500));
    return a.text.split('\n')[0].replace(/\*\*/g, '');
  });

  await t.step('4. as ZZ RM Mine, on her CMS page: "is client ka kya pending hai?" sends her record to the model', async () => {
    await t.eval(async () => { aiCloseP(); aiClearTurns(); navigate('cms', 'CMS-SC-A'); aiTogglePanel(); await aiRefreshStatus(true); });
    const n = seen.length;
    await ask('Is client ka kya pending hai?');
    const out = sent(n);
    if(!/Aaradhya Maurya/.test(out) || !/CMS-SC-A/.test(out) || /ZZ Other Client/.test(out)) throw new Error((seen.length - n) + ' calls; ' + out.slice(0, 500));
    return 'her dossier was sent (' + (seen.length - n) + ' call)';
  });

  await t.step('5. as ZZ RM Mine: a colleague’s client is not found, and nothing of it reaches the model', async () => {
    await as(who.mine);
    const n = seen.length;
    await ask('ZZ Other Client ka DOB batao');
    const a = await last(), out = sent(n);
    if(/01 Jan 1980|ABCPO3434O|9800003434/.test(a.text + out) || /\*\*ZZ Other Client — Date of Birth/.test(a.text) || /"id":"CMS-SC-O"/.test(out)) throw new Error(JSON.stringify({a, out: out.slice(0, 400)}));
    return 'not found; nothing of it sent (' + (seen.length - n) + ' model calls)';
  });

  await t.step('6. as ZZ RM Theirs: their own client, and not Aaradhya', async () => {
    await as(who.theirs);
    const r = await t.eval(() => riaVisible().map(c => c.cmsName));
    await ask('ZZ Other Client ka DOB batao');
    const a = await last();
    await ask('aaradhya maurya ka date of birth kya hain');
    const b = await last();
    if(r.join() !== 'ZZ Other Client' || !/^\*\*ZZ Other Client — Date of Birth:\*\* 01 Jan 1980/.test(a.text) || /15 Mar 2004|Aaradhya Maurya — Date/.test(b.text)) throw new Error(JSON.stringify({r, a: a.text.slice(0, 200), b: b.text.slice(0, 200)}));
    return 'sees ZZ Other Client only; Aaradhya not found';
  });

  await t.step('7. an Admin still sees every client', async () => {
    await as(null);
    const r = await t.eval(() => riaVisible().filter(c => /^CMS-SC-/.test(c.id)).map(c => c.cmsName).sort());
    if(r.join() !== 'Aaradhya Maurya,Vishal Kumar Maurya,ZZ Other Client') throw new Error(JSON.stringify(r));
    return r.length + ' clients';
  });
  } finally { await t.eval(() => { if(window.__adminUser) currentUser = window.__adminUser; }).catch(() => {}); mock.close(); }
});

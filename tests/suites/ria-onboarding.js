/* RIA AI: A NEW CLIENT FROM WHAT WAS PASTED.

   "Add new client: Name: …, Mobile: …, PAN: …" (or a WhatsApp message /
   bio-data with labels) gives a draft read into the client form's own
   fields, with two choices: the Add Client form already filled in, or a
   direct save under the form's own rules. Checked here:

     1. the spec's example: every field read into the right form key
        (accNo, ifsc, bankName, branch as the firm spells it), DOB as a date,
        the form's two other required fields said to be still needed; no
        model call
     2. "Open Pre-filled Form in CMS": the form opens with every value in its
        box; picking the two required choices and Save files the client
     3. a WhatsApp-style message with labels on lines: salutation and gender
        from "Mrs.", state as the form's option, bank from the IFSC; "Direct
        Save" files it once (a second click does not file it twice), with an
        audit entry
     4. a PAN already on file: the draft says so and Direct Save refuses
     5. values the form would refuse are named and not used; Aadhaar is
        never read from chat and is masked in the chat itself
     6. not a new client: a PAN + mobile lookup, a how-to question,
        "client details dikhao"
     7. what was pasted never reaches the AI model, now or with a later
        question
   Synthetic data only. */
const http = require('http');
const fs = require('fs');
const {suite} = require('../lib/harness');

const MOCK_PORT = Number(process.env.BOSS_PORT || 3000) + 334;
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

const SPEC = 'Add new client: Name: Rahul Ramesh Sharma, Mobile: 9820123456, PAN: ABCPS1234F, DOB: 14/07/1992, Email: Rahul@Gmail.com, Branch: Mumbai, Bank: HDFC Bank, A/c: 501004321098, IFSC: HDFC0000123';
const WHATSAPP = ['naya client add karo', 'Naam: Mrs. Priya Kapoor', 'Mobile: 98111 22233', 'Alternate mobile: 9811122234', 'PAN: abcpk5678l', 'DOB: 2 March 1988',
  'Gender: F', 'Address: 12 MG Road, Shivaji Nagar', 'City: Pune', 'State: maharashtra', 'Pin: 411001', 'Occupation: Doctor', 'Marital status: married',
  'Individual client', 'Product: Investment', 'Investment status: Active', 'IFSC: ICIC0001234', 'Account no: 123456789012'].join('\n');

suite(async t => {
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
  const ask = (q) => t.eval(async (q) => { const el = document.getElementById('aiInput'); el.value = q; ai.draft = q; await aiSend(); }, q);
  const last = () => t.eval(() => { const x = ai.turns[ai.turns.length - 1] || {}; return {text: String(x.content || ''), rows: x.table ? x.table.rows : [], actions: (x.actions || []).map(a => a.label),
    onboard: !!x.onboard, private: !!x.private}; });
  const fresh = () => t.eval(async () => { aiCloseP(); navigate('dashboard'); aiClearTurns(); aiTogglePanel(); await aiRefreshStatus(true); });
  const clickAct = (label) => t.eval(async (label) => { const b = [...document.querySelectorAll('#aiTurns .ria-act')].reverse().find(x => x.textContent.indexOf(label) === 0);
    if(!b) throw new Error('no button ' + label); b.click(); await new Promise(r => setTimeout(r, 400)); }, label);
  const stored = () => t.eval(async () => JSON.parse((await (await fetch('/api/storage/clients', {headers: apiHeaders()})).json()).value || '[]'));

  await t.step('setup: one existing client and the stand-in model', async () => {
    const r = await t.eval(async (port) => {
      const put = await fetch('/api/storage/clients', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({value: JSON.stringify([{id:'CMS-OB-EX', cmsName:'ZZ Existing Investor', mobile:'9800000555', pan:'ABCPE9999E', branch:'Pune'}])})});
      await fetch('/api/connections/bossai', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()),
        body: JSON.stringify({enabled:true, config:{baseUrl:'http://127.0.0.1:'+port+'/v1', model:'mock-model'}})});
      const test = await (await fetch('/api/connections/bossai/test', {method:'POST', headers: apiHeaders()})).json();
      return {put: put.status, test};
    }, MOCK_PORT);
    if(r.put !== 200 || (!r.test.ok && !/Connected/.test(JSON.stringify(r.test)))) throw new Error(JSON.stringify(r));
    await t.home();
    return 'model connected; branches: ' + (await t.eval(() => (DB.config.branches || []).join(', ')));
  });

  await t.step('1. the spec’s example → a draft in the form’s own fields; Family or Individual and Product Category still needed; no model call', async () => {
    await fresh();
    const n = seen.length;
    await ask(SPEC);
    const a = await last();
    const want = {'Client name':'Rahul Ramesh Sharma', 'Mobile':'9820123456', 'PAN':'ABCPS1234F', 'Email':'rahul@gmail.com', 'Branch':'Mumbai', 'Bank':'HDFC Bank', 'A/c no.':'501004321098', 'IFSC':'HDFC0000123'};
    const got = Object.fromEntries(a.rows); const wrong = Object.keys(want).filter(k => got[k] !== want[k]);
    if(!a.onboard || !a.private || wrong.length || !/^14 Jul 1992/.test(got['Date of birth'] || '') || !/Still needed before saving: \*\*Family or Individual, Product Category\*\*/.test(a.text)
      || !a.actions.includes('📝 Open Pre-filled Form in CMS') || !a.actions.includes('💾 Direct Save to CMS') || seen.length !== n)
      throw new Error(JSON.stringify({wrong: wrong.map(k => k + '=' + got[k]), a, calls: seen.length - n}).slice(0, 900));
    const draft = await t.eval(() => { const x = ai.turns[ai.turns.length - 1]; return x.actions.find(a => a.act.t === 'onboard').act.draft; });
    if(draft.accNo !== '501004321098' || draft.ifsc !== 'HDFC0000123' || draft.dob !== '1992-07-14' || draft.accountNumber || draft.ifscCode) throw new Error(JSON.stringify(draft));
    return a.rows.length + ' fields read (accNo / ifsc / dob 1992-07-14); 0 model calls';
  });

  await t.step('2. "📝 Open Pre-filled Form in CMS": every value in its box; the two choices picked; Save Client files it', async () => {
    await clickAct('📝 Open Pre-filled Form');
    const r = await t.eval(async () => {
      const v = k => (document.getElementById('f_' + k) || {}).value;
      const boxes = {cmsName: v('cmsName'), mobile: v('mobile'), pan: v('pan'), dob: v('dob'), email: v('email'), branch: v('branch'), bankName: v('bankName'), accNo: v('accNo'), ifsc: v('ifsc'),
        title: (document.querySelector('#modalBody') || {}).textContent.indexOf('Add New Client') >= 0, view: currentView};
      /* what the paste did not say, picked in the form as a person would — Investment then asks its status */
      document.getElementById('f_familyOrIndividual').value = 'Individual'; document.getElementById('f_productCategory').value = 'Investment';
      ['familyOrIndividual', 'productCategory'].forEach(k => document.getElementById('f_' + k).dispatchEvent(new Event('change', {bubbles: true})));
      document.getElementById('f_investmentsStatus').value = 'Active';
      await saveClient('');
      const c = DB.clients.find(x => x.pan === 'ABCPS1234F');
      return {boxes, saved: c ? {id: c.id, name: c.cmsName, acc: c.accNo, ifsc: c.ifsc, dob: c.dob, fam: c.familyOrIndividual} : null, modal: !!document.querySelector('#modalBody .modal-body')};
    });
    const b = r.boxes;
    if(b.cmsName !== 'Rahul Ramesh Sharma' || b.mobile !== '9820123456' || b.pan !== 'ABCPS1234F' || b.dob !== '1992-07-14' || b.email !== 'rahul@gmail.com' || b.branch !== 'Mumbai'
      || b.bankName !== 'HDFC Bank' || b.accNo !== '501004321098' || b.ifsc !== 'HDFC0000123' || !b.title || b.view !== 'cms') throw new Error('form: ' + JSON.stringify(b));
    if(!r.saved || r.saved.acc !== '501004321098' || r.saved.fam !== 'Individual') throw new Error('not saved: ' + JSON.stringify(r) + ' dialogs: ' + JSON.stringify(t.dialogs.slice(-3)));
    const s = (await stored()).find(x => x.pan === 'ABCPS1234F');
    if(!s) throw new Error('not on the server');
    return 'form filled (9 boxes); saved as ' + r.saved.id + ' and on the server';
  });

  await t.step('3. a WhatsApp-style paste: Mrs. → salutation + gender, state as the form’s option, bank from the IFSC; "💾 Direct Save" files it once, with an audit entry', async () => {
    await fresh();
    await ask(WHATSAPP);
    const a = await last(), got = Object.fromEntries(a.rows);
    const want = {'Salutation':'Mrs.', 'Client name':'Priya Kapoor', 'Mobile':'9811122233', 'Second mobile':'9811122234', 'PAN':'ABCPK5678L', 'Gender':'Female', 'City':'Pune', 'State':'Maharashtra',
      'PIN code':'411001', 'Profession':'Doctor', 'Marital status':'Married', 'Bank':'ICICI Bank', 'A/c no.':'123456789012', 'IFSC':'ICIC0001234', 'Family or Individual':'Individual', 'Product category':'Investment', 'Investments status':'Active'};
    const wrong = Object.keys(want).filter(k => got[k] !== want[k]);
    if(wrong.length || !/^02 Mar 1988/.test(got['Date of birth'] || '') || !/✓ Ready to save/.test(a.text)) throw new Error(JSON.stringify({wrong: wrong.map(k => k + '=' + got[k]), text: a.text}).slice(0, 700));
    const before = (await stored()).length;
    await clickAct('💾 Direct Save');
    const ok = await last();
    await clickAct('💾 Direct Save');
    const again = await last();
    const all = await stored(), mine = all.filter(x => x.pan === 'ABCPK5678L');
    const audit = await t.eval(() => (DB.auditLog || DB.audit || []).filter(x => x.module === 'CMS' && x.action === 'Create').slice(-1)[0] || null);
    if(!/✅ \*\*Saved to CMS:\*\* Mrs\. Priya Kapoor · CMS-/.test(ok.text) || !/already saved/.test(again.text) || mine.length !== 1 || all.length !== before + 1
      || mine[0].salutation !== 'Mrs.' || mine[0].mailingState !== 'Maharashtra' || mine[0].bankName !== 'ICICI Bank' || mine[0].dob !== '1988-03-02' || !mine[0].createdAt
      || !audit || !/RIA AI chat/.test(JSON.stringify(audit))) throw new Error(JSON.stringify({ok: ok.text, again: again.text, n: mine.length, rec: mine[0], audit}).slice(0, 900));
    return wrong.length + ' wrong of ' + Object.keys(want).length + '; saved once as ' + mine[0].id + ' (second click: already saved); audit "Create · created from RIA AI chat"';
  });

  await t.step('3b. what the form asks only once another answer is given: Investment without its status is not saved directly', async () => {
    await fresh();
    await ask('Add client: Name: ZZ Needs Status, Mobile: 9800000777, PAN: ABCPN7777N, Individual, Product: Investment');
    const a = await last();
    const before = (await stored()).length;
    await clickAct('💾 Direct Save');
    const r = await last();
    if(!/Still needed before saving: \*\*Investments Status\*\*/.test(a.text) || !/^\*\*Not saved\.\*\* Still needed: Investments Status\./.test(r.text) || (await stored()).length !== before
      || !r.actions.includes('📝 Open Pre-filled Form in CMS')) throw new Error(JSON.stringify({a: a.text, r}).slice(0, 700));
    return 'draft and Direct Save both say Investments Status is still needed; nothing filed';
  });

  await t.step('4. a PAN already on file: the draft says so, Direct Save refuses, nothing new is filed', async () => {
    await fresh();
    await ask('Add client: Name: ZZ Same Person Again, Mobile: 9800000999, PAN: ABCPE9999E, Individual, Product: Investment');
    const a = await last();
    const before = (await stored()).length;
    await clickAct('💾 Direct Save');
    const r = await last();
    if(!/PAN ABCPE9999E is already on file\*\* \(ZZ Existing Investor · CMS-OB-EX\)/.test(a.text) || !a.actions.some(x => /Open ZZ Existing Investor/.test(x))
      || !/^\*\*Not saved\.\*\* PAN ABCPE9999E is already on ZZ Existing Investor/.test(r.text) || (await stored()).length !== before) throw new Error(JSON.stringify({a: a.text, r: r.text}).slice(0, 700));
    return 'draft: already on ZZ Existing Investor (with its Open button); Direct Save: Not saved';
  });

  await t.step('5. values the form would refuse are named and left out; Aadhaar is not read and is masked in the chat', async () => {
    await fresh();
    await ask('Add new client: Name: ZZ Bad Values, Mobile: 12345, PAN: ABCPB12, Email: not-an-email, Branch: Atlantis, Aadhaar: 1234 5678 9012');
    const a = await last();
    const user = await t.eval(() => ai.turns.filter(x => x.role === 'user').slice(-1)[0].content);
    const draft = await t.eval(() => { const x = ai.turns[ai.turns.length - 1]; const o = (x.actions || []).find(a => a.act.t === 'onboard'); return o ? o.act.draft : null; });
    if(!a.onboard || !/Branch "Atlantis" is not one of the firm’s branches/.test(a.text) || !/Aadhaar is not read from chat/.test(a.text) || /1234 5678 9012/.test(user) || !/XXXX XXXX 9012/.test(user)
      || !draft || draft.mobile || draft.pan || draft.email || draft.aadhaar || !/Mobile/.test(a.text)) throw new Error(JSON.stringify({a, user, draft}).slice(0, 800));
    return 'mobile / PAN / email not used, branch not the firm’s, Aadhaar masked in the chat ("' + user.slice(-30) + '")';
  });

  await t.step('6. not a new client: a PAN + mobile lookup, a how-to question, "client details dikhao"', async () => {
    await fresh();
    const out = [];
    for(const q of ['ABCPE9999E ka mobile batao', 'How do I add a new client?', 'ZZ Existing Investor client details dikhao', 'ABCPE9999E 9800000555']){
      await ask(q); const a = await last(); if(a.onboard) throw new Error('"' + q + '" became a draft'); out.push(q);
    }
    return 'none became a draft: ' + out.join(' · ');
  });

  await t.step('7. what was pasted never reaches the AI model: not for the draft, not with a later question', async () => {
    await fresh();
    const n = seen.length;
    await ask(SPEC.replace('Rahul Ramesh Sharma', 'ZZ Private Person').replace('ABCPS1234F', 'ABCPZ4321Z').replace('9820123456', '9820999999'));
    await ask('What is a mutual fund?');
    const out = sent(n);
    if(seen.length - n < 1 || /ZZ Private Person|ABCPZ4321Z|9820999999|501004321098|Add new client/.test(out)) throw new Error((seen.length - n) + ' calls; sent: ' + out.slice(0, 600));
    return (seen.length - n) + ' model call(s) for the later question; nothing of the pasted client in them';
  });
  } finally { mock.close(); }
});

/* THE INDEPENDENT REVIEW'S FINDINGS, AS TESTS — PHASE 1, STEP 6b.

   Each step is a finding from docs/phase1/B2C-STEP6.md §8, written as
   the attack the reviewer ran and asserting what the spec says should
   happen. They were written before the fixes and failed then; each now
   guards its fix. Synthetic data only. */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const smtp = require('../lib/smtp');
const guard = require('../../outbound-guard');
const AC = require('../../access-control');

secSuite(async (t) => {
  const data = seed.build(30);
  data.config = Object.assign({}, data.config || {});
  const enf = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  let admin = await enf.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const own = data.clients.find((c) => c.rmName === 'U-RMA' && c.pan);
  const theirs = data.clients.find((c) => c.rmName === 'U-RMB' && c.pan);
  const theirLead = data.leads.find((l) => l.assignedTo === 'U-RMC');            // another branch's RM
  const visible = async (c) => (await c.store('clients', [])).filter((x) => !x._stub).length;

  /* ---------- #1 duplicate team ids ---------- */
  await t.step('#1 a second copy of one’s own team record is refused, in either mode; the lookup cannot be shadowed', async () => {
    const team = await rmA.store('team', []);
    const me = team.find((m) => m.id === 'U-RMA');
    const before = await visible(rmA);
    const r = await rmA.save('team', [Object.assign({}, me, { role: 'Admin', scope: 'all' })].concat(team));
    const after = await visible(rmA);
    const stored = (await admin.store('team', [])).filter((m) => m.id === 'U-RMA').length;
    /* report mode refuses it too (a duplicate id is never valid data) */
    const rep = await t.startServer({});
    const ra = await rep.admin(); await seed.load(ra, data);
    const rr = await seed.signIn(ra, 'U-RMA');
    const t2 = await rr.store('team', []);
    const r2 = await rr.save('team', [Object.assign({}, t2.find((m) => m.id === 'U-RMA'), { role: 'Admin', scope: 'all' })].concat(t2));
    const stored2 = (await ra.store('team', [])).filter((m) => m.id === 'U-RMA').length;
    /* a team that already holds two records with one id (old data): the account gets no member, not the first copy */
    const ac = AC.create({ storeRaw: (k) => (k === 'team' ? JSON.stringify([{ id: 'X', role: 'Admin', scope: 'all' }, { id: 'X', role: 'RM' }]) : undefined),
      memberOfUser: () => null, env: {}, warn: () => {} });
    const pr = ac.principal({ id: 9, role: 'user', member_id: 'X', email: 'x@x' });
    if (r.status === 200 || after !== before || stored !== 1 || r2.status === 200 || stored2 !== 1 || pr.member || pr.teamAdmin)
      throw new Error(JSON.stringify({ enforce: r.status, before, after, stored, report: r2.status, stored2, member: !!pr.member }));
    return 'enforce ' + r.status + ', report ' + r2.status + '; still one U-RMA; clients seen ' + before + ' → ' + after + '; an ambiguous team gives no member';
  });

  await t.step('#1 a second team record bound to the same email is refused', async () => {
    const team = await admin.store('team', []);
    const r = await admin.save('team', team.concat([{ id: 'U-ZZDUP', name: 'ZZ Dup', role: 'RM', email: seed.email('U-RMA'), status: 'Active' }]));
    if (r.status === 200) throw new Error('accepted');
    return r.status + ' — ' + String(r.json && (r.json.error || r.json.message)).slice(0, 70);
  });

  /* ---------- #2 document links ---------- */
  await t.step('#2 enforce: a link naming another RM’s client or lead is refused, whichever field names it', async () => {
    const links = await rmA.store('docLinks', []);
    const a = await rmA.save('docLinks', links.concat([{ id: 'DL-ZZ1', token: 'zz-tok-aaaaaaaaaaaaaaaa1', clientId: own.id, recordModule: 'CMS', recordId: theirs.id }]));
    const b = await rmA.save('docLinks', links.concat([{ id: 'DL-ZZ2', token: 'zz-tok-aaaaaaaaaaaaaaaa2', clientId: own.id, leadId: theirLead.id }]));
    if (a.status !== 403 || b.status !== 403) throw new Error(a.status + ' / ' + b.status);
    return 'recordId of another RM’s client 403; leadId of another RM’s lead 403';
  });

  await t.step('#2 any mode: a link whose record is not its own client serves nothing', async () => {
    const links = await admin.store('docLinks', []);
    await admin.save('docLinks', links.concat([{ id: 'DL-ZZ3', token: 'zz-tok-bbbbbbbbbbbbbbbb3', clientId: own.id, recordModule: 'CMS', recordId: theirs.id }]));
    const b = await fetch(enf.base + '/api/public/bundle?token=zz-tok-bbbbbbbbbbbbbbbb3');
    const txt = await b.text();
    if (b.status === 200 || txt.includes(theirs.pan)) throw new Error(b.status + ' leaks=' + txt.includes(theirs.pan));
    return 'bundle ' + b.status + '; nothing of the other client';
  });

  await t.step('#2 the client-link page shows PANs masked, and a masked PAN sent back keeps the real one', async () => {
    const links = await admin.store('docLinks', []);
    await admin.save('docLinks', links.concat([{ id: 'DL-ZZ4', token: 'zz-tok-cccccccccccccccc4', clientId: own.id, recordModule: 'CMS', recordId: own.id }]));
    const b = await (await fetch(enf.base + '/api/public/bundle?token=zz-tok-cccccccccccccccc4')).json();
    const shown = (b.store && b.store.clients && b.store.clients[0]) || (b.clients && b.clients[0]) || {};
    const text = JSON.stringify(b);
    const masked = 'XXXXXX' + own.pan.slice(-4);
    const p = await fetch(enf.base + '/api/public/patch?token=zz-tok-cccccccccccccccc4', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { clients: { [own.id]: Object.assign({}, shown, { city: 'ZZ Link City' }) } },
        appends: { docSubmissions: [{ id: 'DS-ZZ4', token: 'zz-tok-cccccccccccccccc4', clientId: own.id, answers: { pan: masked } }] } }) });
    const after = (await admin.store('clients', [])).find((c) => c.id === own.id);
    const sub = (await admin.store('docSubmissions', [])).find((s) => s.id === 'DS-ZZ4');
    if (text.includes(own.pan) || shown.pan !== masked || p.status !== 200 || after.pan !== own.pan || after.city !== 'ZZ Link City' || !sub || sub.answers.pan !== own.pan)
      throw new Error(JSON.stringify({ leak: text.includes(own.pan), shown: shown.pan, patch: p.status, stored: after.pan, city: after.city, sub: sub && sub.answers.pan }));
    return 'bundle shows ' + masked + '; the update and the submission sent the masked PAN back and the real PAN stayed';
  });

  /* ---------- #3 masked PAN restore ---------- */
  await t.step('#3 a masked PAN is restored only from a record the writer may read; no last-four oracle', async () => {
    const list = await rmA.store('clients', []);
    const right = await rmA.save('clients', list.concat([{ id: 'CMS-ZZC1', rmName: 'U-RMA', branch: own.branch, cmsName: 'ZZ Copy', recordId: theirs.id, pan: 'XXXXXX' + theirs.pan.slice(-4) }]));
    const wrong = await rmA.save('clients', list.concat([{ id: 'CMS-ZZC2', rmName: 'U-RMA', branch: own.branch, cmsName: 'ZZ Copy', recordId: theirs.id, pan: 'XXXXXX999Q' }]));
    const all = await admin.store('clients', []);
    const copied = all.filter((c) => c.pan === theirs.pan).length;
    if (right.status === 200 || right.status !== wrong.status || right.text !== wrong.text || copied !== 1)
      throw new Error(JSON.stringify({ right: right.status, wrong: wrong.status, same: right.text === wrong.text, copies: copied }));
    return 'right last four ' + right.status + ', wrong last four ' + wrong.status + ' (identical answers); the other client’s PAN exists once';
  });

  /* ---------- #4 PANs inside text, as keys, in settings ---------- */
  await t.step('#4 PANs inside free text, as object keys and in settings are masked, and survive a save', async () => {
    const PAN_IN = 'ZQZPT4321T';
    const all = await admin.store('clients', []);
    await admin.save('clients', all.map((c) => (c.id === own.id ? Object.assign({}, c, { notes: 'PAN of spouse ' + PAN_IN + ' noted', panIndex: { [PAN_IN]: 'spouse' } }) : c)));
    const s = await admin.store('settings', {});
    await admin.save('settings', Object.assign({}, s, { zzContact: { pan: PAN_IN } }));
    const r = await rmA.get('/api/storage/clients');
    const rs = await rmA.get('/api/storage/settings');
    const mine = (await rmA.store('clients', [])).find((c) => c.id === own.id);
    const leak = r.text.includes(PAN_IN) || rs.text.includes(PAN_IN);
    await rmA.save('clients', (await rmA.store('clients', [])).map((c) => (c.id === own.id ? Object.assign({}, c, { city: 'ZZ Note City' }) : c)));
    const after = (await admin.store('clients', [])).find((c) => c.id === own.id);
    if (leak || !/XXXXXX321T/.test(mine.notes) || !after.notes.includes(PAN_IN) || !after.panIndex[PAN_IN] || after.city !== 'ZZ Note City')
      throw new Error(JSON.stringify({ leak, shown: mine.notes, keys: Object.keys(mine.panIndex || {}), stored: after.notes, storedKeys: Object.keys(after.panIndex || {}) }));
    return 'RM sees "' + mine.notes + '" and key ' + Object.keys(mine.panIndex)[0] + '; settings masked; after the RM’s save the stored text and key still hold the PAN';
  });

  /* ---------- #5 Reply-To ---------- */
  const mailPort = Number(process.env.BOSS_PORT || 3000) + 670;
  const mail = smtp.start(mailPort); await mail.ready;
  admin = await enf.admin();
  await admin.put('/api/connections/email', { enabled: true, config: smtp.connector(mailPort) });
  await admin.post('/api/connections/email/test', {});
  await t.step('#5 Reply-To cannot carry extra headers', async () => {
    const n = mail.received.length;
    const bad = await admin.post('/api/mail/send', { to: own.email, subject: 'ZZ', body: 'ZZ', replyTo: 'a@x.test\r\nFrom: "CEO" <ceo@firm.test>\r\nBcc: z@evil.test' }, { 'X-CRM-Mail': 'compose' });
    const good = await admin.post('/api/mail/send', { to: own.email, subject: 'ZZ', body: 'ZZ', replyTo: 'replies@zz.test' }, { 'X-CRM-Mail': 'compose' });
    const raws = mail.received.slice(n).map((m) => m.body);
    const injected = raws.some((x) => (x.match(/\r\nFrom:/gi) || []).length > 0 && /ceo@firm\.test/.test(x));
    if (bad.status !== 400 || good.status !== 200 || injected || !raws.some((x) => /Reply-To: replies@zz\.test/.test(x))) throw new Error([bad.status, good.status, injected].join(' / '));
    return 'CRLF in Reply-To → 400, nothing sent; a plain address → 200 with Reply-To';
  });

  /* ---------- #6 outbound guard ---------- */
  await t.step('#6 every spelling of a loopback, private, link-local or metadata address is refused', async () => {
    const urls = ['https://[::ffff:169.254.169.254]/', 'https://[::ffff:a9fe:a9fe]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/',
      'https://[::127.0.0.1]/', 'https://[::7f00:1]/', 'https://[::ffff:0:127.0.0.1]/', 'https://[64:ff9b::7f00:1]/', 'https://[64:ff9b::a9fe:a9fe]/',
      'https://[2002:7f00:1::]/', 'https://[2002:a9fe:a9fe::]/', 'https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/', 'https://[fec0::1]/',
      'https://[fd00:ec2::254]/', 'https://[::]/', 'https://2130706433/', 'https://0x7f.1/', 'https://017700000001/', 'https://0x7f000001/',
      'https://127.1/', 'https://0/', 'https://169.254.169.254./'];
    const passed = [];
    for (const u of urls) { const h = new URL(u).hostname; const r = await guard.check(u, { hosts: [h] }); if (r.ok) passed.push(u); }
    /* and the firm's own model, allowed private addresses, still never gets metadata */
    const own2 = await guard.check('https://[::ffff:a9fe:a9fe]/', { hosts: ['[::ffff:a9fe:a9fe]'], allowPrivate: true });
    if (passed.length || own2.ok) throw new Error('allowed: ' + passed.join(' ') + (own2.ok ? ' + metadata for the own model' : ''));
    return urls.length + ' spellings refused (mapped, compatible, translated, NAT64, 6to4, Teredo, site-local, integer/octal/hex IPv4); metadata refused even for the own model';
  });

  /* ---------- #9 compose limits ---------- */
  await t.step('#9 the recipient limit holds whatever kind of send the request claims; an address typed into remarks is not a recipient', async () => {
    const many = data.clients.filter((c) => c.rmName === 'U-RMA').map((c) => c.email);
    while (many.length < 21) many.push(seed.email('U-RMA'));
    const all = await admin.store('clients', []);
    await admin.save('clients', all.map((c) => (c.id === own.id ? Object.assign({}, c, { remarks: 'also try outsider@evil.test' }) : c)));
    const a = await rmA.post('/api/mail/send', { to: many.join(','), subject: 'ZZ', body: 'ZZ' }, { 'X-CRM-Mail': 'template' });
    const b = await rmA.post('/api/mail/send', { to: 'outsider@evil.test', subject: 'ZZ', body: 'ZZ' }, { 'X-CRM-Mail': 'template' });
    const c = await rmA.post('/api/mail/send', { to: own.email, subject: 'ZZ', body: 'ZZ' }, { 'X-CRM-Mail': 'template' });
    if (a.status !== 403 || b.status !== 403 || c.status !== 200) throw new Error([a.status, b.status, c.status].join(' / '));
    return '21 recipients claimed as template 403; address only in remarks 403; the client’s own email 200';
  });
  await mail.close();

  /* ---------- #10 default role ---------- */
  await t.step('#10 a role list cannot make Admin the default role; a non-admin cannot change the role list', async () => {
    const team = await admin.store('team', []);
    await admin.save('team', team.map((m) => (m.id === 'U-RMC' ? Object.assign({}, m, { role: '' }) : m)));
    const cfg = await admin.store('config', {});
    await admin.save('config', Object.assign({}, cfg, { roles: ['Admin'] }));
    const rmC = await seed.signIn(admin, 'U-RMC');
    const seen = await visible(rmC);
    const ownC = data.clients.filter((c) => c.rmName === 'U-RMC').length;
    await admin.save('config', cfg);
    const ops = await seed.signIn(admin, 'U-OPS');                                 // holds an admin flag, may write settings
    const r = await ops.save('config', Object.assign({}, cfg, { roles: ['Admin', 'RM'] }));
    if (seen !== ownC || r.status === 200) throw new Error(JSON.stringify({ seen, ownC, rolesWrite: r.status }));
    return 'empty-role RM with roles=[Admin]: sees own ' + seen + ' (not all); settings writer changing roles: ' + r.status;
  });

  /* ---------- #11 placeholders ---------- */
  await t.step('#11 placeholder records never replace real ones, in either mode', async () => {
    const all = await admin.store('clients', []);
    const stubs = all.map((c) => ({ id: c.id, _stub: true, cmsName: 'Restricted record' }));
    const e = await rmA.save('clients', stubs);
    const rep = await t.startServer({});
    const ra = await rep.admin(); await seed.load(ra, data);
    const rr = await seed.signIn(ra, 'U-RMA');
    const r = await rr.save('clients', stubs);
    const afterE = (await admin.store('clients', [])).filter((c) => c._stub || c.cmsName === 'Restricted record').length;
    const afterR = (await ra.store('clients', [])).filter((c) => c._stub || c.cmsName === 'Restricted record').length;
    if (afterE || afterR) throw new Error(JSON.stringify({ enforce: e.status, report: r.status, afterE, afterR }));
    return 'enforce ' + e.status + ', report ' + r.status + '; no placeholder stored, every client intact';
  });

  /* ---------- #12 dynamic keys, reserved keys ---------- */
  await t.step('#12 upload rows follow CMS access (PANs masked); reserved store names are refused', async () => {
    admin = await enf.admin();
    await admin.save('assetUploads', [{ id: 'UP-ZZ1', file: 'zz.xlsx' }]);
    await admin.save('assetRows.UP-ZZ1', [{ client_name: 'ZZ', pan: own.pan }]);
    const rows = await rmA.get('/api/storage/assetRows.UP-ZZ1');
    const exec = await seed.signIn(admin, 'U-EXEC');                       // no CMS view
    const ex = await exec.get('/api/storage/assetRows.UP-ZZ1');
    const proto = await admin.save('__proto__', { x: 1 });
    const ctor = await admin.save('constructor', { x: 1 });
    const has = await admin.get('/api/storage/hasOwnProperty');
    if (rows.status !== 200 || rows.text.includes(own.pan) || ex.status !== 403 || proto.status !== 400 || ctor.status !== 400 || has.status !== 404)
      throw new Error([rows.status, rows.text.includes(own.pan), ex.status, proto.status, ctor.status, has.status].join(' / '));
    return 'RM with CMS view 200 (PAN masked); no CMS view 403; __proto__/constructor 400; hasOwnProperty 404';
  });

  /* ---------- #8 inactive team record ---------- */
  await t.step('#8 a team record set Inactive or deleted ends that person’s access, even without the account sync; the administrator account is not locked out', async () => {
    admin = await enf.admin();
    const tl = await seed.signIn(admin, 'U-TL');
    const team = await admin.store('team', []);
    await admin.save('team', team.map((m) => (m.id === 'U-TL' ? Object.assign({}, m, { status: 'Inactive' }) : m)));
    const s = await tl.get('/api/session');
    let relog = 'refused'; try { await enf.login(seed.email('U-TL'), 'Passw0rd-u-tl'); relog = 'signed in'; } catch (e) { /* refused */ }
    const adm2 = await enf.admin();
    const still = (await adm2.get('/api/session')).status;
    if (s.status !== 401 || relog !== 'refused' || still !== 200) throw new Error(JSON.stringify({ session: s.status, relog, admin: still }));
    return 'session 401 (' + s.json.session + '); sign-in refused; administrator account unaffected';
  });

  /* ---------- #7 attempt limit ---------- */
  await t.step('#7 a successful sign-in with one’s own account does not reset the limit on guesses at another', async () => {
    const lim = await t.startServer({});
    const a = await lim.admin();
    await a.save('team', seed.build(5).team);
    await seed.signIn(a, 'U-RMA');
    const post = (email, password) => fetch(lim.base + '/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password }).toString() }).then((r) => r.status);
    const st = [];
    for (let round = 0; round < 4 && !st.includes(429); round++) {
      for (let i = 0; i < 6; i++) st.push(await post('test@finowise.test', 'guess-' + round + '-' + i));
      await post(seed.email('U-RMA'), 'Passw0rd-u-rma');
    }
    await lim.stop();
    if (!st.includes(429)) throw new Error(st.join(','));
    return 'guesses at the administrator: ' + st.join(',') + ' — 429 after ' + st.indexOf(429) + ', despite own sign-ins in between';
  });

  /* ======== the second, fresh review (step 6b) ======== */
  const linkTo = async (tok, extra) => {
    const links = await admin.store('docLinks', []);
    await admin.save('docLinks', links.concat([Object.assign({ id: 'DL-' + tok, token: tok, clientId: own.id, recordModule: 'CMS', recordId: own.id }, extra || {})]));
  };
  await t.step('R2-N1 a link, a lead or a review cannot be pointed at another RM’s client by any other field', async () => {
    admin = await enf.admin();
    const links = await rmA.store('docLinks', []);
    const a = await rmA.save('docLinks', links.concat([{ id: 'DL-ZZN1', token: 'zz-tok-dddddddddddddddd1', clientId: own.id, leadId: theirs.id }]));
    const leads = await rmA.store('leads', []);
    const myLead = leads.find((l) => l.assignedTo === 'U-RMA' && !l._stub);
    const b = await rmA.save('leads', leads.map((l) => (l.id === myLead.id ? Object.assign({}, l, { convertedToClientId: theirs.id }) : l)));
    const reviews = await rmA.store('reviews', []);
    const c = await rmA.save('reviews', reviews.concat([{ id: 'RMS-ZZN1', assignTo: 'U-RMA', clientId: theirs.id, ctFormToken: 'zz-tok-eeeeeeeeeeeeeeee1' }]));
    const tx = await rmA.store('transactions', []);
    const d = await rmA.save('transactions', tx.concat([{ id: 'TX-ZZN1', clientId: theirs.id, createdBy: 'U-RMA', amount: 1 }]));
    if ([a, b, c, d].some((r) => r.status !== 403)) throw new Error([a.status, b.status, c.status, d.status].join(' / '));
    return 'link leadId=client 403; own lead converted to their client 403; review on their client 403; transaction on their client 403';
  });

  await t.step('R2-N1/N5 a client link cannot move its client to another RM, or write to records outside the link', async () => {
    admin = await enf.admin();
    await linkTo('zz-tok-ffffffffffffffff1');
    const otherLead = data.leads.find((l) => l.assignedTo === 'U-RMC');
    const p = await fetch(enf.base + '/api/public/patch?token=zz-tok-ffffffffffffffff1', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { clients: { [own.id]: { rmName: 'U-RMB', branch: 'B' } } },
        appends: { docSubmissions: [{ id: 'DS-ZZN5', token: 'zz-tok-not-this-link', leadId: otherLead.id, type: 'ISEQ', score: 99 }],
          transactions: [{ id: 'TX-ZZN5', clientId: theirs.id, amount: 5 }] } }) });
    const cl = (await admin.store('clients', [])).find((c) => c.id === own.id);
    const tx = (await admin.store('transactions', [])).find((x) => x.id === 'TX-ZZN5');
    const ds = (await admin.store('docSubmissions', [])).find((x) => x.id === 'DS-ZZN5');
    const ld = (await admin.store('leads', [])).find((l) => l.id === otherLead.id);
    if (cl.rmName !== 'U-RMA' || cl.branch !== own.branch || tx || ds || (ld && ld.iseqScore === 99))
      throw new Error(JSON.stringify({ patch: p.status, rm: cl.rmName, tx: !!tx, ds: !!ds }));
    return 'patch ' + p.status + '; owner and branch unchanged; the other client’s transaction and the other lead’s submission refused';
  });

  await t.step('R2-N2 a colleague’s team PAN cannot be pulled into a visible field, and the link page masks the team', async () => {
    admin = await enf.admin();
    const team = await rmA.store('team', []);
    const right = await rmA.save('team', team.map((m) => (m.id === 'U-RMB' ? Object.assign({}, m, { name: 'XXXXXX222B' }) : m)));
    const wrong = await rmA.save('team', team.map((m) => (m.id === 'U-RMB' ? Object.assign({}, m, { name: 'XXXXXX999Q' }) : m)));
    const b = (await admin.store('team', [])).find((m) => m.id === 'U-RMB');
    await linkTo('zz-tok-gggggggggggggggg1');
    const bundle = await (await fetch(enf.base + '/api/public/bundle?token=zz-tok-gggggggggggggggg1')).text();
    if (right.status === 200 || right.text !== wrong.text || b.name === 'ZZZPB2222B' || /ZZZP[A-Z]\d{4}[A-Z]/.test(bundle))
      throw new Error(JSON.stringify({ right: right.status, wrong: wrong.status, same: right.text === wrong.text, name: b.name, bundleLeak: /ZZZP[A-Z]\d{4}[A-Z]/.test(bundle) }));
    return 'right ' + right.status + ' / wrong ' + wrong.status + ' (identical); name unchanged; no full PAN in the bundle';
  });

  await t.step('R2-N3 an RM cannot edit a colleague’s name, email or phone; their own phone, yes', async () => {
    const team = await rmA.store('team', []);
    const r = await rmA.save('team', team.map((m) => (m.id === 'U-RMB' ? Object.assign({}, m, { name: 'ZZ Renamed', email: 'planted@evil.test', mobile: '9000000001' }) : m)));
    const mine = await rmA.save('team', team.map((m) => (m.id === 'U-RMA' ? Object.assign({}, m, { mobile: '9000000002' }) : m)));
    if (r.status !== 403 || mine.status !== 200) throw new Error(r.status + ' / ' + mine.status);
    return 'colleague’s record 403; own phone 200';
  });

  await t.step('R2-N4 an account without a team link cannot become a team member another account is linked to', async () => {
    admin = await enf.admin();
    await seed.signIn(admin, 'U-TADM');                                   // U-TADM's account, linked by member id
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'user.js'), 'add', 'legacy@zz.test', 'Legacy-pass-123'],
      { env: Object.assign({}, process.env, { CRM_USERS_DB: path.join(enf.dir, 'users.db') }), stdio: 'ignore' });
    const team = await admin.store('team', []);
    await admin.save('team', team.map((m) => (m.id === 'U-TADM' ? Object.assign({}, m, { email: 'legacy@zz.test' }) : m)));
    const leg = await enf.login('legacy@zz.test', 'Legacy-pass-123');
    const seen = await visible(leg);
    if (seen === data.clients.length) throw new Error('legacy account sees all ' + seen);
    return 'the unlinked account sees ' + seen + ' clients, not U-TADM’s ' + data.clients.length;
  });

  await t.step('R2-N6 granting Manage Permissions or Manage Users needs the administrator account', async () => {
    const pm = await seed.signIn(admin, 'U-PM');
    const team = await pm.store('team', []);
    const r = await pm.save('team', team.map((m) => (m.id === 'U-RMC' ? Object.assign({}, m, { adminFlags: Object.assign({}, m.adminFlags || {}, { managePermissions: 1 }) }) : m)));
    if (r.status !== 403) throw new Error(String(r.status));
    return '403';
  });

  await t.step('R2 #8 any status other than Active ends access ("inactive", "Left")', async () => {
    admin = await enf.admin();
    const exec = await seed.signIn(admin, 'U-EXEC');
    const team = await admin.store('team', []);
    await admin.save('team', team.map((m) => (m.id === 'U-EXEC' ? Object.assign({}, m, { status: 'inactive' }) : m)));
    const s1 = (await exec.get('/api/session')).status;
    if (s1 !== 401) throw new Error(String(s1));
    return 'lower-case "inactive" → 401';
  });

  await t.step('R2 legacy webhooks and integration connector rows are not readable by everyone', async () => {
    admin = await enf.admin();
    await admin.save('webhooks', [{ id: 'WH-ZZ', name: 'ZZ', url: 'https://hooks.example/secret-path-zz', method: 'POST' }]);
    await admin.save('integrationConnectors', [{ id: 'IC-ZZ', provider: 'zz', apiKey: 'zz-legacy-key' }]);
    const ex = await seed.signIn(admin, 'U-RMC');
    const a = await ex.get('/api/storage/webhooks'), b = await ex.get('/api/storage/integrationConnectors');
    if (a.status !== 403 || b.status !== 403 || /secret-path-zz|zz-legacy-key/.test(a.text + b.text)) throw new Error(a.status + ' / ' + b.status);
    return 'webhooks 403; integrationConnectors 403 for an RM';
  });

  await t.step('R2 Azure WireServer (168.63.129.16) is never reached', async () => {
    const r = guard.classify('168.63.129.16');
    if (r !== 'always') throw new Error(r);
    return 'always refused';
  });

  /* ======== the third, fresh review (step 6b) ======== */
  const patch = (tok, body) => fetch(enf.base + '/api/public/patch?token=' + tok, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await t.step('R3-C1 a link cannot add a lead that claims another client, and a lead→client hop must be the real conversion', async () => {
    admin = await enf.admin();
    await linkTo('zz-tok-hhhhhhhhhhhhhhhh1');
    await patch('zz-tok-hhhhhhhhhhhhhhhh1', { appends: { leads: [{ id: 'LMS-ZZEVIL1', leadName: 'ZZ', assignedTo: 'U-RMA', convertedToClientId: theirs.id }] } });
    const added = (await admin.store('leads', [])).find((l) => l.id === 'LMS-ZZEVIL1');
    /* the same lead put there directly (as report mode would let an RM), then a link to it */
    const leads = await admin.store('leads', []);
    await admin.save('leads', leads.filter((l) => l.id !== 'LMS-ZZEVIL1').concat([{ id: 'LMS-ZZEVIL2', leadName: 'ZZ', assignedTo: 'U-RMA', branch: own.branch, convertedToClientId: theirs.id }]));
    const links = await admin.store('docLinks', []);
    await admin.save('docLinks', links.concat([{ id: 'DL-ZZC1', token: 'zz-tok-iiiiiiiiiiiiiiii1', leadId: 'LMS-ZZEVIL2', type: 'X' }]));
    const bj = await (await fetch(enf.base + '/api/public/bundle?token=zz-tok-iiiiiiiiiiiiiiii1')).json();
    const servedClients = ((bj.store || {}).clients || []).map((c) => c.id);
    const b = JSON.stringify(bj);
    /* the planted lead row itself (its own convertedToClientId) is in its bundle; the other client's record is not */
    const leak = servedClients.includes(theirs.id) || b.includes(theirs.email) || (theirs.mobile && b.includes(theirs.mobile)) || b.includes(theirs.cmsName);
    if ((added && added.convertedToClientId === theirs.id) || leak) throw new Error(JSON.stringify({ added: !!added, servedClients, leak }));
    return 'appended claim refused; a planted conversion serves nothing of the other client';
  });

  await t.step('R3-H1/L1 masked PANs are put back only where masking looks; a PAN beside _ = # is masked', async () => {
    admin = await enf.admin();
    const k4 = own.pan.slice(-4);
    const bait = ['XXXXXX' + k4 + '-x', 'data:XXXXXX' + k4, 'XXXXXX' + k4 + '.', 'XXXXXX' + k4 + '/1', 'A'.repeat(210) + ' XXXXXX' + k4];
    const list = await rmA.store('clients', []);
    await rmA.save('clients', list.map((c) => (c.id === own.id ? Object.assign({}, c, { remarks: bait.join(' | '), extra: bait }) : c)));
    const P = 'ZQZPQ4444Q';
    const all = await admin.store('clients', []);
    await admin.save('clients', all.map((c) => (c.id === own.id ? Object.assign({}, c, { notes2: ['pan=' + P, 'PAN#' + P, 'Ref:' + P + '_2'].join(' '), keyed: { [P + ' x']: 1 } }) : c)));
    const view = (await rmA.get('/api/storage/clients')).text;
    if (view.includes(own.pan) || view.includes(P)) throw new Error('full PAN in the RM view: ' + (view.includes(own.pan) ? 'own client' : 'text'));
    return 'no full PAN in the RM’s view after the bait save; pan=/PAN#/_2 and a key with text masked';
  });

  await t.step('R3-M1 a link may not name a converted lead of another RM', async () => {
    admin = await enf.admin();
    const all = await admin.store('clients', []);
    await admin.save('clients', all.map((c) => (c.id === theirs.id ? Object.assign({}, c, { convertedFromLeadId: 'LMS-ZZGONE' }) : c)));
    const links = await rmA.store('docLinks', []);
    const r = await rmA.save('docLinks', links.concat([{ id: 'DL-ZZM1', token: 'zz-tok-jjjjjjjjjjjjjjjj1', leadId: 'LMS-ZZGONE', type: 'X', createdBy: 'U-RMA' }]));
    if (r.status !== 403) throw new Error(String(r.status));
    return '403';
  });

  await t.step('R3-M2/M3 a link cannot re-point itself, and what it adds stays with its own record and owner', async () => {
    admin = await enf.admin();
    await linkTo('zz-tok-kkkkkkkkkkkkkkkk1');
    const qs = await admin.store('queries', []);
    await admin.save('queries', qs.concat([{ id: 'QRY-ZZOTHER', clientId: theirs.id, assignTo: 'U-RMB', subject: 'ZZ' }]));
    const p1 = await patch('zz-tok-kkkkkkkkkkkkkkkk1', { updates: { docLinks: { 'DL-zz-tok-kkkkkkkkkkkkkkkk1': { allocationId: 'REC-ZZX', token: 'zz-new-token-xxxxxxxx' } } } });
    const p2 = await patch('zz-tok-kkkkkkkkkkkkkkkk1', { appends: {
      tasks: [{ id: 'DST-ZZM3', clientId: own.id, assignTo: 'U-RMB', taskType: 'ZZ' }],
      notifications: [{ id: 'NTF-ZZM3', userId: 'U-RMB', title: 'Click here' }],
      transactions: [{ id: 'TX-ZZM3', clientId: own.id, rmName: 'U-RMB', amount: 99999999 }],
      queryReplies: [{ id: 'QR-ZZM3', queryId: 'QRY-ZZOTHER', text: 'ZZ' }],
      communications: [{ id: 'COM-ZZM3', recordId: theirs.id, text: 'ZZ' }] } });
    const link = (await admin.store('docLinks', [])).find((l) => l.id === 'DL-zz-tok-kkkkkkkkkkkkkkkk1');
    const got = {};
    for (const [k, id] of [['tasks', 'DST-ZZM3'], ['notifications', 'NTF-ZZM3'], ['transactions', 'TX-ZZM3'], ['queryReplies', 'QR-ZZM3'], ['communications', 'COM-ZZM3']])
      got[k] = !!(await admin.store(k, [])).find((x) => x.id === id);
    if (link.allocationId || link.token !== 'zz-tok-kkkkkkkkkkkkkkkk1' || Object.values(got).some(Boolean)) throw new Error(JSON.stringify({ p1: p1.status, p2: p2.status, alloc: link.allocationId, token: link.token, got }));
    return 'link unchanged; a task or notification for another member, a transaction for another RM, a reply on another client’s query and a note on another client all refused';
  });

  await t.step('R3-M4 team identity: the email match never makes an account an Admin or firm-wide member; a new member gets the same capability checks', async () => {
    admin = await enf.admin();
    const team = await admin.store('team', []);
    await admin.save('team', team.concat([
      { id: 'U-ZZUNL', name: 'ZZ Unlinked Admin', role: 'Admin', scope: 'all', status: 'Active', email: 'zz-unl@zz.test' },
      { id: 'U-ZZTC', name: 'ZZ Team Creator', role: 'Manager', scope: 'own', branch: 'A', status: 'Active', email: 'zz-tc@zz.test', perms: { Team: { view: 1, create: 1, edit: 1 } } }]));
    const { execFileSync } = require('child_process');
    execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'user.js'), 'add', 'zz-unl@zz.test', 'Legacy-pass-456'],
      { env: Object.assign({}, process.env, { CRM_USERS_DB: path.join(enf.dir, 'users.db') }), stdio: 'ignore' });
    const leg = await enf.login('zz-unl@zz.test', 'Legacy-pass-456');      // no team link of its own; its email is on an Admin record
    const seen = await visible(leg);
    const tc = await seed.signIn(admin, 'U-ZZTC');
    const t2 = await tc.store('team', []);
    const r = await tc.save('team', t2.concat([{ id: 'U-ZZNEW', name: 'ZZ New', role: 'Executive', scope: 'own', branch: 'A', status: 'Active', email: 'zz-new@zz.test',
      perms: { CMS: { view: 1, edit: 1 } }, hrAccess: { admin: true }, managerIds: ['U-ZZTC'] }]));
    if (seen === data.clients.length || r.status !== 403) throw new Error(JSON.stringify({ seen, newMember: r.status }));
    return 'email-matched account on an Admin record sees ' + seen + '; Team-create holder adding perms/HR admin/managers 403';
  });

  await t.step('R3-L3 upload index written only by those who may upload', async () => {
    admin = await enf.admin();
    const ex = await seed.signIn(admin, 'U-HR');                              // no CMS rights
    const r = await ex.save('assetUploads', [{ id: 'UP-ZZL3', file: 'x' }]);
    if (r.status !== 403) throw new Error(String(r.status));
    return '403';
  });

  /* ---------- suspected: SMTP to a metadata address ---------- */
  await t.step('(suspected) the mail connector never connects to a link-local or metadata address', async () => {
    admin = await enf.admin();
    await admin.put('/api/connections/email', { enabled: true, config: { host: '169.254.169.254', port: 25, fromEmail: 'o@zz.test' } });
    const t0 = Date.now();
    const r = await admin.post('/api/connections/email/test', {});
    const ms = Date.now() - t0;
    if (r.json.ok || !/may never be reached|link-local|metadata/i.test(r.json.message || '') || ms > 3000) throw new Error(ms + ' ms ' + JSON.stringify(r.json).slice(0, 160));
    return 'refused in ' + ms + ' ms: "' + String(r.json.message).slice(0, 60) + '…"';
  });
});

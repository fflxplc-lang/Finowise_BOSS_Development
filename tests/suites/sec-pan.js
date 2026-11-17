/* PAN, SHOWN MASKED — PHASE 1, STEP 3.

   For anyone but an administrator account the server sends every PAN as
   XXXXXX234F, wherever it sits in a record: the client's own, a family
   member's, a nominee's, a lead's, an audit line's old and new value, a
   team member's own. That is enforce mode; report mode serves PANs as
   before and records how many it would have masked.

   The other half is the save: a masked PAN sent back means "unchanged",
   and the server puts the stored PAN back before anything else reads the
   record, so the masked string never reaches the disk. That is checked
   against data.json itself, not against what the API says. A full PAN
   typed in is a change and is saved; a masked PAN the server cannot trace
   to a stored one is refused. Synthetic data only (PANs start ZZZP). */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const FULL = /\bZZZP[A-Z][0-9]{4}[A-Z]\b/;          // any seeded PAN, in full
const edit = (list, id, patch) => list.map((r) => (r.id === id ? Object.assign({}, r, patch) : r));

secSuite(async (t) => {
  const data = seed.build(80);
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const admin = await srv.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const tAdm = await seed.signIn(admin, 'U-TADM');
  const disk = () => { const d = JSON.parse(fs.readFileSync(path.join(srv.dir, 'data.json'), 'utf8')); const o = {}; Object.keys(d).forEach((k) => { try { o[k] = JSON.parse(d[k]); } catch (e) { o[k] = d[k]; } }); return o; };
  /* data.json is written just after the answer (the server coalesces writes),
     so a check of the file waits for the change it expects, up to 5 s. */
  const diskWhen = async (pred) => {
    for (let i = 0; i < 100; i++) { try { const d = disk(); if (pred(d)) return d; } catch (e) { /* mid-rename */ } await new Promise((r) => setTimeout(r, 50)); }
    return disk();
  };
  const settle = () => new Promise((r) => setTimeout(r, 400));
  const mine = data.clients.find((c) => c.rmName === 'U-RMA' && c.familyMembers && c.nominees);
  const truthOf = (id) => data.clients.find((c) => c.id === id);

  await t.step('the administrator account sees every PAN in full', async () => {
    const c = (await admin.store('clients', [])).find((x) => x.id === mine.id);
    if (c.pan !== mine.pan || c.familyMembers[0].pan !== mine.familyMembers[0].pan) throw new Error(JSON.stringify(c));
    return mine.pan + ' and the family member’s, in full';
  });

  await t.step('an RM sees their own client’s PANs masked, nested ones included', async () => {
    const c = (await rmA.store('clients', [])).find((x) => x.id === mine.id);
    const want = 'XXXXXX' + mine.pan.slice(-4);
    if (c.pan !== want || c.familyMembers[0].pan !== 'XXXXXX' + mine.familyMembers[0].pan.slice(-4) || c.nominees[0].pan !== 'XXXXXX' + mine.nominees[0].pan.slice(-4))
      throw new Error(JSON.stringify({ pan: c.pan, fam: c.familyMembers[0].pan, nom: c.nominees[0].pan }));
    return c.pan + ' (client), ' + c.familyMembers[0].pan + ' (family), ' + c.nominees[0].pan + ' (nominee)';
  });

  await t.step('no full PAN anywhere in anything an RM can read', async () => {
    const hits = [];
    for (const k of ['clients', 'leads', 'auditLog', 'team', 'tasks', 'transactions', 'platformHoldings', 'communications']) {
      const r = await rmA.get('/api/storage/' + k);
      if (r.status === 200 && FULL.test(r.json.value)) hits.push(k);
    }
    if (hits.length) throw new Error('full PAN in: ' + hits.join(', '));
    const team = await rmA.store('team', []);
    if (team.find((m) => m.id === 'U-RMA').panNumber !== 'XXXXXX111A') throw new Error('own team PAN: ' + team.find((m) => m.id === 'U-RMA').panNumber);
    return '8 stores scanned, incl. audit lines and the RM’s own team PAN (XXXXXX111A)';
  });

  await t.step('the team role Admin is not the administrator account: it also gets masked PANs', async () => {
    const c = (await tAdm.store('clients', [])).find((x) => x.id === mine.id);
    if (c.pan !== 'XXXXXX' + mine.pan.slice(-4)) throw new Error(c.pan);
    return c.pan;
  });

  await t.step('saving a record with masked PANs keeps the real PANs on disk', async () => {
    const list = await rmA.store('clients', []);
    const r = await rmA.save('clients', edit(list, mine.id, { mobile: '9000000005' }));
    const onDisk = (await diskWhen((d) => (d.clients.find((c) => c.id === mine.id) || {}).mobile === '9000000005')).clients.find((c) => c.id === mine.id);
    if (r.status !== 200) throw new Error(r.status + ' ' + r.text.slice(0, 160));
    if (onDisk.mobile !== '9000000005' || onDisk.pan !== mine.pan || onDisk.familyMembers[0].pan !== mine.familyMembers[0].pan || onDisk.nominees[0].pan !== mine.nominees[0].pan)
      throw new Error('on disk: ' + JSON.stringify({ m: onDisk.mobile, pan: onDisk.pan, fam: onDisk.familyMembers[0].pan, nom: onDisk.nominees[0].pan }));
    const masked = JSON.stringify(await diskWhen(() => true)).match(/XXXXXX[0-9]{3}[A-Z]/g) || [];
    if (masked.length) throw new Error('masked PANs on disk: ' + masked.length);
    return 'data.json: mobile changed; PAN ' + onDisk.pan + ', family ' + onDisk.familyMembers[0].pan + ', nominee ' + onDisk.nominees[0].pan + ' intact; 0 masked strings on disk';
  });

  await t.step('the same, through the client form’s own server check', async () => {
    const list = await rmA.store('clients', []);
    const r = await rmA.save('clients', edit(list, mine.id, { city: 'ZZ Varanasi' }), { 'X-CRM-Form': 'client' });
    const onDisk = (await diskWhen((d) => (d.clients.find((c) => c.id === mine.id) || {}).city === 'ZZ Varanasi')).clients.find((c) => c.id === mine.id);
    if (r.status !== 200 || onDisk.pan !== mine.pan) throw new Error(r.status + ' ' + r.text.slice(0, 200) + ' ' + onDisk.pan);
    return 'saved with X-CRM-Form: client; PAN on disk intact';
  });

  await t.step('the team record: a masked PAN on your own profile saved back keeps the real one', async () => {
    const team = await rmA.store('team', []);
    const r = await rmA.save('team', edit(team, 'U-RMA', { phone: '9000000006' }));
    const me = (await diskWhen((d) => (d.team.find((m) => m.id === 'U-RMA') || {}).phone === '9000000006')).team.find((m) => m.id === 'U-RMA');
    if (r.status !== 200 || me.panNumber !== 'ZZZPA1111A' || me.phone !== '9000000006') throw new Error(r.status + ' ' + JSON.stringify(me));
    return 'phone saved; panNumber on disk ZZZPA1111A';
  });

  await t.step('a genuinely new full PAN typed in is saved', async () => {
    const list = await rmA.store('clients', []);
    const r = await rmA.save('clients', edit(list, mine.id, { pan: 'ZZZPQ9999Q' }));
    const onDisk = (await diskWhen((d) => (d.clients.find((c) => c.id === mine.id) || {}).pan === 'ZZZPQ9999Q')).clients.find((c) => c.id === mine.id);
    const seen = (await rmA.store('clients', [])).find((c) => c.id === mine.id).pan;
    const back = await admin.save('clients', (await admin.store('clients', [])).map((c) => (c.id === mine.id ? Object.assign({}, c, { pan: mine.pan }) : c)));
    await diskWhen((d) => (d.clients.find((c) => c.id === mine.id) || {}).pan === mine.pan);
    if (r.status !== 200 || onDisk.pan !== 'ZZZPQ9999Q' || seen !== 'XXXXXX999Q' || back.status !== 200) throw new Error(r.status + ' ' + onDisk.pan + ' ' + seen);
    return 'stored ZZZPQ9999Q; the RM now sees XXXXXX999Q';
  });

  await t.step('a masked PAN the server cannot trace is refused, and nothing is written', async () => {
    const list = await rmA.store('clients', []);
    await settle();
    const before = JSON.stringify(disk().clients);
    const r = await rmA.save('clients', list.concat([{ id: 'CMS-ZZMASK', cmsName: 'ZZ Masked New', rmName: 'U-RMA', branch: 'A', pan: 'XXXXXX321Z' }]));
    await settle();
    if (r.status !== 422 || JSON.stringify(disk().clients) !== before) throw new Error(r.status + ' ' + r.text.slice(0, 160));
    return '422; data.json unchanged';
  });

  await t.step('a new record pre-filled from a client carries the client’s real PAN to disk', async () => {
    const subs = (await rmA.store('docSubmissions', [])).concat([{ id: 'SUB-ZZ1', clientId: mine.id, answers: { cif_pan: 'XXXXXX' + mine.pan.slice(-4) }, at: new Date().toISOString() }]);
    const r = await rmA.save('docSubmissions', subs);
    const onDisk = ((await diskWhen((d) => (d.docSubmissions || []).some((x) => x.id === 'SUB-ZZ1'))).docSubmissions || []).find((x) => x.id === 'SUB-ZZ1');
    if (r.status !== 200 || !onDisk || onDisk.answers.cif_pan !== mine.pan) throw new Error(r.status + ' ' + JSON.stringify(onDisk));
    return 'the form answer on disk is ' + onDisk.answers.cif_pan + ', restored from the client it hangs off';
  });

  await t.step('the audit trail records masking in counts, never a PAN', async () => {
    const e = (await admin.get('/api/audit?limit=500')).json.entries || [];
    const reads = e.filter((x) => x.action === 'store.read' && /PAN\(s\) masked/.test(x.reason || ''));
    if (!reads.length || FULL.test(JSON.stringify(e))) throw new Error(reads.length + ' entries; full PAN present: ' + FULL.test(JSON.stringify(e)));
    return reads.length + ' read entries mention masked PANs; no PAN in the trail';
  });

  /* The page, in enforce mode: everything it holds, exports and the assistant included, is masked. */
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  try {
    await t.step('in the page: no full PAN anywhere in what the RM’s tab holds; the form accepts a masked PAN', async () => {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await page.goto(srv.base + '/login', { waitUntil: 'domcontentloaded' });
      await page.fill('#email', seed.email('U-RMA')); await page.fill('#password', 'Passw0rd-u-rma');
      await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.click('button[type=submit]')]);
      await ready(page); await page.waitForFunction(() => appBooted === true, null, { timeout: 30000 });
      const r = await page.evaluate(() => {
        const all = JSON.stringify(DB);
        const exp = JSON.stringify(exportRows(exportSource('clients')));
        return { full: /\bZZZP[A-Z][0-9]{4}[A-Z]\b/.test(all), expFull: /\bZZZP[A-Z][0-9]{4}[A-Z]\b/.test(exp), expMasked: /XXXXXX[0-9]{3}[A-Z]/.test(exp),
          okMasked: checkValue('pan', 'XXXXXX234C').ok, okFull: checkValue('pan', 'ZZZPQ1234Q').ok, badStill: checkValue('pan', 'NOTAPAN').ok };
      });
      await ctx.close();
      if (r.full || r.expFull || !r.expMasked || !r.okMasked || !r.okFull || r.badStill) throw new Error(JSON.stringify(r));
      return 'the whole tab (so exports and the assistant) holds only masked PANs; the client export is masked; a masked PAN passes the form, a bad one still fails';
    });
  } finally { await browser.close(); }

  /* Report mode: the runner's server. */
  const radmin = await t.admin();
  await seed.load(radmin, data);
  const rA = await seed.signIn(radmin, 'U-RMA');
  await t.step('report mode serves PANs as before, and records what it would mask', async () => {
    const c = (await rA.store('clients', [])).find((x) => x.id === mine.id);
    const e = ((await radmin.get('/api/audit?limit=300')).json.entries || []).find((x) => x.action === 'store.read' && x.target === 'clients' && x.outcome === 'would-scope');
    if (c.pan !== mine.pan || !e || !/PAN\(s\) masked/.test(e.reason)) throw new Error(c.pan + ' ' + JSON.stringify(e));
    return 'served ' + c.pan + ' in full; recorded "' + e.reason + '"';
  });
});

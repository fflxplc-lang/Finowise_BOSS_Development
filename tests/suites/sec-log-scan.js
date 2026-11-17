/* NOTHING SENSITIVE IN LOGS, AUDIT FILES, ERRORS OR AT REST — PHASE 1, STEP 3.

   Known synthetic values are pushed through the server (PANs, an Aadhaar
   number, mobile numbers, a generated password), including on the paths
   that refuse, and then everything the server wrote is searched for them:
   its stdout and stderr, every audit file, the error answers, and users.db
   itself. A generated password must be unreadable in users.db (sealed,
   AES-256-GCM) yet still shown to an administrator until first sign-in;
   one left in plain text by older code is sealed when the server starts. */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const { DatabaseSync } = require('node:sqlite');

secSuite(async (t) => {
  const data = seed.build(40);
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const admin = await srv.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const errors = [];
  const keep = (r) => { if (r.status >= 400) errors.push(r.text); return r; };
  const own = data.clients.find((c) => c.rmName === 'U-RMA');
  const other = data.clients.find((c) => c.rmName === 'U-RMB');
  /* a valid Aadhaar-shaped number, synthetic */
  const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
  const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
  let c = 0; ('29876543210' + '0').split('').reverse().forEach((ch, i) => { c = D[c][P[i % 8][Number(ch)]]; });
  const AAD = '29876543210' + [0,4,3,2,1,5,6,7,8,9][c];
  const MOBILES = ['9811122233', '9822233344'];

  await t.step('sensitive values are pushed through allowed and refused paths', async () => {
    const list = await rmA.store('clients', []);
    keep(await rmA.save('clients', list.map((x) => (x.id === own.id ? Object.assign({}, x, { mobile: MOBILES[0] }) : x))));
    keep(await rmA.save('clients', list.concat([Object.assign({}, other, { mobile: MOBILES[1], cmsName: 'ZZ Hijack' })])));   // refused
    keep(await rmA.save('clients', list.concat([{ id: 'CMS-ZZBAD', rmName: 'U-RMA', branch: 'A', pan: 'XXXXXX999Z' }])));   // refused
    keep(await rmA.put('/api/aadhaar/' + own.id, { number: AAD }));
    keep(await rmA.put('/api/aadhaar/' + other.id, { number: AAD }));                                                          // refused
    keep(await rmA.post('/api/clients/pan-match', { pans: [own.pan, other.pan] }));
    keep(await rmA.del('/api/storage/clients'));                                                                                // refused
    return errors.length + ' refusals collected';
  });

  /* a generated password, made the way Team Members makes an account */
  const made = await admin.post('/api/users/sync', { memberId: 'U-RMC', email: seed.email('U-RMC') });
  const generated = made.json && made.json.password;

  await t.step('nothing sensitive in the server log, the audit trail or any error answer', async () => {
    const auditDir = path.join(srv.dir, 'audit');
    const audit = fs.existsSync(auditDir) ? fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), 'utf8')).join('') : '';
    const haystack = { log: srv.log(), audit, errors: errors.join('\n') };
    const needles = [AAD, ...MOBILES, generated, own.pan, other.pan, ...data.clients.map((x) => x.pan), ...data.leads.map((x) => x.pan)].filter(Boolean);
    const found = [];
    for (const [where, text] of Object.entries(haystack)) for (const n of needles) if (text.includes(n)) found.push(where + ': ' + n.slice(0, 3) + '…');
    if (!audit.length) throw new Error('no audit trail to scan');
    if (found.length) throw new Error(found.slice(0, 10).join(', '));
    return needles.length + ' values × log (' + haystack.log.length + ' chars), audit (' + audit.length + ' chars), ' + errors.length + ' error answers: 0 hits';
  });

  await t.step('a generated password is sealed in users.db, yet shown to the administrator until first sign-in', async () => {
    if (!generated) throw new Error('no password was generated: ' + made.text.slice(0, 200));
    const db = fs.readFileSync(path.join(srv.dir, 'users.db')).toString('latin1') + (fs.existsSync(path.join(srv.dir, 'users.db-wal')) ? fs.readFileSync(path.join(srv.dir, 'users.db-wal')).toString('latin1') : '');
    const row = new DatabaseSync(path.join(srv.dir, 'users.db')).prepare('SELECT issued_password FROM users WHERE email = ?').get(seed.email('U-RMC'));
    const shown = ((await admin.get('/api/users')).json.users || []).find((u) => u.email === seed.email('U-RMC'));
    if (db.includes(generated) || !/^enc1:/.test(row.issued_password) || shown.issuedPassword !== generated) throw new Error(JSON.stringify({ plain: db.includes(generated), stored: String(row.issued_password).slice(0, 8), shown: !!shown.issuedPassword }));
    await srv.login(seed.email('U-RMC'), generated);
    const after = ((await admin.get('/api/users')).json.users || []).find((u) => u.email === seed.email('U-RMC'));
    if (after.issuedPassword !== null) throw new Error('still shown after first sign-in');
    return 'stored as enc1:…; not in users.db in plain; admin saw it; cleared after first sign-in';
  });

  await t.step('a password left in plain text by older code is sealed at start-up, and still shown', async () => {
    const plain = 'ZzPlainOld9876';
    await admin.post('/api/users/sync', { memberId: 'U-EXEC', email: seed.email('U-EXEC'), password: 'Passw0rd-exec-1' });
    await srv.stop();
    const db = new DatabaseSync(path.join(srv.dir, 'users.db'));
    db.prepare('UPDATE users SET issued_password = ? WHERE email = ?').run(plain, seed.email('U-EXEC'));
    db.close();
    const again = await t.startServer({ CRM_ACCESS_MODE: 'enforce' }, { dir: srv.dir });
    const a2 = await again.admin();
    const row = new DatabaseSync(path.join(srv.dir, 'users.db')).prepare('SELECT issued_password FROM users WHERE email = ?').get(seed.email('U-EXEC'));
    const shown = ((await a2.get('/api/users')).json.users || []).find((u) => u.email === seed.email('U-EXEC'));
    if (!/^enc1:/.test(row.issued_password) || shown.issuedPassword !== plain) throw new Error(JSON.stringify({ stored: String(row.issued_password).slice(0, 8), shown: shown.issuedPassword }));
    return 'sealed on restart ("' + row.issued_password.slice(0, 5) + '…"); the administrator still reads it';
  });
});

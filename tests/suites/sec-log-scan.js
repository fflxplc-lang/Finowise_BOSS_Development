/* NOTHING SENSITIVE IN LOGS, AUDIT FILES, ERRORS OR AT REST — PHASE 1, STEPS 3 AND 6.

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
  let againSrv = null;

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
    const again = againSrv = await t.startServer({ CRM_ACCESS_MODE: 'enforce' }, { dir: srv.dir });
    const a2 = await again.admin();
    const row = new DatabaseSync(path.join(srv.dir, 'users.db')).prepare('SELECT issued_password FROM users WHERE email = ?').get(seed.email('U-EXEC'));
    const shown = ((await a2.get('/api/users')).json.users || []).find((u) => u.email === seed.email('U-EXEC'));
    if (!/^enc1:/.test(row.issued_password) || shown.issuedPassword !== plain) throw new Error(JSON.stringify({ stored: String(row.issued_password).slice(0, 8), shown: shown.issuedPassword }));
    return 'sealed on restart ("' + row.issued_password.slice(0, 5) + '…"); the administrator still reads it';
  });

  /* Step 6: after connector secrets, an SMTP password, an assistant request
     carrying its own key, sessions and passwords have all been through the
     server, every file it wrote is searched. Each kind of value may live in
     one place only: PANs and phone numbers in data.json (the records
     themselves), connector secrets in connections.json (0600), Aadhaar in
     the vault, encrypted. Passwords and session cookies: nowhere. */
  await t.step('every file at rest, the log and the audit trail: each value only where it belongs', async () => {
    const SECRETS = { ai: 'zz-final-ai-key-5566778899', smtp: 'zz-final-smtp-pass-1122', bodyKey: 'zz-body-key-should-vanish' };
    const a2 = await againSrv.admin();
    await a2.put('/api/connections/claude', { enabled: true, config: { model: 'zz', privacyVerified: true }, secrets: { apiKey: SECRETS.ai } });
    await a2.put('/api/connections/email', { enabled: true, config: { host: 'smtp.zz.test', username: 'm@zz.test', fromEmail: 'o@zz.test' }, secrets: { password: SECRETS.smtp } });
    await a2.post('/api/ai/chat', { connector: 'claude', apiKey: SECRETS.bodyKey, messages: [{ role: 'user', content: 'ZZ' }] });
    const rmc = await againSrv.login(seed.email('U-EXEC'), 'Passw0rd-exec-1');
    await rmc.get('/api/storage/clients');
    await new Promise((r) => setTimeout(r, 1200));                                // let the coalesced writes land
    const read = (f) => (fs.existsSync(path.join(srv.dir, f)) ? fs.readFileSync(path.join(srv.dir, f)).toString('latin1') : '');
    const auditDir = path.join(srv.dir, 'audit');
    const files = { 'data.json': read('data.json'), 'users.db': read('users.db') + read('users.db-wal'), 'connections.json': read('connections.json'),
      'aadhaar-vault.json': read('aadhaar-vault.json'), audit: fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), 'utf8')).join(''),
      log: srv.log() + againSrv.log(), errors: errors.join('\n') };
    const cookies = [a2.cookie, rmc.cookie, admin.cookie].map((c) => String(c).split('=')[1]).filter(Boolean);
    const pans = data.clients.map((x) => x.pan).filter(Boolean);
    const rules = [
      ['account passwords', ['testpassword1', 'Passw0rd-exec-1', 'Passw0rd-u-rma', generated, 'ZzPlainOld9876'].filter(Boolean), []],
      ['session cookies', cookies, []],
      ['connector secrets', [SECRETS.ai, SECRETS.smtp], ['connections.json']],
      ['a key sent in a request body', [SECRETS.bodyKey], []],
      ['Aadhaar digits', [AAD], []],
      ['PANs', pans, ['data.json']],
      ['phone numbers', MOBILES, ['data.json']],
    ];
    const bad = [];
    for (const [what, values, allowed] of rules) {
      for (const [f, text] of Object.entries(files)) {
        if (allowed.includes(f)) continue;
        const hit = values.find((v) => v && text.includes(v));
        if (hit) bad.push(what + ' in ' + f + ' (' + hit.slice(0, 4) + '…)');
      }
    }
    const mode = (fs.statSync(path.join(srv.dir, 'connections.json')).mode & 0o777).toString(8);
    const present = files['connections.json'].includes(SECRETS.ai) && files['data.json'].includes(pans[0]);
    if (bad.length || mode !== '600' || !present) throw new Error(bad.join('; ') + ' mode=' + mode + ' present=' + present);
    return rules.length + ' kinds of value × ' + Object.keys(files).length + ' places (data.json, users.db+WAL, connections.json, vault, audit, log, errors): each only where it belongs; connections.json is 0600';
  });
});

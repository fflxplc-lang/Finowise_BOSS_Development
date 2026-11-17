/* CONNECTORS AND THEIR SECRETS — PHASE 1, STEP 4.

   Day 1, every mode: saving, testing and deleting a connector (and an API
   connector's secret) is for the administrator account only. That takes
   it away from members who hold Manage module settings, who could test and
   remove connectors in the page before (Step 0 inventory), and from the
   team role Admin. A secret is never sent back to a browser; a masked
   placeholder saved back keeps the stored secret. An API connector's
   secret goes only to the hosts an administrator approved when saving it:
   repointing the connector in the store does not repoint the secret.

   Report mode first: using an API connector (call, token) needs Manage
   module settings, as on the page; in enforce mode others are refused and
   the connector list they get carries no hosts, user names or base URLs. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');

const SECRET = 'zz-real-secret-0123456789', API_SECRET = 'zz-api-secret-abcdef', SMTP_PW = 'zz-smtp-password-42';

secSuite(async (t) => {
  const data = seed.build(20);
  data.apiConnectors = [{ id: 'ZZPART', name: 'ZZ Partner API', baseUrl: 'https://api.partner.test', auth: { kind: 'bearer', tokenUrl: 'https://auth.partner.test/token' } }];
  const srv = await t.startServer({});
  const admin = await srv.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const ops = await seed.signIn(admin, 'U-OPS');
  const tAdm = await seed.signIn(admin, 'U-TADM');
  const conn = () => JSON.parse(fs.readFileSync(path.join(srv.dir, 'connections.json'), 'utf8'));
  /* connections.json is written asynchronously after the response: wait for the value to land */
  const connWhen = async (pick, want) => { let v; for (let i = 0; i < 50; i++) { try { v = pick(conn()); } catch (e) { v = undefined; } if (v === want) return v; await new Promise((r) => setTimeout(r, 100)); } return v; };
  const responses = [];
  const keep = (r) => { responses.push(r.text); return r; };
  let captured = 0;
  const capture = await new Promise((res) => { const s = http.createServer((q, a) => { captured++; a.end('{}'); }); s.listen(0, '127.0.0.1', () => res(s)); });
  const cport = capture.address().port;

  await t.step('the administrator account can configure, test and store secrets', async () => {
    const a = keep(await admin.put('/api/connections/claude', { enabled: true, config: { model: 'zz-model', privacyVerified: true }, secrets: { apiKey: SECRET } }));
    const b = keep(await admin.put('/api/connections/email', { enabled: true, config: { host: 'smtp.zz.test', port: 587, username: 'mailer@zz.test', fromEmail: 'office@zz.test' }, secrets: { password: SMTP_PW } }));
    const c = keep(await admin.put('/api/apiconnectors/ZZPART', { secret: API_SECRET, baseUrl: 'https://api.partner.test', tokenUrl: 'https://auth.partner.test/token' }));
    await connWhen((c) => !!(c.claude && c.email && c['apiconn:ZZPART'] && c['apiconn:ZZPART'].secrets.secret === API_SECRET), true);
    const stored = conn();
    if (a.status !== 200 || b.status !== 200 || c.status !== 200 || stored.claude.secrets.apiKey !== SECRET || stored['apiconn:ZZPART'].secrets.secret !== API_SECRET)
      throw new Error([a.status, b.status, c.status].join(','));
    return 'saved; the API connector’s approved hosts: ' + stored['apiconn:ZZPART'].approvedHosts.join(', ');
  });

  await t.step('nobody else may save, test or delete a connector — not RM, team-role Admin, nor Manage module settings', async () => {
    const before = JSON.stringify(conn());
    const got = [];
    for (const [who, c] of [['RM', rmA], ['team Admin', tAdm], ['module settings', ops]]) {
      got.push(who + ': ' + [
        keep(await c.put('/api/connections/claude', { config: { baseUrl: 'https://evil.test' }, secrets: { apiKey: 'stolen' } })).status,
        keep(await c.post('/api/connections/claude/test', {})).status,
        keep(await c.del('/api/connections/email')).status,
        keep(await c.put('/api/apiconnectors/ZZPART', { secret: 'replaced' })).status,
        keep(await c.del('/api/apiconnectors/ZZPART')).status].join('/'));
    }
    if (got.some((g) => !/403\/403\/403\/403\/403$/.test(g)) || JSON.stringify(conn()) !== before) throw new Error(got.join('; '));
    return got.join('; ') + '; connections.json unchanged';
  });

  await t.step('no response ever carries a secret, and a masked placeholder keeps the stored one', async () => {
    for (const c of [admin, rmA, ops]) { keep(await c.get('/api/connections')); keep(await c.get('/api/apiconnectors')); keep(await c.get('/api/ai/status')); }
    keep(await admin.put('/api/connections/claude', { secrets: { apiKey: '••••••••' } }));
    keep(await admin.put('/api/apiconnectors/ZZPART', { secret: '********' }));
    await new Promise((r) => setTimeout(r, 500));            // let the placeholder saves reach the file
    const s = conn();
    const leak = responses.filter((r) => [SECRET, API_SECRET, SMTP_PW].some((x) => r.includes(x)));
    if (leak.length || s.claude.secrets.apiKey !== SECRET || s['apiconn:ZZPART'].secrets.secret !== API_SECRET) throw new Error(leak.length + ' leaking responses; ' + s.claude.secrets.apiKey);
    return responses.length + ' responses, none with a secret; placeholders left the stored secrets as they were';
  });

  await t.step('changing an AI connector’s endpoint clears its privacy attestation unless it is made again', async () => {
    keep(await admin.put('/api/connections/claude', { config: { baseUrl: 'https://other.example' } }));
    const cleared = await connWhen((c) => c.claude.config.privacyVerified, false);
    keep(await admin.put('/api/connections/claude', { config: { baseUrl: 'https://third.example', privacyVerified: true } }));
    const kept = await connWhen((c) => c.claude.config.baseUrl === 'https://third.example' && c.claude.config.privacyVerified, true);
    if (cleared !== false || kept !== true) throw new Error(cleared + ' / ' + kept);
    return 'new endpoint without re-attesting → privacyVerified false; with it → true';
  });

  await t.step('the stored API secret goes only to approved hosts; repointing the connector in the store does not move it', async () => {
    const call = async (c, url, kind) => keep(await c.post('/api/apiconnectors/ZZPART/call', { url, method: 'GET', auth: { kind: kind || 'bearer' } })).json;
    const approved = await call(ops, 'https://api.partner.test/v1/items');
    const foreign = await call(ops, 'https://evil.test/collect');
    const local = await call(ops, 'https://127.0.0.1:' + cport + '/collect');
    /* the member with Manage module settings may edit the store: point it elsewhere */
    const defs = await ops.store('apiConnectors', []);
    keep(await ops.save('apiConnectors', defs.map((d) => Object.assign({}, d, { baseUrl: 'https://127.0.0.1:' + cport }))));
    const afterRepoint = await call(ops, 'https://127.0.0.1:' + cport + '/collect');
    const token = keep(await ops.post('/api/apiconnectors/ZZPART/token', { url: 'https://127.0.0.1:' + cport + '/token', clientId: 'x' })).json;
    await new Promise((r) => setTimeout(r, 200));
    const refused = (r) => ['host_not_approved', 'private_address'].includes(r.blocked);
    if (approved.blocked === 'host_not_approved' || foreign.blocked !== 'host_not_approved' || !refused(local)
      || !refused(afterRepoint) || token.ok || captured !== 0)
      throw new Error(JSON.stringify({ approved: approved.blocked || approved.message, foreign: foreign.blocked, local: local.blocked, afterRepoint: afterRepoint.blocked, token, captured }));
    return 'approved host passes the guard (' + (approved.blocked || 'reached') + ' offline); foreign, local and repointed hosts refused; token to a foreign URL refused; the capture server received ' + captured;
  });

  await t.step('report mode: using a connector without Manage module settings is recorded, not yet refused', async () => {
    const r = keep(await rmA.post('/api/apiconnectors/ZZPART/call', { url: 'https://api.partner.test/v1', method: 'GET', auth: { kind: 'none' } }));
    const e = ((await admin.get('/api/audit?limit=200')).json.entries || []).find((x) => x.action === 'connector.use' && x.outcome === 'would-deny');
    if (r.status !== 200 || !e) throw new Error(r.status + ' ' + JSON.stringify(e));
    return 'call went on (' + r.status + '); would-deny recorded';
  });

  await t.step('every refusal is audited, and no secret is in the server log or the audit trail', async () => {
    const auditDir = path.join(srv.dir, 'audit');
    const audit = fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), 'utf8')).join('');
    const denies = (audit.match(/"outcome":"deny"/g) || []).length;
    const leak = [SECRET, API_SECRET, SMTP_PW, 'stolen', 'replaced'].filter((x) => audit.includes(x) || srv.log().includes(x));
    if (denies < 15 || leak.length) throw new Error(denies + ' denies; leaks: ' + leak.join(','));
    return denies + ' refusals in the audit trail; no secret in it or in the server log';
  });

  /* Enforce mode: a server of its own. */
  const enf = await t.startServer({ CRM_ACCESS_MODE: 'enforce' });
  const a2 = await enf.admin();
  await seed.load(a2, data);
  await a2.put('/api/connections/email', { enabled: true, config: { host: 'smtp.zz.test', username: 'mailer@zz.test', fromEmail: 'office@zz.test' }, secrets: { password: SMTP_PW } });
  await a2.put('/api/apiconnectors/ZZPART', { secret: API_SECRET, baseUrl: 'https://api.partner.test' });
  const rm2 = await seed.signIn(a2, 'U-RMA');
  const ops2 = await seed.signIn(a2, 'U-OPS');
  await t.step('enforce: an RM cannot use the connector; Manage module settings can', async () => {
    const r = await rm2.post('/api/apiconnectors/ZZPART/call', { url: 'https://api.partner.test/v1', method: 'GET', auth: { kind: 'none' } });
    const o = await ops2.post('/api/apiconnectors/ZZPART/call', { url: 'https://api.partner.test/v1', method: 'GET', auth: { kind: 'none' } });
    if (r.status !== 403 || o.status !== 200) throw new Error(r.status + ' / ' + o.status);
    return 'RM 403; Manage module settings 200';
  });
  await t.step('enforce: the connector list a non-administrator gets has no hosts, user names or base URLs', async () => {
    const list = (await rm2.get('/api/connections')).json.connections;
    const email = list.find((c) => c.id === 'email');
    const text = JSON.stringify(list);
    const full = JSON.stringify((await a2.get('/api/connections')).json.connections);
    if (/smtp\.zz\.test|mailer@zz\.test/.test(text) || email.config.fromEmail !== 'office@zz.test' || email.config.host !== 'set' || !/smtp\.zz\.test/.test(full))
      throw new Error(text.slice(0, 300));
    return 'RM sees on/off, status, the sender it will show (office@zz.test) and "host: set"; the administrator sees it all';
  });
  capture.close();
});

/* WHERE THE SERVER MAY SEND A REQUEST — PHASE 1, STEP 4, DAY 1.

   outbound-guard.js stands in front of every request that carries a stored
   credential or that a person can point somewhere: connector tests, API
   connector calls and tokens, the AI providers. Checked here:
     - addresses: loopback, private, CGNAT, unique-local refused (unless the
       policy allows private: the firm's own model only); link-local and
       cloud metadata (169.254.169.254) refused always, in every spelling;
     - schemes: https only; plain http only to a private address and only
       where allowed; no user:password in the URL;
     - the host must be one the policy names, exactly;
     - a name is resolved once and the connection is pinned to that answer,
       so a name that answers differently a moment later cannot redirect it
       (DNS is stubbed here to answer with a private address);
     - a redirect is never followed (a real local server answers 302). */
const http = require('http');
const dns = require('dns');
const { secSuite } = require('../lib/sec-http');
const guard = require('../../outbound-guard');

function listen(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
}

secSuite(async (t) => {
  await t.step('addresses are classified correctly, in every spelling', async () => {
    const cases = { '127.0.0.1': 'private', '10.0.0.1': 'private', '172.16.0.1': 'private', '172.31.255.255': 'private', '192.168.0.1': 'private',
      '100.64.1.1': 'private', '169.254.169.254': 'always', '169.254.10.10': 'always', '0.0.0.0': 'always', '224.0.0.5': 'always',
      '::1': 'private', 'fe80::1': 'always', 'fd00::1': 'private', '::ffff:169.254.169.254': 'always', '::ffff:10.0.0.1': 'private',
      '8.8.8.8': 'public', '172.32.0.1': 'public', '2606:4700::1111': 'public' };
    const bad = Object.entries(cases).filter(([ip, want]) => guard.classify(ip) !== want);
    if (bad.length) throw new Error(bad.map(([ip, w]) => ip + ' → ' + guard.classify(ip) + ' (want ' + w + ')').join('; '));
    return Object.keys(cases).length + ' addresses';
  });

  await t.step('the checks: scheme, exact host, private, metadata, credentials in the URL', async () => {
    const r = async (u, p) => (await guard.check(u, p)).reason || 'ok';
    const got = {
      http_public: await r('http://8.8.8.8/x', { hosts: ['8.8.8.8'] }),
      foreign_host: await r('https://8.8.8.8/x', { hosts: ['1.1.1.1'] }),
      loopback: await r('https://127.0.0.1/x', { hosts: ['127.0.0.1'] }),
      localhost: await r('https://localhost/x', { hosts: ['localhost'] }),
      metadata: await r('https://169.254.169.254/latest/meta-data', { hosts: ['169.254.169.254'], allowPrivate: true }),
      creds: await r('https://u:p@8.8.8.8/', { hosts: ['8.8.8.8'] }),
      ftp: await r('ftp://8.8.8.8/', { hosts: ['8.8.8.8'] }),
      own_model_http: await r('http://127.0.0.1:11434/v1', { hosts: ['127.0.0.1'], allowPrivate: true, allowHttp: true }),
      own_model_public_http: await r('http://8.8.8.8/v1', { hosts: ['8.8.8.8'], allowPrivate: true, allowHttp: true }),
    };
    const want = { http_public: 'scheme', foreign_host: 'host_not_approved', loopback: 'private_address', localhost: 'private_address', metadata: 'blocked_address',
      creds: 'credentials_in_url', ftp: 'scheme', own_model_http: 'ok', own_model_public_http: 'scheme' };
    const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
    if (bad.length) throw new Error(bad.map((k) => k + ': ' + got[k]).join('; '));
    return JSON.stringify(got);
  });

  await t.step('a public-looking name that resolves to a private address is refused', async () => {
    const real = dns.lookup;
    dns.lookup = (h, o, cb) => { if (typeof o === 'function') cb = o; if (h === 'api.evil.test') return cb(null, [{ address: '10.1.2.3', family: 4 }]); return real(h, o, cb); };
    try {
      const a = await guard.check('https://api.evil.test/x', { hosts: ['api.evil.test'] });
      dns.lookup = (h, o, cb) => { if (typeof o === 'function') cb = o; return cb(null, [{ address: '169.254.169.254', family: 4 }]); };
      const b = await guard.check('https://meta.evil.test/x', { hosts: ['meta.evil.test'], allowPrivate: true });
      if (a.reason !== 'private_address' || b.reason !== 'blocked_address') throw new Error(a.reason + ' / ' + b.reason);
      return 'api.evil.test → 10.1.2.3: refused; a name answering 169.254.169.254: refused even for the own-model policy';
    } finally { dns.lookup = real; }
  });

  await t.step('the connection goes to the address that was checked (pinned), not a fresh lookup', async () => {
    let hits = 0;
    const s = await listen((req, res) => { hits++; res.end(JSON.stringify({ host: req.headers.host })); });
    const port = s.address().port;
    /* "pinned.test" resolves nowhere; the checked address says 127.0.0.1 */
    const checked = { ok: true, url: new URL('http://pinned.test:' + port + '/x'), address: '127.0.0.1', family: 4 };
    const body = await new Promise((resolve, reject) => {
      const req = guard.request(checked, { method: 'GET' }, (res) => { let d = ''; res.on('data', (c) => d += c); res.on('end', () => resolve(d)); });
      req.on('error', reject); req.end();
    });
    s.close();
    if (hits !== 1 || !/pinned\.test/.test(body)) throw new Error(hits + ' ' + body);
    return 'connected to 127.0.0.1 for pinned.test (Host header kept), no DNS lookup';
  });

  await t.step('a redirect is never followed: the server the 302 points at hears nothing', async () => {
    let finalHits = 0;
    const target = await listen((req, res) => { finalHits++; res.end('{}'); });
    const first = await listen((req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1:' + target.address().port + '/stolen' }); res.end(); });
    const chk = await guard.check('http://127.0.0.1:' + first.address().port + '/v1/models', { hosts: ['127.0.0.1'], allowPrivate: true, allowHttp: true });
    const status = await new Promise((resolve, reject) => {
      const req = guard.request(chk, { method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    await new Promise((r) => setTimeout(r, 200));
    first.close(); target.close();
    if (status !== 302 || finalHits !== 0) throw new Error(status + ' / ' + finalHits);
    return '302 returned as it is; the redirect target received 0 requests';
  });

  /* Through the server itself: the firm's own model connector. */
  const srv = await t.startServer({});
  const admin = await srv.admin();
  await t.step('the own-model connector: its saved private address works; a metadata address and a redirect do not', async () => {
    let modelHits = 0, stolen = 0;
    const model = await listen((req, res) => { modelHits++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'mock-model' }] })); });
    const thief = await listen((req, res) => { stolen++; res.end('{}'); });
    const bouncer = await listen((req, res) => { res.writeHead(302, { Location: 'http://127.0.0.1:' + thief.address().port + '/v1/models' }); res.end(); });
    const set = async (baseUrl) => admin.put('/api/connections/bossai', { enabled: true, config: { baseUrl, model: 'mock-model' } });
    await set('http://127.0.0.1:' + model.address().port + '/v1');
    const ok = await admin.post('/api/connections/bossai/test', {});
    await set('http://169.254.169.254/v1');
    const meta = await admin.post('/api/connections/bossai/test', {});
    await set('http://127.0.0.1:' + bouncer.address().port + '/v1');
    const bounced = await admin.post('/api/connections/bossai/test', {});
    await new Promise((r) => setTimeout(r, 200));
    model.close(); thief.close(); bouncer.close();
    if (!ok.json.ok || modelHits < 1 || meta.json.ok || !/link-local|metadata|reserved/i.test(meta.json.message) || bounced.json.ok || stolen !== 0)
      throw new Error(JSON.stringify({ ok: ok.json.message, meta: meta.json.message, bounced: bounced.json.message, stolen }));
    return 'saved 127.0.0.1 model: Connected; 169.254.169.254: refused; a 302 to another server: not followed (0 requests there)';
  });
});

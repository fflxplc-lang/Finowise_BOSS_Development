/* PHASE 1 SECURITY SUITES: HTTP AS A REAL PERSON, NOT AS THE PAGE.

   The page's own checks are not what these suites test: the server's are.
   So a suite signs in over HTTP as several different accounts and calls
   the API the way anyone with a browser console could. It prints the same
   lines every suite prints (ok / FAIL, then ALL CLEAN or N PROBLEM(S)), so
   run.sh and parallel.sh read it unchanged.

     const {secSuite} = require('../lib/sec-http');
     secSuite(async t => {
       const admin = await t.admin();                 // the runner's server (report mode)
       const srv = await t.startServer({CRM_ACCESS_MODE:'enforce'});   // a second one, its own data
       const a2 = await srv.admin();
       await t.step('what must hold', async () => { ...; return 'what was seen'; });
     });

   A second server is started from this checkout on a port of its own
   (the runner's port + 500) with an empty data folder in the system temp
   directory, and stopped when the suite ends. Synthetic data only. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const PORT = Number(process.env.BOSS_PORT || 3000);
const BASE = 'http://localhost:' + PORT;
const ROOT = path.join(__dirname, '..', '..');
const signIn = require('./signin');

async function login(email, password, base) {
  base = base || BASE;
  const body = new URLSearchParams({ email, password, next: '/' }).toString();
  const res = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => c.split(';')[0]);
  const session = cookies.find((c) => /^finowise_session=/.test(c));
  if (!session) throw new Error('could not sign in as ' + email + ' (HTTP ' + res.status + ')');
  const cfg = await (await fetch(base + '/config.js', { headers: { Cookie: session } })).text();
  const key = (/CRM_API_KEY = "([^"]*)"/.exec(cfg) || [])[1] || '';
  return client(session, key, email, base);
}

function client(cookie, apiKey, email, base) {
  base = base || BASE;
  async function call(method, p, body, extra) {
    const headers = Object.assign({}, cookie ? { Cookie: cookie } : {}, apiKey ? { 'X-API-Key': apiKey } : {}, extra || {});
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + p, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { json = null; }
    return { status: res.status, json, text };
  }
  return {
    email, cookie, apiKey, base, call,
    get: (p, x) => call('GET', p, undefined, x),
    put: (p, b, x) => call('PUT', p, b, x),
    post: (p, b, x) => call('POST', p, b, x),
    del: (p, x) => call('DELETE', p, undefined, x),
    /* A store, as the page reads it: the JSON value, or the fallback. */
    async store(key, fallback) {
      const r = await call('GET', '/api/storage/' + encodeURIComponent(key));
      if (r.status === 404) return fallback;
      if (r.status !== 200) throw new Error('GET ' + key + ' → ' + r.status);
      return JSON.parse(r.json.value);
    },
    /* A store written whole, as the page's sset() writes it. */
    async save(key, value, extra) { return call('PUT', '/api/storage/' + encodeURIComponent(key), { value: JSON.stringify(value) }, extra); },
  };
}

/* An account for a team member, made the way the CRM makes one. */
async function account(admin, memberId, email, password, opts) {
  const r = await admin.post('/api/users/sync', Object.assign({ memberId, email, password, crmRole: '' }, opts || {}));
  if (!r.json || !r.json.ok) throw new Error('could not create the account for ' + memberId + ': ' + r.text.slice(0, 200));
  return login(email, password, admin.base);
}

const started = [];
/* opts.dir: start on an existing data folder (a restart), keeping its accounts. */
async function startServer(env, opts) {
  const port = PORT + 500 + started.length;
  const dir = (opts && opts.dir) || fs.mkdtempSync(path.join(os.tmpdir(), 'sec-srv-'));
  const base = 'http://localhost:' + port;
  const usersDb = path.join(dir, 'users.db');
  const run = (args) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'user.js')].concat(args),
    { cwd: ROOT, env: Object.assign({}, process.env, { CRM_USERS_DB: usersDb }), stdio: 'ignore' });
  if (!(opts && opts.dir)) { run(['add', signIn.EMAIL, signIn.PASSWORD]); run(['role', signIn.EMAIL, 'admin']); }
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    /* A server a suite starts runs in the mode the suite asks for, report
       when it names none, whatever mode the runner itself was started in. */
    env: Object.assign({}, process.env, { CRM_ACCESS_MODE: 'report' }, env || {}, { PORT: String(port), CRM_DB_FILE: path.join(dir, 'data.json'),
      CRM_USERS_DB: usersDb, CRM_CONNECTIONS_FILE: path.join(dir, 'connections.json'), CRM_REMINDERS: 'manual',
      CRM_BUSINESS_TZ: 'UTC', CRM_PIN_LOOKUP_URL: 'http://127.0.0.1:9/', CRM_IFSC_LOOKUP_URL: 'http://127.0.0.1:9/' }) });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const srv = { base, dir, port, child, log: () => log,
    admin: () => login(signIn.EMAIL, signIn.PASSWORD, base),
    login: (e, p) => login(e, p, base),
    account: (admin, ...a) => account(admin, ...a),
    /* A child stopped by a signal has signalCode set and exitCode null: either means it is gone. */
    stop: () => new Promise((r) => { if (child.exitCode !== null || child.signalCode !== null) return r(); child.once('exit', () => r()); child.kill(); }) };
  started.push(srv);
  for (let i = 0; i < 150; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return srv; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the second server on ' + port + ' never answered: ' + log.slice(-400));
}

function secSuite(body) {
  const errors = [];
  const t = {
    base: BASE,
    anonymous: () => client('', '', '', BASE),
    admin: () => login(signIn.EMAIL, signIn.PASSWORD, BASE),
    login: (e, p) => login(e, p, BASE),
    account,
    startServer,
    async step(name, fn) {
      try {
        const note = await fn();
        console.log('ok    ' + name + (note ? '  — ' + note : ''));
      } catch (e) {
        const msg = 'FAIL  ' + name + ' — ' + (e && e.message ? e.message : String(e));
        console.log(msg); errors.push(msg);
      }
    },
  };
  (async () => {
    /* The runner's own server is in whatever mode the run uses. A security
       suite tests both modes on servers of its own, and its report-mode
       steps use the runner's server; when the run is in enforce mode those
       steps get a report-mode server of their own instead (step 6b). */
    if (process.env.CRM_ACCESS_MODE === 'enforce') {
      try {
        const own = await startServer({ CRM_ACCESS_MODE: 'report' });
        t.base = own.base;
        t.anonymous = () => client('', '', '', own.base);
        t.admin = own.admin;
        t.login = own.login;
      } catch (e) { errors.push('SUITE CRASHED  could not start its report-mode server: ' + e.message); }
    }
    try { await body(t); }
    catch (e) { const msg = 'SUITE CRASHED  ' + (e && e.stack || e); console.log(msg); errors.push(msg); }
    for (const s of started) {
      await s.stop();
      try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) { /* temp folder */ }
    }
    if (errors.length) { console.log('\n' + errors.length + ' PROBLEM(S):\n' + errors.join('\n')); process.exitCode = 1; }
    else console.log('\nALL CLEAN');
  })();
}

module.exports = { secSuite, login, account, startServer, BASE };

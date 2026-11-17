/* PHASE 1 SECURITY SUITES: HTTP AS A REAL PERSON, NOT AS THE PAGE.

   The page's own checks are not what these suites test: the server's are.
   So a suite signs in over HTTP as several different accounts and calls
   the API the way anyone with a browser console could. It prints the same
   lines every suite prints (ok / FAIL, then ALL CLEAN or N PROBLEM(S)), so
   run.sh and parallel.sh read it unchanged.

     const {secSuite} = require('../lib/sec-http');
     secSuite(async t => {
       const admin = await t.admin();
       await t.step('what must hold', async () => { ...; return 'what was seen'; });
     });
*/
const PORT = Number(process.env.BOSS_PORT || 3000);
const BASE = 'http://localhost:' + PORT;
const signIn = require('./signin');

async function login(email, password) {
  const body = new URLSearchParams({ email, password, next: '/' }).toString();
  const res = await fetch(BASE + '/login', { method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const cookies = (res.headers.getSetCookie ? res.headers.getSetCookie() : []).map((c) => c.split(';')[0]);
  const session = cookies.find((c) => /^finowise_session=/.test(c));
  if (!session) throw new Error('could not sign in as ' + email + ' (HTTP ' + res.status + ')');
  const cfg = await (await fetch(BASE + '/config.js', { headers: { Cookie: session } })).text();
  const key = (/CRM_API_KEY = "([^"]*)"/.exec(cfg) || [])[1] || '';
  return client(session, key, email);
}

function client(cookie, apiKey, email) {
  async function call(method, path, body, extra) {
    const headers = Object.assign({}, cookie ? { Cookie: cookie } : {}, apiKey ? { 'X-API-Key': apiKey } : {}, extra || {});
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (e) { json = null; }
    return { status: res.status, json, text };
  }
  return {
    email, cookie, apiKey, call,
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

function secSuite(body) {
  const errors = [];
  const t = {
    base: BASE,
    anonymous: () => client('', '', ''),
    admin: () => login(signIn.EMAIL, signIn.PASSWORD),
    login,
    /* An account for a team member, made the way the CRM makes one. */
    async account(admin, memberId, email, password, opts) {
      const r = await admin.post('/api/users/sync', Object.assign({ memberId, email, password, crmRole: '' }, opts || {}));
      if (!r.json || !r.json.ok) throw new Error('could not create the account for ' + memberId + ': ' + r.text.slice(0, 200));
      return login(email, password);
    },
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
    try { await body(t); }
    catch (e) { const msg = 'SUITE CRASHED  ' + (e && e.stack || e); console.log(msg); errors.push(msg); }
    if (errors.length) { console.log('\n' + errors.length + ' PROBLEM(S):\n' + errors.join('\n')); process.exitCode = 1; }
    else console.log('\nALL CLEAN');
  })();
}

module.exports = { secSuite, login, BASE };

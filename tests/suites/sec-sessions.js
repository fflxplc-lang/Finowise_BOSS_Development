/* SIGN-IN SESSIONS — PHASE 1, STEP 5 (enforced in every mode).

   The cookie is an opaque id for a row in users.db. Checked here:
     - with an injected clock (sessions.js itself): 30 minutes idle ends a
       session, only touch() (real activity) extends it, the warning is at
       25 minutes, 12 hours is the limit however busy, an account change
       (password, role, CRM role, email, team link, deactivation, removal)
       ends it, a 2FA switch or a sign-in stamp does not, the table holds
       hashes and never the cookie;
     - through the server, with the limits shortened (CRM_IDLE_MINUTES,
       CRM_SESSION_MAX_HOURS): saves, the HR heartbeat's save, live sync
       and the status check do not extend a session; the activity ping
       does; the absolute limit holds; sign-out, a password reset, a role
       change, deactivation, "sign out everywhere" and a change made with
       scripts/user.js on the server all end it; a cookie in the old HMAC
       form, a forged one and a reused one are refused;
     - signing in again in place (/login/json): wrong password, another
       account, the attempt limit;
     - every session event is in the audit trail, and no password or
       cookie is in it or in the server log. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const sessionsLib = require('../../sessions');
const ROOT = path.join(__dirname, '..', '..');
const MIN = 60000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

secSuite(async (t) => {
  /* ---- sessions.js with a clock the test moves ---- */
  const db = new DatabaseSync(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sess-')), 'u.db'));
  let clock = Date.UTC(2026, 10, 17, 9, 0, 0);
  const S = sessionsLib.create({ db, now: () => clock });
  const user = { id: 7, email: 'rm@x.test', password_hash: 'salt:hash', role: 'user', crm_role: 'RM', active: 1, member_id: 'U-7', two_factor: 0 };
  const find = (over) => () => Object.assign({}, user, over || {});

  await t.step('30 minutes without activity ends a session; only activity extends it; warning at 25', async () => {
    const tok = S.issue(user, 'ua');
    const start = clock;
    clock = start + 29 * MIN + 59000; const a = S.check(tok, find());
    clock = start + 30 * MIN; const b = S.check(tok, find());
    const tok2 = S.issue(user, 'ua'); const s2 = clock;
    clock = s2 + 20 * MIN; const c = S.check(tok2, find()); S.touch(c);
    clock = s2 + 49 * MIN; const d = S.check(tok2, find());
    clock = s2 + 50 * MIN; const e = S.check(tok2, find());
    if (!a.ok || b.ok || b.reason !== 'idle' || !d.ok || e.ok || e.reason !== 'idle' || a.status.idleLeftMs !== 1000 || S.warnBeforeMs !== 5 * MIN)
      throw new Error(JSON.stringify({ a: a.ok, b: b.reason, d: d.ok, e: e.reason, left: a.status && a.status.idleLeftMs, warn: S.warnBeforeMs }));
    return 'ok at 29:59 (1 s left), ended at 30:00; touched at 20:00 → ok at 49:00, ended at 50:00; warning 5 min before (at 25)';
  });

  await t.step('12 hours is the limit however busy; activity is written at most once a minute', async () => {
    const tok = S.issue(user, 'ua'); const start = clock;
    let writes = 0, last = 0, ended = null;
    for (let m = 0; m <= 12 * 60; m += 0.5) {
      clock = start + m * MIN;
      const c = S.check(tok, find());
      if (!c.ok) { ended = { at: m, reason: c.reason }; break; }
      S.touch(c);
      const row = db.prepare('SELECT last_seen_at FROM sessions WHERE user_id = 7 ORDER BY created_at DESC LIMIT 1').get();
      if (row.last_seen_at !== last) { writes++; last = row.last_seen_at; }
    }
    if (!ended || ended.at !== 720 || ended.reason !== 'expired' || writes > 721) throw new Error(JSON.stringify({ ended, writes }));
    return 'active every 30 s, ended at 12:00 (expired); ' + writes + ' writes for 1,440 pings';
  });

  await t.step('an account change ends a session; a 2FA switch or a sign-in stamp does not', async () => {
    const cases = { password: { password_hash: 'salt:other' }, role: { role: 'admin' }, crmRole: { crm_role: 'Manager' },
      email: { email: 'new@x.test' }, member: { member_id: 'U-8' }, deactivated: { active: 0 } };
    const got = {};
    for (const [k, over] of Object.entries(cases)) { const tok = S.issue(user, 'ua'); got[k] = S.check(tok, find(over)).reason; }
    const tokG = S.issue(user, 'ua'); got.gone = S.check(tokG, () => undefined).reason;
    const tokF = S.issue(user, 'ua'); const fine = S.check(tokF, find({ two_factor: 1, last_login_at: 'now', issued_password: null })).ok;
    const want = { password: 'account_changed', role: 'account_changed', crmRole: 'account_changed', email: 'account_changed', member: 'account_changed',
      deactivated: 'deactivated', gone: 'account_removed' };
    const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
    if (bad.length || !fine) throw new Error(JSON.stringify(got) + ' fine=' + fine);
    return Object.keys(want).map((k) => k + '→' + got[k]).join(', ') + '; 2FA/sign-in stamp: still signed in';
  });

  await t.step('the table holds hashes, never the cookie; a closed session cannot come back', async () => {
    const tok = S.issue(user, 'ua');
    const rows = db.prepare('SELECT * FROM sessions').all();
    const leak = rows.some((r) => Object.values(r).some((v) => String(v).includes(tok)));
    const c = S.check(tok, find({ active: 0 })); S.close(c.row, c.reason);
    const again = S.check(tok, find());                       // reactivated: the old session stays closed
    if (leak || again.ok || again.reason !== 'deactivated') throw new Error(leak + ' ' + JSON.stringify(again));
    return rows.length + ' rows, none containing a cookie; deactivated then reactivated → still closed (' + again.reason + ')';
  });

  /* ---- through the server: idle 3 s, limit 9 s ---- */
  const env = { CRM_IDLE_MINUTES: '0.05', CRM_SESSION_MAX_HOURS: '0.0025' };
  const srv = await t.startServer(env);
  const data = seed.build(10);
  await seed.load(await srv.admin(), data);
  /* With a 3-second idle limit, the administrator signs in afresh for each step. */
  let admin;
  const ok = async (c) => (await c.get('/api/session')).status;

  await t.step('saves, the HR heartbeat save, live sync and status checks do not extend a session', async () => {
    admin = await srv.admin();
    const rm = await seed.signIn(admin, 'U-RMA');
    const until = Date.now() + 4200;
    let calls = 0;
    while (Date.now() < until) {
      await rm.put('/api/storage/zzHeartbeat', { value: JSON.stringify([{ id: 'b' + calls, at: Date.now() }]) });   // what the 30-second HR beat does: a save
      await rm.get('/api/changes?since=0'); await rm.get('/api/session');
      calls += 3; await sleep(250);
    }
    const r = await rm.get('/api/storage/team');
    if (r.status !== 401 || r.json.session !== 'idle') throw new Error(r.status + ' ' + r.text.slice(0, 120));
    return calls + ' background requests in 4.2 s; then 401 (idle) — none of them counted';
  });

  await t.step('the activity ping keeps it going; the absolute limit still ends it', async () => {
    admin = await srv.admin();
    const rm = await seed.signIn(admin, 'U-RMB');
    const t0 = Date.now();
    let first401 = 0;
    while (Date.now() - t0 < 11000) {
      const r = await rm.post('/api/session/activity', {});
      if (r.status === 401) { first401 = Date.now() - t0; var why = r.json.session; break; }
      await sleep(700);
    }
    if (!first401 || first401 < 7000 || first401 > 10500 || why !== 'expired') throw new Error(first401 + ' ' + why);
    return 'pinging every 0.7 s: still signed in past the 3 s idle limit, ended at ' + (first401 / 1000).toFixed(1) + ' s (expired, limit 9 s)';
  });

  await t.step('sign-out ends that session on the server; the same cookie used again is refused', async () => {
    admin = await srv.admin();
    const a = await seed.signIn(admin, 'U-TL');
    const other = await srv.login(seed.email('U-TL'), 'Passw0rd-u-tl');     // a second window
    await fetch(srv.base + '/logout', { headers: { Cookie: a.cookie }, redirect: 'manual' });
    const reuse = await a.get('/api/session'); const still = await ok(other);
    if (reuse.status !== 401 || reuse.json.session !== 'signed_out' || still !== 200) throw new Error(reuse.status + ' ' + still);
    return 'reused cookie 401 (signed_out); the other window still 200';
  });

  await t.step('password reset, role change, deactivation and "sign out everywhere" end sessions at once', async () => {
    admin = await srv.admin();
    const got = {};
    let c = await seed.signIn(admin, 'U-EXEC');
    await admin.post('/api/users/U-EXEC/password', {});
    got.password = (await c.get('/api/session')).json.session;
    const pw = (r) => r.json.password;
    const fresh = await admin.post('/api/users/U-EXEC/password', {});
    c = await srv.login(seed.email('U-EXEC'), pw(fresh));
    await admin.post('/api/users/sync', { memberId: 'U-EXEC', email: seed.email('U-EXEC'), crmRole: 'Manager' });
    got.role = (await c.get('/api/session')).json.session;
    c = await srv.login(seed.email('U-EXEC'), pw(fresh));
    await admin.post('/api/users/sync', { memberId: 'U-EXEC', email: seed.email('U-EXEC'), crmRole: 'Manager', active: false });
    got.deactivated = (await c.get('/api/session')).json.session;
    const d = await seed.signIn(admin, 'U-OPS'); const d2 = await srv.login(seed.email('U-OPS'), 'Passw0rd-u-ops');
    const rv = await admin.post('/api/users/U-OPS/sessions/revoke', {});
    got.everywhere = [(await d.get('/api/session')).json.session, (await d2.get('/api/session')).json.session].join('+');
    const want = { password: 'password_changed', role: 'account_changed', deactivated: 'deactivated', everywhere: 'revoked_by_admin+revoked_by_admin' };
    if (Object.keys(want).some((k) => got[k] !== want[k]) || rv.json.ended !== 2) throw new Error(JSON.stringify(got) + ' ' + rv.text);
    return JSON.stringify(got) + '; admin ended ' + rv.json.ended + ' sessions';
  });

  await t.step('a change made on the server with scripts/user.js ends the session too', async () => {
    admin = await srv.admin();
    const c = await seed.signIn(admin, 'U-RMA');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'user.js'), 'passwd', seed.email('U-RMA'), 'Changed-pass-123'],
      { cwd: ROOT, env: Object.assign({}, process.env, { CRM_USERS_DB: path.join(srv.dir, 'users.db') }), stdio: 'ignore' });
    const r = await c.get('/api/session');
    if (r.status !== 401 || r.json.session !== 'account_changed') throw new Error(r.status + ' ' + r.text);
    return '401 (account_changed) at the next request';
  });

  await t.step('an old HMAC cookie, a forged one and garbage are refused', async () => {
    const tries = ['finowise_session=1.99999999999999.' + 'a'.repeat(64), 'finowise_session=' + 'A'.repeat(43), 'finowise_session=../../etc'];
    const st = [];
    for (const ck of tries) { const r = await fetch(srv.base + '/api/storage/team', { headers: { Cookie: ck } }); st.push(r.status + ':' + r.headers.get('x-crm-session')); }
    const page = await fetch(srv.base + '/', { headers: { Cookie: tries[0] }, redirect: 'manual' });
    if (st.some((s) => s !== '401:ended') || page.status !== 302 || !/\/login/.test(page.headers.get('location'))) throw new Error(st.join(',') + ' ' + page.status);
    return st.join(', ') + '; the page itself redirects to sign-in (one forced re-login after deploy)';
  });

  await t.step('signing in again in place: wrong password refused, another account refused, right one works', async () => {
    admin = await srv.admin();
    const post = (b) => fetch(srv.base + '/login/json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    const wrong = await post({ email: seed.email('U-TL'), password: 'nope', expect: seed.email('U-TL') });
    const other = await post({ email: seed.email('U-TL'), password: 'Passw0rd-u-tl', expect: seed.email('U-RMB') });
    const right = await post({ email: seed.email('U-TL'), password: 'Passw0rd-u-tl', expect: seed.email('U-TL') });
    const ck = (right.headers.getSetCookie() || []).map((c) => c.split(';')[0]).find((c) => /^finowise_session=/.test(c));
    const otherCk = (other.headers.getSetCookie() || []).some((c) => /^finowise_session=/.test(c));
    const works = ck ? (await fetch(srv.base + '/api/session', { headers: { Cookie: ck } })).status : 0;
    if (wrong.status !== 401 || other.status !== 409 || otherCk || right.status !== 200 || works !== 200) throw new Error([wrong.status, other.status, otherCk, right.status, works].join(','));
    return 'wrong 401; another account 409 with no cookie; right 200 and the new cookie works';
  });

  await t.step('the attempt limit applies to signing in again in place', async () => {
    const lim = await t.startServer({});
    const st = [];
    for (let i = 0; i < 9; i++) st.push((await fetch(lim.base + '/login/json', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@x.test', password: 'x' + i }) })).status);
    await lim.stop();
    if (st.slice(0, 8).some((s) => s !== 401) || st[8] !== 429) throw new Error(st.join(','));
    return st.join(',');
  });

  await t.step('every session event is audited; no password or cookie in the audit trail or the log', async () => {
    const auditDir = path.join(srv.dir, 'audit');
    const audit = fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), 'utf8')).join('');
    const kinds = ['session.start', 'session.signout', 'session.end', 'session.revoke', 'session.signin', 'account.change'];
    const missing = kinds.filter((k) => !audit.includes('"' + k + '"'));
    const reasons = ['idle', 'expired', 'password_changed', 'deactivated', 'account_changed', 'wrong_password'].filter((r) => !audit.includes('"reason":"' + r));
    const leaks = ['Passw0rd-', 'Changed-pass-123', 'nope', 'finowise_session='].filter((x) => audit.includes(x) || srv.log().includes(x));
    if (missing.length || reasons.length || leaks.length) throw new Error('missing ' + missing + ' / ' + reasons + '; leaks ' + leaks);
    return kinds.length + ' kinds of session line, with reasons; nothing secret in them or in the log';
  });
  db.close();
});

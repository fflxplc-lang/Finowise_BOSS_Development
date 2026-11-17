/* SERVER SESSIONS — PHASE 1, STEP 5.

   The sign-in cookie used to be "<user>.<expiry>.<hmac>": valid for seven
   days wherever it went, with nothing on the server that could end it
   before then. Signing out only asked the browser to forget it.

   Now the cookie is an opaque random id (32 bytes). The server keeps one
   row per session in users.db, keyed by the SHA-256 of that id, so the
   table on its own cannot be used to sign in. A session ends when:

     - nobody has done anything for IDLE (30 minutes). Only a request the
       browser makes because a person did something counts — the page's
       activity ping, sent at most once a minute after real keyboard,
       mouse or touch input. Heartbeats, saves, live sync, drips and
       scheduled syncs never extend a session, so a tab left open on an
       empty desk still ends;
     - it reaches its absolute limit (12 hours from sign-in), however busy;
     - the person signs out (that session), or
     - the account changes underneath it: its password, its role (sign-in
       role or CRM role), its email or team link, or it is deactivated or
       deleted. Each session row carries a fingerprint of those fields as
       they were at sign-in; any difference ends it at the next request,
       whichever way the change was made (the CRM, the users page, or
       scripts/user.js on the server);
     - an administrator ends all of somebody's sessions.

   There is no exemption for unattended screens (decision QC-2).

   The clock is injectable (opts.now) so the limits can be tested without
   waiting half an hour. No secret is read or written here:
   CRM_SESSION_SECRET and CRM_AADHAAR_KEY are untouched. */
'use strict';
const crypto = require('crypto');

const MIN = 60 * 1000;

function create(opts) {
  const db = opts.db;
  const now = opts.now || Date.now;
  const idleMs = Math.max(1000, opts.idleMs || 30 * MIN);
  const maxMs = Math.max(idleMs, opts.maxMs || 12 * 60 * MIN);
  /* The warning comes five minutes before the idle limit (at 25 of 30);
     a shorter limit, as in tests, keeps the same proportion. */
  const warnBeforeMs = opts.warnBeforeMs || (idleMs >= 10 * MIN ? 5 * MIN : Math.round(idleMs / 6));
  /* last_seen_at is written at most once a minute per session (or a tenth
     of the idle limit when that is shorter), not on every ping. */
  const touchEveryMs = Math.min(MIN, Math.round(idleMs / 10));

  db.exec(`CREATE TABLE IF NOT EXISTS sessions (
    id             TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL,
    created_at     INTEGER NOT NULL,
    last_seen_at   INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    revoked_at     INTEGER,
    revoked_reason TEXT,
    fp             TEXT NOT NULL,
    ua_hash        TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id)');

  const sql = {
    insert: db.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, fp, ua_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    get: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    touch: db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND revoked_at IS NULL'),
    revoke: db.prepare('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE id = ? AND revoked_at IS NULL'),
    revokeUser: db.prepare('UPDATE sessions SET revoked_at = ?, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL AND id <> ?'),
    activeOf: db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? AND last_seen_at > ?'),
    sweep: db.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?) OR last_seen_at < ?'),
  };

  const hashId = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
  /* What a session depends on. A change to any of these ends it. */
  function fingerprint(user) {
    return crypto.createHash('sha256').update(JSON.stringify([
      String(user.email || '').toLowerCase(), user.password_hash || '', user.role || '', user.crm_role || '',
      user.active === 0 ? 0 : 1, user.member_id || '',
    ])).digest('hex');
  }

  /* A new session for an account that has just proved who it is. Returns
     the cookie value; only its hash is stored. */
  function issue(user, userAgent) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = now();
    sql.insert.run(hashId(token), user.id, t, t, t + maxMs, fingerprint(user),
      userAgent ? crypto.createHash('sha256').update(String(userAgent)).digest('hex').slice(0, 16) : null);
    return token;
  }

  /* Who a cookie belongs to, or why it no longer counts. Never extends
     the session: that is touch(), and only for real activity. */
  function check(token, findUser) {
    if (!token || typeof token !== 'string' || token.length < 40 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token))
      return { ok: false, reason: token ? 'unknown' : 'none' };
    const id = hashId(token);
    const row = sql.get.get(id);
    if (!row) return { ok: false, reason: 'unknown' };
    const t = now();
    if (row.revoked_at) return { ok: false, reason: row.revoked_reason || 'revoked', row };
    if (t >= row.expires_at) return { ok: false, reason: 'expired', row, end: true };
    if (t - row.last_seen_at >= idleMs) return { ok: false, reason: 'idle', row, end: true };
    const user = findUser(row.user_id);
    if (!user) return { ok: false, reason: 'account_removed', row, end: true };
    if (user.active === 0) return { ok: false, reason: 'deactivated', row, end: true };
    if (fingerprint(user) !== row.fp) return { ok: false, reason: 'account_changed', row, end: true };
    return { ok: true, id, row, user, status: statusOf(row, t) };
  }

  /* A session found to have ended is closed for good, so a clock moved
     back, or a later account change undone, cannot revive it. */
  function close(row, reason) {
    if (row && !row.revoked_at) sql.revoke.run(now(), reason, row.id);
  }

  function statusOf(row, t) {
    const idleLeftMs = Math.max(0, row.last_seen_at + idleMs - t);
    const absLeftMs = Math.max(0, row.expires_at - t);
    return { idleLeftMs, absLeftMs, idleMs, maxMs, warnBeforeMs, lastSeenAt: row.last_seen_at, expiresAt: row.expires_at };
  }

  /* Real activity. Writes at most once per touchEveryMs. */
  function touch(checked) {
    const t = now();
    if (t - checked.row.last_seen_at >= touchEveryMs) {
      sql.touch.run(t, checked.id);
      checked.row = Object.assign({}, checked.row, { last_seen_at: t });
    }
    return statusOf(checked.row, t);
  }

  function revoke(token, reason) {
    if (!token) return false;
    return sql.revoke.run(now(), reason || 'signed_out', hashId(token)).changes > 0;
  }
  /* Every session of an account, except optionally the one making the
     request (an administrator ending their own other sessions). */
  function revokeUser(userId, reason, exceptToken) {
    return sql.revokeUser.run(now(), reason || 'revoked', userId, exceptToken ? hashId(exceptToken) : '').changes;
  }
  function activeCount(userId) {
    const t = now();
    return sql.activeOf.get(userId, t, t - idleMs).n;
  }
  /* Rows that can never be used again are kept a week for the record,
     then removed. */
  function sweep() {
    const old = now() - 7 * 24 * 60 * MIN;
    return sql.sweep.run(old, old, old).changes;
  }

  return { issue, check, close, touch, revoke, revokeUser, activeCount, sweep, fingerprint, statusOf,
    idleMs, maxMs, warnBeforeMs, touchEveryMs };
}

module.exports = { create };

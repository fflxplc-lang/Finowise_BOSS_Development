#!/usr/bin/env node
/* PHASE 1 CENSUS — COUNTS ONLY.

   For the TEST server, before and during the seven report-only days:
   how the sign-in accounts and the team records line up, how big the
   stores are, how many sessions are open, and what the audit trail says
   would have been refused. It prints numbers and store/action names only:
   never a name, email, id, PAN, phone number, secret or record content.

   It only reads. It opens users.db read-only, never writes data.json,
   and needs no secret. Run it on the server as the app's user:

     node scripts/phase1-census.js                    (paths as the server finds them)
     node scripts/phase1-census.js --days 7           (audit summary for the last 7 days)
     node scripts/phase1-census.js --json             (machine-readable)

   Paths follow the server's own settings: CRM_DB_FILE, CRM_USERS_DB, and
   the audit folder beside data.json. */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const DB_FILE = opt('--data', process.env.CRM_DB_FILE || path.join(__dirname, '..', 'data.json'));
const USERS_DB = opt('--users', process.env.CRM_USERS_DB || path.join(path.dirname(DB_FILE), 'users.db'));
const AUDIT_DIR = opt('--audit', path.join(path.dirname(DB_FILE), 'audit'));
const DAYS = Math.max(1, Math.min(90, Number(opt('--days', '7')) || 7));
const ADMIN_ROLE = 'Admin';
const PAN_RE = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;

const out = { generatedAt: new Date().toISOString(), accounts: {}, reconcile: {}, team: {}, stores: {}, clients: {}, sessions: {}, audit: {} };

/* ---- the data file ---- */
let store = {};
try { store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { out.dataFile = 'could not be read (' + (e.code || 'parse error') + ')'; }
const list = (k) => { try { const v = JSON.parse(store[k] || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
const team = list('team').filter((t) => t && t.id && !t.deletedAt);
const clients = list('clients').filter((c) => c && !c.deletedAt);

out.stores.count = Object.keys(store).length;
out.stores.records = {};
Object.keys(store).forEach((k) => {
  let v; try { v = JSON.parse(store[k]); } catch (e) { v = undefined; }
  out.stores.records[k] = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? 'object' : typeof v);
});

const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
out.team.members = team.length;
out.team.byRole = {}; out.team.byScope = {}; out.team.byStatus = {};
team.forEach((t) => { bump(out.team.byRole, t.role || '(none)'); bump(out.team.byScope, t.scope || '(default)'); bump(out.team.byStatus, t.status || 'Active'); });

const teamIds = new Set(team.map((t) => t.id));
const teamNames = new Set(team.map((t) => t.name).filter(Boolean));
out.clients.total = clients.length;
out.clients.withPan = clients.filter((c) => PAN_RE.test(String(c.pan || '').trim())).length;
out.clients.panMaskedInStore = clients.filter((c) => /^X{6}/.test(String(c.pan || ''))).length;      // must be 0
out.clients.withoutRm = clients.filter((c) => !c.rmName).length;
out.clients.rmNotOnTeam = clients.filter((c) => c.rmName && !teamIds.has(c.rmName) && !teamNames.has(c.rmName)).length;
out.clients.withoutBranch = clients.filter((c) => !c.branch).length;

/* ---- accounts, read-only ---- */
let users = [];
try {
  const db = new DatabaseSync(USERS_DB, { readOnly: true });
  users = db.prepare('SELECT * FROM users').all();
  const hasSessions = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get();
  if (hasSessions) {
    const now = Date.now();
    out.sessions.rows = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    out.sessions.open = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE revoked_at IS NULL AND expires_at > ?').get(now).n;
    out.sessions.closedByReason = {};
    db.prepare('SELECT revoked_reason AS r, COUNT(*) AS n FROM sessions WHERE revoked_at IS NOT NULL GROUP BY revoked_reason').all()
      .forEach((x) => { out.sessions.closedByReason[x.r || '(none)'] = x.n; });
  } else out.sessions.note = 'no sessions table yet (Phase 1 step 5 not deployed here)';
  db.close();
} catch (e) { out.accounts.note = 'users.db could not be read (' + (e.code || e.message) + ')'; }

out.accounts.total = users.length;
out.accounts.admins = users.filter((u) => u.role === 'admin').length;
out.accounts.inactive = users.filter((u) => u.active === 0).length;
out.accounts.twoFactor = users.filter((u) => u.two_factor).length;
out.accounts.issuedPasswordPending = users.filter((u) => u.issued_password).length;
out.accounts.issuedPasswordPlainText = users.filter((u) => u.issued_password && !String(u.issued_password).startsWith('enc1:')).length;   // must be 0 after step 3

/* the same five questions as GET /api/access/reconcile, as counts */
const memberOf = (u) => team.find((t) => t.id === u.member_id)
  || team.find((t) => t.email && String(t.email).toLowerCase() === String(u.email || '').toLowerCase()) || null;
const rc = { accountsWithoutMember: 0, teamAdminWithoutAdminAccount: 0, adminAccountWithoutTeamAdmin: 0, scopeAllWithoutAdminAccount: 0, membersWithoutAccount: 0 };
const linked = new Set();
users.forEach((u) => {
  if (u.active === 0) return;
  const m = memberOf(u);
  if (!m) { rc.accountsWithoutMember++; return; }
  linked.add(m.id);
  const teamAdmin = (m.role || '') === ADMIN_ROLE;
  if (teamAdmin && u.role !== 'admin') rc.teamAdminWithoutAdminAccount++;
  if (!teamAdmin && u.role === 'admin') rc.adminAccountWithoutTeamAdmin++;
  if (m.scope === 'all' && u.role !== 'admin') rc.scopeAllWithoutAdminAccount++;
});
team.forEach((t) => { if (!linked.has(t.id) && (t.status || 'Active') === 'Active') rc.membersWithoutAccount++; });
out.reconcile = rc;

/* ---- the audit trail: what report mode would have refused ---- */
const since = Date.now() - DAYS * 24 * 3600 * 1000;
const audit = { days: DAYS, lines: 0, byDay: {}, wouldDeny: {}, denied: {}, sessions: {} };
try {
  fs.readdirSync(AUDIT_DIR).filter((f) => /^\d{4}-\d{2}\.jsonl$/.test(f)).sort().forEach((f) => {
    fs.readFileSync(path.join(AUDIT_DIR, f), 'utf8').split('\n').forEach((line) => {
      if (!line) return;
      let e; try { e = JSON.parse(line); } catch (err) { return; }
      const at = Date.parse(e.at); if (!(at >= since)) return;
      audit.lines++;
      const day = String(e.at).slice(0, 10);
      audit.byDay[day] = audit.byDay[day] || { lines: 0, wouldDeny: 0, denied: 0 };
      audit.byDay[day].lines++;
      /* reasons are fixed codes; anything that is not a short code is counted as "other" */
      const reason = String(e.reason || '').split(/[;,]/)[0].trim();
      const code = /^[a-z_+~\- 0-9]{1,40}$/i.test(reason) ? reason : 'other';
      const key = e.action + ' · ' + (code || '-');
      if (e.outcome === 'would-deny') { audit.byDay[day].wouldDeny++; bump(audit.wouldDeny, key); }
      if (e.outcome === 'deny') { audit.byDay[day].denied++; bump(audit.denied, key); }
      if (/^session\./.test(e.action)) bump(audit.sessions, e.action + ' · ' + (code || e.outcome));
    });
  });
} catch (e) { audit.note = 'no audit folder yet'; }
out.audit = audit;

if (flag('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

const line = (k, v) => console.log('  ' + String(k).padEnd(36) + ' ' + (v && typeof v === 'object' ? JSON.stringify(v) : v));
const table = (o) => Object.entries(o).sort((a, b) => (typeof b[1] === 'number' ? b[1] : 0) - (typeof a[1] === 'number' ? a[1] : 0)).forEach(([k, v]) => line(k, v));
console.log('PHASE 1 CENSUS (counts only) — ' + out.generatedAt);
console.log('\nAccounts'); table(out.accounts);
console.log('\nAccounts vs team (GET /api/access/reconcile, as counts — all 0 before enforcing)'); table(out.reconcile);
console.log('\nTeam'); line('members', out.team.members); line('by role', JSON.stringify(out.team.byRole)); line('by scope', JSON.stringify(out.team.byScope)); line('by status', JSON.stringify(out.team.byStatus));
console.log('\nClients'); table(out.clients);
console.log('\nSessions'); table(out.sessions);
console.log('\nAudit, last ' + DAYS + ' day(s): ' + audit.lines + ' lines' + (audit.note ? ' (' + audit.note + ')' : ''));
Object.keys(audit.byDay).sort().forEach((d) => line(d, audit.byDay[d].lines + ' lines, ' + audit.byDay[d].wouldDeny + ' would-deny, ' + audit.byDay[d].denied + ' refused'));
console.log('\n  would have been refused (report mode):'); if (!Object.keys(audit.wouldDeny).length) line('(none)', ''); table(audit.wouldDeny);
console.log('\n  refused (day-1 rules, or enforce mode):'); if (!Object.keys(audit.denied).length) line('(none)', ''); table(audit.denied);
console.log('\nStores: ' + out.stores.count + ' (record counts with --json)');

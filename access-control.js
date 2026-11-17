'use strict';
/* =====================================================================
   WHO IS ASKING, DECIDED ON THE SERVER  (Phase 1, step 1)

   Until now every rule about who may see or change what lived in the
   page: can(), visibleRecords(), the record door. The server checked
   that somebody was signed in and handed over whatever was asked for.
   Anything the page refused could be done by calling the API directly.

   This file is the server's own copy of those rules, read from the
   server's own copy of the data. It answers three questions:

     principal(user)        who this signed-in account is in the CRM
     can(p, module, action) the page's can(), worked out here
     inScope(p, owner, br)  the page's visibleRecords() for one record

   Two different kinds of "admin" are kept apart on purpose:

     p.admin      the sign-in account's own role in users.db. Only this
                  opens the administrator operations (settings, team
                  permissions, connectors, deleting a store, accounts).
                  Nothing a browser sends can change it.
     p.teamAdmin  the team record says role "Admin". The page treats
                  that as full module access and every record, and so
                  does the server for records (so nobody loses a screen),
                  but it opens no administrator operation by itself.

   Modes (CRM_ACCESS_MODE):
     report   (default) every rule is evaluated and a refusal is only
              written to the audit log as "would deny"; the response is
              what it has always been.
     enforce  a refusal is a refusal.
   The emergency switch back to unscoped storage needs BOTH
   CRM_SCOPED_STORAGE=off and CRM_ALLOW_UNSCOPED=yes-i-understand; one
   on its own is ignored and said so at start-up. It never switches off
   the administrator-only operations, which are not storage scoping.

   Step 1 uses this to identify people, give every route a declared
   policy, and evaluate the team-record rule in report mode. Later steps
   use the same functions to scope reads and writes.
   ===================================================================== */

const ADMIN_ROLE = 'Admin';
/* The page's defaultRoles() (index.html H:6182), top to bottom. */
const DEFAULT_ROLES = [ADMIN_ROLE, 'President / CEO', 'Senior Vice President', 'Vice President',
  'Senior General manager', 'General Manager', 'Senior Manager', 'Manager', 'Senior Executive', 'Executive'];
const PERM_DEFAULT_ON = { changeStage: 1 };                                   // H:34412
const PERM_MODULE_ALIAS = { AMC: 'Masters', Schemes: 'Masters', Commission: 'Masters', ProjectTasks: 'Projects' }; // H:35256
const ADMIN_FLAGS = ['manageFields', 'manageWorkflows', 'manageReports', 'manageUsers',
  'managePermissions', 'manageModuleSettings', 'approveAllocations'];       // H:34394
const USER_FLAGS = ['useAiAssistant'];                                        // H:34418

/* Fields on a team record that decide what a person may do or see. A
   person never changes these on their own record; on somebody else's
   the page's own capability is needed (TEAM_FIELD_CAPABILITY). */
const TEAM_PROTECTED = ['role', 'scope', 'branch', 'status', 'deletedAt', 'parentUserId', 'managerIds',
  'departments', 'perms', 'permsOff', 'pagePerms', 'stagePerms', 'adminFlags', 'hrAccess'];
const TEAM_FIELD_CAPABILITY = {
  role: 'teamEdit', scope: 'teamEdit', branch: 'teamEdit', status: 'teamEdit', deletedAt: 'teamDelete',
  parentUserId: 'manageUsers', managerIds: 'manageUsers', departments: 'manageUsers',
  perms: 'managePermissions', permsOff: 'managePermissions', pagePerms: 'managePermissions',
  stagePerms: 'managePermissions', adminFlags: 'managePermissions', hrAccess: 'hrAdmin',
};

function norm(x) { return String(x === null || x === undefined ? '' : x).trim().toLowerCase(); }
function same(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }
/* A field on a new record counts as set when it holds something: an empty
   string, list or object is how the page writes "nothing chosen". */
function hasValue(v) {
  if (v === undefined || v === null || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function create(opts) {
  const storeRaw = opts.storeRaw;               // key -> raw JSON string, as the server holds it
  const memberOfUser = opts.memberOfUser;       // the server's own id-then-email lookup
  const env = opts.env || process.env;
  const warn = opts.warn || ((m) => console.warn(m));

  /* ---- modes ---- */
  const requested = norm(env.CRM_ACCESS_MODE) || 'report';
  const MODE = requested === 'enforce' ? 'enforce' : 'report';
  if (requested !== 'report' && requested !== 'enforce') warn('[access] CRM_ACCESS_MODE="' + env.CRM_ACCESS_MODE + '" is not report or enforce; using report.');
  const offA = env.CRM_SCOPED_STORAGE === 'off', offB = env.CRM_ALLOW_UNSCOPED === 'yes-i-understand';
  const UNSCOPED = offA && offB;
  if (offA !== offB) warn('[access] only one of CRM_SCOPED_STORAGE=off / CRM_ALLOW_UNSCOPED=yes-i-understand is set; scoped storage stays on.');
  if (UNSCOPED) warn('[access] WARNING: scoped storage is switched OFF by CRM_SCOPED_STORAGE and CRM_ALLOW_UNSCOPED. Administrator-only operations still apply.');

  /* ---- parsed stores, cached on the raw string so a write is never missed ---- */
  const cache = {};
  function parsed(key, fallback) {
    const raw = storeRaw(key);
    const hit = cache[key];
    if (hit && hit.raw === raw) return hit.value;
    let value = fallback;
    try {
      const v = raw === undefined ? fallback : JSON.parse(raw);
      value = Array.isArray(fallback) ? (Array.isArray(v) ? v : fallback) : (v && typeof v === 'object' ? v : fallback);
    } catch (e) { value = fallback; }
    cache[key] = { raw, value };
    return value;
  }
  const team = () => parsed('team', []);
  const config = () => parsed('config', {});

  /* ---- the page's role helpers ---- */
  function roleList(cfg) {
    const r = (cfg && cfg.roles) || DEFAULT_ROLES;                          // roleList() H:6187
    return r.includes(ADMIN_ROLE) ? r : [ADMIN_ROLE].concat(r);
  }
  function defaultRole(cfg) {                                                 // defaultRole() H:6196
    const roles = roleList(cfg);
    const junior = DEFAULT_ROLES.filter((r) => r !== ADMIN_ROLE).slice(-1)[0];
    return roles.find((r) => norm(r) === norm(junior)) || roles.find((r) => r !== ADMIN_ROLE) || ADMIN_ROLE;
  }
  function roleOf(m, cfg) { return (m && m.role) || defaultRole(cfg); }      // roleOf() H:6238
  function descendants(list, id) {                                            // userDescendants() H:6246
    const out = []; const seen = new Set([id]); const queue = list.filter((t) => t && t.parentUserId === id);
    while (queue.length) {
      const u = queue.shift();
      if (seen.has(u.id)) continue;
      seen.add(u.id); out.push(u); queue.push(...list.filter((t) => t && t.parentUserId === u.id));
    }
    return out;
  }

  /* ---- who is asking ---- */
  function principal(user) {
    if (!user) return null;
    const cfg = config();
    const member = memberOfUser(user) || null;
    const role = member ? roleOf(member, cfg) : '';
    const teamAdmin = !!member && role === ADMIN_ROLE;
    const scope = member ? (member.scope || 'own') : 'none';
    return {
      userId: user.id, email: user.email || '', admin: user.role === 'admin',
      member, memberId: member ? member.id : '', linked: !!member,
      role, teamAdmin, scope, branch: member ? (member.branch || '') : '',
    };
  }

  /* ---- the page's can() (H:35473), worked out here ---- */
  function permModule(m) { return PERM_MODULE_ALIAS[m] || m; }
  function moduleOpen(p, m, cfg) {                                            // moduleOpenToMe() H:6095
    const allowed = ((cfg.moduleRoles || {})[permModule(m)]);
    if (!Array.isArray(allowed) || !allowed.length) return true;
    return p.teamAdmin || allowed.includes(p.role);
  }
  function permHas(u, m, a) {                                                 // permHas() H:35333
    const mm = permModule(m);
    const ticked = !!(u.perms && u.perms[mm] && u.perms[mm][a]);
    if (!PERM_DEFAULT_ON[a]) return ticked;
    return !(u.permsOff && u.permsOff[mm] && u.permsOff[mm][a]);
  }
  function can(p, module, action) {
    if (!p) return false;
    if (p.admin || p.teamAdmin) return true;        // the page: "Admin retains full access always"
    if (!p.member) return false;
    const cfg = config();
    if (!moduleOpen(p, module, cfg)) return false;
    return permHas(p.member, module, action);
  }
  /* An administrator capability. The account admin always; otherwise only
     a flag on the member. Unlike the page, the team role "Admin" alone is
     not enough (decision D1). */
  function canAdmin(p, flag) {
    if (!p) return false;
    if (p.admin) return true;
    return !!(p.member && p.member.adminFlags && p.member.adminFlags[flag]);
  }
  function hrAdmin(p) {
    if (!p) return false;
    if (p.admin) return true;
    return !!(p.member && p.member.hrAccess && p.member.hrAccess.admin);
  }

  /* ---- the page's visibleRecords() (H:35554) for one record ---- */
  function inScope(p, ownerId, branch) {
    if (!p) return false;
    if (p.admin || p.teamAdmin || p.scope === 'all') return true;
    if (!p.member) return false;
    if (p.scope === 'branch') return (branch || '') === p.branch;
    if (p.scope === 'team') {
      const ids = new Set([p.memberId].concat(descendants(team(), p.memberId).map((t) => t.id)));
      return ids.has(ownerId);
    }
    return ownerId === p.memberId;
  }

  /* ---- the team-record rule ----
     Compares the team list before and after a write and returns every
     protected change this person may not make. Empty means allowed.
     Used in report mode in step 1; enforced from step 2. */
  function teamViolations(p, before, after) {
    const out = [];
    if (!p) return [{ memberId: '', fields: [], reason: 'not_signed_in' }];
    if (p.admin) return out;
    const b = new Map((before || []).filter((t) => t && t.id).map((t) => [t.id, t]));
    const a = new Map((after || []).filter((t) => t && t.id).map((t) => [t.id, t]));
    const holds = {
      teamEdit: can(p, 'Team', 'edit'), teamCreate: can(p, 'Team', 'create'), teamDelete: can(p, 'Team', 'delete') || canAdmin(p, 'manageUsers'),
      manageUsers: canAdmin(p, 'manageUsers'), managePermissions: canAdmin(p, 'managePermissions'), hrAdmin: hrAdmin(p) || canAdmin(p, 'managePermissions'),
    };
    const flagGrantProblem = (flags, prev) => Object.keys(flags || {}).filter((f) =>
      flags[f] && !(prev && prev[f]) && !canAdmin(p, f) && ADMIN_FLAGS.includes(f));
    for (const [id, now] of a) {
      const was = b.get(id);
      const fields = TEAM_PROTECTED.filter((k) => (was ? !same(was[k], now[k]) : hasValue(now[k])));
      if (!fields.length) continue;
      const reasons = [];
      if (was && id === p.memberId) reasons.push('own_record');
      if (!was && !(holds.teamCreate || holds.manageUsers)) reasons.push('no_team_create');
      if (now.role === ADMIN_ROLE && (!was || was.role !== ADMIN_ROLE)) reasons.push('admin_role_needs_admin_account');
      if (now.scope === 'all' && (!was || was.scope !== 'all')) reasons.push('scope_all_needs_admin_account');
      if (fields.includes('adminFlags') && flagGrantProblem(now.adminFlags, was && was.adminFlags).length) reasons.push('grants_flag_not_held');
      if (was) fields.forEach((k) => { const need = TEAM_FIELD_CAPABILITY[k]; if (need && !holds[need]) reasons.push('needs_' + need + ':' + k); });
      if (reasons.length) out.push({ memberId: id, fields, reason: Array.from(new Set(reasons)).join(',') });
    }
    for (const [id] of b) {
      if (!a.has(id) && !holds.teamDelete) out.push({ memberId: id, fields: ['(removed)'], reason: 'needs_teamDelete' });
    }
    return out;
  }

  return {
    MODE, UNSCOPED, ADMIN_ROLE, ADMIN_FLAGS, USER_FLAGS, TEAM_PROTECTED,
    principal, can, canAdmin, hrAdmin, inScope, teamViolations,
    roleOf: (m) => roleOf(m, config()), descendants: (id) => descendants(team(), id),
    enforcing: () => MODE === 'enforce',
  };
}

/* =====================================================================
   EVERY ROUTE, AND WHAT IT IS FOR

   One entry per route server.js registers. A test (sec-route-policy)
   reads server.js and fails if any route is missing from this list, so a
   new route cannot be added without somebody deciding who it is for.

     public      no sign-in by design (the sign-in pages, a client's own
                 link page, health)
     token       a client's link or a share link: the token is the key
     signed-in   any signed-in account; no record data comes back
     scoped      returns or changes records: scoped from step 2 on
     admin       the sign-in account must be an administrator
     day1-admin  administrator only, enforced from the first TEST deploy
     test-only   registered only when the test switch is on
   ===================================================================== */
const ROUTE_POLICY = {
  'GET /login': 'public', 'POST /login': 'public', 'GET /login/otp': 'public', 'POST /login/otp': 'public',
  'POST /login/otp/resend': 'public', 'POST /logout': 'public', 'GET /logout': 'public',
  'GET /api/storage/:key': 'scoped', 'PUT /api/storage/:key': 'scoped', 'DELETE /api/storage/:key': 'day1-admin',
  'GET /api/connections': 'signed-in', 'PUT /api/connections/:id': 'day1-admin',
  'DELETE /api/connections/:id': 'day1-admin', 'POST /api/connections/:id/test': 'day1-admin',
  'POST /api/outlook/meeting': 'signed-in', 'POST /api/mail/send': 'scoped',
  'GET /api/me/2fa': 'signed-in', 'POST /api/me/2fa/start': 'signed-in', 'POST /api/me/2fa/verify': 'signed-in',
  'GET /api/lookup/pincode/:pin': 'signed-in', 'GET /api/public/pincode/:pin': 'public', 'GET /api/lookup/ifsc/:code': 'signed-in',
  'GET /api/aadhaar/access': 'signed-in', 'PUT /api/aadhaar/access': 'admin',
  'PUT /api/aadhaar/:clientId': 'scoped', 'GET /api/aadhaar/:clientId': 'scoped',
  'POST /api/market/nav': 'signed-in', 'GET /api/market/quote': 'signed-in', 'GET /api/market/candles': 'signed-in',
  'GET /api/apiconnectors': 'signed-in', 'PUT /api/apiconnectors/:id': 'day1-admin', 'DELETE /api/apiconnectors/:id': 'day1-admin',
  'POST /api/apiconnectors/:id/call': 'scoped', 'POST /api/apiconnectors/:id/token': 'scoped',
  'GET /api/share/:id': 'token', 'POST /api/share/:id': 'token',
  'POST /api/ai/chat': 'scoped', 'GET /api/ai/status': 'signed-in', 'POST /api/ai/hello': 'signed-in',
  'GET /api/events': 'signed-in', 'GET /api/changes': 'signed-in', 'GET /api/health': 'public',
  'GET /users': 'admin', 'POST /users/delete': 'admin', 'POST /users': 'admin',
  'GET /api/users': 'admin', 'POST /api/users/sync': 'admin', 'POST /api/users/:memberId/password': 'admin',
  'DELETE /api/users/:memberId': 'admin',
  'GET /api/access/reconcile': 'admin', 'GET /api/audit': 'admin',
  'GET /api/public/bundle': 'token', 'POST /api/public/patch': 'token', 'POST /api/approvals': 'signed-in',
  'POST /api/public/approval': 'token', 'POST /api/public/mail': 'token', 'POST /api/public/website-lead': 'public',
  'GET /config.js': 'public', 'POST /api/reminders/run': 'test-only',
  'GET /api/push/key': 'public', 'POST /api/push/subscribe': 'signed-in', 'POST /api/push/unsubscribe': 'signed-in',
  'GET /api/reminders/log': 'scoped', 'GET /api/attendance/today': 'signed-in', 'GET /*splat': 'public',
};

module.exports = { create, ROUTE_POLICY, TEAM_PROTECTED, ADMIN_ROLE, DEFAULT_ROLES };

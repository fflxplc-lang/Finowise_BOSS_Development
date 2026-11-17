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

/* =====================================================================
   PAN, SHOWN MASKED  (Phase 1, step 3)

   A PAN is ten characters: five letters, four digits, a letter. For anyone
   but an administrator account the server sends every PAN it finds in a
   record as XXXXXX234F (the last four kept, so a person can still tell two
   apart), wherever in the record it sits: the client's own, a family
   member's, a nominee's, a value a form recorded, an audit line's old and
   new value. It is matched on the value, not the field name, so a PAN in
   a field nobody listed is masked too.

   A masked PAN sent back on a save means "unchanged": the server puts the
   stored PAN back before anything else looks at the record. A full PAN
   sent back is a change, and is saved like any other edit. A masked value
   the server cannot trace to a stored PAN is refused rather than saved.
   ===================================================================== */
const PAN_FULL_RE = /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/;
const PAN_MASKED_RE = /^X{6}([0-9]{3}[A-Za-z])$/;
function maskPan(v) { return 'XXXXXX' + String(v).trim().slice(-4).toUpperCase(); }
function isFullPan(v) { return typeof v === 'string' && PAN_FULL_RE.test(v.trim()); }
function isMaskedPan(v) { return typeof v === 'string' && PAN_MASKED_RE.test(v.trim()); }
/* Copy-on-write walk: returns the same object when nothing needed masking. */
function maskPansDeep(v, counter) {
  if (typeof v === 'string') { if (isFullPan(v)) { counter.n++; return maskPan(v); } return v; }
  if (!v || typeof v !== 'object') return v;
  let copy = null;
  if (Array.isArray(v)) {
    v.forEach((x, i) => { const y = maskPansDeep(x, counter); if (y !== x) { if (!copy) copy = v.slice(); copy[i] = y; } });
  } else {
    Object.keys(v).forEach((k) => { const y = maskPansDeep(v[k], counter); if (y !== v[k]) { if (!copy) copy = Object.assign({}, v); copy[k] = y; } });
  }
  return copy || v;
}
/* Every full PAN in a stored record, by its last four. */
function pansByLast4(v, out) {
  out = out || new Map();
  if (typeof v === 'string') {
    if (isFullPan(v)) { const k = v.trim().slice(-4).toUpperCase(); const s = out.get(k) || new Set(); s.add(v.trim().toUpperCase()); out.set(k, s); }
  } else if (v && typeof v === 'object') (Array.isArray(v) ? v : Object.values(v)).forEach((x) => pansByLast4(x, out));
  return out;
}
/* Put the stored PAN back wherever a masked one came in. */
function restorePansDeep(v, last4, counter) {
  if (typeof v === 'string') {
    const m = v.trim().match(PAN_MASKED_RE);
    if (!m) return v;
    const hit = last4 && last4.get(m[1].toUpperCase());
    if (hit && hit.size === 1) { counter.restored++; return [...hit][0]; }
    counter.unresolved++; return v;
  }
  if (!v || typeof v !== 'object') return v;
  let copy = null;
  if (Array.isArray(v)) {
    v.forEach((x, i) => { const y = restorePansDeep(x, last4, counter); if (y !== x) { if (!copy) copy = v.slice(); copy[i] = y; } });
  } else {
    Object.keys(v).forEach((k) => { const y = restorePansDeep(v[k], last4, counter); if (y !== v[k]) { if (!copy) copy = Object.assign({}, v); copy[k] = y; } });
  }
  return copy || v;
}
function hasMaskedPan(v) {
  if (typeof v === 'string') return isMaskedPan(v);
  if (!v || typeof v !== 'object') return false;
  return (Array.isArray(v) ? v : Object.values(v)).some(hasMaskedPan);
}
/* A save's records with their masked PANs put back from the server copy
   of the same record (matched by id; a store that is one object is matched
   as a whole). {value, restored, unresolved, changed}. */
function restoreMaskedPans(curValue, nextValue, linked) {
  const counter = { restored: 0, unresolved: 0 };
  if (!hasMaskedPan(nextValue)) return { value: nextValue, restored: 0, unresolved: 0, changed: false };
  let value = nextValue;
  if (Array.isArray(nextValue)) {
    const byId = new Map((Array.isArray(curValue) ? curValue : []).filter((r) => r && r.id).map((r) => [r.id, r]));
    value = nextValue.map((r) => {
      if (!hasMaskedPan(r)) return r;
      const was = r && r.id ? byId.get(r.id) : null;
      /* The record's own stored copy first; then the client or lead it hangs
         off (a form pre-filled from the client carries the client's PAN). */
      const map = was ? pansByLast4(was) : new Map();
      const extra = linked && !was ? linked(r) : [];      // only a record new to the server needs it
      (extra || []).forEach((x) => pansByLast4(x, map));
      return restorePansDeep(r, map.size ? map : null, counter);
    });
  } else {
    value = restorePansDeep(nextValue, pansByLast4(curValue), counter);
  }
  return { value, restored: counter.restored, unresolved: counter.unresolved, changed: counter.restored > 0 };
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
  const anyCache = {};
  function parsedRaw(key, raw) {                     // any JSON value, cached on the raw string
    const hit = anyCache[key];
    if (hit && hit.raw === raw) return hit.value;
    let value; try { value = raw === undefined ? undefined : JSON.parse(raw); } catch (e) { value = undefined; }
    anyCache[key] = { raw, value };
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

  /* =====================================================================
     STEP 2: EVERY STORE, AND WHO MAY SEE AND CHANGE WHAT IS IN IT

     One rule per store (STORE_CLASS below; docs/phase1/B2C-INVENTORY.md
     §3 is the evidence for each). A record-store rule is the page's own
     rule for that store, worked out here. Where two screens of the page
     use two different rules for the same store, the server uses BOTH (a
     record is visible if either says so), so no screen loses a row it
     shows today. A store with no rule is closed to everyone but an
     administrator.
     ===================================================================== */
  function anyAdminFlag(p) { return !!p && (p.admin || ADMIN_FLAGS.some((f) => canAdmin(p, f))); }
  function hrStaff(p) {
    if (!p) return false;
    if (p.admin || p.teamAdmin) return true;                  // the page's hrGrants(): Admin holds every grant
    const g = (p.member && p.member.hrAccess) || {};
    return !!(g.admin || g.staff);
  }
  function sees(p) { return !!p && (p.admin || p.teamAdmin || p.scope === 'all'); }

  /* What one request needs to answer "is this record theirs?", built once. */
  function context(p) {
    const lists = {}, byId = {}, memo = {};
    const list = (k) => lists[k] || (lists[k] = parsed(k, []));
    const get = (k, id) => {
      if (!id) return null;
      let m = byId[k];
      if (!m) { m = byId[k] = new Map(); for (const r of list(k)) if (r && r.id) m.set(r.id, r); }
      return m.get(id) || null;
    };
    const teamList = team();
    const teamById = new Map(teamList.filter((t) => t && t.id).map((t) => [t.id, t]));
    const below = p && p.member ? new Set(descendants(teamList, p.memberId).map((t) => t.id)) : new Set();
    const teamSet = new Set([p && p.memberId].concat([...below]).filter(Boolean));
    /* dstVisible()'s "mine": me, and on team scope everybody below me */
    const mine = new Set([p && p.memberId].concat(p && p.scope === 'team' ? [...below] : []).filter(Boolean));
    function scopeOk(owner, branch) {
      if (!p) return false;
      if (sees(p)) return true;
      if (!p.member) return false;
      if (p.scope === 'branch') return (branch || '') === p.branch;
      if (p.scope === 'team') return teamSet.has(owner);
      return !!owner && owner === p.memberId;
    }
    function ownerOf(r, fields) {                               // listOwnerOf() H:49227
      for (const f of fields) if (r && r[f]) return r[f];
      const c = r && r.clientId ? get('clients', r.clientId) : null; if (c && c.rmName) return c.rmName;
      const l = r && r.leadId ? get('leads', r.leadId) : null; if (l && l.assignedTo) return l.assignedTo;
      return '';
    }
    function branchOf(r, fields) {                              // listBranchOf() H:49251
      const c = r && r.clientId ? get('clients', r.clientId) : null; if (c && c.branch) return c.branch;
      const l = r && r.leadId ? get('leads', r.leadId) : null; if (l && l.branch) return l.branch;
      if (r && r.branch) return r.branch;
      const t = teamById.get(ownerOf(r, fields)); return (t && t.branch) || '';
    }
    /* Is the record with this id in that store visible? Memoised. */
    function visibleId(key, id) {
      if (!id) return false;
      const mk = key + '\u0000' + id;
      if (memo[mk] !== undefined) return memo[mk];
      memo[mk] = false;                                          // a cycle answers no
      const rec = get(key, id);
      const v = !!rec && readable(key, rec, ctx);
      memo[mk] = v;
      return v;
    }
    const ctx = { p, list, get, teamById, below, mine, scopeOk, ownerOf, branchOf, visibleId };
    return ctx;
  }

  const TASK = ['assignTo', 'createdBy'], MEETING = ['assignTo', 'createdBy'], CALL = ['loggedBy', 'createdBy'],
    TXN = ['rmName', 'createdBy'], ALLOC = ['createdBy', 'assignTo'];
  function taskPeople(t) {                                       // dstPeopleOf() H:45356
    const out = new Set();
    [t.assignTo, t.createdBy, t.assignedBy, t.originalAssignee, t.completedBy].forEach((x) => { if (x) out.add(x); });
    (t.assignHistory || []).forEach((h) => { if (h) [h.by, h.from, h.to].forEach((x) => { if (x) out.add(x); }); });
    return out;
  }
  const MODULE_STORE = { LMS: 'leads', CMS: 'clients', RMS: 'reviews', DST: 'tasks', Queries: 'queries',
    Recommendations: 'recommendations', Meetings: 'meetings', Calls: 'callEntries', Business: 'businessEntries',
    Transactions: 'transactions', Partners: 'partners', Campaigns: 'campaigns', Projects: 'projects' };
  const STORE_MODULE = {}; Object.keys(MODULE_STORE).forEach((m) => { STORE_MODULE[MODULE_STORE[m]] = m; });
  STORE_MODULE.platformHoldings = 'Transactions'; STORE_MODULE.platformSips = 'Transactions';

  /* A record reached through what it hangs off: a client, a lead, a review,
     a record named by module, or failing all of those, who made it. */
  function linkedVisible(r, c) {
    if (!r) return false;
    if (r.clientId && c.get('clients', r.clientId)) return c.visibleId('clients', r.clientId);
    if (r.leadId && c.get('leads', r.leadId)) return c.visibleId('leads', r.leadId);
    if (r.reviewId && c.get('reviews', r.reviewId)) return c.visibleId('reviews', r.reviewId);
    if (r.recordId) {
      const st = MODULE_STORE[r.recordModule] || MODULE_STORE[r.module] || r.recordStore;
      if (st && c.get(st, r.recordId)) return c.visibleId(st, r.recordId);
      for (const k of ['clients', 'leads', 'reviews']) if (c.get(k, r.recordId)) return c.visibleId(k, r.recordId);
    }
    for (const f of ['createdBy', 'by', 'assignTo', 'userId', 'requestedBy', 'approverId', 'importedBy']) {
      if (r[f] && c.scopeOk(r[f], r.branch || '')) return true;
    }
    return false;
  }
  const clientOf = (r, c) => (r && r.clientId ? c.get('clients', r.clientId) : null) || {};

  /* The page's rule for each record store (R). */
  const RECORD_RULES = {
    leads: (r, c) => c.scopeOk(r.assignedTo, r.branch),
    clients: (r, c) => c.scopeOk(r.rmName, r.branch),
    reviews: (r, c) => { const cl = clientOf(r, c); return c.scopeOk(r.assignTo || cl.rmName, r.branch || cl.branch) || c.scopeOk(r.assignTo, cl.branch); },
    tasks: (r, c) => c.scopeOk(c.ownerOf(r, TASK), c.branchOf(r, TASK)) || [...taskPeople(r)].some((x) => c.mine.has(x)),
    queries: (r, c) => { const cl = clientOf(r, c); const o = r.assignTo || cl.rmName || ''; return c.scopeOk(o, r.branch || cl.branch) || c.scopeOk(o, cl.branch); },
    queryReplies: (r, c) => (r.queryId && c.get('queries', r.queryId)) ? c.visibleId('queries', r.queryId) : (!!r.by && c.scopeOk(r.by, '')),
    recommendations: (r, c) => c.scopeOk(c.ownerOf(r, ALLOC), c.branchOf(r, ALLOC)),
    meetings: (r, c) => c.scopeOk(c.ownerOf(r, MEETING), c.branchOf(r, MEETING)),
    callEntries: (r, c) => c.scopeOk(r.loggedBy, c.branchOf(r, CALL)),     // visibleRecords(DB.callEntries, c=>c.loggedBy, callBranchOf)
    businessEntries: (r, c) => {                                 // bizOwnerOf()/bizBranchOf() H:49271
      const cl = r.clientId ? c.get('clients', r.clientId) : null;
      const ld = !cl && r.leadId ? c.get('leads', r.leadId) : null;
      return c.scopeOk(cl ? cl.rmName : ld ? ld.assignedTo : r.createdBy, cl ? (cl.branch || '') : ld ? (ld.branch || '') : '');
    },
    transactions: (r, c) => c.scopeOk(c.ownerOf(r, TXN), c.branchOf(r, TXN)),
    platformHoldings: (r, c) => (r.clientId && c.get('clients', r.clientId) ? c.visibleId('clients', r.clientId) : false) || c.scopeOk(r.importedBy, r.branch),
    platformSips: (r, c) => (r.clientId && c.get('clients', r.clientId) ? c.visibleId('clients', r.clientId) : false) || c.scopeOk(r.importedBy, r.branch),
    communications: (r, c) => c.scopeOk(r.by, r.branch) || linkedVisible(r, c),
    projects: (r, c) => c.scopeOk(r.owner, r.branch),
    projectClients: (r, c) => c.visibleId('projects', r.projectId) || (r.clientId ? c.visibleId('clients', r.clientId) : false),
    projectTasks: (r, c) => c.visibleId('projects', r.projectId) || [...taskPeople(r)].some((x) => c.mine.has(x)),
    partners: (r, c) => c.scopeOk(r.createdBy, r.branch),
    campaigns: (r, c) => c.scopeOk(r.createdBy, r.branch),
    campaignRecipients: (r, c) => (r.campaignId && c.get('campaigns', r.campaignId)) ? c.visibleId('campaigns', r.campaignId) : linkedVisible(r, c),
  };
  ['moms', 'insPolicies', 'clientDocuments', 'clientGoals', 'clientFeedback', 'docLinks', 'docSubmissions', 'approvals',
    'complianceItems', 'aumMonthly', 'reviewEdits', 'reviewReports'].forEach((k) => { RECORD_RULES[k] = linkedVisible; });

  /* Member and HR stores (M). */
  function memberRule(managerToo) {
    return (r, c) => {
      const me = c.p.memberId;
      if (hrStaff(c.p) || c.p.admin) return true;
      if (!me) return false;
      if (r.userId === me || r.approverId === me || r.createdBy === me || r.by === me || r.memberId === me) return true;
      if (managerToo) {
        const who = r.userId || r.memberId || r.createdBy;
        if (who && c.below.has(who)) return true;
        const t = who ? c.teamById.get(who) : null;
        if (t && Array.isArray(t.managerIds) && t.managerIds.includes(me)) return true;
      }
      return false;
    };
  }
  const MEMBER_RULES = {
    hrAttendance: memberRule(false), hrLeave: memberRule(false), hrCompOff: memberRule(false), hrRegularizations: memberRule(false),
    hrAppraisals: memberRule(true), hrIncentives: memberRule(true), workActivities: memberRule(true), djtEntries: memberRule(true),
    notifications: (r, c) => c.p.admin || (!!c.p.memberId && r.userId === c.p.memberId),
    supportQueries: (r, c) => c.p.admin || c.p.teamAdmin || (!!c.p.memberId && r.by === c.p.memberId),
    accessRequests: (r, c) => c.p.admin || c.p.teamAdmin || canAdmin(c.p, 'managePermissions')
      || (!!c.p.memberId && [r.memberId, r.userId, r.by, r.requestedBy].includes(c.p.memberId)),
  };
  /* Somebody may notify somebody else: a notification is the one record a
     person routinely creates that they cannot see afterwards. */
  const CREATE_FOR_OTHERS = new Set(['notifications', 'accessRequests', 'auditLog']);

  /* Shared settings and reference data (S): everyone reads; these write. */
  const SETTINGS_WRITE = {
    config: (p) => anyAdminFlag(p) || hrAdmin(p), settings: (p) => anyAdminFlag(p) || hrAdmin(p),
    hrConfig: (p) => hrAdmin(p), hrSourceMaps: (p) => hrAdmin(p),
    slaRules: (p) => canAdmin(p, 'manageWorkflows'), automationRules: (p) => canAdmin(p, 'manageWorkflows'),
    sops: (p) => anyAdminFlag(p), webhooks: (p) => canAdmin(p, 'manageWorkflows') || canAdmin(p, 'manageModuleSettings'),
    integrationConnectors: (p) => canAdmin(p, 'manageModuleSettings'), apiConnectors: (p) => canAdmin(p, 'manageModuleSettings'),
    campaignTemplates: (p) => can(p, 'Campaigns', 'edit') || can(p, 'Campaigns', 'create'),
    multiProductSchemes: (p) => ['create', 'edit', 'delete'].some((a) => can(p, 'Masters', a)),
    amcs: (p) => ['create', 'edit', 'delete'].some((a) => can(p, 'Masters', a)),
    schemes: (p) => ['create', 'edit', 'delete'].some((a) => can(p, 'Masters', a)),
    commissionRates: (p) => ['create', 'edit', 'delete'].some((a) => can(p, 'Masters', a)),
  };
  /* Logs (L): who reads; all of them only ever grow (auditLog and
     settingsAudit strictly; the capped ones may drop their oldest lines). */
  const LOG_READ = {
    auditLog: (r, c) => {
      if (c.p.teamAdmin) return true;
      if (r.by && r.by === c.p.memberId) return true;
      const st = MODULE_STORE[r.module];
      if (st && r.recordId && c.get(st, r.recordId)) return c.visibleId(st, r.recordId);
      return can(c.p, 'Team', 'view') && !!r.by && c.scopeOk(r.by, r.branch || '');
    },
    settingsAudit: (r, c) => c.p.teamAdmin || anyAdminFlag(c.p) || hrAdmin(c.p),
    errorLog: (r, c) => c.p.teamAdmin || [r.by, r.userId].includes(c.p.memberId),
    exportHistory: (r, c) => c.p.teamAdmin || [r.by, r.userId].includes(c.p.memberId),
    apiReqLog: (r, c) => c.p.teamAdmin || canAdmin(c.p, 'manageModuleSettings'),
    automationExecutionLog: (r, c) => c.p.teamAdmin || canAdmin(c.p, 'manageWorkflows'),
    backupHistory: (r, c) => c.p.teamAdmin || anyAdminFlag(c.p),
  };
  const STRICT_LOGS = new Set(['auditLog', 'settingsAudit']);
  /* System and import (X). */
  const mayImport = (p) => can(p, 'Transactions', 'import') || can(p, 'CMS', 'import') || can(p, 'LMS', 'import');
  const SYSTEM = {
    systemState: { read: () => true, write: () => true },
    assetUploads: { read: () => true, write: () => true },
    importBatches: { read: (r, c) => c.p.teamAdmin || mayImport(c.p) || r.by === c.p.memberId, write: mayImport },
    importUndo: { read: (r, c) => c.p.teamAdmin || mayImport(c.p) || r.by === c.p.memberId, write: mayImport },
    importHistory: { read: (r, c) => c.p.teamAdmin || mayImport(c.p) || r.by === c.p.memberId, write: mayImport },
    apiInbox: { read: (r, c) => c.p.teamAdmin || canAdmin(c.p, 'manageModuleSettings'), write: (p) => canAdmin(p, 'manageModuleSettings') },
    apiSyncRuns: { read: (r, c) => c.p.teamAdmin || canAdmin(c.p, 'manageModuleSettings'), write: (p) => canAdmin(p, 'manageModuleSettings') },
  };
  /* Keys made per upload: they follow the upload index. */
  const DYNAMIC = /^(maRows|maFile|reviewFile)\./;

  function classOf(key) {
    if (RECORD_RULES[key]) return 'R';
    if (MEMBER_RULES[key]) return 'M';
    if (key === 'team') return 'T';
    if (SETTINGS_WRITE[key]) return 'S';
    if (LOG_READ[key]) return 'L';
    if (SYSTEM[key] || DYNAMIC.test(key)) return 'X';
    return '';
  }
  function readable(key, rec, c) {
    if (!rec || typeof rec !== 'object') return true;
    const cls = classOf(key);
    if (cls === 'R') return RECORD_RULES[key](rec, c);
    if (cls === 'M') return MEMBER_RULES[key](rec, c);
    if (cls === 'L') return c.p.admin || LOG_READ[key](rec, c);
    if (cls === 'X') return c.p.admin || (SYSTEM[key] ? SYSTEM[key].read(rec, c) : true);
    return true;
  }

  /* Private parts of a team record: the page shows them to an Admin,
     somebody with Manage Users, and the person (canViewSensitiveMemberData
     H:74445); salary also to HR's administrator (maySetSalary H:74395). */
  const TEAM_PRIVATE = ['panNumber', 'pfUan', 'esicNumber', 'dscSubmitted', 'bankIfsc', 'bankName',
    'bankAccountName', 'bankAccountNumber', 'bankBranch'];
  const TEAM_SALARY = ['monthlySalary'];
  function privateHidden(p, memberId) {
    const keys = [];
    const self = !!p.memberId && p.memberId === memberId;
    const full = p.admin || p.teamAdmin || canAdmin(p, 'manageUsers') || self;
    if (!full) keys.push(...TEAM_PRIVATE);
    if (!(full || hrAdmin(p))) keys.push(...TEAM_SALARY);
    return keys;
  }

  /* -------- reading a store -------- */
  function readView(p, key, raw) {
    const out = { cls: classOf(key), hidden: 0, stubs: 0, masked: 0, refused: false, value: raw, maskCounter: { n: 0 } };
    if (raw === undefined || !p || p.admin || UNSCOPED) return out;
    if (!out.cls) { out.refused = true; out.value = undefined; return out; }    // a store with no rule
    const v = parsedRaw(key, raw);
    if (v === undefined) return out;
    const c = context(p);
    if (out.cls === 'T' && Array.isArray(v)) {
      let changed = false;
      const shown = v.map((m) => {
        if (!m || typeof m !== 'object') return m;
        const hide = privateHidden(p, m.id).filter((k) => m[k] !== undefined);
        if (!hide.length) return m;
        changed = true; out.hidden += hide.length;
        const copy = Object.assign({}, m); hide.forEach((k) => { delete copy[k]; }); return copy;
      });
      const masked = maskPansDeep(shown, out.maskCounter);
      out.masked = out.maskCounter.n;
      if (changed || masked !== shown) out.value = JSON.stringify(masked);
      return out;
    }
    if (out.cls === 'S') return out;
    if (!Array.isArray(v)) {                       // a store that is one object: masked, not filtered
      const m = maskPansDeep(v, out.maskCounter);
      out.masked = out.maskCounter.n;
      if (m !== v) out.value = JSON.stringify(m);
      return out;
    }
    const kept = v.filter((r) => readable(key, r, c));
    out.hidden = v.length - kept.length;
    /* A visible record that points at a client or lead the person cannot
       see gets a placeholder for it, so the page says "Restricted record"
       rather than failing to find it. A placeholder is never saved. */
    if (key === 'clients' || key === 'leads') {
      const keptIds = new Set(kept.map((r) => r && r.id));
      const want = new Set();
      const field = key === 'clients' ? 'clientId' : 'leadId';
      ['tasks', 'meetings', 'reviews', 'queries', 'transactions', 'callEntries', 'businessEntries', 'recommendations', 'projectClients'].forEach((k) => {
        for (const r of c.list(k)) {
          if (!r || !r[field] || keptIds.has(r[field]) || want.has(r[field])) continue;
          if (readable(k, r, c)) want.add(r[field]);
        }
      });
      want.forEach((id) => {
        kept.push(key === 'clients' ? { id, _stub: true, cmsName: 'Restricted record', name: 'Restricted record', rmName: '', branch: '' }
          : { id, _stub: true, name: 'Restricted record', fullName: 'Restricted record', assignedTo: '', branch: '' });
      });
      out.stubs = want.size;
    }
    const shownList = maskPansDeep(kept, out.maskCounter);
    out.masked = out.maskCounter.n;
    if (out.hidden || out.stubs || shownList !== kept) out.value = JSON.stringify(shownList);
    return out;
  }

  /* -------- writing a store --------
     Compares what is on the server with what was sent, record by record,
     and returns what this person may not do, plus the value the server
     should keep if the write is accepted: records the person could not see
     are kept as they are, placeholders are never saved, and hidden private
     fields of a team record are kept from the server copy. */
  function keyOf(r) { return r && typeof r === 'object' && r.id ? 'id:' + r.id : 'json:' + JSON.stringify(r); }
  function mergeWrite(p, key, curRaw, nextValue) {
    const res = { cls: classOf(key), violations: [], value: nextValue, advisory: [] };
    if (!p) { res.violations.push({ id: '', reason: 'not_signed_in' }); return res; }
    if (p.admin || UNSCOPED) return res;
    if (!res.cls) { res.violations.push({ id: '', reason: 'store_has_no_rule' }); return res; }
    const cur = parsedRaw(key, curRaw);
    const c = context(p);

    if (res.cls === 'S') {
      if (JSON.stringify(cur) !== JSON.stringify(nextValue) && !SETTINGS_WRITE[key](p)) res.violations.push({ id: '', reason: 'settings_write_not_allowed' });
      return res;
    }
    if (!Array.isArray(nextValue)) {
      if (res.cls !== 'X') res.violations.push({ id: '', reason: 'not_a_list' });
      return res;
    }
    const before = Array.isArray(cur) ? cur : [];

    if (res.cls === 'T') {
      teamViolations(p, before, nextValue).forEach((v) => res.violations.push({ id: v.memberId, reason: v.reason }));
      const byId = new Map(before.filter((m) => m && m.id).map((m) => [m.id, m]));
      res.value = nextValue.map((m) => {
        if (!m || !m.id || !byId.has(m.id)) return m;
        const hide = privateHidden(p, m.id);
        if (!hide.length) return m;
        const was = byId.get(m.id), copy = Object.assign({}, m);
        hide.forEach((k) => { if (was[k] === undefined) delete copy[k]; else copy[k] = was[k]; });
        return copy;
      });
      return res;
    }

    if (res.cls === 'L') {
      const nextKeys = new Map(); nextValue.forEach((r) => nextKeys.set(keyOf(r), r));
      const curKeys = new Set(before.map(keyOf));
      const seen = before.filter((r) => readable(key, r, c));          // what this person could read
      /* An entry they could not read is not "removed" by leaving it out: it is kept. */
      const removed = seen.filter((r) => !nextKeys.has(keyOf(r)));
      const changed = before.filter((r) => nextKeys.has(keyOf(r)) && JSON.stringify(nextKeys.get(keyOf(r))) !== JSON.stringify(r));
      if (changed.length) res.violations.push({ id: changed.slice(0, 5).map(keyOf).join(','), reason: 'log_entry_changed' });
      if (removed.length) {
        const prefix = removed.every((r, i) => keyOf(r) === keyOf(seen[i]));          // only the oldest may go
        if (STRICT_LOGS.has(key) || !prefix) res.violations.push({ id: removed.slice(0, 5).map(keyOf).join(','), reason: 'log_entry_removed' });
      }
      /* What is kept: everything already there (less the oldest lines a capped
         log let go), then what is new. */
      const gone = new Set(STRICT_LOGS.has(key) ? [] : removed.map(keyOf));
      const added = nextValue.filter((r) => !curKeys.has(keyOf(r)));
      res.value = before.filter((r) => !gone.has(keyOf(r))).concat(added);
      return res;
    }

    const rule = (r) => readable(key, r, c);
    const module = STORE_MODULE[key];
    const cap = res.cls === 'X' && SYSTEM[key] ? SYSTEM[key].write : null;
    if (cap && !cap(p) && JSON.stringify(before) !== JSON.stringify(nextValue)) {
      res.violations.push({ id: '', reason: 'write_needs_permission' });
      return res;
    }
    const curMap = new Map(); before.forEach((r) => curMap.set(keyOf(r), r));
    const nextMap = new Map();
    nextValue.forEach((r) => { if (r && r._stub) return; nextMap.set(keyOf(r), r); });
    for (const [k, r] of nextMap) {
      const was = curMap.get(k);
      if (was && JSON.stringify(was) === JSON.stringify(r)) continue;
      const id = r && r.id ? r.id : '';
      if (!was) {
        if (!rule(r) && !CREATE_FOR_OTHERS.has(key)) res.violations.push({ id, reason: 'create_outside_scope' });
        else if (module && !can(p, module, 'create')) res.advisory.push({ id, reason: 'module_create_right' });
        continue;
      }
      const okBefore = rule(was);
      if (!okBefore) { res.violations.push({ id, reason: 'edit_outside_scope' }); continue; }
      if (!rule(r)) {
        if (!(module && (can(p, module, 'reassign') || can(p, module, 'assign')))) res.violations.push({ id, reason: 'moved_outside_scope' });
        continue;
      }
      if (module && !can(p, module, 'edit') && !can(p, module, 'changeStage')) res.advisory.push({ id, reason: 'module_edit_right' });
    }
    for (const [k, was] of curMap) {
      if (nextMap.has(k)) continue;
      if (rule(was) && module && !can(p, module, 'delete')) res.advisory.push({ id: was && was.id, reason: 'module_delete_right' });
    }
    /* The value kept: the server's order, with the person's changes, their
       removals of records they could see, and their new records; every
       record they could not see stays exactly as it was. */
    const merged = [];
    for (const [k, was] of curMap) {
      if (nextMap.has(k)) merged.push(nextMap.get(k));
      else if (!rule(was)) merged.push(was);
    }
    for (const [k, r] of nextMap) if (!curMap.has(k)) merged.push(r);
    res.value = merged;
    return res;
  }

  /* -------- the day-1 guard against a save that would wipe records --------
     A list that becomes empty while losing two or more records, or loses
     more than max(5, 10%) of what is on the server in one save, is refused unless an administrator account
     confirms how many records it means to remove (X-CRM-Confirm-Bulk: n,
     with n at least the number removed). That is the shape of the failure
     it exists for: a store that did not load, saved back from what little
     the tab holds. An object store (config, settings) emptied is refused
     the same way. Soft deletion (deletedAt) is an edit, not a removal. */
  const SHRINK_EXEMPT = new Set(['apiInbox']);                 // a queue: draining it is its job
  function shrinkCheck(p, key, curRaw, nextValue, confirmHeader) {
    if (SHRINK_EXEMPT.has(key) || DYNAMIC.test(key)) return null;  // per-upload rows are replaced whole on purpose
    const cur = parsedRaw(key, curRaw);
    if (cur === undefined || cur === null) return null;
    let removed = 0, total = 0, emptied = false;
    if (Array.isArray(cur) && Array.isArray(nextValue)) {
      total = cur.length;
      /* Records with an id that are gone, or the drop in length, whichever is
         larger: a list without ids that is rebuilt in place is not a wipe. */
      const keep = new Set(nextValue.filter((r) => r && r.id).map((r) => r.id));
      const idGone = cur.filter((r) => r && r.id && !keep.has(r.id)).length;
      removed = Math.max(idGone, cur.length - nextValue.length);
      emptied = cur.length > 0 && nextValue.length === 0;
    } else if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      total = Object.keys(cur).length;
      emptied = total > 0 && (nextValue === null || (typeof nextValue === 'object' && !Array.isArray(nextValue) && !Object.keys(nextValue).length));
      removed = emptied ? total : 0;
    } else return null;
    const limit = Math.max(5, Math.floor(total * 0.10));
    /* Emptying is refused when it takes two or more records with it. Removing
       the last single record (converting the only lead, deleting the only SLA
       rule) is an ordinary action and goes through (decision, 2026-11-17). */
    if (!(emptied && removed >= 2) && removed <= limit) return null;
    const n = Number(confirmHeader);
    if (p && p.admin && Number.isFinite(n) && n >= removed) return null;
    return { removed, total, emptied, limit, confirmed: confirmHeader !== undefined && confirmHeader !== '' };
  }

  /* -------- PAN match: which clients carry these PANs, without saying the PANs --------
     For each PAN asked about: the ids of the live clients in the person's
     scope that carry it, and whether it is also on a client outside their
     scope (yes or no, nothing more). The page uses it for platform imports
     and duplicate checks when it only holds masked PANs. */
  const panIndexCache = { raw: null, index: null };
  function panIndex() {
    const raw = storeRaw('clients');
    if (panIndexCache.raw === raw && panIndexCache.index) return panIndexCache.index;
    const index = new Map();
    for (const c of parsed('clients', [])) {
      if (!c || c.deletedAt || !isFullPan(c.pan)) continue;
      const k = c.pan.trim().toUpperCase();
      if (!index.has(k)) index.set(k, []);
      index.get(k).push(c);
    }
    panIndexCache.raw = raw; panIndexCache.index = index;
    return index;
  }
  /* One answer per PAN asked, in the same order; null for something that
     is not a PAN. The answer carries ids and a yes/no, never a PAN. */
  function panMatch(p, pans) {
    const index = panIndex();
    const c = context(p);
    return pans.map((raw) => {
      const k = String(raw || '').trim().toUpperCase();
      if (!PAN_FULL_RE.test(k)) return null;
      const hits = index.get(k) || [];
      const mine = p.admin ? hits : hits.filter((cl) => readable('clients', cl, c));
      return { ids: mine.map((cl) => cl.id), elsewhere: hits.length > mine.length };
    });
  }
  function mayMatchPans(p) { return !!p && (p.admin || can(p, 'CMS', 'view') || can(p, 'CMS', 'create') || mayImport(p)); }

  /* -------- Aadhaar: the client must be the person's to work on --------
     Store or replace: the client is in scope and CMS edit is held.
     Remove: also CMS delete. View: the approval list (unchanged, checked by
     the route) and the client in scope. The administrator account: always. */
  function aadhaarDecision(p, clientId, action) {
    if (!p) return { ok: false, reason: 'not_signed_in' };
    if (p.admin) return { ok: true };
    const c = context(p);
    const client = c.get('clients', clientId);
    if (!client) return { ok: false, reason: 'no_such_client' };
    if (!readable('clients', client, c)) return { ok: false, reason: 'client_outside_scope' };
    if (action === 'view') return { ok: true };
    if (!can(p, 'CMS', 'edit')) return { ok: false, reason: 'needs_cms_edit' };
    if (action === 'remove' && !can(p, 'CMS', 'delete')) return { ok: false, reason: 'needs_cms_delete' };
    return { ok: true };
  }

  /* -------- Mail as the firm (step 4; report mode first) --------
     Every recipient must be an email address found on a record the person
     can see (a client, a lead, a campaign recipient), on the team, or be
     their own. Anything else needs the administrator account or the
     mailExternal flag. A campaign or drip send needs Campaigns permission.
     Free-form compose is capped at 20 recipients a message. */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function emailsIn(v, out) {
    if (typeof v === 'string') { const t = v.trim().toLowerCase(); if (EMAIL_RE.test(t)) out.add(t); }
    else if (v && typeof v === 'object') (Array.isArray(v) ? v : Object.values(v)).forEach((x) => emailsIn(x, out));
    return out;
  }
  function mailDecision(p, addresses, kind) {
    if (!p) return { ok: false, reason: 'not_signed_in' };
    if (p.admin) return { ok: true };
    const reasons = [];
    if ((kind === 'campaign' || kind === 'drip') && !(can(p, 'Campaigns', 'edit') || can(p, 'Campaigns', 'create'))) reasons.push('needs_campaigns_permission');
    if (kind === 'compose' && addresses.length > 20) reasons.push('too_many_recipients');
    if (!canAdmin(p, 'mailExternal')) {
      const c = context(p);
      const ok = new Set();
      emailsIn(p.email, ok);
      team().forEach((m) => { if (m) ['email', 'personalEmail', 'officialEmail'].forEach((k) => emailsIn(m[k], ok)); });
      ['clients', 'leads', 'campaignRecipients'].forEach((k) => { for (const r of c.list(k)) if (r && readable(k, r, c)) emailsIn(r, ok); });
      const outside = addresses.filter((a) => !ok.has(String(a).trim().toLowerCase()));
      if (outside.length) reasons.push('recipient_outside_scope');
    }
    return reasons.length ? { ok: false, reason: reasons.join(',') } : { ok: true };
  }
  /* The assistant (step 4; report mode first): the page's canUse('useAiAssistant'). */
  function mayUseAi(p) {
    if (!p) return false;
    if (p.admin || p.teamAdmin) return true;
    return !!(p.member && p.member.adminFlags && p.member.adminFlags.useAiAssistant);
  }

  return {
    MODE, UNSCOPED, ADMIN_ROLE, ADMIN_FLAGS, USER_FLAGS, TEAM_PROTECTED, TEAM_PRIVATE,
    panMatch, mayMatchPans, aadhaarDecision, mailDecision, mayUseAi,
    principal, can, canAdmin, hrAdmin, inScope, teamViolations,
    classOf, readView, mergeWrite, shrinkCheck,
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
  'GET /api/access/reconcile': 'admin', 'GET /api/audit': 'admin', 'POST /api/clients/pan-match': 'scoped',
  'GET /api/public/bundle': 'token', 'POST /api/public/patch': 'token', 'POST /api/approvals': 'signed-in',
  'POST /api/public/approval': 'token', 'POST /api/public/mail': 'token', 'POST /api/public/website-lead': 'public',
  'GET /config.js': 'public', 'POST /api/reminders/run': 'test-only',
  'GET /api/push/key': 'public', 'POST /api/push/subscribe': 'signed-in', 'POST /api/push/unsubscribe': 'signed-in',
  'GET /api/reminders/log': 'scoped', 'GET /api/attendance/today': 'signed-in', 'GET /*splat': 'public',
};

module.exports = { create, ROUTE_POLICY, TEAM_PROTECTED, ADMIN_ROLE, DEFAULT_ROLES,
  maskPan, isFullPan, isMaskedPan, maskPansDeep, restoreMaskedPans };

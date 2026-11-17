/* EVERY ROUTE HAS A DECLARED POLICY.

   access-control.js keeps one entry per route server.js registers, saying
   who the route is for. This reads server.js itself and fails on a route
   with no entry, so a new route cannot slip in without somebody deciding.
   It also fails on an entry for a route that no longer exists, so the list
   cannot quietly rot. Phase 1, step 1. */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const { ROUTE_POLICY } = require('../../access-control');

const KINDS = new Set(['public', 'token', 'signed-in', 'scoped', 'admin', 'day1-admin', 'test-only']);

secSuite(async (t) => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
  const re = /^\s*app\.(get|post|put|delete|patch)\(\s*(['"`])([^'"`]+)\2/gm;
  const routes = new Set(); let m;
  while ((m = re.exec(src))) routes.add(m[1].toUpperCase() + ' ' + m[3]);

  await t.step('server.js registers routes the scan can read', async () => {
    if (routes.size < 60) throw new Error('only ' + routes.size + ' routes found; the scan is broken');
    return routes.size + ' routes';
  });

  await t.step('every route has a declared policy', async () => {
    const missing = [...routes].filter((r) => !ROUTE_POLICY[r]);
    if (missing.length) throw new Error('no policy for: ' + missing.join(', '));
    return 'all ' + routes.size + ' covered';
  });

  await t.step('no policy entry names a route that does not exist', async () => {
    const stale = Object.keys(ROUTE_POLICY).filter((r) => !routes.has(r));
    if (stale.length) throw new Error('stale entries: ' + stale.join(', '));
    return Object.keys(ROUTE_POLICY).length + ' entries, none stale';
  });

  await t.step('every policy is one of the known kinds', async () => {
    const odd = Object.entries(ROUTE_POLICY).filter(([, k]) => !KINDS.has(k));
    if (odd.length) throw new Error(odd.map(([r, k]) => r + ' → ' + k).join(', '));
    const counts = {};
    Object.values(ROUTE_POLICY).forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
    return Object.entries(counts).map(([k, n]) => k + ' ' + n).join(', ');
  });

  await t.step('the routes the day-1 lock-down covers are declared as such', async () => {
    const want = ['DELETE /api/storage/:key', 'PUT /api/connections/:id', 'DELETE /api/connections/:id',
      'POST /api/connections/:id/test', 'PUT /api/apiconnectors/:id', 'DELETE /api/apiconnectors/:id'];
    const wrong = want.filter((r) => ROUTE_POLICY[r] !== 'day1-admin');
    if (wrong.length) throw new Error('not day1-admin: ' + wrong.join(', '));
    return want.length + ' routes';
  });
});

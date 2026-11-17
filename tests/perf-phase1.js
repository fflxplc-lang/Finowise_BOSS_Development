/* PHASE 1 COST, MEASURED — NOT A SUITE.

     node tests/perf-phase1.js [serverDir] [sizes]
     e.g. node tests/perf-phase1.js . 1478,10000,50000
          node tests/perf-phase1.js /path/to/a/baseline/checkout 1478,10000,50000

   Starts the server found in serverDir on synthetic data (tests/lib/
   sec-seed.js) at each size, in report mode and (where the code has it)
   enforce mode, and prints the median of 5 timings for the requests that
   Phase 1 touches: reading and saving the client store as the
   administrator account and as an RM, and the session check. Prints
   numbers only. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const seed = require('./lib/sec-seed');
const { login } = require('./lib/sec-http');

const DIR = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const SIZES = (process.argv[3] || '1478,10000,50000').split(',').map(Number);
const PORT = Number(process.env.PERF_PORT || 22800);
const ADMIN = { email: 'perf-admin@x.test', password: 'Perf-admin-pass-1' };
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

async function start(env, n) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-'));
  const users = path.join(d, 'users.db');
  const run = (a) => execFileSync(process.execPath, [path.join(DIR, 'scripts', 'user.js')].concat(a), { env: Object.assign({}, process.env, { CRM_USERS_DB: users }), stdio: 'ignore' });
  run(['add', ADMIN.email, ADMIN.password]); run(['role', ADMIN.email, 'admin']);
  const port = PORT + n;
  const child = spawn(process.execPath, ['server.js'], { cwd: DIR, stdio: 'ignore', env: Object.assign({}, process.env, env, {
    PORT: String(port), CRM_DB_FILE: path.join(d, 'data.json'), CRM_USERS_DB: users, CRM_CONNECTIONS_FILE: path.join(d, 'connections.json'), CRM_REMINDERS: 'manual' }) });
  const base = 'http://localhost:' + port;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch (e) { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
  return { base, stop: () => new Promise((r) => { child.once('exit', r); child.kill(); }) };
}
async function time(fn) { const t = []; for (let i = 0; i < 5; i++) { const t0 = process.hrtime.bigint(); await fn(i); t.push(Number(process.hrtime.bigint() - t0) / 1e6); } return Math.round(median(t)); }

(async () => {
  const hasEnforce = fs.readFileSync(path.join(DIR, 'server.js'), 'utf8').includes('CRM_ACCESS_MODE') || fs.existsSync(path.join(DIR, 'access-control.js'));
  const rows = [];
  let k = 0;
  for (const n of SIZES) {
    const data = seed.build(n);
    for (const mode of hasEnforce ? ['report', 'enforce'] : ['(baseline)']) {
      const srv = await start(mode === '(baseline)' ? {} : { CRM_ACCESS_MODE: mode }, k++);
      const admin = await login(ADMIN.email, ADMIN.password, srv.base);
      await seed.load(admin, data);
      const r = await admin.post('/api/users/sync', { memberId: 'U-RMA', email: 'perf-rma@x.test', password: 'Perf-rma-pass-1', crmRole: '' });
      const rm = await login('perf-rma@x.test', 'Perf-rma-pass-1', srv.base);
      const all = await admin.store('clients', []);
      const mine = await rm.store('clients', []);
      const out = { size: n, mode };
      out.adminRead = await time(() => admin.get('/api/storage/clients'));
      out.rmRead = await time(() => rm.get('/api/storage/clients'));
      out.adminSave = await time((i) => admin.save('clients', all.map((c, j) => (j === 0 ? Object.assign({}, c, { city: 'ZZ' + i }) : c))));
      const ownIdx = mine.findIndex((c) => c.rmName === 'U-RMA');
      out.rmSave = await time((i) => rm.save('clients', mine.map((c, j) => (j === ownIdx ? Object.assign({}, c, { city: 'ZZ' + i }) : c))));
      out.sessionCheck = await time(() => admin.get('/api/health'));
      out.rmSees = mine.filter((c) => !c._stub).length + '/' + all.length;
      rows.push(out);
      await srv.stop();
      if (!r.json || !r.json.ok) console.error('account sync failed at', n, mode);
    }
  }
  console.log('size'.padEnd(7), 'mode'.padEnd(11), 'adminRead', 'rmRead', 'adminSave', 'rmSave', 'health', ' rmSees');
  rows.forEach((o) => console.log(String(o.size).padEnd(7), o.mode.padEnd(11), String(o.adminRead).padStart(9), String(o.rmRead).padStart(6),
    String(o.adminSave).padStart(9), String(o.rmSave).padStart(6), String(o.sessionCheck).padStart(6), ' ' + o.rmSees));
  console.log('(milliseconds, median of 5, through HTTP on this machine)');
})().catch((e) => { console.error(e); process.exit(1); });

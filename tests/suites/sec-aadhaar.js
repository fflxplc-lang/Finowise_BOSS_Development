/* AADHAAR: ONLY FOR CLIENTS THAT ARE YOURS — PHASE 1, STEP 3.

   The vault (aadhaar-vault.json, AES-256-GCM) was already approval-listed
   for viewing, but anyone signed in could store, overwrite or remove the
   number of any client. Now, in enforce mode:
     store or replace  the client is in your scope and you hold CMS edit;
     remove            also CMS delete;
     view              the approval list (as before) and the client in scope.
   The administrator account is not limited by scope (viewing still needs
   the approval list). Report mode records a refusal and carries on.
   Every attempt is in the server audit trail without any digits.

   The vault's key and encryption are not touched: a number stored before a
   restart reads back after it, with the same secret. Synthetic numbers
   only (valid check digit, no real person). */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');

/* A 12-digit number with a valid Verhoeff check digit, from an 11-digit stem. */
const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const INV = [0,4,3,2,1,5,6,7,8,9];
function aadhaar(stem) {
  let c = 0;
  (stem + '0').split('').reverse().forEach((ch, i) => { c = D[c][P[i % 8][Number(ch)]]; });
  return stem + INV[c];
}
const N1 = aadhaar('29876543210'), N2 = aadhaar('38765432109'), N3 = aadhaar('47654321098');

secSuite(async (t) => {
  const data = seed.build(40);
  const SECRET = 'zz-test-only-session-secret';            // a test value, for the restart check
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce', CRM_SESSION_SECRET: SECRET });
  const admin = await srv.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const rmB = await seed.signIn(admin, 'U-RMB');
  const rmC = await seed.signIn(admin, 'U-RMC');
  const tAdm = await seed.signIn(admin, 'U-TADM');
  const own = data.clients.find((c) => c.rmName === 'U-RMA').id;
  const bs = data.clients.find((c) => c.rmName === 'U-RMB').id;
  const cs = data.clients.find((c) => c.rmName === 'U-RMC').id;
  const vault = () => { try { return JSON.parse(fs.readFileSync(path.join(srv.dir, 'aadhaar-vault.json'), 'utf8')); } catch (e) { return { clients: {} }; } };
  await admin.put('/api/aadhaar/access', { emails: [seed.email('U-RMA'), seed.email('U-RMB'), seed.email('U-TADM'), 'test@finowise.test'], roles: [] });

  await t.step('an RM may store the Aadhaar number of their own client', async () => {
    const r = await rmA.put('/api/aadhaar/' + own, { number: N1 });
    if (r.status !== 200 || !vault().clients[own]) throw new Error(r.status + ' ' + r.text);
    return '200; sealed in the vault (last four ' + vault().clients[own].last4 + ')';
  });

  await t.step('an RM cannot store or overwrite the number of another RM’s client', async () => {
    const before = JSON.stringify(vault().clients[bs] || null);
    const r = await rmA.put('/api/aadhaar/' + bs, { number: N2 });
    if (r.status !== 403 || JSON.stringify(vault().clients[bs] || null) !== before) throw new Error(r.status + ' ' + r.text);
    const r2 = await rmC.put('/api/aadhaar/' + own, { number: N3 });          // another branch
    if (r2.status !== 403 || vault().clients[own].last4 !== N1.slice(-4)) throw new Error('RM C overwrote: ' + r2.status);
    return 'RM A on RM B’s client 403; RM C (branch B) on RM A’s client 403; vault unchanged';
  });

  await t.step('removing needs CMS delete as well', async () => {
    await rmB.put('/api/aadhaar/' + bs, { number: N2 });
    const noDelete = await rmB.put('/api/aadhaar/' + bs, { number: '' });       // RM B: edit, no delete
    const still = !!vault().clients[bs];
    const otherRemove = await rmA.put('/api/aadhaar/' + bs, { number: '' });    // RM A: not theirs
    if (noDelete.status !== 403 || !still || otherRemove.status !== 403 || !vault().clients[bs]) throw new Error([noDelete.status, still, otherRemove.status].join(','));
    const ok = await rmA.put('/api/aadhaar/' + own, { number: '' });            // RM A: own, has delete
    const gone = !vault().clients[own];
    await rmA.put('/api/aadhaar/' + own, { number: N1 });
    if (ok.status !== 200 || !gone) throw new Error('own removal: ' + ok.status);
    return 'RM B without delete 403; RM A on another’s 403; RM A on own (with delete) 200';
  });

  await t.step('viewing: approved and in scope sees the number; approved but out of scope does not; unapproved does not', async () => {
    const a = await rmA.get('/api/aadhaar/' + own);
    const b = await rmA.get('/api/aadhaar/' + bs);
    const c = await rmC.get('/api/aadhaar/' + cs);
    if (a.status !== 200 || a.json.number !== N1 || b.status !== 403 || c.status !== 403) throw new Error([a.status, b.status, c.status].join(','));
    return 'own 200 (number matches); RM B’s 403; RM C not approved 403';
  });

  await t.step('the team role Admin is held to scope; the administrator account is not', async () => {
    const t1 = await tAdm.get('/api/aadhaar/' + bs);                 // team Admin sees all records, as the page does
    const ad = await admin.get('/api/aadhaar/' + bs);
    if (t1.status !== 200 || ad.status !== 200 || ad.json.number !== N2) throw new Error(t1.status + ' ' + ad.status);
    return 'team Admin 200 (every record is in its scope, as in the page); administrator 200';
  });

  await t.step('every attempt is audited, and no Aadhaar number appears in the audit trail or the server log', async () => {
    const e = ((await admin.get('/api/audit?limit=300')).json.entries || []).filter((x) => /^aadhaar\./.test(x.action));
    const text = JSON.stringify(e) + srv.log();
    const leak = [N1, N2, N3].filter((n) => text.includes(n));
    const vaultText = fs.readFileSync(path.join(srv.dir, 'aadhaar-vault.json'), 'utf8');
    if (e.filter((x) => x.outcome === 'deny').length < 5 || leak.length || [N1, N2].some((n) => vaultText.includes(n))) throw new Error(e.length + ' entries; leaks ' + leak.length);
    return e.length + ' entries (' + e.filter((x) => x.outcome === 'deny').length + ' refused); no full number in the trail, the log or the vault file';
  });

  /* The vault after a restart, with the same secret: the encryption is unchanged. */
  await t.step('a number stored before a restart reads back after it (same secret, vault untouched)', async () => {
    await srv.stop();
    const again = await t.startServer({ CRM_ACCESS_MODE: 'enforce', CRM_SESSION_SECRET: SECRET }, { dir: srv.dir });
    const a2 = await again.admin();
    const r = await a2.get('/api/aadhaar/' + own);
    if (r.status !== 200 || r.json.number !== N1) throw new Error(r.status + ' ' + r.text);
    return 'read back ' + N1.slice(0, 2) + '…' + N1.slice(-4) + ' after a restart';
  });

  /* Report mode: the runner's server. */
  const radmin = await t.admin();
  await seed.load(radmin, data);
  const rA = await seed.signIn(radmin, 'U-RMA');
  await t.step('report mode: storing on another RM’s client goes through as before, and is recorded as would-deny', async () => {
    const r = await rA.put('/api/aadhaar/' + bs, { number: N2 });
    const e = ((await radmin.get('/api/audit?limit=100')).json.entries || []).find((x) => x.action === 'aadhaar.store' && x.outcome === 'would-deny');
    if (r.status !== 200 || !e || e.reason !== 'client_outside_scope') throw new Error(r.status + ' ' + JSON.stringify(e));
    return '200, recorded: ' + e.reason;
  });
});

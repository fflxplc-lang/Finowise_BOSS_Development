/* DELETING A WHOLE STORE — PHASE 1, STEP 2, ENFORCED FROM DAY 1.

   DELETE /api/storage/<store> used to drop any store for anyone signed in:
   one call and the client list was gone. It is now for an administrator
   account only, in every mode, and the store is copied to
   backups/store-delete/ before it goes. This suite runs against the
   runner's own server, which is in report mode, to show the rule does not
   wait for enforcement; and against a second server to read the copy. */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');

secSuite(async (t) => {
  const data = seed.build(40);
  const admin = await t.admin();
  await seed.load(admin, data);
  const rmA = await seed.signIn(admin, 'U-RMA');
  const tAdm = await seed.signIn(admin, 'U-TADM');
  const pm = await seed.signIn(admin, 'U-PM');

  await t.step('the server is in report mode, and the delete rule applies anyway', async () => {
    const r = await admin.get('/api/access/reconcile');
    if (r.json.mode !== 'report') throw new Error('mode ' + r.json.mode);
    return 'report';
  });

  await t.step('an RM cannot delete the client list, the team or the audit log', async () => {
    const got = [];
    for (const k of ['clients', 'team', 'auditLog', 'config']) got.push(k + ' ' + (await rmA.del('/api/storage/' + k)).status);
    const still = await admin.store('clients', []);
    if (got.some((g) => !/ 403$/.test(g)) || still.length !== data.clients.length) throw new Error(got.join(', ') + '; clients ' + still.length);
    return got.join(', ') + '; all ' + still.length + ' clients still there';
  });

  await t.step('neither the team role Admin nor a permissions manager can delete a store', async () => {
    const a = (await tAdm.del('/api/storage/leads')).status, b = (await pm.del('/api/storage/leads')).status;
    const still = await admin.store('leads', []);
    if (a !== 403 || b !== 403 || still.length !== data.leads.length) throw new Error(a + ' ' + b + ' ' + still.length);
    return 'team Admin 403, permissions manager 403; leads intact';
  });

  await t.step('signed out, nothing is deleted', async () => {
    const s = (await t.anonymous().del('/api/storage/clients')).status;
    if (s !== 401) throw new Error(String(s));
    return '401';
  });

  await t.step('the administrator account may delete a store', async () => {
    await admin.save('zzScratch', [{ id: 'Z1' }, { id: 'Z2' }]);
    const r = await admin.del('/api/storage/zzScratch');
    const after = await admin.get('/api/storage/zzScratch');
    if (r.status !== 200 || after.status !== 404) throw new Error(r.status + ' / ' + after.status);
    return 'deleted (200), then 404';
  });

  await t.step('every attempt is in the audit trail', async () => {
    const e = ((await admin.get('/api/audit?limit=300')).json.entries || []).filter((x) => x.action === 'store.delete');
    const denied = e.filter((x) => x.outcome === 'deny').length, done = e.filter((x) => x.outcome === 'ok').length;
    if (denied < 6 || done < 1) throw new Error(denied + ' denied, ' + done + ' done');
    return denied + ' refused, ' + done + ' done';
  });

  /* The copy, read from a server whose data folder this suite knows. */
  const srv = await t.startServer({});
  const a2 = await srv.admin();
  await t.step('the store is copied to backups/store-delete/ before it goes', async () => {
    const value = [{ id: 'ZZK1', name: 'ZZ kept' }, { id: 'ZZK2', name: 'ZZ kept too' }];
    await a2.save('zzKeep', value);
    const r = await a2.del('/api/storage/zzKeep');
    const dir = path.join(srv.dir, 'backups', 'store-delete');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /zzKeep\.json$/.test(f)) : [];
    const copy = files.length ? JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8')) : null;
    if (r.status !== 200 || !copy || JSON.stringify(copy) !== JSON.stringify(value)) throw new Error(r.status + ' ' + files.join(','));
    return files[0] + ' holds the 2 records';
  });
});

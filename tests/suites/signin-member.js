/* WHO YOU SIGNED IN AS IS WHO BOSS IS.

   Reported (TEST): signed in as Shubham Seth, a senior — BOSS opened the
   Admin's profile, not his. The page links the signed-in account to a team
   member by the account's member id or its address; when neither matched,
   it carried on as whoever was first in the team list: the Admin. On this
   copy the role hierarchy is enforced in the browser, so that meant the
   Admin's access and every record. Checked here, through the real sign-in
   page with a second account:
     1. an account linked to no team member gets a screen that says so and
        how to fix it — never the Admin, and nothing of the app behind it
     2. once the member's Official Email is that address, the same sign-in
        is that member: their name, role and scope, not an admin
     3. a personal email that is one member's links too
     4. the admin account still opens as before
   Synthetic accounts only. */
const path = require('path');
const {execFileSync} = require('child_process');
const {suite} = require('../lib/harness');

const ROOT = path.join(__dirname, '..', '..');
const USERS_DB = path.join(__dirname, '..', '.work', 'serial', 'users.db');
const addAccount = (email, password) => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'user.js'), 'add', email, password],
  {env: Object.assign({}, process.env, {CRM_USERS_DB: USERS_DB}), stdio: 'ignore'});

suite(async t => {
  await t.home();
  const browser = t.page.context().browser();
  /* A fresh browser, signed in through /login as this account. */
  const signInAs = async (email, password) => {
    const ctx = await browser.newContext(); const pg = await ctx.newPage();
    await pg.goto(t.base + '/login', {waitUntil: 'domcontentloaded'});
    await pg.fill('#email', email); await pg.fill('#password', password);
    await Promise.all([pg.waitForNavigation({waitUntil: 'domcontentloaded'}), pg.click('button[type=submit]')]);
    await pg.waitForFunction(() => document.getElementById('unlinkedSignIn') || (typeof currentUser !== 'undefined' && currentUser && document.querySelector('#content')), null, {timeout: 30000});
    await pg.waitForTimeout(400);
    const r = await pg.evaluate(() => ({unlinked: !!document.getElementById('unlinkedSignIn'), text: (document.getElementById('unlinkedSignIn') || {}).textContent || '',
      user: typeof currentUser !== 'undefined' ? currentUser : null, me: typeof me === 'function' && me() ? {name: me().name, role: me().role, scope: me().scope, admin: isAdmin(me())} : null,
      app: !!document.querySelector('#content'), adminSeen: /Administrator/.test((document.querySelector('.topbar, header, #topbar') || {}).textContent || ''),
      banner: (document.getElementById('unlinkedBanner') || {}).textContent || ''}));
    /* the screen an unlinked sign-in gets once UNLINKED_SIGNIN_BLOCKS is on */
    if(r.banner) r.blockScreen = await pg.evaluate(() => { renderUnlinkedSignIn(); const el = document.getElementById('unlinkedSignIn');
      return {screen: !!el, text: el ? el.textContent : '', me: me(), user: currentUser}; });
    await ctx.close();
    return r;
  };
  let senior = null;

  await t.step('setup: a senior team member, "ZZ Shubham Seth", and a sign-in account for an address no member has yet', async () => {
    senior = await t.eval(async () => {
      const m = {id: uid('TM'), name: 'ZZ Shubham Seth', role: roleList()[1] || 'Senior', status: 'Active', scope: 'team', branch: 'Varanasi',
        email: 'shubham.seth.official@zz.test', designation: 'Senior Manager', adminFlags: fullAdminFlags(false), perms: fullPerms(true), createdAt: new Date().toISOString()};
      DB.team.push(m); await save('team'); return {id: m.id, role: m.role};
    });
    addAccount('zz.shubham@zz.test', 'zzpassword1');
    return 'member ' + senior.id + ' (' + senior.role + ', team scope); account zz.shubham@zz.test, linked to nobody';
  });

  await t.step('1. signed in as an account no member has: BOSS opens, and says in red at the top that this sign-in is not linked and how to link it (the blocking screen is ready, switched off)', async () => {
    const r = await signInAs('zz.shubham@zz.test', 'zzpassword1');
    const b = r.blockScreen || {};
    if(r.unlinked || !r.app || !/This sign-in \(zz\.shubham@zz\.test\) is not linked to a team member/.test(r.banner) || !/Team & Access/.test(r.banner) || !/Official Email/.test(r.banner)
      || !b.screen || b.me || b.user || !/zz\.shubham@zz\.test/.test(b.text)) throw new Error(JSON.stringify(r).slice(0, 700));
    return 'banner: "' + r.banner.slice(0, 90) + '…"; with blocking on, the screen and nobody signed in';
  });

  await t.step('2. the member’s Official Email set to that address: the same sign-in is ZZ Shubham Seth — his role and scope, not an admin', async () => {
    await t.eval(async (id) => { const m = DB.team.find(x => x.id === id); m.email = ' ZZ.Shubham@zz.test '; await save('team'); }, senior.id);
    const r = await signInAs('zz.shubham@zz.test', 'zzpassword1');
    if(r.unlinked || r.user !== senior.id || !r.me || r.me.name !== 'ZZ Shubham Seth' || r.me.admin || r.me.scope !== 'team') throw new Error(JSON.stringify(r).slice(0, 600));
    return 'opens as ' + r.me.name + ' (' + r.me.role + ', ' + r.me.scope + ' scope, not admin); spaces and capitals in the address ignored';
  });

  await t.step('3. a personal email that is one member’s links too', async () => {
    const id = await t.eval(async () => { const m = {id: uid('TM'), name: 'ZZ Personal Mail', role: roleList()[2] || 'Executive', status: 'Active', scope: 'own', branch: 'Varanasi',
      email: 'zz.official.two@zz.test', personalEmail: 'zz.personal@zz.test', adminFlags: fullAdminFlags(false), perms: fullPerms(true), createdAt: new Date().toISOString()};
      DB.team.push(m); await save('team'); return m.id; });
    addAccount('zz.personal@zz.test', 'zzpassword2');
    const r = await signInAs('zz.personal@zz.test', 'zzpassword2');
    if(r.unlinked || r.user !== id || !r.me || r.me.name !== 'ZZ Personal Mail' || r.me.admin) throw new Error(JSON.stringify(r).slice(0, 500));
    return 'opens as ZZ Personal Mail';
  });

  await t.step('4. the admin account still opens BOSS as before', async () => {
    const r = await signInAs(require('../lib/signin').EMAIL, require('../lib/signin').PASSWORD);
    if(r.unlinked || !r.me || !r.me.admin || !r.app) throw new Error(JSON.stringify(r).slice(0, 500));
    return 'admin: ' + r.me.name;
  });
});

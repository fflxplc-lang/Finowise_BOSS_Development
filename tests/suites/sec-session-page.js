/* THE SESSION IN THE PAGE — PHASE 1, STEP 5.

   A server of its own with the idle limit shortened to 18 seconds (the
   warning then comes 3 seconds before the end, the same proportion as 25
   of 30 minutes). In a real browser:
     - with nobody touching anything, the bar "Stay signed in" appears
       before the end; pressing it keeps the session;
     - when the session has ended, the password is asked for over the
       screen: an open form keeps what was typed, a save made meanwhile
       waits and is sent once the person is back, and the account cannot
       be swapped in that box;
     - real mouse movement keeps a session going past the idle limit. */
const { secSuite } = require('../lib/sec-http');
const signIn = require('../lib/signin');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const IDLE_MS = 18000;

secSuite(async (t) => {
  const srv = await t.startServer({ CRM_IDLE_MINUTES: String(IDLE_MS / 60000) });
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await signIn(page, srv.base);
    await ready(page);
    await page.waitForFunction(() => appBooted === true && crmSess.started, null, { timeout: 30000 });
    const status = () => page.evaluate(async () => { const r = await fetch('/api/session', { headers: apiHeaders() }); return { status: r.status, json: await r.json() }; });

    await t.step('with nobody at the keyboard, "Stay signed in" appears before the end; pressing it keeps the session', async () => {
      const before = (await status()).json;
      await page.waitForSelector('#crmSessWarn [data-stay]:not([hidden])', { timeout: IDLE_MS + 5000 });
      const text = await page.textContent('#crmSessWarn [data-text]');
      const leftAtWarn = (await status()).json.idleLeftMs;
      await page.click('#crmSessWarn [data-stay]');
      await page.waitForSelector('#crmSessWarn', { state: 'detached', timeout: 5000 });
      const after = (await status()).json;
      if (!/signed out in 0:0[0-3]/.test(text) || leftAtWarn > 3500 || after.idleLeftMs < IDLE_MS - 2000 || before.warnBeforeMs !== 3000)
        throw new Error(JSON.stringify({ text, leftAtWarn, after: after.idleLeftMs, warn: before.warnBeforeMs }));
      return '"' + text + '" with ' + (leftAtWarn / 1000).toFixed(1) + ' s left; after "Stay signed in": ' + (after.idleLeftMs / 1000).toFixed(1) + ' s again';
    });

    await t.step('when it ends, the password is asked for over the screen; the open form and a save made meanwhile survive', async () => {
      await page.evaluate(() => openModal('ZZ unsaved form', '<input id="zzKeep" style="width:100%">', ''));
      await page.fill('#zzKeep', 'ZZ half-typed note');          // typing is activity: the clock restarts from here
      await page.waitForSelector('#crmRelogin', { timeout: IDLE_MS + 8000 });
      const why = await page.textContent('#crmRelogin p');
      /* A save made while signed out: it waits for the password, then goes. */
      const saving = page.evaluate(() => sset('zzSessionSave', [{ id: 'ZZ-1', note: 'made while signed out' }]).then(() => 'done'));
      await page.waitForTimeout(500);
      const emailLocked = await page.$eval('#crmRelogin input[name=email]', (el) => el.readOnly && el.value);
      await page.fill('#crmRelogin input[name=password]', 'wrong-password');
      await page.click('#crmRelogin button[type=submit]');
      await page.waitForFunction(() => /do not match/.test(document.querySelector('#crmRelogin [data-err]').textContent), null, { timeout: 5000 });
      await page.fill('#crmRelogin input[name=password]', signIn.PASSWORD);
      await page.click('#crmRelogin button[type=submit]');
      await page.waitForSelector('#crmRelogin', { state: 'detached', timeout: 8000 });
      const saved = await Promise.race([saving, new Promise((r) => setTimeout(() => r('timed out'), 8000))]);
      const kept = await page.inputValue('#zzKeep');
      const onServer = await page.evaluate(async () => (await sget('zzSessionSave', [])).length);
      if (!/without activity/.test(why) || emailLocked !== signIn.EMAIL || saved !== 'done' || kept !== 'ZZ half-typed note' || onServer !== 1)
        throw new Error(JSON.stringify({ why, emailLocked, saved, kept, onServer }));
      return '"' + why.slice(0, 60) + '…"; email fixed to this account; wrong password refused in place; form kept "' + kept + '"; the waiting save reached the server';
    });

    await t.step('real mouse movement keeps the session going past the idle limit', async () => {
      const t0 = Date.now();
      let i = 0;
      while (Date.now() - t0 < IDLE_MS + 8000) { await page.mouse.move(100 + (i % 50), 120 + (i % 30)); i++; await page.waitForTimeout(1500); }
      const s = await status();
      const dialog = await page.$('#crmRelogin');
      if (s.status !== 200 || dialog) throw new Error(s.status + ' dialog=' + !!dialog);
      return 'moved the mouse for ' + Math.round((Date.now() - t0) / 1000) + ' s (limit ' + IDLE_MS / 1000 + ' s): still signed in, no dialog';
    });

    await t.step('no page errors from any of it', async () => {
      const mine = errors.filter((m) => /crmSess|crmRelogin|session/i.test(m));
      if (mine.length) throw new Error(mine.join(' | '));
      return errors.length ? errors.length + ' unrelated page error(s)' : 'none';
    });
  } finally { await browser.close(); }
});

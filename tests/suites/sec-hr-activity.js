/* HR ACTIVE TIME AND THE SESSION — PHASE 1, STEP 5.

   Two things that must not interfere:
     - HR active-time tracking is unchanged: its code is byte for byte the
       baseline's (b4380fa), and it still records active and idle time;
     - its 30-second heartbeat, and the save that follows, do not keep the
       sign-in session alive. Only real input does (the page's activity
       ping), so the session's last-seen time stays put through beats and
       saves, and moves when the mouse does.
   A server of its own with a one-minute idle limit (last-seen is then
   written at most every 6 seconds). */
const path = require('path');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { secSuite } = require('../lib/sec-http');
const signIn = require('../lib/signin');
const pw = require('../lib/pw');
const ready = require('../lib/ready');
const CHROME = process.env.BOSS_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROOT = path.join(__dirname, '..', '..');

/* A top-level function's text, from "function name(" to its closing brace in column 0. */
function fnText(src, name) {
  const i = src.indexOf('\nfunction ' + name + '(') >= 0 ? src.indexOf('\nfunction ' + name + '(') : src.indexOf('\nasync function ' + name + '(');
  if (i < 0) return null;
  const end = src.indexOf('\n}\n', i);
  return src.slice(i, end + 3);
}
const HR_FUNCS = ['hrActivityCfg', 'hrActCfg', 'hrActNote', 'hrActBeat', 'hrSessionTimes', 'hrDayTimes', 'hrOpenSession', 'hrPunchIn', 'hrPunchOut'];

secSuite(async (t) => {
  await t.step('the HR active-time code is byte for byte the baseline’s', async () => {
    const now = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
    const base = execFileSync('git', ['show', 'b4380fa:public/index.html'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
    const differ = HR_FUNCS.filter((f) => fnText(now, f) !== fnText(base, f) || !fnText(now, f));
    /* and every line that feeds it input */
    const feed = (src) => src.split('\n').filter((l) => /hrAct\.lastInput\s*=/.test(l)).join('\n');
    if (differ.length || feed(now) !== feed(base) || !feed(now)) throw new Error('changed: ' + differ.join(', ') + (feed(now) !== feed(base) ? ' + input lines' : ''));
    return HR_FUNCS.length + ' functions and ' + feed(now).split('\n').length + ' input line(s) identical';
  });

  const srv = await t.startServer({ CRM_IDLE_MINUTES: '1', CRM_ATTENDANCE_ANY_DAY: '1' });
  const browser = await pw.chromium.launch({ executablePath: CHROME });
  const page = await (await browser.newContext()).newPage();
  try {
    await signIn(page, srv.base);
    await ready(page);
    await page.waitForFunction(() => appBooted === true && crmSess.started, null, { timeout: 30000 });
    const lastSeen = () => page.evaluate(async () => (await (await fetch('/api/session', { headers: apiHeaders() })).json()).lastSeenAt);

    await t.step('it still records active time, and idle time past the threshold', async () => {
      const r = await page.evaluate(async () => {
        DB.hrConfig = Object.assign({}, DB.hrConfig, { location: { required: false, note: '' },
          activity: { enabled: true, idleMinutes: 5, beatSeconds: 30, saveSeconds: 120 }, weeklyOff: [], holidays: [],
          day: Object.assign({}, (DB.hrConfig || {}).day, { punchInFrom: '00:00', punchOutUntil: '23:59' }) });
        window.hrClosedDayWhy = () => ''; window.hrIsSunday = () => false;
        DB.hrAttendance = []; await save('hrConfig'); await save('hrAttendance');
        await hrPunchIn();
        await new Promise((res) => setTimeout(res, 1200));
        hrAct.lastInput = Date.now(); hrAct.lastBeat = Date.now() - 1000;
        await hrActBeat(true);
        hrAct.lastInput = Date.now() - 6 * 60000; hrAct.lastBeat = Date.now() - 20000;     // no input for six minutes, a beat on time
        await hrActBeat(true);
        const s = hrOpenSession(hrAttendanceOf(me().id, hrToday()));
        return { kinds: (s.spans || []).map((x) => x.kind), times: hrSessionTimes(s) };
      });
      if (r.kinds.join(',') !== 'active,idle' || !(r.times.activeMs > 500) || !(r.times.idleMs > 0)) throw new Error(JSON.stringify(r));
      return 'spans: ' + r.kinds.join(', ') + '; active ' + (r.times.activeMs / 1000).toFixed(1) + ' s, idle ' + Math.round(r.times.idleMs / 1000) + ' s';
    });

    await t.step('its heartbeat and saves do not keep the session alive; real mouse movement does', async () => {
      const before = await lastSeen();
      for (let i = 0; i < 4; i++) {
        await page.evaluate(async () => { hrAct.lastInput = Date.now(); hrAct.lastBeat = Date.now() - 2000; await hrActBeat(true); await save('hrAttendance'); });
        await page.waitForTimeout(2000);
      }
      const afterBeats = await lastSeen();
      await page.mouse.move(200, 200); await page.mouse.move(240, 260);
      await page.waitForTimeout(1500);
      const afterInput = await lastSeen();
      if (afterBeats !== before || !(afterInput > before)) throw new Error(JSON.stringify({ before, afterBeats, afterInput }));
      return 'last seen unchanged through 4 beats and saves over 8 s; moved forward ' + ((afterInput - before) / 1000).toFixed(1) + ' s on mouse movement';
    });
  } finally { await browser.close(); }
});

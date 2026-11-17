/* SENDING MAIL AS THE FIRM — PHASE 1, STEP 4.

   SMTP settings are connector settings: administrator account only, from
   day 1 (sec-connectors covers that). Sending (POST /api/mail/send) is
   report mode first; in enforce mode:
     - every recipient must be on a record the sender can see (a client, a
       lead, a campaign recipient), on the team, or be the sender; anything
       else needs the administrator account or the mailExternal flag;
     - a campaign or drip send needs Campaigns permission;
     - free-form compose: at most 20 recipients, and a per-person hourly
       cap (100 in production; set low here with CRM_MAIL_HOURLY_CAP);
     - the From address is the connector's, whatever the request says.
   Every send is audited with its kind, recipient count and domains, never
   the addresses in full, the subject or the body. A fake SMTP server
   counts what actually left. */
const fs = require('fs');
const path = require('path');
const { secSuite } = require('../lib/sec-http');
const seed = require('../lib/sec-seed');
const smtp = require('../lib/smtp');

secSuite(async (t) => {
  const data = seed.build(20);
  const mailPort = Number(process.env.BOSS_PORT || 3000) + 650;
  const mail = smtp.start(mailPort); await mail.ready;
  const srv = await t.startServer({ CRM_ACCESS_MODE: 'enforce', CRM_MAIL_HOURLY_CAP: '3' });
  const admin = await srv.admin();
  await seed.load(admin, data);
  await admin.put('/api/connections/email', { enabled: true, config: smtp.connector(mailPort) });
  const tested = await admin.post('/api/connections/email/test', {});        // the connector must pass its test before it sends
  if (!tested.json || !tested.json.ok) throw new Error('the mail connector did not pass its test: ' + tested.text.slice(0, 200));
  mail.clear();
  const rmA = await seed.signIn(admin, 'U-RMA');
  const exec = await seed.signIn(admin, 'U-EXEC');
  const own = data.clients.find((c) => c.rmName === 'U-RMA');
  const other = data.clients.find((c) => c.rmName === 'U-RMB');
  const sent = () => mail.received.length;
  const send = (c, body, kind) => c.post('/api/mail/send', body, kind ? { 'X-CRM-Mail': kind } : {});

  await t.step('an RM may write to their own client, to a colleague and to themselves', async () => {
    const n = sent();
    const a = await send(rmA, { to: own.email, subject: 'ZZ hello', body: 'ZZ body one' }, 'compose');
    const b = await send(rmA, { to: seed.email('U-TL'), subject: 'ZZ note', body: 'ZZ body two' }, 'template');
    if (a.status !== 200 || b.status !== 200 || sent() !== n + 2) throw new Error([a.status, b.status, sent() - n].join(','));
    return '200, 200; 2 messages delivered';
  });

  await t.step('an RM cannot write to another RM’s client or to an arbitrary address', async () => {
    const n = sent();
    const a = await send(rmA, { to: other.email, subject: 'ZZ', body: 'ZZ' }, 'compose');
    const b = await send(rmA, { to: 'anyone@outside.example', subject: 'ZZ', body: 'ZZ' }, 'compose');
    const c = await send(rmA, { to: own.email, cc: 'leak@outside.example', subject: 'ZZ', body: 'ZZ' }, 'compose');
    if (a.status !== 403 || b.status !== 403 || c.status !== 403 || sent() !== n) throw new Error([a.status, b.status, c.status, sent() - n].join(','));
    return 'other RM’s client 403; arbitrary 403; own client with an outside cc 403; nothing delivered';
  });

  await t.step('a campaign or drip send needs Campaigns permission', async () => {
    const n = sent();
    const a = await send(exec, { to: seed.email('U-EXEC'), subject: 'ZZ campaign', body: 'ZZ' }, 'campaign');
    const b = await send(exec, { to: seed.email('U-EXEC'), subject: 'ZZ drip', body: 'ZZ' }, 'drip');
    const c = await send(admin, { to: own.email, subject: 'ZZ campaign', body: 'ZZ' }, 'campaign');
    if (a.status !== 403 || b.status !== 403 || c.status !== 200 || sent() !== n + 1) throw new Error([a.status, b.status, c.status].join(','));
    return 'Executive: campaign 403, drip 403; administrator 200';
  });

  await t.step('free-form compose: 21 recipients refused; the hourly cap answers 429', async () => {
    const many = Array.from({ length: 21 }, (_, i) => 'client' + i + '@sec.test');
    const a = await send(admin, { to: many.join(','), subject: 'ZZ', body: 'ZZ' }, 'compose');            // the administrator: no cap
    const b = await send(rmA, { to: many.join(','), subject: 'ZZ', body: 'ZZ' }, 'compose');
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await send(rmA, { to: own.email, subject: 'ZZ ' + i, body: 'ZZ' }, 'compose')).status);
    if (a.status !== 200 || b.status !== 403 || !statuses.includes(429)) throw new Error([a.status, b.status, statuses].join(','));
    return 'administrator 21 recipients 200; RM 21 recipients 403; RM over the hourly cap → ' + statuses.join(',');
  });

  await t.step('the From address is the connector’s, whatever the request says', async () => {
    const n = sent();
    await send(admin, { to: own.email, from: 'ceo@spoofed.example', fromName: 'Spoofed', subject: 'ZZ from', body: 'ZZ' }, 'template');
    const m = mail.received[n];
    if (!m || !/crm@finowise\.test/.test(m.from) || /spoofed/.test(JSON.stringify(m.from))) throw new Error(JSON.stringify(m && m.from));
    return 'sent from ' + m.from;
  });

  await t.step('every send is audited with kind, count and domains; never the address, subject or body', async () => {
    const auditDir = path.join(srv.dir, 'audit');
    const audit = fs.readdirSync(auditDir).map((f) => fs.readFileSync(path.join(auditDir, f), 'utf8')).join('');
    const lines = audit.split('\n').filter((l) => l.includes('"mail.send"'));
    const bad = ['ZZ hello', 'ZZ body', own.email, 'anyone@outside.example', 'leak@outside.example'].filter((x) => audit.includes(x));
    if (lines.length < 8 || bad.length || !/"fields":\["sec\.test"\]/.test(audit)) throw new Error(lines.length + ' lines; leaks ' + bad.join(','));
    return lines.length + ' mail lines (' + lines.filter((l) => /"deny"/.test(l)).length + ' refused); domains only';
  });

  /* Report mode: the runner's server. */
  const radmin = await t.admin();
  await seed.load(radmin, data);
  await radmin.put('/api/connections/email', { enabled: true, config: smtp.connector(mailPort) });
  await radmin.post('/api/connections/email/test', {});
  const rA = await seed.signIn(radmin, 'U-RMA');
  await t.step('report mode: a send to another RM’s client goes, and is recorded as would-deny', async () => {
    const n = sent();
    const r = await send(rA, { to: other.email, subject: 'ZZ report', body: 'ZZ' }, 'compose');
    const e = ((await radmin.get('/api/audit?limit=100')).json.entries || []).find((x) => x.action === 'mail.send' && x.outcome === 'would-deny');
    if (r.status !== 200 || sent() !== n + 1 || !e || !/recipient_outside_scope/.test(e.reason)) throw new Error(r.status + ' ' + JSON.stringify(e));
    return 'delivered (as before); would-deny: ' + e.reason;
  });
  await mail.close();
});

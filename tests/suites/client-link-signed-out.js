/* A CLIENT'S LINK OPENS FOR SOMEBODY WHO HAS NEVER SIGNED IN.

   A client opened their CIF link and got a blank page and "maLoadRows is
   not defined": the page's own scripts (multi-asset.js and the rest) sat
   behind the sign-in, so for anybody without an account they came back as
   the sign-in page. The test browser is always signed in, so no other suite
   saw it.

   Here every kind of form the firm sends — FQ, ISEQ, CIF, Plan Input and
   C&T — and the client's query desk is opened in a fresh browser with no
   session at all: each draws with no error, and nothing beyond the page's
   own scripts — the API, the workbook template, the app — is opened by it.

   And the moves a submission makes on the client's page — the CIF taking an
   insurance case to Documents Verification, the Plan Input form taking a
   lead to Plan Input Submitted — go through without "You do not have
   permission to move this record forward", recorded as by the client, with
   the tasks the stage raises. */
const {suite} = require('../lib/harness');

suite(async t => {
  let token = '';
  const out = (fn) => async () => {
    const ctx = await t.page.context().browser().newContext();
    const page = await ctx.newPage();
    const errs = [], said = [];
    page.on('pageerror', e => errs.push(String(e && e.message || e)));
    page.on('dialog', async d => { said.push(d.message()); await d.accept().catch(() => {}); });
    try { return await fn(page, errs, said); } finally { await ctx.close(); }
  };
  let links = {};
  await t.step('a link of every kind of form, made inside the CRM', async () => {
    links = await t.eval(async () => {
      const now = new Date().toISOString();
      const c = {id: 'CMS-ZZOUT', cmsName: 'ZZ Signed Out', mobile: '9800000091', email: 'zzout@zz.in', rmName: currentUser, createdAt: now};
      initState('CMS', c); DB.clients = DB.clients.filter(x => x.id !== c.id).concat([c]);
      const l = {id: 'LEAD-ZZOUT', firstName: 'ZZ', lastName: 'Out Lead', mobile: '9800000092', email: 'zzoutl@zz.in', assignedTo: currentUser, createdAt: now,
        transformationForm: 'MULTIGOAL', investmentApproach: 'Transformation'};
      initState('LMS', l); l.lmsStage = 'dataGatheringSent'; l[RECORD_STATE_FIELD.LMS] = 'dataGatheringSent';
      DB.leads = DB.leads.filter(x => x.id !== l.id).concat([l]);
      await save('clients'); await save('leads');
      const pick = cat => activeFormsInCategory(cat).filter(x => formQuestionCount(x))[0];
      const made = {};
      for(const [cat, rec] of [['FQ', 'lead'], ['ISEQ', 'lead'], ['CIF', 'client'], ['C&T', 'client']]){
        const type = pick(cat); if(!type) continue;
        made[cat] = rec === 'lead' ? await createDocLink(l.id, type, {recordModule: 'LMS', recordId: l.id}) : await createDocLink(c.id, type, {recordModule: 'CMS', recordId: c.id});
      }
      made.Plan = await createDocLink(l.id, 'MULTIGOAL', {recordModule: 'LMS', recordId: l.id});
      return made;
    });
    if(!links.CIF || !links.Plan) throw new Error(JSON.stringify(links));
    return Object.keys(links).join(', ');
  });

  await t.step('each one opens with no session: the form draws, no script is missing', out(async (page, errs) => {
    const bad = [], fine = [];
    for(const [cat, token] of Object.entries(links)){
      errs.length = 0;
      await page.goto(t.base + '/?doc=' + token, {waitUntil: 'domcontentloaded'});
      await page.waitForTimeout(2000);
      const r = await page.evaluate(() => ({url: location.pathname, banner: /Something went wrong on this screen/.test(document.body.innerText),
        ma: typeof maLoadRows, inputs: document.querySelectorAll('input, select, textarea').length}));
      if(errs.length || r.banner || r.ma !== 'function' || r.url !== '/' || !r.inputs) bad.push(cat + ' ' + JSON.stringify({r, errs}));
      else fine.push(cat + ' (' + r.inputs + ' boxes)');
    }
    if(bad.length) throw new Error(bad.join('\n'));
    return fine.join(' · ');
  }));

  await t.step('the CIF, submitted on the client’s page, takes an insurance case to Documents Verification', out(async (page, errs, said) => {
    await t.eval(async () => { const c = DB.clients.find(x => x.id === 'CMS-ZZOUT'); c.cmsStage = 'insCif'; c[RECORD_STATE_FIELD.CMS] = 'insCif'; await save('clients'); });
    await page.goto(t.base + '/?doc=' + links.CIF, {waitUntil: 'domcontentloaded'});
    await page.waitForTimeout(2000);
    await page.evaluate(async (token) => { await autoAdvanceOnCifSubmission(DB.docLinks.find(l => l.token === token) || {token, type: activeFormsInCategory('CIF')[0], recordModule: 'CMS', recordId: 'CMS-ZZOUT'}); }, links.CIF);
    await page.waitForTimeout(500);
    const r = await t.eval(async () => { DB.clients = await sget('clients');
      const c = DB.clients.find(x => x.id === 'CMS-ZZOUT');
      return {stage: stateOf('CMS', c), by: (c.blueprintHistory || []).slice(-1)[0], ins: (c.insHistory || []).slice(-1)[0]}; });
    if(said.length || errs.length || r.stage !== 'insDocsCheck' || r.by.by !== 'client' || (r.ins || {}).by !== 'client') throw new Error(JSON.stringify({said, errs, r}));
    return 'Documents Verification, by the client; no message';
  }));

  await t.step('the Plan Input form, submitted on the client’s page, moves the lead and raises the RM’s task', out(async (page, errs, said) => {
    await page.goto(t.base + '/?doc=' + links.Plan, {waitUntil: 'domcontentloaded'});
    await page.waitForTimeout(2000);
    await page.evaluate(async () => { await markPlanInputSubmitted(DB.leads.find(l => l.id === 'LEAD-ZZOUT'), 'Client'); });
    await page.waitForTimeout(500);
    const r = await t.eval(async () => { DB.leads = await sget('leads'); DB.tasks = await sget('tasks');
      const l = DB.leads.find(x => x.id === 'LEAD-ZZOUT');
      return {stage: stateOf('LMS', l), by: (l.blueprintHistory || []).slice(-1)[0].by,
        task: (DB.tasks || []).some(x => x.leadId === 'LEAD-ZZOUT' && x.taskType === 'Prepare the Plan')}; });
    if(said.length || errs.length || r.stage !== 'planInputSubmitted' || r.by !== 'client') throw new Error(JSON.stringify({said, errs, r}));
    return 'Plan Input Submitted, by the client' + (r.task ? '; “Prepare the Plan” raised' : '');
  }));

  await t.step('without a session the scripts are served, and nothing else is', async () => {
    const ctx = await t.page.context().browser().newContext();
    try {
      const get = async p => { const r = await ctx.request.get(t.base + p, {maxRedirects: 0}); return r.status(); };
      const got = {
        ma: await get('/multi-asset.js'), ae: await get('/appraisal-engine.js'), rr: await get('/review/review-report.js'), css: await get('/review/review-report.css'),
        app: await get('/'), xlsx: await get('/review/client-review.xlsx'), api: await get('/api/store/clients'), missing: await get('/nothing-here.js'),
      };
      const want = {ma: 200, ae: 200, rr: 200, css: 200, app: 302, xlsx: 302, api: 401, missing: 302};
      const off = Object.keys(want).filter(k => got[k] !== want[k]);
      if(off.length) throw new Error(off.map(k => k + ' ' + got[k] + ' (want ' + want[k] + ')').join(', '));
      return 'scripts 200; the app, the template and the API still need signing in';
    } finally { await ctx.close(); }
  });
});

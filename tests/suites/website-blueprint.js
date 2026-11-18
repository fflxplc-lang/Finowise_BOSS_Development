/* A BLUEPRINT INPUT FORM FILLED IN ON THE WEBSITE.

   The website draws the client half of each blueprint from BOSS's own
   definitions and posts the finished form to /api/public/website-blueprint.
   What has to hold:

     · each goal lands in its own blueprint's formData, the plan round is told
       its input is in, the goal is on the lead and the Forms registry has the
       link and the submission — Single and Multiple Goal both as Goal Based
       Investment, Inspiring as FSL, 7 Events and Golden Age as their own;
     · "Your details" go onto the lead, and into the template's own first
       section;
     · the same mobile again is the same lead, and the RM's half of a
       workbook is never overwritten by a re-submission;
     · a bad request is refused and says why;
     · the "skip" options are offered on these leads, and only on these. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  const send = (goal, mobile, sheetFn, extra) => t.eval(async a => {
    const type = {single: 'MULTIGOAL', multiple: 'MULTIGOAL', inspiring: 'FSL', sevenevents: 'SEVENEVENTS', goldenage: 'GAB'}[a.goal];
    const blankOf = {GAB: () => gabBlank(), FSL: () => fslBlank(), SEVENEVENTS: () => seBlank(), MULTIGOAL: () => ({})};
    const sheet = blankOf[type]();
    // a few answers, at the paths the website writes them
    if(type === 'MULTIGOAL') sheet.mg_goals = [{goal: 'Child education', years: 10, currentValue: 1500000}];
    if(type === 'FSL') { sheet.years = 12; sheet.assets[0].current = 800000; }
    // "Your details" carried into the sheet's own copies, as the website does on submit
    if(type === 'GAB') { sheet.s1.name = 'ZZ Web ' + a.goal; sheet.s1.dobSelf = '1984-03-15'; sheet.s1.retYear = new Date().getFullYear() + 10; sheet.s2[0].monthly = 50000; sheet.s4.rows[0].existing = 900000; }
    if(type === 'SEVENEVENTS') { sheet.fiYears = 15; sheet.family[0].name = 'ZZ Seven'; }
    // The ISEQ for their age (born 1984: under 50), scored by BOSS's own scorer, as the website does.
    const iseqType = ageSplitFormFor('ISEQ', 42);
    const answers = {};
    iseqFieldsFor(iseqType).filter(f => (f.opts || []).length).forEach(f => { answers[f.k] = f.opts[1]; });
    const sc = computeISEQScore(answers, iseqType);
    const iseq = {type: iseqType, answers, raw: sc.raw, score: sc.score, max: sc.max, category: sc.category};
    const res = await fetch('/api/public/website-blueprint', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(Object.assign({goal: a.goal, consent: true, sheet, iseq,
        touched: type === 'MULTIGOAL' ? undefined : Object.keys(sheet).filter(k => k !== 'client'),
        basics: {me_name: 'ZZ Web ' + a.goal, me_mobile: a.mobile, me_email: 'zz.' + a.mobile + '@example.com',
                 me_dob: '1984-03-15', me_city: 'Varanasi', me_pan: 'ABCDE1234F'}}, a.extra || {}))});
    const d = await res.json();
    DB.leads = await sget('leads', []); DB.docLinks = await sget('docLinks', []); DB.docSubmissions = await sget('docSubmissions', []);
    const l = DB.leads.find(x => x.id === d.leadId) || {};
    const link = DB.docLinks.find(x => x.leadId === l.id && x.type === type && x.createdBy === 'Website') || {};
    return {status: res.status, d, type, iseqWant: sc, iseqGot: {score: l.iseqScore, max: l.iseqMaxScore, category: l.iseqCategory, type: l.iseqFormType},
      iseqIn: iseqIsIn(l), goal: (l.websiteBlueprint || {}).goal, form: l.transformationForm, inputIn: planInputIsIn(l),
      dob: l.dob, pan: l.pan, fd: (l.formData || {})[type], link: link.status, subs: DB.docSubmissions.filter(s => s.token === link.token).length,
      leads: DB.leads.length};
  }, {goal, mobile, extra});
  const ids = {};

  t.section('each goal lands in its own blueprint');

  await t.step('the five goals are stored where BOSS keeps each blueprint, with the round told its input is in', async () => {
    const got = [];
    let n = 0;
    for(const g of ['single', 'multiple', 'inspiring', 'sevenevents', 'goldenage']){
      const r = await send(g, '98765004' + (10 + n++));
      if(r.status !== 200 || !r.d.ok) throw new Error(g + ': ' + JSON.stringify(r.d));
      if(r.form !== r.type || !r.inputIn || !r.fd || r.link !== 'Submitted' || r.subs !== 1) throw new Error(g + ': ' + JSON.stringify(r).slice(0, 400));
      if(r.dob !== '1984-03-15' || r.pan !== 'ABCDE1234F') throw new Error(g + ': details not on the lead');
      ids[g] = r.d.leadId;
      got.push(g + ' → ' + r.type + ' (' + r.goal + ')');
    }
    return got.join(' · ');
  });

  await t.step('"Your details" fill the Goal Based Investment template\'s own first section', async () => {
    const fd = await t.eval(id => DB.leads.find(l => l.id === id).formData.MULTIGOAL, ids.single);
    if(fd.name !== 'ZZ Web single' || fd.dob !== '1984-03-15' || !Array.isArray(fd.mg_goals) || fd.mg_goals[0].years !== 10) throw new Error(JSON.stringify(fd));
    return 'name, DOB and the goals table on formData.MULTIGOAL';
  });

  await t.step('BOSS reads the client half of a workbook as complete', async () => {
    const miss = await t.eval(id => { const l = DB.leads.find(x => x.id === id); return sheetAdapter('GAB').missingOn(l, 'client').map(m => m.label); }, ids.goldenage);
    if(miss.length) throw new Error('GAB still asks: ' + miss.join(', '));
    return 'GAB — nothing outstanding from the client';
  });

  await t.step('the same mobile again is the same lead, and the RM\'s half is kept', async () => {
    await t.eval(async id => { const l = DB.leads.find(x => x.id === id); l.formData.GAB.client = Object.assign({}, l.formData.GAB.client, {rm: 'ZZ Planner'}); await save('leads'); }, ids.goldenage);
    const again = await send('goldenage', '9876500414');
    if(again.d.leadId !== ids.goldenage || again.subs !== 2) throw new Error(JSON.stringify(again.d) + ' subs ' + again.subs);
    if(!again.fd.client || again.fd.client.rm !== 'ZZ Planner') throw new Error('the RM\'s input was overwritten');
    return 'one lead, two submissions on its link, the planner still "ZZ Planner"';
  });

  await t.step('a bad request is refused and names what is wrong', async () => {
    // Sent from here rather than the page, so the 400 is not a page error.
    const res = await fetch(t.url('/api/public/website-blueprint'), {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({goal: 'nope', basics: {me_name: 'x', me_mobile: '12'}, consent: false})});
    const r = {status: res.status, d: await res.json()};
    if(r.status !== 400 || !/goal/.test(r.d.message) || !/mobile/.test(r.d.message) || !/empty/.test(r.d.message)) throw new Error(JSON.stringify(r));
    return r.d.message;
  });

  await t.step('the ISEQ rides with the form: scored, on the lead, with its own link and submission', async () => {
    const r = await send('single', '9876500420');
    const w = r.iseqWant, g = r.iseqGot;
    if(!r.iseqIn || g.score !== w.score || g.max !== w.max || g.category !== w.category || g.type !== 'ISEQ_UNDER50') throw new Error(JSON.stringify(r).slice(0, 400));
    const trail = await t.eval(async id => {
      DB.auditLog = await sget('auditLog', []);
      const l = DB.leads.find(x => x.id === id);
      const link = DB.docLinks.find(x => x.token === l.iseqDocToken) || {};
      return {link: link.type + ':' + link.status, subs: DB.docSubmissions.filter(s => s.token === l.iseqDocToken && s.score !== undefined).length,
        card: DB.auditLog.some(a => a.recordId === id && /^ISEQ Score Card/.test(a.action))};
    }, r.d.leadId);
    if(trail.link !== 'ISEQ_UNDER50:Submitted' || trail.subs !== 1 || !trail.card) throw new Error(JSON.stringify(trail));
    return g.type + ' ' + g.score + '/' + g.max + ' ' + g.category + ' · its link Submitted · the score card attempted and logged';
  });

  await t.step('an ISEQ for the wrong age, or none, is refused', async () => {
    // Sent from here rather than the page, so the 400s are not page errors.
    const post = async (mobile, iseq) => {
      const res = await fetch(t.url('/api/public/website-blueprint'), {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({goal: 'single', consent: true, sheet: {mg_goals: [{goal: 'X', years: 5, currentValue: 1}]}, iseq,
          basics: {me_name: 'ZZ Wrong Age', me_mobile: mobile, me_email: 'zz.' + mobile + '@example.com', me_dob: '1984-03-15'}})});
      return {status: res.status, d: await res.json()};
    };
    const wrong = await post('9876500421', {type: 'ISEQ_OVER50', answers: {iseq_q1: 'x'}, score: 10, max: 100, category: 'Moderate'});
    const none = await post('9876500422', null);
    if(wrong.status !== 400 || !/age/.test(wrong.d.message) || none.status !== 400 || !/ISEQ/.test(none.d.message)) throw new Error(JSON.stringify([wrong.d, none.d]));
    return wrong.d.message + ' · ' + none.d.message;
  });

  t.section('the skip options, on these leads only');

  const offered = id => t.eval(id => {
    const l = DB.leads.find(x => x.id === id);
    return availableTransitions('LMS', stateOf('LMS', l), 'forward', l).map(x => x.id);
  }, id);

  await t.step('a website blueprint lead may skip to qualification; a walk-in may not', async () => {
    const mine = await offered(ids.inspiring);
    if(!mine.includes('websiteSkipToQualifyT')) throw new Error('not offered: ' + mine.join(', '));
    const other = await t.eval(async () => {
      const l = {id: uid('LMS'), firstName: 'ZZ', lastName: 'Walk In', mobile: '9876500499', source: 'Walk-in', createdAt: new Date().toISOString()};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      return availableTransitions('LMS', stateOf('LMS', l), 'forward', l).map(x => x.id);
    });
    if(other.includes('websiteSkipToQualifyT')) throw new Error('offered on a walk-in');
    await t.eval(async id => { await doTransition('LMS', id, 'websiteSkipToQualifyT'); }, ids.inspiring);
    const st = await t.eval(id => stateOf('LMS', DB.leads.find(x => x.id === id)), ids.inspiring);
    if(st !== 'readyToQualify') throw new Error('stood on ' + st);
    return 'offered beside "' + mine.filter(x => x !== 'websiteSkipToQualifyT').join(', ') + '" · Ready for Qualification';
  });

  await t.step('Plan Choose may be skipped, and the input form, already in, continues', async () => {
    const r = await t.eval(async id => {
      const l = DB.leads.find(x => x.id === id);
      l.status = 'investmentApproach'; await save('leads');
      const atChoose = availableTransitions('LMS', 'investmentApproach', 'forward', l).map(x => x.id);
      await doTransition('LMS', id, 'websitePlanChosenT');
      const st1 = stateOf('LMS', l);
      const at = availableTransitions('LMS', st1, 'forward', l).map(x => x.id);
      await doTransition('LMS', id, 'websiteInputInT');
      return {atChoose, st1, at, st2: stateOf('LMS', l),
        tasks: DB.tasks.filter(x => x.leadId === id).map(x => x.taskType + ':' + x.overallStatus)};
    }, ids.inspiring);
    if(!r.atChoose.includes('fwd_fbpPreparation') || !r.atChoose.includes('websitePlanChosenT')) throw new Error('at Plan Choose: ' + r.atChoose);
    if(r.st1 !== 'fbpPreparation') throw new Error('Plan Choose skip stood on ' + r.st1);
    if(!r.at.includes('websiteInputInT') || !r.at.includes('fwd_dataGatheringSent')) throw new Error('at the form: ' + r.at);
    if(r.st2 !== 'planInputSubmitted') throw new Error('stood on ' + r.st2);
    if(!r.tasks.includes('FBP Preparation:Completed') || !r.tasks.some(x => /^Prepare the Plan/.test(x))) throw new Error('tasks: ' + r.tasks);
    return 'Plan Choose skipped beside "Choose the Blueprint" · Continue offered · ' + r.tasks.join(', ');
  });
});

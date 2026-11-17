/* A LEAD FROM ONE OF THE WEBSITE'S FIVE GOAL CARDS.

   What has to hold:

     · each card is handed BOSS's own client form for its blueprint — Single
       and Multiple Goal the Goal Based Investment form, Inspiring Goal the
       FSL, 7 Events and Golden Age their own — with the ISEQ riding on it,
       and the goal they picked is on the lead;
     · the same mobile again is the same lead and the same link, never a
       second one;
     · the form opens with nobody signed in;
     · the "skip" options are offered on these leads, and only on these:
       LMS Create / Warm Up to Qualification, Plan Choose, and the Input Form
       once it has come back from the website — beside the normal steps, which
       stay where they were. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  const post = (goal, mobile) => t.eval(async a => {
    const res = await fetch('/api/public/website-blueprint', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({goal: a.goal, name: 'ZZ Blueprint ' + a.goal, mobile: a.mobile, email: 'zz.' + a.mobile + '@example.com',
        city: 'Varanasi', consent: true})});
    const d = await res.json();
    DB.leads = await sget('leads', []);
    DB.docLinks = await sget('docLinks', []);
    const l = DB.leads.find(x => x.id === d.leadId) || {};
    const link = DB.docLinks.find(x => d.path && d.path.indexOf(encodeURIComponent(x.token)) >= 0) || {};
    return {status: res.status, d, goal: (l.websiteBlueprint || {}).goal, type: link.type, iseq: link.iseqType,
      iseqLink: !!DB.docLinks.find(x => x.token === link.iseqToken), leads: DB.leads.length, form: l.transformationForm};
  }, {goal, mobile});
  const ids = {};

  t.section('each card opens its own blueprint form');

  await t.step('the five cards are handed the right forms, with the ISEQ on them', async () => {
    const want = {single: 'MULTIGOAL', multiple: 'MULTIGOAL', inspiring: 'FSL', sevenevents: 'SEVENEVENTS', goldenage: 'GAB'};
    const got = [];
    let n = 0;
    for(const g of Object.keys(want)){
      const r = await post(g, '98765003' + (10 + n++));
      if(r.status !== 200 || !r.d.ok) throw new Error(g + ': ' + JSON.stringify(r.d));
      if(r.type !== want[g] || r.form !== want[g]) throw new Error(g + ' got ' + r.type + ' / ' + r.form);
      if(!/^ISEQ_/.test(r.iseq || '') || !r.iseqLink) throw new Error(g + ': no ISEQ on the link');
      ids[g] = r.d.leadId;
      got.push(g + ' → ' + r.type + ' (' + r.goal + ')');
    }
    return got.join(' · ');
  });

  await t.step('the same mobile again is the same lead and the same form', async () => {
    const before = await post('single', '9876500310');
    const again = await post('single', '9876500310');
    if(again.d.leadId !== before.d.leadId || again.d.path !== before.d.path || again.leads !== before.leads)
      throw new Error(JSON.stringify({before: before.d, again: again.d}));
    return 'one lead, one link, ' + again.leads + ' leads in all';
  });

  await t.step('a bad request is refused and names what is wrong', async () => {
    // Sent from here rather than the page, so the 400 is not a page error.
    const res = await fetch(t.url('/api/public/website-blueprint'), {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({goal: 'nope', name: 'x', mobile: '12', email: 'no', city: '', consent: false})});
    const r = {status: res.status, d: await res.json()};
    if(r.status !== 400 || !/goal/.test(r.d.message) || !/mobile/.test(r.d.message)) throw new Error(JSON.stringify(r));
    return r.d.message;
  });

  t.section('the skip options, on these leads only');

  const offered = id => t.eval(id => {
    const l = DB.leads.find(x => x.id === id);
    return availableTransitions('LMS', stateOf('LMS', l), 'forward', l).map(x => x.id);
  }, id);

  await t.step('a website blueprint lead may skip to qualification; a walk-in may not', async () => {
    const mine = await offered(ids.goldenage);
    if(!mine.includes('websiteSkipToQualifyT')) throw new Error('not offered: ' + mine.join(', '));
    const other = await t.eval(async () => {
      const l = {id: uid('LMS'), firstName: 'ZZ', lastName: 'Walk In', mobile: '9876500399', source: 'Walk-in', createdAt: new Date().toISOString()};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      return availableTransitions('LMS', stateOf('LMS', l), 'forward', l).map(x => x.id);
    });
    if(other.includes('websiteSkipToQualifyT')) throw new Error('offered on a walk-in');
    await t.eval(async id => { await doTransition('LMS', id, 'websiteSkipToQualifyT'); }, ids.goldenage);
    const st = await t.eval(id => stateOf('LMS', DB.leads.find(x => x.id === id)), ids.goldenage);
    if(st !== 'readyToQualify') throw new Error('stood on ' + st);
    return 'offered beside "' + mine.filter(x => x !== 'websiteSkipToQualifyT').join(', ') + '" · Ready for Qualification';
  });

  await t.step('Plan Choose may be skipped, and the input form continues only once it is in', async () => {
    const r = await t.eval(async id => {
      const l = DB.leads.find(x => x.id === id);
      l.status = 'investmentApproach'; await save('leads');
      const atChoose = availableTransitions('LMS', 'investmentApproach', 'forward', l).map(x => x.id);
      await doTransition('LMS', id, 'websitePlanChosenT');
      const st1 = stateOf('LMS', l);
      const before = availableTransitions('LMS', st1, 'forward', l).map(x => x.id);
      // the client's input form coming back from the website
      ensurePlanRound(l, l.transformationForm).inputSubmittedAt = new Date().toISOString(); await save('leads');
      const after = availableTransitions('LMS', st1, 'forward', l).map(x => x.id);
      await doTransition('LMS', id, 'websiteInputInT');
      return {atChoose, st1, before, after, st2: stateOf('LMS', l),
        tasks: DB.tasks.filter(x => x.leadId === id).map(x => x.taskType + ':' + x.overallStatus)};
    }, ids.goldenage);
    if(!r.atChoose.includes('fwd_fbpPreparation') || !r.atChoose.includes('websitePlanChosenT')) throw new Error('at Plan Choose: ' + r.atChoose);
    if(r.st1 !== 'fbpPreparation') throw new Error('Plan Choose skip stood on ' + r.st1);
    if(r.before.includes('websiteInputInT')) throw new Error('offered before the form was in');
    if(!r.after.includes('websiteInputInT') || !r.after.includes('fwd_dataGatheringSent')) throw new Error('once in: ' + r.after);
    if(r.st2 !== 'planInputSubmitted') throw new Error('stood on ' + r.st2);
    if(!r.tasks.includes('FBP Preparation:Completed') || !r.tasks.some(x => /^Prepare the Plan/.test(x))) throw new Error('tasks: ' + r.tasks);
    return 'Plan Choose skipped beside "Choose the Blueprint" · Continue once the form is in · ' + r.tasks.join(', ');
  });

  t.section('the form opens for somebody who is not signed in');

  await t.step('the 7 Events link draws its own page with no session', async () => {
    const path = (await post('sevenevents', '9876500313')).d.path;
    const ctx = await t.page.context().browser().newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    let text = '';
    try {
      await page.goto(t.url(path));
      await page.waitForTimeout(2500);
      text = await page.innerText('body');
    } finally { await ctx.close(); }
    if(!/Comprehensive Freedom Blueprint/.test(text) || !/questionnaire/i.test(text) || errors.length)
      throw new Error(errors.join(' ; ') || text.slice(0, 300));
    return 'the 7 Events input form and the ISEQ after it, signed out';
  });
});

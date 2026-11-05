/* A LEAD FROM THE WEBSITE'S FQ TEST, THROUGH THE CLIENT JOURNEY.

   What has to hold:

     · the first step on a website lead is "Schedule Call", not "Log a Call":
       they filled in a form, nobody has spoken to them yet;
     · "Schedule Call" (the stage button, the Move to link, or one of the
       times they offered) opens the call scheduler — the time they picked
       filled in, an outgoing call — and the lead moves on to Warm Up Call
       Scheduled, their request closed;
     · their FQ score is already on the lead, so qualification needs no
       assessment: the panel says so and Qualify moves the lead on;
     · and nothing changes for anybody else: an inbound phone lead still logs
       its call, and a lead with no FQ score still waits for the result. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  const ids = {};

  /* The website posts a lead the way the live site does. */
  const post = (mobile, name, slots) => t.eval(async a => {
    const res = await fetch('/api/public/website-lead', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({consent: true, name: a.name, mobile: a.mobile, email: 'zz.' + a.mobile + '@example.com', city: 'Varanasi',
        slots: a.slots, fq: {score: 37, band: 'Impulse Explorer', points: 37, max: 100, completedAt: new Date().toISOString(),
        answers: [{pillar: 'Earn', question: 'How do you spend a bonus?', answer: 'On something I want', option: 'A', points: 2}]}})});
    DB.leads = await sget('leads', []);
    const l = DB.leads.find(x => x.mobile === a.mobile);
    return {status: res.status, id: l && l.id};
  }, {mobile, name, slots});
  const ist = d => new Date(Date.now() + d * 86400000 + 5.5 * 3600e3).toISOString().slice(0, 11);
  const slotA = ist(1) + '11:30', slotB = ist(2) + '16:00';

  const stageButtons = id => t.eval(async id => {
    navigate('lms', id); await new Promise(r => setTimeout(r, 250));
    const c = document.getElementById('content');
    return {btns: Array.from(c.querySelectorAll('.btn')).map(b => (b.disabled ? '[off] ' : '') + b.textContent.trim()),
      next: Array.from(c.querySelectorAll('a, span, div')).map(x => x.textContent.trim()).find(x => /^Move to /.test(x) && x.length < 60) || '',
      card: (document.getElementById('callRequestCard') || {}).innerText || '', fq: (document.getElementById('fqOnFilePanel') || {}).innerText || '',
      stage: stateOf('LMS', DB.leads.find(l => l.id === id))};
  }, id);

  t.section('Schedule Call, not Log a Call');

  await t.step('a website lead offers Schedule Call, and shows the times they asked to be called', async () => {
    const r = await post('9876500201', 'ZZ Website One', [slotA, slotB]);
    if(r.status !== 200 || !r.id) throw new Error('the website could not post the lead: ' + JSON.stringify(r));
    ids.one = r.id;
    const s = await stageButtons(ids.one);
    if(s.btns.some(b => /Log a Call/.test(b))) throw new Error('still offers Log a Call: ' + s.btns.join(' | '));
    if(!s.btns.includes('Schedule Call')) throw new Error('no Schedule Call: ' + s.btns.join(' | '));
    if(s.next !== 'Move to Schedule Call ›' && s.next !== 'Move to Schedule Call') throw new Error('Move link reads ' + s.next);
    if(!/They asked to be called/i.test(s.card) || (s.card.match(/Schedule this call/g) || []).length !== 2)
      throw new Error('request card: ' + s.card);
    return 'Schedule Call on the stage bar and the Move link · two offered times, each "Schedule this call"';
  });

  await t.step('picking one of their times opens the full scheduler, and the lead moves to Warm Up Call Scheduled', async () => {
    const r = await t.eval(async a => {
      const b = Array.from(document.querySelectorAll('#callRequestCard .btn')).filter(x => /Schedule this call/.test(x.textContent))[0];
      b.click(); await new Promise(r => setTimeout(r, 300));
      const title = (document.querySelector('.modal-head, .modal h3, .modal-title') || {}).textContent || '';
      const plat = document.getElementById('f_schedPlatform');
      const offline = Array.from(plat.options).map(o => o.value).find(v => meetingIsOffline(v));
      plat.value = offline; plat.dispatchEvent(new Event('change'));
      document.getElementById('f_sendEmail').checked = false;
      document.getElementById('f_schedAgenda').value = 'Go over the FQ result';
      const form = {title: title.trim(), when: document.getElementById('f_schedWhen').value, type: document.getElementById('f_schedMeetingType').value,
        fields: ['f_schedPlatform', 'f_schedWhen', 'f_schedAgenda', 'f_schedAttendee'].every(id => !!document.getElementById(id))};
      await submitScheduleMeeting('LMS', a.id, 'fwd_warmUpCallScheduled');
      await new Promise(r => setTimeout(r, 300));
      const lead = DB.leads.find(l => l.id === a.id);
      const call = (DB.callEntries || []).find(c => c.leadId === a.id && !c.deletedAt);
      const mtg = (DB.meetings || []).find(m => m.linkedRecordId === a.id && !m.deletedAt);
      return {form, stage: stateOf('LMS', lead), request: lead.meetingRequest && lead.meetingRequest.status,
        via: lead.meetingRequest && lead.meetingRequest.handledVia, call: call && {date: call.callDate, time: call.startTime, type: call.callType, meetingId: call.meetingId},
        mtg: mtg && {id: mtg.id, status: mtg.status, agenda: mtg.agenda}};
    }, {id: ids.one});
    if(!/^Schedule: Call\b/.test(r.form.title)) throw new Error('the box is "' + r.form.title + '"');
    if(!r.form.fields) throw new Error('not the full scheduler');
    if(r.form.when !== slotA) throw new Error('not filled with their time: ' + r.form.when + ' vs ' + slotA);
    if(!/^Warm Up Call with ZZ Website One$/.test(r.form.type)) throw new Error('meeting type ' + r.form.type);
    if(r.stage !== 'warmUpCallScheduled') throw new Error('the lead stands at ' + r.stage);
    if(!r.call || r.call.date + 'T' + r.call.time !== slotA || r.call.type !== 'Outbound') throw new Error('call logged as ' + JSON.stringify(r.call));
    if(!r.mtg || r.call.meetingId !== r.mtg.id || r.mtg.agenda !== 'Go over the FQ result') throw new Error('meeting ' + JSON.stringify(r.mtg));
    if(r.request !== 'Handled' || r.via !== 'A call was scheduled') throw new Error('request ' + r.request + ' / ' + r.via);
    const s = await stageButtons(ids.one);
    if(s.card) throw new Error('the request card is still up');
    return '"Schedule: Call" with platform, agenda, attendees · the call at ' + slotA.replace('T', ' ') + ' in Call Logs and Meetings · request closed';
  });

  await t.step('completing the call closes its meeting and goes straight on to booking the warm-up meeting', async () => {
    const r = await t.eval(async id => {
      openCompleteWarmCallModal('LMS', id, 'fwd_warmUpCallDone');
      await new Promise(r => setTimeout(r, 200));
      document.getElementById('f_wcdDescription').value = 'Spoke about their goals';
      await submitCompleteWarmCall(id, 'fwd_warmUpCallDone');
      await new Promise(r => setTimeout(r, 300));
      const call = DB.callEntries.find(c => c.leadId === id && !c.deletedAt);
      const mtg = DB.meetings.find(m => m.id === call.meetingId);
      const box = (document.querySelector('.modal') || {}).innerText || '';
      const out = {after: stateOf('LMS', DB.leads.find(l => l.id === id)), calls: DB.callEntries.filter(c => c.leadId === id && !c.deletedAt).length,
        mtg: mtg && mtg.status, box: box.split('\n')[0], when: !!document.getElementById('f_schedWhen')};
      if(out.when){
        const ist = new Date(Date.now() + 3 * 86400000 + 5.5 * 3600e3).toISOString().slice(0, 11) + '15:00';
        document.getElementById('f_schedWhen').value = ist;
        const plat = document.getElementById('f_schedPlatform');
        plat.value = Array.from(plat.options).map(o => o.value).find(v => meetingIsOffline(v)); plat.dispatchEvent(new Event('change'));
        document.getElementById('f_sendEmail').checked = false;
        await submitScheduleMeeting('LMS', id, 'fwd_warmUpMeetingScheduled');
        await new Promise(r => setTimeout(r, 300));
      }
      out.final = stateOf('LMS', DB.leads.find(l => l.id === id));
      return out;
    }, ids.one);
    if(r.after !== 'warmUpCallDone' || r.calls !== 1 || r.mtg !== 'Completed') throw new Error(JSON.stringify(r));
    if(!r.when || !/Schedule: Warm Up Meeting/.test(r.box)) throw new Error('the meeting scheduler did not open: ' + r.box);
    if(r.final !== 'warmUpMeetingScheduled') throw new Error('after booking, the lead stands at ' + r.final);
    return 'call done (its meeting Completed) → "' + r.box + '" opens → Warm Up Meeting Scheduled';
  });

  await t.step('Schedule Call on the stage bar opens the call scheduler too', async () => {
    const r = await post('9876500202', 'ZZ Website Two', []);
    ids.two = r.id;
    const s = await t.eval(async id => {
      navigate('lms', id); await new Promise(r => setTimeout(r, 250));
      const b = Array.from(document.querySelectorAll('#content .btn')).find(x => x.textContent.trim() === 'Schedule Call');
      b.click(); await new Promise(r => setTimeout(r, 200));
      const box = !!document.getElementById('f_schedWhen') && /Schedule: Call/.test((document.querySelector('.modal') || {}).innerText || ''), logBox = /Log a Call/.test(((document.querySelector('.modal') || {}).innerText || '').split('\n')[0]);
      closeModal();
      return {box, logBox};
    }, ids.two);
    if(!s.box || s.logBox) throw new Error(JSON.stringify(s));
    return 'Schedule Call → "Schedule: Call", the full scheduler';
  });

  await t.step('an inbound phone lead still logs its call, as before', async () => {
    const r = await t.eval(async () => {
      const l = {id: uid('LMS'), firstName: 'ZZ', lastName: 'Phone In', mobile: '9876500203', source: 'Walk-in', callType: 'Inbound',
        assignedTo: currentUser, branch: 'Varanasi', createdAt: new Date().toISOString()};
      initState('LMS', l); DB.leads.push(l); await save('leads');
      return l.id;
    });
    const s = await stageButtons(r);
    if(!s.btns.includes('Log a Call')) throw new Error('phone lead: ' + s.btns.join(' | '));
    return 'Walk-in, inbound: Log a Call';
  });

  t.section('the FQ score from the website counts');

  await t.step('at qualification the score is on file, no assessment is asked for, and Qualify moves the lead on', async () => {
    await t.eval(async id => {
      for(const tid of ['fwd_warmUpMeetingDone', 'fwd_readyToQualify']){
        await doTransition('LMS', id, tid); closeModal();
      }
    }, ids.one);
    const s = await stageButtons(ids.one);
    if(s.stage !== 'readyToQualify') throw new Error('stands at ' + s.stage);
    if(!/37/.test(s.fq) || !/website/i.test(s.fq) || !/no assessment to send/i.test(s.fq)) throw new Error('FQ panel: ' + s.fq);
    if(s.btns.some(b => /^Send the FQ Assessment$/.test(b))) throw new Error('still asks to send the assessment');
    if(!s.btns.includes('Qualify')) throw new Error('Qualify not open: ' + s.btns.join(' | '));
    const after = await t.eval(async id => { await doTransition('LMS', id, 'fwd_qualified'); return stateOf('LMS', DB.leads.find(l => l.id === id)); }, ids.one);
    if(after !== 'qualified') throw new Error('Qualify left it at ' + after);
    if(t.dialogs.some(d => /cannot be qualified/.test(d))) throw new Error('an FQ gate alert came up');
    return 'FQ 37 shown as answered on the website · Qualify → Lead Qualified, no test';
  });

  await t.step('a lead with no FQ score still waits for the assessment', async () => {
    const r = await t.eval(async () => {
      const l = {id: uid('LMS'), firstName: 'ZZ', lastName: 'No Score', mobile: '9876500204', source: 'Referral', callType: 'Outbound',
        assignedTo: currentUser, branch: 'Varanasi', createdAt: new Date().toISOString()};
      initState('LMS', l); l.status = 'readyToQualify'; DB.leads.push(l); await save('leads');
      return l.id;
    });
    const s = await stageButtons(r);
    if(s.fq) throw new Error('the on-file panel showed for a lead with no score');
    if(!s.btns.includes('Send the FQ Assessment')) throw new Error('no Send the FQ Assessment: ' + s.btns.join(' | '));
    if(s.btns.includes('Qualify') || !s.btns.some(b => /^\[off\] Awaiting the FQ/.test(b))) throw new Error('Qualify was not held: ' + s.btns.join(' | '));
    const after = await t.eval(async id => { await doTransition('LMS', id, 'fwd_qualified'); return stateOf('LMS', DB.leads.find(l => l.id === id)); }, r);
    if(after !== 'readyToQualify') throw new Error('it moved to ' + after);
    return 'Send the FQ Assessment · Qualify held as "Awaiting the FQ Result…"';
  });
});

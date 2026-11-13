/* THE INSURANCE JOURNEY (CMS), AS THE FIRM'S SOP HAS IT.

   Walked end to end through the stage buttons' own boxes, with the suite's
   own mail server, so "emailed" means a letter arrived:
   1 intake, category, the company BEFORE the type, plan, and the benefit
     illustration emailed with the insurer's PDF attached; a revised one;
   2 the CIF sent after the illustration; the client filling it moves the
     case to Documents Verification (Health, Income, Existing Policy) by
     itself; proposal submitted, updated, and premium paid, each a step;
   3 the medical question before the scrub ("Medical Required" / "Medical
     not Required"), the scrub following up with the medical team, and
     underwriting: a loading goes to the client, to payment and back to the
     underwriter; Policy Approved goes on to the policy;
   4 policy data read from the policy PDF (empty boxes filled, differences
     listed, the client's details kept), typed twice, the client emailed;
     an endorsement holding the confirmation; original received closes the
     CMS journey, files the policy in Life Insurance and books RMS;
   5 in the module: the server's reminders from the policy (once per step),
     a payment moving the due date on with a receipt, the last premium of
     the paying term (PPT Completed), closing the policy.
   Also: a client on the old parked stage, under an edited journey, walks on. */
const {suite} = require('../lib/harness');

const waitForMail = async (t, re, ms) => {
  const until = Date.now() + (ms || 6000);
  while(Date.now() < until){
    const hit = t.mail.matching(re);
    if(hit.length) return hit[hit.length - 1];
    await t.wait(200);
  }
  return null;
};

/* A one-page PDF with a real text layer, a line for each entry — a made-up policy schedule. */
const tinyPdf = (lines) => {
  const esc = x => String(x).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const ops = lines.map((l, i) => `BT /F1 9 Tf 40 ${800 - i * 16} Td (${esc(l)}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [5 0 R] /Count 1 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
};

suite({mail: true}, async t => {
  /* Press a step the way the stage does: open its box, fill it, save. */
  const step = async (id, fill, opts) => t.eval(async (a) => {
    const c = DB.clients.find(x => x.id === 'CMS-ZINW');
    const handler = STAGE_FORM_HANDLERS[a.id];
    const said = []; const al = window.alert; window.alert = m => said.push(String(m));
    try {
      if(handler === 'openInsuranceStepModal') {
        openInsuranceStepModal('CMS', c.id, a.id);
        await new Promise(r => setTimeout(r, 30));
        if(said.length) return {said};
        for(const [k, v] of Object.entries(a.fill || {})){
          const el = document.getElementById('f_' + k);
          if(!el) throw new Error('no box for ' + k + ' on ' + a.id);
          el.value = v; el.dispatchEvent(new Event('change', {bubbles: true}));
        }
        const box = document.getElementById('f_insMail');
        if(box) box.checked = !!a.opts.mail;
        if(a.opts.attach) composeAttachments.push({filename: a.opts.attach, contentType: 'application/pdf', content: btoa('%PDF-1.4 illustration')});
        await submitInsuranceStep(c.id, a.id);
      } else await doTransition('CMS', c.id, a.id);
    } finally { window.alert = al; }
    if(said.length) return {said};
    const r = DB.clients.find(x => x.id === 'CMS-ZINW');
    return {stage: stateOf('CMS', r), r: JSON.parse(JSON.stringify(r))};
  }, {id, fill, opts: opts || {}});

  await t.step('Insurance opens Phase 1, and the box asks for the company before the type', async () => {
    const r = await t.eval(async () => {
      const c = {id: 'CMS-ZINW', cmsName: 'ZZ Insured Walk', email: 'zzinw@example.com', mobile: '9800111333',
        createdAt: new Date().toISOString(), assignedTo: me().id, rmName: me().id};
      initState('CMS', c); DB.clients = DB.clients.filter(x => x.id !== c.id).concat([c]); await save('clients');
      await doTransition('CMS', c.id, 'toInsurance');
      navigate('cms', c.id); await new Promise(r => setTimeout(r, 150));
      const buttons = [...document.querySelectorAll('button')].map(b => b.textContent.trim());
      openInsuranceStepModal('CMS', c.id, 'insIllustrationSentT');
      const order = [...document.querySelectorAll('#insStepForm select, #insStepForm input')].map(x => x.id.replace('f_', ''));
      closeModal();
      return {st: stateOf('CMS', c), send: buttons.some(b => /Send Illustration to Client/.test(b)), back: buttons.some(b => /Change Product Category/.test(b)),
        company: order.indexOf('insCompany'), type: order.indexOf('insLifeType'), category: order.indexOf('insCategory')};
    });
    if(r.st !== 'insurancePending' || !r.send || !r.back) throw new Error(JSON.stringify(r));
    if(!(r.category < r.company && r.company < r.type)) throw new Error('order: ' + JSON.stringify(r));
    return 'Category → Company → Type; Send Illustration and Back offered';
  });

  await t.step('the illustration is emailed with the insurer’s PDF attached', async () => {
    const miss = await step('insIllustrationSentT', {insCategory: 'Life Insurance', insCompany: 'TATA', insPremium: '25000'});
    if(!miss.said || !/Life Plan Type/.test(miss.said[0]) || /General/.test(miss.said[0])) throw new Error(JSON.stringify(miss));
    await t.eval(() => closeModal());
    const r = await step('insIllustrationSentT', {insCategory: 'Life Insurance', insCompany: 'TATA', insLifeType: 'Term Insurance',
      insPlanName: 'Sampoorna Raksha', insSumAssured: '10000000', insPremium: '25000', insPremiumFrequency: 'Yearly', insRiders: 'Accidental death'},
      {mail: true, attach: 'illustration.pdf'});
    if(r.said) throw new Error(r.said.join(' | '));
    const m = await waitForMail(t, /Sampoorna Raksha/);
    if(r.stage !== 'insIllustration' || !m) throw new Error('stage ' + r.stage + ', mail ' + !!m);
    if(!/illustration\.pdf/.test(m.body)) throw new Error('the PDF was not attached');
    if(!/Accidental death/.test(m.text || m.body)) throw new Error('the riders are not in the letter');
    return 'stage moved; “' + m.subject + '” arrived with illustration.pdf';
  });

  await t.step('a revised illustration is emailed', async () => {
    const a = await step('insIllustrationRevised', {insRevisionReason: 'Premium too high', insCompany: 'MAX', insPlanName: 'Smart Term', insPremium: '21000'}, {mail: true});
    const m = await waitForMail(t, /revised insurance illustration/i);
    if(a.stage !== 'insIllustration' || a.r.insIllustrations.length !== 2 || !m || !/Premium too high/.test(m.text || m.body)) throw new Error(JSON.stringify({s: a.stage, m: !!m}));
    return 'v2 MAX › Smart Term emailed';
  });

  await t.step('after the illustration the CIF goes out, and the client filling it moves the case to Documents Verification', async () => {
    const b = await step('insIllustrationAccepted');
    if(b.stage !== 'insCif') throw new Error('accepted went to ' + b.stage);
    const offered = await t.eval(() => getBlueprint('CMS').transitions.filter(x => x.from === 'insCif' && !x.notOffered).map(x => x.id));
    if(offered.indexOf('insCifValidated') >= 0 || offered.indexOf('insCifReceivedT') >= 0) throw new Error('a manual CIF step is still offered: ' + offered);
    const sent = await t.eval(async () => {
      const c = DB.clients.find(x => x.id === 'CMS-ZINW');
      const forms = activeFormsInCategory('CIF').filter(t => formQuestionCount(t));
      const al = window.alert, cf = window.confirm; window.alert = () => {}; window.confirm = () => true;
      openSendCifModal('CMS', c.id, 'insCifSend');
      if(forms.length) await submitSendCif('CMS', c.id, 'insCifSend'); else await new Promise(r => setTimeout(r, 100));
      window.alert = al; window.confirm = cf;
      return {forms: forms.length, stage: stateOf('CMS', c), asked: !!c.insCifRequestedAt};
    });
    if(sent.stage !== 'insCif' || !sent.asked) throw new Error(JSON.stringify(sent));
    const back = await t.eval(async () => { window.confirm = () => true; await insRecordPaperCif('CMS-ZINW');
      const c = DB.clients.find(x => x.id === 'CMS-ZINW'); return {stage: stateOf('CMS', c), kyc: getBlueprint('CMS').states.some(s => s.id === 'insKyc')}; });
    if(back.stage !== 'insDocsCheck' || back.kyc) throw new Error(JSON.stringify(back));
    return 'CIF ' + (sent.forms ? 'emailed' : 'requested') + '; received → Documents Verification by itself; no KYC stage';
  });

  await t.step('Documents Verification has Health, Income and Existing Policy; then proposal submitted, updated, premium paid as separate steps', async () => {
    const r = await t.eval(async () => {
      const c = DB.clients.find(x => x.id === 'CMS-ZINW');
      navigate('cms', c.id); await new Promise(r => setTimeout(r, 150));
      const items = docsVerifyItems(c).map(i => i.label);
      const said = []; const al = window.alert; window.alert = m => said.push(String(m));
      await doTransition('CMS', c.id, 'insDocsCheckedT');
      const held = stateOf('CMS', c);
      for(const i of docsVerifyItems(c)) await setDocsVerifyAnswer(c.id, i.id, 'v', 'Yes');
      await submitDocsVerify(c.id);
      await doTransition('CMS', c.id, 'insDocsCheckedT');
      window.alert = al;
      return {items, held, said: said[0] || '', stage: stateOf('CMS', c)};
    });
    ['Health', 'Income', 'Existing Polic'].forEach(w => { if(!r.items.some(l => l.indexOf(w) >= 0)) throw new Error('no ' + w + ' check: ' + r.items.join(', ')); });
    if(r.held !== 'insDocsCheck' || r.stage !== 'insProposal') throw new Error(JSON.stringify(r));
    const a = await step('insProposalSubmitted', {insProposalNo: 'PRP-123'});
    const b = await step('insProposalUpdated', {insProposalNo: 'PRP-123'});
    const c = await step('insPremiumPaid', {insPaymentMode: 'UPI', insPaymentRef: 'UPI-9'});
    const path = [a, b, c].map(x => x.stage || JSON.stringify(x.said)).join(' → ');
    if(path !== 'insProposalUpdate → insPremiumPayment → insMedical' || c.r.insuranceStatus !== 'Applied') throw new Error(path + ' ' + c.r.insuranceStatus);
    return 'checklist incl. Health / Income / Existing Policy → ' + path;
  });

  await t.step('the medical question comes before the scrub, with its new names; the scrub can follow up with the medical team', async () => {
    const labels = await t.eval(() => {
      const bp = getBlueprint('CMS'); const l = id => (bp.transitions.find(x => x.id === id) || {}).label;
      return {yes: l('insMedicalYes'), no: l('insMedicalNo'), fu: l('insMedicalFollowUp')};
    });
    if(labels.yes !== 'Medical Required' || labels.no !== 'Medical not Required' || labels.fu !== 'Follow up with Medical Team') throw new Error(JSON.stringify(labels));
    const d = new Date(); d.setDate(d.getDate() + 3);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const b = await step('insMedicalYes', {insMedicalType: 'Tele-medical', insMedicalDate: key});
    const c = await step('insMedicalDone', {insMedicalReportsUploaded: 'Yes'});
    const f = await step('insMedicalFollowUp', {insMedicalTeamNote: 'Chase the ECG report'});
    const task = await t.eval(() => !!insOpenTask(DB.clients.find(x => x.id === 'CMS-ZINW'), INS_MEDICAL_TEAM_TASK));
    const a = await step('insDocsVerified', {insScrubDisclosureOk: 'Yes', insScrubDocsOk: 'Yes'});
    const closed = await t.eval(() => !insOpenTask(DB.clients.find(x => x.id === 'CMS-ZINW'), INS_MEDICAL_TEAM_TASK));
    const path = [b, c, f, a].map(x => x.stage || JSON.stringify(x.said)).join(' → ');
    if(path !== 'insMedicalCheckup → insDocsVerification → insDocsVerification → insUnderwriting' || !task || !closed) throw new Error(path + ' task ' + task + ' closed ' + closed);
    return path + '; medical-team task raised and closed with the scrub';
  });

  await t.step('underwriting: a loading goes to the client, then payment, then back to the underwriter; Policy Approved goes on', async () => {
    const opts = await t.eval(() => insField('insUwOutcome').opts);
    if(opts[0] !== 'Policy Approved' || opts.indexOf('Standard') >= 0) throw new Error('outcomes: ' + opts);
    const a = await step('insUwApproved', {insUwOutcome: 'Accepted with loading', insUwTerms: '25% extra premium'});
    const b = await step('insUwClientApproved', {});
    const c = await step('insUwPaymentDone', {insUwExtraPremium: '6250', insPaymentMode: 'UPI'});
    const tasks = await t.eval(() => (DB.tasks || []).filter(x => x.clientId === 'CMS-ZINW' && [INS_UW_APPROVAL_TASK, INS_UW_PAYMENT_TASK].indexOf(x.taskType) >= 0).map(x => x.overallStatus));
    const d = await step('insUwApproved', {insUwOutcome: 'Policy Approved', insUwTerms: ''});
    const path = [a, b, c, d].map(x => x.stage || JSON.stringify(x.said)).join(' → ');
    if(path !== 'insUwClientApproval → insUwPayment → insUnderwriting → insPolicyIssuance') throw new Error(path);
    if(tasks.length !== 2 || tasks.some(s => s !== 'Completed') || (d.r.insUwRounds || []).length !== 1) throw new Error(JSON.stringify({tasks, rounds: d.r.insUwRounds}));
    return path;
  });

  await t.step('policy data entry reads the policy PDF: fills what is empty, lists what differs, keeps the client’s details', async () => {
    const r = await t.eval(async () => {
      const text = ['Policy Schedule', 'Policy Number : POL-777', 'Name of the Policyholder : Mr. ZZ Insured Walker', 'PAN : ZZZPW1234Q',
        'Date of Commencement of Policy : 15/01/2026', 'Plan Name : Smart Term Plan UIN 104N', 'Sum Assured (Rs.) : 1,00,00,000',
        'Instalment Premium : Rs. 26,250.00', 'Premium Payment Mode : Yearly', 'Due Date of Last Premium : 15-Jan-2045',
        'Maturity Date : 15 January 2066', 'Nominee Name : Asha Walk Relationship : Wife'].join('\n');
      const found = insParsePolicyText(text);
      openInsuranceStepModal('CMS', 'CMS-ZINW', 'insPolicyEntered');
      await new Promise(r => setTimeout(r, 30));
      const box = !!document.getElementById('insPolicyPdfBox');
      const did = insApplyPolicyPdf('CMS-ZINW', found, 'policy.pdf');
      const v = k => (document.getElementById('f_' + k) || {}).value;
      const out = {found, box, did, no: v('insPolicyNo'), check: v('insPolicyNoCheck'), start: v('insCommencementDate'), last: v('insFinalPremiumDate'),
        mat: v('insMaturityDate'), nom: v('insNomineeName'), rel: v('insNomineeRelation'), prem: v('insPremium')};
      closeModal();
      return out;
    });
    const want = {insPolicyNo: 'POL-777', insCommencementDate: '2026-01-15', insFinalPremiumDate: '2045-01-15', insMaturityDate: '2066-01-15',
      insSumAssured: '10000000', insPremium: '26250', insPremiumFrequency: 'Yearly', insNomineeName: 'Asha Walk', insNomineeRelation: 'Spouse', pan: 'ZZZPW1234Q'};
    const off = Object.keys(want).filter(k => r.found[k] !== want[k]);
    if(off.length) throw new Error('read wrong: ' + off.map(k => k + '=' + r.found[k]).join(', '));
    if(!r.box || r.no !== 'POL-777' || r.check || r.start !== '2026-01-15' || r.nom !== 'Asha Walk') throw new Error(JSON.stringify(r));
    // The premium was already 21000 from the illustration: listed, not overwritten. The holder's name differs from the client's: listed, not changed.
    if(String(r.prem).replace(/,/g, '') !== '21000' || !r.did.differs.some(d => d.k === 'insPremium') || !r.did.client.some(d => d.k === 'cmsName')) throw new Error(JSON.stringify(r.did));
    return 'read ' + Object.keys(r.found).length + ' facts; filled ' + r.did.filled.length + '; premium 21000 vs 26250 listed; client name kept';
  });

  await t.step('the policy PDF itself, uploaded on the box, is read and fills the form', async () => {
    await t.eval(async () => { openInsuranceStepModal('CMS', 'CMS-ZINW', 'insPolicyEntered'); await new Promise(r => setTimeout(r, 30)); });
    await t.page.setInputFiles('#insPolicyPdf', {name: 'ZZ_policy.pdf', mimeType: 'application/pdf',
      buffer: tinyPdf(['Policy Schedule', 'Policy No. : TST-2468', 'Risk Commencement Date : 01-02-2026', 'Maturity Date : 01-02-2046', 'Nominee Name : ZZ Nominee'])});
    let r = null;
    // "Reading…" is the box at work; "Read <file>:" is the box done.
    for(let i = 0; i < 125 && !(r && /^(Read |Nothing recognisable|This PDF could not)/.test(r.note)); i++){
      await t.wait(200);
      r = await t.eval(() => ({note: (document.getElementById('insPolicyPdfResult') || {}).textContent || '', no: (document.getElementById('f_insPolicyNo') || {}).value,
        start: (document.getElementById('f_insCommencementDate') || {}).value, att: composeAttachments.map(a => a.filename)}));
    }
    await t.eval(() => closeModal());
    if(!r || !/^Read /.test(r.note) || r.start !== '2026-02-01' || r.att.indexOf('ZZ_policy.pdf') < 0) throw new Error(JSON.stringify(r));
    return r.note.slice(0, 120) + ' · attached to the policy letter';
  });

  await t.step('policy data: the number and dates must be typed twice; the client is emailed', async () => {
    const base = {insPolicyNo: 'POL-777', insCommencementDate: '2026-01-15', insCommencementCheck: '2026-01-15', insPremium: '26250',
      insPremiumFrequency: 'Yearly', insFinalPremiumDate: '2045-01-15', insFinalPremiumCheck: '2045-01-15', insMaturityDate: '2066-01-15',
      insNomineeName: 'Asha Walk', insNomineeRelation: 'Spouse'};
    const bad = await step('insPolicyEntered', Object.assign({}, base, {insPolicyNoCheck: 'POL-771'}));
    if(!bad.said || !/do not match/.test(bad.said[0])) throw new Error('a mistyped policy number went through');
    await t.eval(() => closeModal());
    const r = await step('insPolicyEntered', Object.assign({}, base, {insPolicyNoCheck: 'POL-777'}), {mail: true});
    const m = await waitForMail(t, /POL-777 has been issued/);
    if(r.stage !== 'insPolicyDelivery' || r.r.insNextDueDate !== '2027-01-15' || r.r.insPolicyNoCheck || !m) throw new Error(JSON.stringify({s: r.stage, d: r.r.insNextDueDate, m: !!m}));
    if(!/Asha Walk/.test(m.text || m.body)) throw new Error('the nominee is not in the letter');
    if(r.r.cmsName !== 'ZZ Insured Walk') throw new Error('the client name was changed without being asked: ' + r.r.cmsName);
    return 'mismatch refused; next premium ' + r.r.insNextDueDate + '; “' + m.subject + '”';
  });

  await t.step('an endorsement holds Original Received until it is resolved', async () => {
    const e = await step('insEndorsement', {insEndorsementNote: 'Nominee spelling'});
    const held = await step('insPolicyConfirmed');
    if(e.stage !== 'insPolicyDelivery' || !held.said || !/endorsement/i.test(held.said[0])) throw new Error(JSON.stringify({e: e.stage, held}));
    await t.eval(async () => { await completeClientDST('CMS-ZINW', INS_ENDORSE_TASK); });
    return 'endorsement task raised; confirmation refused until it was done';
  });

  await t.step('original received and confirmed: the CMS journey closes, the policy goes to Life Insurance, the client to RMS', async () => {
    await t.eval(async () => {
      // The last CMS meeting the next review is counted from.
      DB.meetings.push({id: 'MTG-ZINW', clientId: 'CMS-ZINW', linkedModule: 'CMS', scheduledDate: '2026-10-01', status: 'Completed', subject: 'ZZ warm-up'});
      DB.reviews = DB.reviews.filter(x => x.clientId !== 'CMS-ZINW');
      await save('meetings'); await save('reviews');
    });
    const r = await step('insPolicyConfirmed');
    const s = await t.eval(() => {
      const c = DB.clients.find(x => x.id === 'CMS-ZINW');
      const pols = insPoliciesOf('CMS-ZINW');
      const task = (DB.tasks || []).find(x => x.clientId === 'CMS-ZINW' && x.taskType === INS_RENEWAL_TASK && x.overallStatus !== 'Completed');
      const reviews = DB.reviews.filter(x => x.clientId === 'CMS-ZINW');
      return {pols: pols.map(p => ({module: p.module, no: p.insPolicyNo, status: p.status, due: p.insNextDueDate})), task: task ? task.policyId : null,
        polId: pols[0] && pols[0].id, reviews: reviews.map(x => x.meetingDate), want: nextReviewDateFrom(c.clientCategory, '2026-10-01'), clientDue: c.insNextDueDate || ''};
    });
    if(r.stage !== 'insCompleted') throw new Error('stage ' + r.stage);
    if(s.pols.length !== 1 || s.pols[0].module !== 'inslife' || s.pols[0].status !== 'Active' || s.pols[0].due !== '2027-01-15') throw new Error(JSON.stringify(s.pols));
    if(s.task !== s.polId || s.clientDue) throw new Error('renewal task ' + s.task + ', client due ' + s.clientDue);
    const wantDate = s.want < new Date().toISOString().slice(0, 10) ? null : s.want;
    if(s.reviews.length !== 1 || (wantDate && s.reviews[0] !== wantDate)) throw new Error('reviews ' + JSON.stringify(s.reviews) + ' want ' + s.want);
    // Confirming again does not make a second policy or a second review.
    const again = await t.eval(async () => { await insCloseCmsJourney(DB.clients.find(x => x.id === 'CMS-ZINW'));
      return [insPoliciesOf('CMS-ZINW').length, DB.reviews.filter(x => x.clientId === 'CMS-ZINW').length]; });
    if(again.join() !== '1,1') throw new Error('duplicated: ' + again);
    return 'Journey Completed; policy POL-777 in Life Insurance, due 15 Jan 2027; RMS review ' + s.reviews[0];
  });

  await t.step('the Life Insurance module lists it, with the three actions', async () => {
    const r = await t.eval(async () => {
      navigate('inslife'); await new Promise(r => setTimeout(r, 150));
      const row = document.querySelector('#insPolicyTable tr[data-policy]');
      const nav = [...document.querySelectorAll('*')].some(e => e.children.length === 0 && /Health Insurance/.test(e.textContent));
      if(row) row.click(); await new Promise(r => setTimeout(r, 80));
      const steps = [...document.querySelectorAll('#insPolicyDetail [data-step]')].map(b => b.dataset.step);
      closeModal();
      navigate('inshealth'); await new Promise(r => setTimeout(r, 100));
      const health = document.querySelectorAll('#insPolicyTable tr[data-policy]').length;
      return {row: row ? row.textContent : '', steps, health, nav};
    });
    if(!/POL-777/.test(r.row) || r.steps.join() !== 'insRenewalFollowUp,insRenewalPaid,insPolicyEnded' || r.health !== 0) throw new Error(JSON.stringify(r));
    return 'listed under Life (not Health); follow-up, payment, close offered';
  });

  await t.step('the server emails the renewal reminder from the policy at T-30, once, and again at T-7', async () => {
    const run = async (at) => t.eval(async (at) => {
      const res = await fetch('/api/reminders/run', {method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, apiHeaders()),
        body: JSON.stringify({at})});
      return (await res.json()).log.filter(x => x.kind === 'insurance-renewal');
    }, at);
    const first = await run('2026-12-16T10:30:00Z');
    const again = await run('2026-12-16T15:00:00Z');
    const m = await waitForMail(t, /Premium due on 15 Jan 2027/);
    const later = await run('2027-01-08T10:30:00Z');
    const back = await t.eval(async () => {
      DB.insPolicies = await sget('insPolicies'); DB.communications = await sget('communications');
      const p = insPoliciesOf('CMS-ZINW')[0];
      return {hist: (p.history || []).filter(h => h.step === 'insRenewalAuto').map(h => h.label),
        comm: (DB.communications || []).filter(x => x.clientId === 'CMS-ZINW' && /Renewal Reminder/.test(x.label || '')).length};
    });
    if(first.length !== 1 || !first[0].ok || again.length !== 1) throw new Error(JSON.stringify({first, again}));
    if(!m || m.to.indexOf('zzinw@example.com') < 0) throw new Error('no reminder arrived');
    if(later.length !== 2 || later[1].step !== 7) throw new Error(JSON.stringify(later));
    if(back.hist.length !== 2 || back.comm !== 2) throw new Error(JSON.stringify(back));
    return '“' + m.subject + '”; ' + back.hist.join(', ') + '; one reminder per step, from the policy only';
  });

  const polStep = async (id, fill, opts) => t.eval(async (a) => {
    const p = insPoliciesOf('CMS-ZINW')[0];
    const said = []; const al = window.alert; window.alert = m => said.push(String(m));
    try {
      openInsPolicyStep(p.id, a.id); await new Promise(r => setTimeout(r, 30));
      for(const [k, v] of Object.entries(a.fill || {})){ const el = document.getElementById('f_' + k); if(!el) throw new Error('no box ' + k); el.value = v; }
      const box = document.getElementById('f_insMail'); if(box) box.checked = !!a.opts.mail;
      await submitInsPolicyStep(p.id, a.id);
      closeModal();
    } finally { window.alert = al; }
    return {said, p: JSON.parse(JSON.stringify(insPoliciesOf('CMS-ZINW')[0]))};
  }, {id, fill, opts: opts || {}});

  await t.step('a payment in the module moves the due date on, keeps the history and emails a receipt', async () => {
    const b = await polStep('insRenewalPaid', {insRenewalPaidOn: '2027-01-10', insRenewalAmount: '26250', insRenewalReceiptRef: 'RCPT-1', insFundValue: '30000'}, {mail: true});
    const m = await waitForMail(t, /Premium received — policy POL-777/);
    const tasks = await t.eval(() => (DB.tasks || []).filter(x => x.clientId === 'CMS-ZINW' && x.taskType === INS_RENEWAL_TASK).map(x => x.overallStatus));
    if(b.p.insNextDueDate !== '2028-01-15' || (b.p.renewals || []).length !== 1 || String(b.p.insFundValue) !== '30000') throw new Error(JSON.stringify(b.p));
    if(!m || !/RCPT-1/.test(m.text || m.body)) throw new Error('no receipt letter');
    if(tasks.length !== 2 || tasks[0] !== 'Completed' || tasks[1] === 'Completed') throw new Error(tasks.join(', '));
    return 'next due ' + b.p.insNextDueDate + '; “' + m.subject + '”';
  });

  await t.step('the last premium of the paying term: PPT Completed, reminders stop, client and RM told, policy kept', async () => {
    await t.eval(async () => { const p = insPoliciesOf('CMS-ZINW')[0]; p.insNextDueDate = '2045-01-15'; await save('insPolicies'); });
    const b = await polStep('insRenewalPaid', {insRenewalPaidOn: '2045-01-10', insRenewalAmount: '26250'});
    const m = await waitForMail(t, /Premium paying term completed — policy POL-777/);
    const s = await t.eval(() => ({open: (DB.tasks || []).filter(x => x.clientId === 'CMS-ZINW' && x.taskType === INS_RENEWAL_TASK && x.overallStatus !== 'Completed').length,
      note: (DB.notifications || []).some(n => n.kind === 'insurance-ppt' && /POL-777/.test(n.body))}));
    const after = await t.eval(async () => (await (await fetch('/api/reminders/run', {method: 'POST', headers: Object.assign({'Content-Type': 'application/json'}, apiHeaders()),
      body: JSON.stringify({at: '2045-12-16T10:30:00Z'})})).json()).log.filter(x => x.kind === 'insurance-renewal' && /^2045/.test(x.date || '')).length);
    if(b.p.status !== 'PPT Completed' || b.p.insNextDueDate || b.p.insPolicyNo !== 'POL-777' || !m || s.open || !s.note || after) throw new Error(JSON.stringify({st: b.p.status, m: !!m, s, after}));
    return 'PPT Completed; “' + m.subject + '”; RM notified; no more reminders';
  });

  await t.step('the policy can be closed, and a new application can start on the same client', async () => {
    const a = await polStep('insPolicyEnded', {insClosureReason: 'Surrendered'});
    const b = await step('insNewApplication');
    if(a.p.status !== 'Closed') throw new Error(a.p.status);
    if(b.stage !== 'insurancePending' || b.r.insPolicyNo || (b.r.insPastPolicies || []).length !== 1) throw new Error(JSON.stringify(b.r));
    const kept = await t.eval(() => insPoliciesOf('CMS-ZINW').length);
    if(kept !== 1) throw new Error('policies ' + kept);
    return 'closed (Surrendered); a new application started; the policy stays on file';
  });

  await t.step('a client left at the old Policy In Force stage is moved to Journey Completed, its policy filed once', async () => {
    const r = await t.eval(async () => {
      const c = {id: 'CMS-ZOLD', cmsName: 'ZZ Old Policy', createdAt: new Date().toISOString(), rmName: me().id, cmsStage: 'insActive',
        insCategory: 'General Insurance', insGeneralCategory: 'Health', insPolicyNo: 'HLT-1', insPremium: '12000', insPremiumFrequency: 'Yearly',
        insNextDueDate: '2027-03-01', insUwOutcome: 'Standard'};
      DB.clients = DB.clients.filter(x => x.id !== c.id).concat([c]);
      await migrateInsuranceToModules(); await migrateRetiredStages('CMS', CMS_RETIRED_STATES);
      await migrateInsuranceToModules();
      return {stage: stateOf('CMS', c), outcome: c.insUwOutcome, pols: insPoliciesOf(c.id).map(p => p.module + ':' + p.insNextDueDate), due: c.insNextDueDate || ''};
    });
    if(r.stage !== 'insCompleted' || r.outcome !== 'Policy Approved' || r.pols.join() !== 'inshealth:2027-03-01' || r.due) throw new Error(JSON.stringify(r));
    return 'moved; filed under Health Insurance; Standard → Policy Approved';
  });

  await t.step('a client on the old parked stage, under an edited journey, walks on', async () => {
    const r = await t.eval(async () => {
      const old = JSON.parse(JSON.stringify(BLUEPRINTS.CMS));
      old.states = old.states.filter(s => !/^ins[A-Z]/.test(s.id));
      old.states.find(s => s.id === 'insurancePending').label = 'Insurance — Workflow Not Yet Defined (Pending)';
      old.states.find(s => s.id === 'insurancePending').terminal = true;
      old.transitions = old.transitions.filter(x => !/^ins[A-Z]/.test(x.id));
      DB.config.blueprints = DB.config.blueprints || {};
      const keep = DB.config.blueprints.CMS;
      DB.config.blueprints.CMS = old;
      const bp = getBlueprint('CMS');
      const out = {label: stateLabel('CMS', 'insurancePending'), terminal: !!stateMeta('CMS', 'insurancePending').terminal,
        states: bp.states.filter(s => /^ins[A-Z]/.test(s.id)).length, steps: bp.transitions.filter(x => x.from === 'insCif').map(x => x.id)};
      DB.config.blueprints.CMS = keep;
      return out;
    });
    if(r.terminal || r.states !== 16 || r.steps.indexOf('insCifSend') < 0) throw new Error(JSON.stringify(r));
    return r.label + ', ' + r.states + ' stages added';
  });

  await t.step('the six letters are in Setup, editable', async () => {
    const r = await t.eval(() => ['insIllustration', 'insIllustrationRevised', 'insPolicyIssued', 'insRenewalReminder', 'insRenewalReceived', 'insPptCompleted']
      .map(k => !!mailTemplateMeta(k) && !!mailTemplateOf(k).subject));
    if(!r.every(Boolean)) throw new Error(JSON.stringify(r));
    return 'all six listed under Insurance';
  });
});

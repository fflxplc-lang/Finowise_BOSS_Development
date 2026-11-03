/* RIA research: what RIA reads before it speaks about a company, a fund, a
   sector or the firm, the risk checks BOSS runs on it, the client's
   suitability, and what reaches the model and the screen.

   Every outside source is a stand-in (lib/research-feed.js): a distressed
   company built to trip the warnings, a sound bank built not to, two
   funds, two sector indices and a four-page company website. The model is
   a stand-in too; the tests read what BOSS sent it and what BOSS drew. */
const http = require('http');
const {suite} = require('../lib/harness');
const feedLib = require('../lib/research-feed');

const BASE = Number(process.env.BOSS_PORT || 3000);
const FEED_PORT = BASE + 317, NAV_PORT = BASE + 311, MOCK_PORT = BASE + 329;
const SITE = 'http://127.0.0.1:' + FEED_PORT + '/site/';

const seen = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d);
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if(req.url.endsWith('/models')) return res.end(JSON.stringify({data:[{id:'mock-model'}]}));
    const j = JSON.parse(body || '{}'); seen.push(j);
    const sys = ((j.messages||[]).find(m=>m.role==='system')||{}).content || '';
    const text = /WHICH RECORDS/.test(sys) ? '{"reads":[],"client":null}' : '1. Executive Summary\nMOCK RESEARCH ANSWER';
    res.end(JSON.stringify({choices:[{message:{role:'assistant', content:text}}]}));
  });
});
const last = () => seen[seen.length-1];
const lastUser = () => { const m = last().messages; return m[m.length-1].content; };
const lastSys = () => ((last().messages||[]).find(m=>m.role==='system')||{}).content || '';
const dataOf = u => { const m = u.match(/<data>\n([\s\S]*?)\n<\/data>/); return m ? JSON.parse(m[1]) : null; };

suite(async t => {
  const feed = await feedLib.start(FEED_PORT), navFeed = await feedLib.start(NAV_PORT);
  await new Promise(r => mock.listen(MOCK_PORT, '127.0.0.1', r));
  try {
  await t.home();
  const get = url => t.eval(async (u) => (await fetch(u, {headers: apiHeaders()})).json(), url);

  t.section('the server researches a listed company');
  await t.step('a distressed company: statements, ratios and headlines read with a session, and every warning goes up with its figure', async () => {
    const r = await get('/api/research/stock?symbol=SHAKY.NS');
    if(!r.ok || !r.fundamentals || !r.risk) throw new Error(JSON.stringify(r).slice(0, 300));
    if(!feed.hits.some(h => /quoteSummary\/SHAKY\.NS.*crumb=CrUmB123/.test(h))) throw new Error('the quote summary was not read with the crumb');
    const f = r.fundamentals, k = Object.fromEntries(r.risk.categories.map(c => [c.key, c]));
    if(f.annual.length !== 3 || f.annual[2].netProfitCr !== -110 || f.balanceSheet.debtToEquity !== 3.4 || f.valuation.marketCapCr !== 420) throw new Error('fundamentals ' + JSON.stringify({a: f.annual[2], de: f.balanceSheet.debtToEquity, mc: f.valuation.marketCapCr}));
    if(r.risk.overall !== 'Critical' || k.financialHealth.level !== 'Critical') throw new Error('levels ' + r.risk.overall + ' / ' + k.financialHealth.level);
    const texts = r.risk.warnings.map(w => w.text).join(' | ');
    for(const w of ['Net loss in each of the last 3 financial years', 'Revenue has declined two years running', 'Debt rose', 'Debt-to-equity of 3.4', 'Operating cash flow is negative', 'Loss-making on a trailing basis', 'Governance risk score 9/10', 'Thinly traded', 'forensic audit', 'Results are due'])
      if(!texts.includes(w)) throw new Error('missing warning "' + w + '": ' + texts);
    if(k.regulatory.level !== 'High' || k.liquidity.level !== 'High' || k.concentration.level !== 'Not assessed') throw new Error('categories ' + JSON.stringify([k.regulatory.level, k.liquidity.level, k.concentration.level]));
    if(!/NSE\/BSE corporate announcements/.test(k.regulatory.notes.join(' '))) throw new Error('regulatory limitation not stated');
    if(!r.risk.warnings.every(w => w.data)) throw new Error('a warning came without its figure');
    const st = r.sources.find(s => /statements/.test(s.what));
    if(!st || st.statementsAsOf !== '2025-03-31' || !st.asOf) throw new Error('sources ' + JSON.stringify(r.sources));
    return 'Critical: ' + r.risk.warnings.length + ' warnings across ' + r.risk.categories.filter(c => c.findings.length).length + ' categories, each with its figure; statements to 2025-03-31';
  });
  await t.step('a sound bank: no warnings, positives found, and debt-to-equity is not held against a lender', async () => {
    const r = await get('/api/research/stock?symbol=HDFCBANK.NS');
    const fh = r.risk.categories.find(c => c.key === 'financialHealth');
    if(r.risk.overall !== 'Low' || r.risk.warnings.length) throw new Error('flagged ' + JSON.stringify(r.risk.warnings));
    if(!/lender or financial company/.test(fh.notes.join(' '))) throw new Error('no note on D/E for a bank');
    if(r.risk.positives.length < 5 || !r.risk.positives.some(p => /ROE of 16.4%/.test(p))) throw new Error('positives ' + JSON.stringify(r.risk.positives));
    if(!r.risk.positives.some(p => /₹60,000 Cr to ₹67,000 Cr/.test(p))) throw new Error('crore figures not in Indian format: ' + r.risk.positives[0]);
    return 'Low, ' + r.risk.positives.length + ' positives, D/E 3.1 not flagged for a bank';
  });
  await t.step('an index has prices but no fundamentals, and says so rather than scoring itself', async () => {
    const r = await get('/api/research/stock?symbol=%5ENSEI');
    if(!r.ok || r.risk !== null || !r.fundamentalsError) throw new Error(JSON.stringify(r).slice(0, 300));
    const bad = await get('/api/research/stock?symbol=not%20a%20symbol');
    if(bad.ok) throw new Error('a bad symbol was researched');
    return 'no risk score; fundamentals: "' + r.fundamentalsError + '"';
  });

  t.section('funds, sectors and the firm\'s own website');
  await t.step('a fund: AMFI NAV, returns from its history, and the facts the sources do not carry named as missing', async () => {
    const r = await get('/api/market/fund?q=' + encodeURIComponent('Parag Parikh Flexi Cap Direct'));
    if(!r.ok || r.code !== '122639' || r.nav !== 88.1234 || r.navDate !== '31-Oct-2026') throw new Error(JSON.stringify(r).slice(0, 300));
    const s = r.stats || {};
    if(!(s.returnsPct.y1 > 10 && s.returnsPct.y3Cagr > 10) || s.volatility1yPct == null || s.maxDrawdown3yPct == null) throw new Error('stats ' + JSON.stringify(s));
    if(!r.notAvailable.some(x => /expense ratio/.test(x)) || !r.notAvailable.some(x => /portfolio/.test(x))) throw new Error('missing facts not named');
    if(!r.alternatives.some(a => /Regular Plan/.test(a.scheme))) throw new Error('alternatives ' + JSON.stringify(r.alternatives));
    const sm = await get('/api/market/fund?q=' + encodeURIComponent('Nippon India Small Cap'));
    if(!sm.riskFlags.some(f => f.level === 'High' && /Small Cap/.test(f.text))) throw new Error('small-cap risk not flagged ' + JSON.stringify(sm.riskFlags));
    const none = await get('/api/market/fund?q=' + encodeURIComponent('Imaginary Unicorn Opportunities'));
    if(none.ok || !none.notFound) throw new Error('an unknown fund matched ' + JSON.stringify(none).slice(0, 200));
    return '1y ' + s.returnsPct.y1 + '%, 3y CAGR ' + s.returnsPct.y3Cagr + '%, worst fall ' + s.maxDrawdown3yPct + '%; small cap flagged High; unknown fund not matched';
  });
  await t.step('the sector indices come side by side, and the ones the feed lacks are marked, not invented', async () => {
    const r = await get('/api/market/sectors');
    const it = r.rows.find(x => x.name === 'IT'), bank = r.rows.find(x => x.name === 'Bank'), pharma = r.rows.find(x => x.name === 'Pharma');
    if(!r.ok || !it || it.level !== 35100 || !bank || bank.trend !== 'uptrend' || !pharma.missing || pharma.level != null) throw new Error(JSON.stringify(r.rows).slice(0, 400));
    return 'IT ' + it.monthPct + '% / Bank ' + bank.monthPct + '% this month; Pharma marked missing';
  });
  await t.step('the website is read page by page, scripts and other sites left out, and a question finds its page', async () => {
    const all = await get('/api/research/website?site=' + encodeURIComponent(SITE) + '&refresh=1');
    if(!all.ok || all.pagesRead !== 4) throw new Error(JSON.stringify(all).slice(0, 300));
    if(all.pages.some(p => /elsewhere|pdf/.test(p.url))) throw new Error('followed a link off the site');
    if(all.pages.find(p => /fees/.test(p.url)).title !== 'Fees & Charges') throw new Error('title entities not decoded');
    const q = await get('/api/research/website?site=' + encodeURIComponent(SITE) + '&q=' + encodeURIComponent('What are your advisory fees?'));
    if(!/\/site\/fees$/.test((q.results[0] || {}).url) || !/₹25,000/.test(q.results[0].text)) throw new Error('fees ' + JSON.stringify(q.results).slice(0, 300));
    if(q.results.some(x => /do not read/.test(x.text))) throw new Error('a script was read as text');
    const bad = await get('/api/research/website?site=' + encodeURIComponent('ftp://example.com'));
    if(bad.ok || !/only http/.test(bad.message)) throw new Error('ftp accepted ' + JSON.stringify(bad));
    return all.pagesRead + ' pages; "advisory fees" → ' + q.results[0].url.split('/').pop() + '; ftp refused';
  });

  t.section('RIA researches before it answers');
  const cid = await t.eval(async (port) => {
    await fetch('/api/connections/bossai', {method:'PUT', headers:Object.assign({'Content-Type':'application/json'}, apiHeaders()),
      body: JSON.stringify({enabled:true, config:{baseUrl:'http://127.0.0.1:'+port+'/v1', model:'mock-model'}})});
    await fetch('/api/connections/bossai/test', {method:'POST', headers: apiHeaders()});
    const c = {id: uid('CMS'), cmsName: 'Ramesh Research', createdAt: new Date().toISOString(), assignedTo: me().id, branch: 'Pune',
      kycStatus: 'Validated', taxStatus: 'Individual', dob: '1958-04-10', iseqCategory: 'Conservative', iseqScore: 6, pan: 'ABCDE1234F'};
    initState('CMS', c); DB.clients.push(c);
    DB.platformHoldings.push({id: uid('PH'), clientId: c.id, schemeName: 'Some Debt Fund', current: 1000000});
    const due = new Date(Date.now() + 2 * 365 * 86400000).toISOString().slice(0, 10);
    DB.clientGoals.push({id: uid('GOL'), clientId: c.id, name: 'Daughter wedding', target: '500000', targetDate: due, priority: 'High'});
    navigate('dashboard'); ai.turns = []; aiTogglePanel(); await aiRefreshStatus(true);
    return c.id;
  }, MOCK_PORT);
  const ask = async q => t.eval(async (q) => {
    document.getElementById('aiInput').value = q; await aiSend();
    const turns = document.getElementById('aiTurns') || document.body;
    const openFirst = [...turns.querySelectorAll('.ria-alert')].map(e => e.hasAttribute('open'));
    return {openFirst, alerts: [...turns.querySelectorAll('.ria-alert')].map(e => { e.open = true; return e.innerText.replace(/\s+/g, ' '); }),
      sources: [...turns.querySelectorAll('.ria-sources')].slice(-1).map(e => { e.open = true; return e.innerText.replace(/\s+/g, ' '); })[0] || '',
      cards: [...turns.querySelectorAll('.lexi-quote')].map(e => e.innerText.replace(/\s+/g, ' ')), text: turns.innerText};
  }, q);

  await t.step('a share for a Conservative client: research, suitability and concentration reach the model, and the alerts are drawn', async () => {
    await t.eval(() => { ai.turns = []; aiDrawPanel(); });
    const r = await ask('Ramesh Research ke liye Shaky Infra ka share lena chahiye? 3 lakh lagana hai');
    const d = dataOf(lastUser()), q = d.liveMarket.quotes[0];
    if(q.symbol !== 'SHAKY.NS' || !q.research || q.research.risk.overall !== 'Critical') throw new Error('research not sent ' + JSON.stringify(q).slice(0, 300));
    const s = d.clientSuitability;
    if(!s || !s.assessed || s.riskProfile !== 'Conservative' || s.age < 60 || !(s.nearestGoalYears < 3) || s.bookAum !== 1000000) throw new Error('suitability ' + JSON.stringify(s));
    const ft = s.findings.map(f => f.level + ': ' + f.text).join(' | ');
    for(const w of ['outside a Conservative profile', 'should not be in individual shares', 'does not fit a Conservative profile', '23.1% of the client\'s book', 'harder to recover'])
      if(!ft.includes(w)) throw new Error('suitability lacks "' + w + '": ' + ft);
    if(!/Critical: Shaky Infra Limited carries Critical risk/.test(ft)) throw new Error('a Critical stock for a Conservative client is not Critical: ' + ft);
    const conc = q.research.risk.categories.find(c => c.key === 'concentration');
    if(conc.level !== 'High') throw new Error('concentration not filled from the book: ' + JSON.stringify(conc));
    if(!s.tax || !/20%/.test(s.tax.shortTerm) || !/12.5%/.test(s.tax.longTerm) || !/1.25 lakh/.test(s.tax.longTerm)) throw new Error('tax ' + JSON.stringify(s.tax));
    if(!d.riskAlerts.some(a => a.level === 'Critical' && /^Financial Health,.*Regulatory Risk/.test(a.category)) || !d.riskAlerts.some(a => a.category === 'Suitability')) throw new Error('alerts ' + JSON.stringify(d.riskAlerts));
    if(last().max_tokens !== 2600) throw new Error('a research answer was capped at ' + last().max_tokens + ' tokens');
    const sys = lastSys();
    for(const w of ['RESEARCH, RISK AND CLIENT PROTECTION', 'Client interest first', '1. Executive Summary', '11. Recommended Next Steps / Human Review', 'Never promise or imply a guaranteed return', 'never claim research you were not given', 'Not assessed" is unknown, never safe', 'follow the SOP, state the discrepancy', 'SEBI', 'Decision now', 'analytical lean'])
      if(!sys.includes(w)) throw new Error('the brief lacks "' + w + '"');
    const stock = r.alerts.filter(a => /Shaky Infra Limited/.test(a) && !/Suitability for/.test(a));
    if(stock.length !== 1) throw new Error('expected one alert for the company, got ' + stock.length + ': ' + JSON.stringify(r.alerts).slice(0, 500));
    const a = stock[0];
    for(const w of ['RISK ALERT: CRITICAL', 'Risk category: Financial Health', 'Regulatory Risk', 'Concern: Net loss in each of the last 3 financial years', 'Data: net profit: -₹20 Cr',
      'Source: Yahoo Finance (statements to 2025-03-31)', 'Potential impact on the client:', 'Suggested next steps:', 'Escalate to an authorised financial professional'])
      if(!a.includes(w)) throw new Error('the company alert lacks "' + w + '": ' + a);
    if(!r.alerts.some(x => /Suitability for Ramesh Research/.test(x))) throw new Error('no suitability card');
    if(r.alerts.length !== 2) throw new Error(r.alerts.length + ' alerts: ' + JSON.stringify(r.alerts.map(x => x.slice(0, 60))));
    if(!r.openFirst[0] || r.openFirst.slice(1).some(Boolean)) throw new Error('only the worst alert should be open: ' + JSON.stringify(r.openFirst));
    if(!r.alerts.every(a => /not a buy or sell instruction/.test(a))) throw new Error('an alert lacks the not-an-instruction line');
    if(!/Sources and data timestamps/.test(r.sources) || !/Shaky Infra Limited: price and technicals — Yahoo Finance, \d/.test(r.sources) || !/statements to 2025-03-31/.test(r.sources) || !/Client records \(Ramesh Research\) — BOSS/.test(r.sources)) throw new Error('sources ' + r.sources);
    if(!/Risk checks: Critical/.test(r.cards[0] || '')) throw new Error('card ' + r.cards[0]);
    if(!/not advice to a client and not a buy or sell instruction/.test(r.text)) throw new Error('no research disclaimer');
    return r.alerts.length + ' alert cards (worst ' + d.riskAlerts[0].level + '); suitability ' + s.level + ' with ' + s.findings.length + ' findings; concentration High at 23.1% of the book';
  });
  await t.step('with no client in view, suitability is reported as not checked rather than assumed', async () => {
    await t.eval(() => { ai.turns = []; aiDrawPanel(); });
    await ask('Shaky Infra share analyse karo');
    const s = dataOf(lastUser()).clientSuitability;
    if(!s || s.assessed !== false || !/was not checked/.test(s.reason)) throw new Error(JSON.stringify(s));
    return 'assessed:false — "' + s.reason.slice(0, 70) + '…"';
  });
  await t.step('a sound company for an Aggressive client: no suitability alert, only what the checks found', async () => {
    const r = await t.eval(async (id) => {
      const c = DB.clients.find(x => x.id === id); c.iseqCategory = 'Aggressive';
      const q = [{symbol:'HDFCBANK.NS', name:'HDFC Bank Limited'}]; await riaStockResearch(q);
      const s = riaSuitability(c, q, 50000);
      const out = {level: s.level, findings: s.findings.map(f => f.text), verdict: s.perStock[0].verdict, alerts: riaAlerts(q, s, []).length};
      c.iseqCategory = 'Conservative';
      return out;
    }, cid);
    if(r.alerts || /does not fit/i.test(r.verdict) || r.level !== 'Moderate' || r.findings.length !== 1 || !/nearest goal is 2/.test(r.findings[0])) throw new Error(JSON.stringify(r));
    return 'verdict "' + r.verdict + '"; the 2-year goal is a Moderate note for an Aggressive client, not an alert';
  });
  await t.step('the risk ladder reads every ISEQ category, and a bare client lists what is missing instead of guessing', async () => {
    const r = await t.eval(() => ({
      tiers: ['Conservative', 'Moderately Conservative', 'Moderate', 'Moderately Aggressive', 'Aggressive', '', 'Balanced'].map(p => riaTierOf({iseqCategory: p})),
      bare: riaSuitability({id: 'X', cmsName: 'Bare Client'}, [{symbol:'HDFCBANK.NS', name:'HDFC Bank'}], 0),
    }));
    if(JSON.stringify(r.tiers) !== '[1,2,3,4,5,0,3]') throw new Error('tiers ' + JSON.stringify(r.tiers));
    const m = r.bare.missing.join(' | ');
    for(const w of ['risk profile', 'date of birth', 'goals', 'portfolio value', 'emergency reserve', 'amount to be invested']) if(!m.includes(w)) throw new Error('missing list lacks "' + w + '": ' + m);
    if(!r.bare.findings.some(f => f.level === 'High' && /No risk profile/.test(f.text))) throw new Error('no-profile not flagged');
    return 'tiers ' + r.tiers.join(',') + '; a bare client lists ' + r.bare.missing.length + ' missing facts';
  });
  await t.step('a fund question reads the fund, checks it against the client, and lists AMFI among the sources', async () => {
    await t.eval(() => { ai.turns = []; aiDrawPanel(); });
    const r = await ask('Ramesh Research ke liye Nippon India Small Cap fund ka performance kaisa hai?');
    const d = dataOf(lastUser());
    const f = d.mutualFunds && d.mutualFunds.funds[0];
    if(!f || f.code !== '125497' || !f.stats || !f.riskFlags.some(x => x.level === 'High')) throw new Error('fund ' + JSON.stringify(d.mutualFunds).slice(0, 300));
    if(d.liveMarket) throw new Error('a fund question read share prices');
    if(!d.clientSuitability.findings.some(x => /high-risk fund for a Conservative profile/.test(x.text)) || !d.clientSuitability.findings.some(x => /equity-oriented fund and the nearest goal/.test(x.text))) throw new Error('fund suitability ' + JSON.stringify(d.clientSuitability.findings));
    if(d.clientSuitability.tax) throw new Error('share tax rules attached to a fund question');
    if(!r.alerts.some(a => /Nippon India Small Cap.*Fund Risk/.test(a)) || !r.alerts.some(a => /Suitability for/.test(a))) throw new Error('alerts ' + JSON.stringify(r.alerts).slice(0, 300));
    if(!/Latest NAV — AMFI/.test(r.sources) || !/NAV history .* — mfapi\.in/.test(r.sources)) throw new Error('sources ' + r.sources);
    if(last().max_tokens !== 2600) throw new Error('tokens ' + last().max_tokens);
    return f.scheme + ': ' + f.riskFlags.length + ' risk flags; ' + r.alerts.length + ' alerts';
  });
  await t.step('a policy question names no fund and is left to the policy; a sector question reads the sectors', async () => {
    const r = await t.eval(() => ({policy: riaFundAsk('Konsa fund loon 5 lakh ke liye?', []), best: riaFundAsk('Best large cap fund for a moderate client', []), two: riaFundAsk('Compare Parag Parikh Flexi Cap vs Nippon India Small Cap fund returns', [])}));
    if(r.policy !== null || r.best !== null) throw new Error('policy question read as a fund: ' + JSON.stringify(r));
    if(JSON.stringify(r.two) !== '["Parag Parikh Flexi Cap","Nippon India Small Cap"]') throw new Error('two funds ' + JSON.stringify(r.two));
    await t.eval(() => { ai.turns = []; aiDrawPanel(); });
    await ask('Which sector is doing best this month?');
    const d = dataOf(lastUser());
    if(!d.sectors || !d.sectors.ok || !d.sectors.rows.some(x => x.name === 'IT')) throw new Error('sectors ' + JSON.stringify(d.sectors).slice(0, 200));
    return 'policy questions untouched; two funds split; sectors read (' + d.sectors.rows.filter(x => x.level != null).length + ' indices)';
  });
  await t.step('a question about the firm is answered from its website, with the page, and a records question never reads it', async () => {
    await t.eval(async (site) => { DB.config.aiWebsite = {url: site}; ai.turns = []; aiDrawPanel(); }, SITE);
    const r = await ask('What are your advisory fees?');
    const u = lastUser(), m = u.match(/<website>\n([\s\S]*?)\n<\/website>/);
    if(!m) throw new Error('no <website> block: ' + u.slice(0, 300));
    const w = JSON.parse(m[1]);
    if(!/\/site\/fees$/.test(w.passages[0].url) || !w.readAt) throw new Error('website ' + JSON.stringify(w).slice(0, 300));
    if(!/<website> holds passages from the firm's own website/.test(lastSys())) throw new Error('website rule missing');
    if(!/Company website: Fees & Charges — http/.test(r.sources)) throw new Error('sources ' + r.sources);
    const n0 = seen.length; await ask('Aaj kitne tasks pending hain?');
    if(seen.slice(n0).some(x => /<website>/.test(x.messages[x.messages.length - 1].content))) throw new Error('a records question read the website');
    return 'fees page sent with its address and read time; records question left alone';
  });
  await t.step('setup: the website is set on the RIA page and "Read it now" lists what was read', async () => {
    const r = await t.eval(async (site) => {
      const box = document.createElement('div'); box.id = 'riaTestBox'; box.innerHTML = renderSettingsAiAssistant(); document.body.appendChild(box);
      document.getElementById('aiw_url').value = site;
      await saveAiWebsite();
      await aiWebsiteCheck();
      const out = {saved: DB.config.aiWebsite.url, status: document.getElementById('aiw_status').innerText.replace(/\s+/g, ' '), card: /The company website/.test(box.textContent)};
      box.remove(); return out;
    }, SITE);
    if(!r.card || r.saved !== SITE || !/^Read 4 pages/.test(r.status) || !/Fees & Charges/.test(r.status)) throw new Error(JSON.stringify(r));
    return r.status.slice(0, 90) + '…';
  });
  await t.step('a question about the CRM\'s records still reads no prices, funds, sectors or fundamentals', async () => {
    const n0 = feed.hits.length, m0 = navFeed.hits.length;
    await t.eval(async () => { DB.config.aiWebsite = {}; ai.turns = []; document.getElementById('aiInput').value = 'kitne clients ke KYC pending hain'; await aiSend(); });
    const d = dataOf(lastUser()) || {};
    if(feed.hits.length !== n0 || navFeed.hits.length !== m0 || d.liveMarket || d.mutualFunds || d.sectors || d.clientSuitability) throw new Error('read something: ' + JSON.stringify(feed.hits.slice(n0).concat(navFeed.hits.slice(m0))));
    if(last().max_tokens !== 1200) throw new Error('a records question got ' + last().max_tokens + ' tokens');
    return 'nothing outside read; short-answer budget kept';
  });
  } finally { feed.close(); navFeed.close(); mock.close(); }
});

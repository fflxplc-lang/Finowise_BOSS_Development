/* A stand-in for every outside source RIA researches from, on one port:
   the price feed's chart and search (as lexi-market fakes them), its
   cookie + crumb handshake, the quote summary and the statements
   timeseries, the AMFI NAV file, the NAV history (mfapi.in) and a small
   company website. Each company is shaped to trip particular checks, so a
   test can say exactly which warning should and should not go up. */
const http = require('http');

function chart(symbol, name, from, prev, last, opts){
  opts = opts || {};
  const n = 250, now = Date.now(), t = [], c = [];
  for(let i = n - 1; i >= 0; i--) t.push(Math.floor((now - 60000 - i * 86400000) / 1000));
  for(let i = 0; i < n - 2; i++) c.push(from + (prev - from) * i / (n - 3) + (i % 2 ? 3 : -3) * (opts.swing || 1));
  c.push(prev, last);
  const vol = opts.volume || 100000;
  return {chart:{result:[{meta:{symbol, longName:name, currency:'INR', fullExchangeName:'NSE', regularMarketPrice:last, chartPreviousClose:prev,
    regularMarketTime:Math.floor(now / 1000), regularMarketDayHigh:last + 5, regularMarketDayLow:last - 9,
    fiftyTwoWeekHigh:Math.max(from, prev, last) + 20, fiftyTwoWeekLow:Math.min(from, last) - 20},
    timestamp:t, indicators:{quote:[{close:c, high:c.map(x => x + 4), low:c.map(x => x - 4), open:c.map(x => x - 1.5), volume:c.map((_, i) => vol + i * 37)}]}}], error:null}};
}
const R = v => ({raw: v, fmt: String(v)});
const CHARTS = {
  // a healthy large bank in an uptrend
  'HDFCBANK.NS': chart('HDFCBANK.NS', 'HDFC Bank Limited', 600, 700, 707, {volume: 9000000}),
  // a stretched, indebted, loss-making small company falling hard, thinly traded
  'SHAKY.NS': chart('SHAKY.NS', 'Shaky Infra Limited', 120, 60, 54, {volume: 8000, swing: 4}),
  '^NSEI': chart('^NSEI', 'NIFTY 50', 25800, 22888.95, 22811.35),
  '^CNXIT': chart('^CNXIT', 'NIFTY IT', 40000, 35000, 35100),
  '^NSEBANK': chart('^NSEBANK', 'NIFTY BANK', 48000, 52000, 52300),
};
const SEARCH = {
  'hdfc bank': {quotes:[{symbol:'HDFCBANK.NS', longname:'HDFC Bank Limited', quoteType:'EQUITY', sectorDisp:'Financial Services', industryDisp:'Banks - Regional'}],
    news:[{title:'HDFC Bank posts steady quarter', publisher:'Business Line', providerPublishTime:Math.floor(Date.now() / 1000) - 3600}]},
  'hdfcbank': {quotes:[{symbol:'HDFCBANK.NS', longname:'HDFC Bank Limited', quoteType:'EQUITY'}],
    news:[{title:'HDFC Bank posts steady quarter', publisher:'Business Line', providerPublishTime:Math.floor(Date.now() / 1000) - 3600}]},
  'shaky infra': {quotes:[{symbol:'SHAKY.NS', longname:'Shaky Infra Limited', quoteType:'EQUITY', sectorDisp:'Industrials'}],
    news:[{title:'SEBI orders forensic audit of Shaky Infra accounts', publisher:'Mint', providerPublishTime:Math.floor(Date.now() / 1000) - 7200},
          {title:'Shaky Infra auditor resigns', publisher:'ET', providerPublishTime:Math.floor(Date.now() / 1000) - 9000}]},
  'shaky': {quotes:[{symbol:'SHAKY.NS', longname:'Shaky Infra Limited', quoteType:'EQUITY'}],
    news:[{title:'SEBI orders forensic audit of Shaky Infra accounts', publisher:'Mint', providerPublishTime:Math.floor(Date.now() / 1000) - 7200},
          {title:'Shaky Infra auditor resigns', publisher:'ET', providerPublishTime:Math.floor(Date.now() / 1000) - 9000}]},
};
const SUMMARY = {
  'HDFCBANK.NS': {price:{longName:'HDFC Bank Limited', currency:'INR', marketCap:R(1.08e13)},
    summaryDetail:{marketCap:R(1.08e13), trailingPE:R(19.4), forwardPE:R(16.8), dividendYield:R(0.011), beta:R(0.8), averageVolume:R(9000000)},
    defaultKeyStatistics:{trailingEps:R(36.4), forwardEps:R(42.1), priceToBook:R(2.6), bookValue:R(272)},
    financialData:{returnOnEquity:R(0.164), returnOnAssets:R(0.019), profitMargins:R(0.24), operatingMargins:R(0.31), revenueGrowth:R(0.12), earningsGrowth:R(0.09),
      totalDebt:R(7.5e12), totalCash:R(2.1e12), debtToEquity:R(310), operatingCashflow:R(1.2e12), freeCashflow:R(1.0e12), recommendationKey:'buy', numberOfAnalystOpinions:R(38)},
    assetProfile:{sector:'Financial Services', industry:'Banks - Regional', fullTimeEmployees:R(210000), longBusinessSummary:'HDFC Bank provides banking and financial services.', overallRisk:R(2), auditRisk:R(1), boardRisk:R(3), compensationRisk:R(2), shareHolderRightsRisk:R(1)},
    calendarEvents:{earnings:{earningsDate:[R(Math.floor(Date.now() / 1000) + 60 * 86400)]}}},
  'SHAKY.NS': {price:{longName:'Shaky Infra Limited', currency:'INR'},
    summaryDetail:{marketCap:R(4.2e9), trailingPE:null, forwardPE:R(95), beta:R(1.9)},
    defaultKeyStatistics:{trailingEps:R(-6.2), priceToBook:R(3.1)},
    financialData:{returnOnEquity:R(-0.21), profitMargins:R(-0.18), operatingMargins:R(-0.07), revenueGrowth:R(-0.22), earningsGrowth:R(-0.6),
      totalDebt:R(9e9), totalCash:R(2e8), debtToEquity:R(340), operatingCashflow:R(-6e8), freeCashflow:R(-1.1e9)},
    assetProfile:{sector:'Industrials', industry:'Engineering & Construction', overallRisk:R(9), auditRisk:R(10), boardRisk:R(8), compensationRisk:R(6), shareHolderRightsRisk:R(7)},
    calendarEvents:{earnings:{earningsDate:[R(Math.floor(Date.now() / 1000) + 5 * 86400)]}}},
};
const STATEMENTS = {
  'HDFCBANK.NS': {annualTotalRevenue:[1.9e12, 2.2e12, 2.6e12], annualNetIncome:[4.4e11, 6.0e11, 6.7e11], annualTotalDebt:[6e12, 6.8e12, 7.5e12],
    annualOperatingCashFlow:[9e11, 1.1e12, 1.2e12], annualFreeCashFlow:[8e11, 9e11, 1.0e12], annualStockholdersEquity:[2.8e12, 3.4e12, 4.0e12],
    quarterlyTotalRevenue:[6.3e11, 6.5e11, 6.6e11, 6.8e11], quarterlyNetIncome:[1.6e11, 1.65e11, 1.7e11, 1.76e11]},
  'SHAKY.NS': {annualTotalRevenue:[9e9, 7.5e9, 5.9e9], annualNetIncome:[-2e8, -6e8, -1.1e9], annualTotalDebt:[5e9, 6.5e9, 9e9],
    annualOperatingCashFlow:[1e8, -2e8, -6e8], annualFreeCashFlow:[-3e8, -6e8, -1.1e9], annualStockholdersEquity:[3.6e9, 3.0e9, 2.6e9],
    quarterlyTotalRevenue:[1.8e9, 1.6e9, 1.4e9, 1.1e9], quarterlyNetIncome:[-1e8, -2.5e8, -3e8, -4.5e8]},
};
function timeseries(sym, types){
  const st = STATEMENTS[sym]; if(!st) return {timeseries:{result:[]}};
  const yearEnds = ['2023-03-31', '2024-03-31', '2025-03-31'], qEnds = ['2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31'];
  return {timeseries:{result: types.filter(t => st[t]).map(t => ({meta:{symbol:[sym], type:[t]}, timestamp:[],
    [t]: st[t].map((v, i) => ({asOfDate:(t.startsWith('annual') ? yearEnds : qEnds)[i], periodType:t.startsWith('annual') ? '12M' : '3M', reportedValue:R(v)}))}))}};
}
const NAV_FILE = [
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
  '',
  'Open Ended Schemes(Equity Scheme - Flexi Cap Fund)',
  '122639;INF879O01027;-;Parag Parikh Flexi Cap Fund - Direct Plan - Growth;88.1234;31-Oct-2026',
  '122640;INF879O01019;-;Parag Parikh Flexi Cap Fund - Regular Plan - Growth;80.4321;31-Oct-2026',
  '125497;INF204K01K15;-;Nippon India Small Cap Fund - Direct Plan - Growth;190.55;31-Oct-2026',
].join('\n');
/* Five years of NAVs, oldest first, from a daily path: steady for the
   flexi cap, a deep fall and recovery for the small cap. */
function navHistory(code){
  const out = [], days = 5 * 365, end = Date.now() - 3 * 86400000;
  for(let i = days; i >= 0; i--){
    const t = end - i * 86400000, d = new Date(t); if(d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const x = (days - i) / days;
    let nav = code === '125497' ? 100 * (1 + x) * (1 - 0.45 * Math.sin(Math.PI * Math.min(1, x * 2))) * (1 + 0.03 * Math.sin(i / 3)) : 40 * Math.pow(2.2, x) * (1 + 0.004 * Math.sin(i / 5));
    out.push({date: String(d.getUTCDate()).padStart(2, '0') + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + d.getUTCFullYear(), nav: nav.toFixed(4)});
  }
  return out.reverse(); // mfapi gives newest first
}
const MF_META = {'122639': {fund_house:'PPFAS Mutual Fund', scheme_type:'Open Ended Schemes', scheme_category:'Equity Scheme - Flexi Cap Fund', scheme_code:122639, scheme_name:'Parag Parikh Flexi Cap Fund - Direct Plan - Growth'},
  '125497': {fund_house:'Nippon India Mutual Fund', scheme_type:'Open Ended Schemes', scheme_category:'Equity Scheme - Small Cap Fund', scheme_code:125497, scheme_name:'Nippon India Small Cap Fund - Direct Plan - Growth'}};
const SITE = {
  '/': `<html><head><title>Freedom LifeX — Financial Planning</title><meta name="description" content="Goal-based financial planning and mutual fund advisory."></head>
    <body><nav><a href="/services">Services</a> <a href="/fees">Fees</a> <a href="/about">About</a> <a href="https://elsewhere.example/x">Out</a> <a href="/brochure.pdf">PDF</a></nav>
    <h1>Plan every goal</h1><p>We help families plan retirement, education and wealth.</p><script>var secret='do not read';</script></body></html>`,
  '/services': `<html><head><title>Our Services</title></head><body><h2>Mutual Fund Advisory</h2><p>Goal-based mutual fund portfolios reviewed every quarter.</p>
    <h2>Golden Age Blueprint</h2><p>Retirement planning for those over fifty, with a cash-flow ladder.</p><h2>Insurance review</h2><p>Term and health cover review.</p></body></html>`,
  '/fees': `<html><head><title>Fees &amp; Charges</title></head><body><p>Financial planning fee: &#8377;25,000 a year for a family plan. Advisory fee on AUM is 1% a year, billed quarterly.</p></body></html>`,
  '/about': `<html><head><title>About us</title></head><body><p>Freedom LifeX is a SEBI-registered investment adviser founded in 2012.</p></body></html>`,
};

function start(port){
  const hits = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(u.pathname + u.search);
    const json = (o, code) => { res.statusCode = code || 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    if(u.pathname === '/' && !u.searchParams.get('site')){ res.setHeader('Set-Cookie', 'A3=fake-session; Path=/; HttpOnly'); res.statusCode = 404; return res.end('no page'); }
    if(u.pathname === '/v1/test/getcrumb') return (req.headers.cookie || '').includes('A3=fake-session') ? (res.setHeader('Content-Type', 'text/plain'), res.end('CrUmB123')) : (res.statusCode = 401, res.end('no cookie'));
    if(u.pathname === '/v1/finance/search'){ const q = String(u.searchParams.get('q') || '').toLowerCase(); return json(SEARCH[q] || {quotes:[], news:[]}); }
    let m = u.pathname.match(/^\/v8\/finance\/chart\/(.+)$/);
    if(m){ const ch = CHARTS[decodeURIComponent(m[1])]; return ch ? json(ch) : json({chart:{result:null}}, 404); }
    m = u.pathname.match(/^\/v10\/finance\/quoteSummary\/(.+)$/);
    if(m){
      if(u.searchParams.get('crumb') !== 'CrUmB123' || !(req.headers.cookie || '').includes('A3=')) return json({finance:{error:{code:'Unauthorized', description:'Invalid Crumb'}}}, 401);
      const s = SUMMARY[decodeURIComponent(m[1])]; return s ? json({quoteSummary:{result:[s], error:null}}) : json({quoteSummary:{result:null, error:{code:'Not Found'}}}, 404);
    }
    m = u.pathname.match(/^\/ws\/fundamentals-timeseries\/v1\/finance\/timeseries\/(.+)$/);
    if(m) return json(timeseries(decodeURIComponent(m[1]), String(u.searchParams.get('type') || '').split(',')));
    if(u.pathname === '/NAVAll.txt'){ res.setHeader('Content-Type', 'text/plain'); return res.end(NAV_FILE); }
    m = u.pathname.match(/^\/mfapi\/mf\/(\d+)$/);
    if(m) return MF_META[m[1]] ? json({meta: MF_META[m[1]], data: navHistory(m[1]), status:'SUCCESS'}) : json({meta:{}, data:[], status:'SUCCESS'});
    if(u.pathname === '/sitemap.xml'){ res.setHeader('Content-Type', 'application/xml'); return res.end('<urlset><url><loc>http://127.0.0.1:' + port + '/site/about</loc></url></urlset>'); }
    if(u.pathname.startsWith('/site')){
      const p = u.pathname.slice(5) || '/';
      if(p === '/sitemap.xml'){ res.setHeader('Content-Type', 'application/xml'); return res.end('<urlset><url><loc>http://127.0.0.1:' + port + '/site/about</loc></url></urlset>'); }
      const html = SITE[p];
      if(!html){ res.statusCode = 404; return res.end('nope'); }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html.replace(/href="\/(?!\/)/g, 'href="/site/'));
    }
    res.statusCode = 404; res.end('{}');
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({srv, hits, CHARTS, SUMMARY, close: () => srv.close()})));
}
module.exports = {start};

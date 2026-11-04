/* THE FIRM'S PLATFORM REPORTS, READ AS THE PLATFORMS LAY THEM OUT.

   What has to hold:

     · the report date is read however the platform writes it — "As on",
       "Report Date:", "Since inception to …", "For the period … To …" —
       so a snapshot is filed under the day its figures are true of;
     · Omni Science's Fund Activity Report, whose money columns sit under a
       second heading row (Initial Investment › Cash · Stock · Total), keeps
       the capital in and out it reports;
     · an Ametra PMS factsheet is read one account per page: the client and
       account from "Account: … - NAME - …", what was put in (Contribution
       less Withdrawal), what it is worth, and its holdings — every value on
       its own stock even where a name or a sector wraps over lines;
     · a PhillipCapital COSMOS report is read as one advisory account: net
       invested, current strategy value (stocks, debt, cash and dividends),
       the stated gain, and the stock list;
     · and the review report shows those accounts with what was invested,
       so a portfolio is not read as all gain.

   The statements here are made-up clients in the platforms' own layouts —
   the real ones carry real people's names and are not kept in the repo. */
const {suite} = require('../lib/harness');
const {xlsx} = require('../lib/xlsx-write');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bossst-'));

/* A PDF with a real text layer, one or more pages, each word where it is put. */
function pdf(name, pages){
  const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  pages.forEach(lines => {
    const ops = lines.map(([x, y, text]) => `BT /F1 8 Tf ${x} ${y} Td (${esc(text)}) Tj ET`).join('\n');
    objs.push(`<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`);
    const content = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`);
    kids.push(objs.length);
  });
  objs[1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const p = path.join(DIR, name);
  fs.writeFileSync(p, out, 'latin1');
  return p;
}

/* An Ametra factsheet page: the account on the left, the holdings on the
   right. Row 2 has a name over two lines and a sector over five, its value
   at the top of the row and its serial half-way down; row 3 has its value
   in the middle — the two layouts that used to send values one stock down. */
function ametraPage(o){
  return [
    [40, 800, 'AMETRA INVESTMENT MANAGERS PRIVATE LIMITED'], [40, 786, 'As of: 28/09/2026'],
    [40, 760, 'Portfolio Manager: EIAPLFM'], [40, 740, 'Strategy: ' + o.strategy],
    [40, 728, 'Account: ' + o.acc + ' - ZZ AMETRA CLIENT - ELEVD0001'], [40, 710, 'Inception Date: 16/04/2026'],
    [40, 680, 'Sector Allocation'], [40, 668, 'Sr.'], [60, 668, 'Sector'], [205, 668, 'Assets (%)'],
    [40, 656, '1'], [60, 656, 'METALS'], [222, 656, '40.00%'],
    [40, 644, '2'], [60, 644, 'Energy/ Power Plants/ power generation and'], [222, 644, '29.70%'],
    [60, 634, 'transmission/Non-conventional energy'],
    [40, 622, '3'], [60, 622, 'Fixed Income'], [226, 622, '9.90%'],
    [40, 610, '4'], [60, 610, 'Cash and Equivalent'], [222, 610, '20.40%'], [60, 598, 'Total'], [226, 598, '100%'],
    [40, 570, 'Portfolio Summary'], [40, 558, 'Since 16/04/2026'], [205, 558, 'Amount(INR)'],
    [40, 546, 'Contribution'], [215, 546, o.contribution], [40, 534, 'Withdrawal'], [225, 534, o.withdrawal],
    [40, 522, 'Profit/Loss'], [225, 522, o.profit], [40, 510, 'Portfolio Value(28/09/2026)'], [215, 510, o.value],
    [40, 480, 'Performance(TWRR)'], [112, 468, '1m'], [157, 468, '3m'], [198, 468, '1y'], [228, 468, 'Since'], [225, 458, '16/04/26'],
    [50, 446, 'Portfolio'], [105, 446, '-1.00%'], [150, 446, '2.00%'], [200, 446, '-'], [228, 446, '1.50%'],
    [50, 438, 'NSE Multi Asset'], [105, 430, '-2.00%'], [150, 430, '1.00%'], [200, 430, '-'], [228, 430, '0.50%'], [50, 422, 'Index 2'],
    [262, 770, 'Portfolio Holdings'], [262, 758, 'Sr.'], [290, 758, 'Security'], [425, 758, 'Sector'], [500, 758, 'Mkt Value'], [548, 758, '%Assets'],
    [264, 746, '1'], [290, 746, 'Coal India Limited'], [425, 746, 'METALS'], [508, 746, o.h[0]], [550, 746, '40.00%'],
    [508, 732, o.h[1]], [550, 732, '29.70%'],
    [425, 732, 'Energy/ Power'], [425, 722, 'Plants/ power'], [425, 712, 'generation and'], [425, 702, 'transmission/Non-'], [425, 692, 'conventional energy'],
    [290, 717, 'Power Grid Corporation of'], [264, 712, '2'], [290, 707, 'India Limited'],
    [290, 680, '7.91%JM FINANCIAL PRODUCTS LIMITED'], [264, 675, '3'], [425, 675, 'Fixed Income'], [508, 675, o.h[2]], [553, 675, '9.90%'], [290, 670, '07OCT2026'],
    [264, 658, '4'], [290, 658, 'Cash'], [425, 658, 'Cash and Equivalent'], [508, 658, o.h[3]], [550, 658, '20.40%'],
    [290, 644, 'Total'], [500, 644, o.value], [552, 644, '100%'],
  ];
}
const AMETRA = pdf('AMETRA_ZZ_PortFolioFactSheet.pdf', [
  ametraPage({strategy: 'Ametra FactorIncome PMS', acc: '9990001', contribution: '1,000,000', withdrawal: '10,000', profit: '20,000',
    value: '1,010,000', h: ['404,000', '300,000', '100,000', '206,000']}),
  ametraPage({strategy: 'Ametra FactorAlpha PMS', acc: '9990002', contribution: '500,000', withdrawal: '0', profit: '-5,000',
    value: '495,000', h: ['198,000', '147,000', '50,000', '100,000']}),
]);

/* A PhillipCapital COSMOS report: the account and corpus on the left, the
   performance box beside it on the same lines, the stocks on page two. */
const PHILIP = pdf('PHILIP_CAPITAL_COSMOS_MonthlyReport_ZZ.pdf', [[
  [40, 800, 'PhillipCapital'], [40, 786, 'Your Partner In Finance'], [40, 760, 'COSMOS Investment Advisory'],
  [40, 712, 'Account Details'], [230, 712, 'Performance'],
  [40, 700, 'Name :'], [150, 700, 'ZZ PHILIP CLIENT'], [230, 700, 'Report Date'], [350, 700, '28 Sep 2026'],
  [40, 688, 'Number :'], [160, 688, 'ACN000001'], [205, 688, '**'],
  [230, 688, 'Portfolio Performance (%) TWRR*'], [370, 688, '16.50'],
  [230, 676, 'Benchmark Performance (%) TWRR*'], [375, 676, '9.99'],
  [40, 664, 'Corpus Details'], [230, 664, 'Valuation of Stocks'], [350, 664, '1,450,000'],
  [40, 652, 'Activation Date :'], [150, 652, '10 Mar 2025'], [230, 652, 'Value of Debt Instrument'], [360, 652, '30,000'],
  [40, 640, 'Initial :'], [160, 640, '1,000,000'], [230, 640, 'Cash'], [370, 640, '5,000'],
  [40, 628, 'Additions :'], [165, 628, '500,000'], [230, 628, 'Dividend'], [365, 628, '15,000'],
  [40, 616, 'Withdrawals :'], [165, 616, '100,000'], [230, 616, 'Current Strategy Value'], [350, 616, '1,500,000'],
  [40, 604, 'Net :'], [160, 604, '1,400,000'], [230, 604, 'Total Gain/Loss (Since Inception)'], [360, 604, '100,000'],
  [40, 592, 'Plan :'], [140, 592, 'Lumpsum with STP'], [230, 592, 'Benchmark :'], [360, 592, 'Nifty 500'],
], [
  [40, 800, 'Valuation of Stocks'], [200, 790, 'Report Date : 28 Sep 2026'],
  [40, 778, 'Sr. No.'], [90, 778, 'Symbol'], [160, 778, 'Scrip Name'], [300, 778, 'ISIN'], [390, 778, 'Qty'], [430, 778, 'Cl. Rate'], [500, 778, 'Value'],
  [45, 764, '1'], [90, 764, 'INFY'], [160, 764, 'INFOSYS LTD.'], [300, 764, 'INE009A01021'], [395, 764, '500'], [430, 764, '1000.00'], [500, 764, '500000.00'],
  [45, 752, '2'], [90, 752, 'TCS'], [160, 752, 'TATA CONSULTANCY'], [300, 752, 'INE467B01029'], [395, 752, '300'], [430, 752, '3166.67'], [500, 752, '950000.00'],
  [40, 740, 'Total'], [500, 740, '1450000.00'],
]]);

const pad = at => { const r = []; Object.keys(at).forEach(k => { r[Number(k)] = at[k]; }); for(let i = 0; i < r.length; i++) if(r[i] === undefined) r[i] = ''; return r; };
const XLS = {
  finowise: xlsx('Sheet1', [['Finowise Freedom LLP'], ['Investor Wise AUM Report (Oct-2026)'], ['Report Date: 30-10-2026'],
    ['Name', 'PAN', 'Branch', 'RM Name', 'Associate Name', 'Inv.\nCost', 'Current\n Value', 'XIRR', 'Mobile'],
    ['ZZ Finowise Person', 'PQRST6789K', 'Varanasi', '', 'Ravi', '250000', '312500.50', '14.2', '9876500022']]),
  ar: xlsx('Sheet1', [
    pad({0: ' Since inception to 28-09-2026', 10: 'Strategy Set by the client while onboarding', 15: 'Equity MF', 19: 'Debt MF'}),
    ['Client Code', 'Client Full Name', 'Mobile Number', 'Email Address', 'DOB', 'PAN', 'Rm Code', 'Rm Name', 'BDM Name', 'Account Open Date',
     'Current Wealth', 'Annual Savings', 'Strategy Years', 'WS Equity Allocation Per', 'ARTarget Wealth', 'Equity Investment', 'Equity Current Value',
     'Equity Xirr', 'Debt Investment Value', 'Debt Current Value', 'Debt Xirr', 'SP Investment', 'SP Current Value', 'SP XIRR', 'WealthPlus Investment',
     'WealthPlus Current Value', 'WealthPlus XIRR', 'MF Allocation', 'SP Allocation', 'Cash Investment', 'Cash Current Value', 'Cash XIRR',
     'Tax Investment', 'Tax Current Value', 'Tax XIRR', 'Total Investment', 'Total Current Value', 'Total XIRR', 'SIP Executed last month',
     'Nach Mandate Status', 'Realized Gain', 'Unrealized Gain', 'Total Portfolio Return', 'App Install Status', 'Last Purchase Date',
     'Long Term Non AR Equity Holdings Current Value', '% of Total_Portfolio'],
    ['AR001', 'ZZ Rathi Person', '9876500033', 'zz.ar@example.com', '01-01-1975', 'LMNOP4321Q', 'RM9', '', 'BDM X', '10-06-2022',
     '5000000', '600000', '10', '60', '20000000', '1000000', '1300000', '12.5', '500000', '540000', '7.1', '0', '0', '0', '0', '0', '0',
     '70', '30', '0', '0', '0', '0', '0', '0', '1500000', '1840000', '11.2', '25000', 'Active', '50000', '290000', '22.6', 'Yes',
     '01-09-2026', '0', '5']]),
  omni: xlsx('Sheet1', [
    pad({1: 'Fund Activity Report\nFor the period 27-Sep-2026 To 27-Sep-2026'}), [], [], [],
    pad({11: 'Capital IN', 18: 'Capital Out', 22: 'AUM'}),
    pad({1: 'OFIN Code', 3: 'Client Name', 6: 'Scheme Name', 7: 'Status', 8: 'Date of Investment', 9: 'Distributor', 10: 'Opening NAV',
      11: 'Initial Investment', 14: 'Additional Investment', 18: 'Capital Withdrawal', 22: 'Closing NAV'}),
    pad({1: 'OFINCode', 6: 'PMS', 11: 'Cash', 12: 'Stock', 13: 'Total', 14: 'Cash', 15: 'Stock', 16: 'Total', 17: 'Grand Total',
      18: 'Cash', 19: ' Stock', 20: 'Total'}),
    pad({1: 'OFIN7001', 3: 'ZZ Omni Client', 6: 'Omni Science Value Strategy', 7: 'Active', 8: '15-Jan-2025', 9: 'Finowise', 10: 1600000,
      11: 0, 12: 0, 13: 0, 14: 50000, 15: 0, 16: 50000, 17: 50000, 18: 20000, 19: 0, 20: 20000, 22: 1630000})]),
};

suite(async t => {
  await t.home();

  /* Read one file the way Upload All reads it. */
  const read = (name, buf, kind) => t.eval(async a => {
    const bin = atob(a.b64), u = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const r = await maReadFile(new File([u], a.name), a.kind, '', false);
    return {layout: r.layout || '', notes: r.notes, rows: r.rows.map(x => { const o = Object.assign({}, x); delete o.src; return o; })};
  }, {b64: buf.toString('base64'), name, kind: kind || 'aum'});

  t.section('the report date, however the platform writes it');

  await t.step('"Report Date:", "Since inception to" and "For the period … To" are each read as the as-on date', async () => {
    const f = await read('fw.xlsx', XLS.finowise), a = await read('ar.xlsx', XLS.ar), o = await read('omni.xlsx', XLS.omni);
    const got = [f, a, o].map(x => (x.rows[0] || {}).as_of);
    if(got.join() !== '2026-10-30,2026-09-28,2026-09-27') throw new Error('as on: ' + got.join(', ') + ' — layouts ' + [f, a, o].map(x => x.layout).join(', '));
    return 'Finowise 30 Oct · Anand Rathi 28 Sep · Omni Science 27 Sep';
  });

  await t.step('Omni Science keeps the capital in and out from under its second heading row', async () => {
    const o = await read('omni.xlsx', XLS.omni);
    const r = o.rows[0] || {}, e = r.extra || {};
    if(o.layout !== 'omni_pms') throw new Error('read as ' + o.layout);
    if(r.current_value !== 1630000 || e.openingValue !== 1600000) throw new Error('values: ' + JSON.stringify(r));
    if(e.periodAdditional !== 50000 || e.periodCapitalIn !== 50000 || e.periodCapitalOut !== 20000)
      throw new Error('capital: ' + JSON.stringify(e));
    return 'closing 16.3L · opening 16L · in 50,000 · out 20,000';
  });

  t.section('Ametra PMS factsheet');

  await t.step('each page is one account, with the client, what went in and what it is worth', async () => {
    const r = await read('AMETRA.pdf', fs.readFileSync(AMETRA));
    if(r.layout !== 'ametra_pms') throw new Error('read as ' + (r.layout || 'the general PDF reader') + ': ' + r.notes.join('; '));
    const a = r.rows.map(x => [x.client_name, x.identifier, x.security_name, x.invested, x.current_value, x.gain_loss, x.start_date, x.as_of].join('|'));
    const want = ['ZZ AMETRA CLIENT|9990001|Ametra FactorIncome PMS|990000|1010000|20000|2026-04-16|2026-09-28',
                  'ZZ AMETRA CLIENT|9990002|Ametra FactorAlpha PMS|500000|495000|-5000|2026-04-16|2026-09-28'];
    if(a.join('\n') !== want.join('\n')) throw new Error(a.join('\n'));
    const e = r.rows[0].extra;
    if(!e.twrr || e.twrr.sinceInception !== 1.5 || !e.benchmark || e.benchmark.name !== 'NSE Multi Asset Index 2')
      throw new Error('returns: ' + JSON.stringify({twrr: e.twrr, benchmark: e.benchmark}));
    return 'two accounts · invested 9.9L and 5L · TWRR and benchmark read';
  });

  await t.step('every holding keeps its own value, though a name and a sector wrap over lines', async () => {
    const r = await read('AMETRA.pdf', fs.readFileSync(AMETRA));
    const h = r.rows[0].extra.holdings.map(x => x.security + ' = ' + x.value + ' [' + x.sector + ']');
    const want = ['Coal India Limited = 404000 [METALS]',
      'Power Grid Corporation of India Limited = 300000 [Energy/ Power Plants/ power generation and transmission/Non-conventional energy]',
      '7.91%JM FINANCIAL PRODUCTS LIMITED 07OCT2026 = 100000 [Fixed Income]', 'Cash = 206000 [Cash and Equivalent]'];
    if(h.join('\n') !== want.join('\n')) throw new Error(h.join('\n'));
    if(r.rows[0].extra.holdingsTotal !== 1010000) throw new Error('holdings add to ' + r.rows[0].extra.holdingsTotal);
    return '4 holdings, each value on its own stock, adding to the portfolio value';
  });

  t.section('PhillipCapital COSMOS report');

  await t.step('one advisory account: net invested, the strategy value with debt, cash and dividends, and the stocks', async () => {
    const r = await read('PHILIP.pdf', fs.readFileSync(PHILIP));
    if(r.layout !== 'philip_cosmos') throw new Error('read as ' + (r.layout || 'the general PDF reader') + ': ' + r.notes.join('; '));
    const x = r.rows[0], e = x.extra;
    const got = [x.client_name, x.identifier, x.invested, x.current_value, x.gain_loss, x.start_date, x.as_of].join('|');
    if(got !== 'ZZ PHILIP CLIENT|ACN000001|1400000|1500000|100000|2025-03-10|2026-09-28') throw new Error(got);
    if(e.stocksValue !== 1450000 || e.debtValue !== 30000 || e.cash !== 5000 || e.dividend !== 15000 || e.twrr !== 16.5 || e.benchmark !== 'Nifty 500')
      throw new Error(JSON.stringify(e));
    if(e.holdings.map(h => h.symbol + ':' + h.isin + ':' + h.qty + ':' + h.value).join(',') !== 'INFY:INE009A01021:500:500000,TCS:INE467B01029:300:950000')
      throw new Error('stocks: ' + JSON.stringify(e.holdings));
    return 'invested 14L · value 15L (stocks 14.5L + debt + cash + dividend) · gain 1L · 2 stocks';
  });

  t.section('through Upload All, to the client and the review report');

  const upload = async (slot, file) => {
    await t.eval(() => { MA.picked = {}; MA.result = null; MA.uploadType = 'platform'; MA.clientName = ''; MA.snapDate = ''; MA.createClients = true; maNav('upload'); });
    await t.wait(300);
    await t.page.setInputFiles(`input[data-ma="${slot}"]`, file);
    await t.wait(100);
    await t.page.click('#maUploadAll');
    for(let i = 0; i < 80; i++){ await t.wait(250); if(await t.eval(() => !MA.busy && !!MA.result)) break; }
    const r = await t.eval(() => MA.result.results.filter(x => !x.job.auto).map(x => ({ok: !!x.ok, error: x.error || '', rows: x.created ? x.created.rowsCount : 0})));
    await t.eval(() => closeModal());
    return r[0] || {};
  };

  await t.step('both statements land on their clients, counted at what was invested and what it is worth', async () => {
    const a = await upload('pms-ametra:aum', AMETRA);
    const p = await upload('stocks-philip-capital:aum', PHILIP);
    if(!a.ok || a.rows !== 2) throw new Error('Ametra: ' + JSON.stringify(a));
    if(!p.ok || p.rows !== 1) throw new Error('PhillipCapital: ' + JSON.stringify(p));
    const r = await t.eval(() => {
      const c = n => DB.clients.find(x => x.cmsName === n && !x.deletedAt);
      const line = (cl, plat) => (DB.platformHoldings || []).find(h => cl && h.clientId === cl.id && !h.deletedAt && h.platform === plat) || {};
      const am = c('ZZ AMETRA CLIENT'), ph = c('ZZ PHILIP CLIENT');
      return {am: am && am.id, ph: ph && ph.id, a: line(am, 'AMETRA'), p: line(ph, 'Philip Capital')};
    });
    if(!r.am || !r.ph) throw new Error('clients not added: ' + JSON.stringify(r));
    if(r.a.invested !== 1490000 || r.a.current !== 1505000) throw new Error('Ametra line: ' + JSON.stringify(r.a));
    if(r.p.invested !== 1400000 || r.p.current !== 1500000) throw new Error('PhillipCapital line: ' + JSON.stringify(r.p));
    t.ids = r;
    return 'Ametra 14.9L in → 15.05L · PhillipCapital 14L in → 15L';
  });

  await t.step('the review report lists each account with what was invested in it', async () => {
    const det = await t.eval(async id => {
      ReviewReport.open(id);
      for(let i = 0; i < 60; i++){
        await new Promise(r => setTimeout(r, 250));
        if(document.querySelectorAll('#xlTabs .xl-tab').length) break;
      }
      const b = Array.from(document.querySelectorAll('#xlTabs .xl-tab')).find(x => /Detailed Portfolio/i.test(x.textContent));
      if(!b) return {err: 'no Detailed Portfolio: ' + ((document.getElementById('rrOverlay') || {}).innerText || '').slice(0, 300)};
      b.click();
      await new Promise(r => setTimeout(r, 300));
      const open = document.querySelector('[data-fold="open"]'); if(open) open.click();
      await new Promise(r => setTimeout(r, 300));
      const text = document.getElementById('xlHost').innerText.replace(/\s+/g, ' ');
      const card = name => { const i = text.indexOf(name); return i < 0 ? '' : text.slice(i, i + 160); };
      return {inc: card('Ametra FactorIncome PMS'), alp: card('Ametra FactorAlpha PMS'), head: text.slice(0, 160)};
    }, t.ids.am);
    if(det.err) throw new Error(det.err);
    if(!/INVESTED ₹9,90,000 CURRENT VALUE ₹10,10,000/.test(det.inc)) throw new Error('FactorIncome: ' + det.inc);
    if(!/INVESTED ₹5,00,000 CURRENT VALUE ₹4,95,000/.test(det.alp)) throw new Error('FactorAlpha: ' + det.alp);
    if(!/INVESTED ₹14,90,000 CURRENT VALUE ₹15,05,000 GAIN ₹15,000/.test(det.head)) throw new Error('PMS total: ' + det.head);
    await t.eval(() => { const x = document.getElementById('rrOverlay'); if(x) x.remove(); });
    return 'FactorIncome 9.9L → 10.1L · FactorAlpha 5L → 4.95L · gain ₹15,000, not the whole value';
  });
});

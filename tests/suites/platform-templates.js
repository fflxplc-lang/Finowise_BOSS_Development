/* EVERY UPLOAD ROW HAS A SAMPLE TEMPLATE, AND EVERY TEMPLATE READS BACK.

   What has to hold:

     · each platform row on the upload page offers a template for its AUM
       file and its SIP file (and NJ's Folio Detail beside its AUM file);
     · a platform with a report layout of its own gets that layout — its
       title lines, its date line, its heading rows and column names;
     · every template, read by the same reader an upload goes through,
       gives back its sample records with the right figures, as the layout
       it claims to be — so following the template is following the reader;
     · the guide sheet is never taken for the data sheet;
     · the link downloads a real .xlsx. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();

  await t.step('every row of the upload matrix has a template link for its AUM and SIP file', async () => {
    const r = await t.eval(async () => {
      maNav('upload');
      await new Promise(res => setTimeout(res, 300));
      const links = Array.from(document.querySelectorAll('[data-tpl]')).map(a => a.getAttribute('data-tpl'));
      return {links, plats: maPlatforms().map(p => p.id)};
    });
    const missing = [];
    r.plats.forEach(id => ['aum', 'sip'].forEach(k => { if(r.links.indexOf(id + ':' + k) < 0) missing.push(id + ':' + k); }));
    if(missing.length) throw new Error('no template link for ' + missing.join(', '));
    if(r.links.indexOf('mf-nj:folio') < 0) throw new Error('no Folio Detail template beside NJ');
    return r.plats.length + ' platforms × AUM and SIP, plus NJ Folio Detail';
  });

  await t.step('each template reads back: its layout, all its sample rows, the right figures', async () => {
    const r = await t.eval(async () => {
      const out = [];
      const jobs = [];
      maPlatforms().forEach(p => ['aum', 'sip'].forEach(k => jobs.push({p, k})));
      jobs.push({p: maPlatforms().find(p => p.id === 'mf-nj'), k: 'aum', layout: 'nj_folio'});
      for(const j of jobs){
        const b = maTemplateBook(j.p, j.k, {layout: j.layout, asOn: '2026-10-30'});
        const bytes = xlsxWrite(b.sheets);
        const r = await maReadFile(new File([bytes], b.file), j.k, '', false);
        const first = r.rows[0] || {};
        out.push({slot: j.p.id + ':' + j.k + (j.layout ? ':' + j.layout : ''), want: b.layout, got: r.layout || 'generic', samples: b.samples,
          rows: r.rows.length, notes: r.notes.join('; ').slice(0, 300), detailsOnly: !!r.detailsOnly,
          name: first.client_name, value: j.k === 'sip' ? first.sip_amount : first.current_value, asOf: first.as_of || '',
          head: b.sheets[0].rows.slice(0, 2).map(x => x.filter(Boolean).slice(0, 3).join(' | '))});
      }
      return out;
    });
    const bad = r.filter(x => x.got !== x.want || x.rows !== x.samples || x.name !== 'Sample Client One'
      || (!x.detailsOnly && !(Number(x.value) > 0)));
    if(bad.length) throw new Error(bad.map(x => x.slot + ': read as ' + x.got + ' (want ' + x.want + '), ' + x.rows + '/' + x.samples + ' rows, first '
      + x.name + ' = ' + x.value + ' — ' + x.notes).join('\n'));
    const undated = r.filter(x => !x.detailsOnly && x.want !== 'mo_aum' && x.asOf !== '2026-10-30');
    if(undated.length) throw new Error('the date line was not read: ' + undated.map(x => x.slot + ' (' + x.asOf + ')').join(', '));
    return r.length + ' templates · ' + r.filter(x => x.want !== 'generic').length + ' in the platform’s own layout · every sample row back, dated 30 Oct';
  });

  await t.step('the platform layouts keep their own header rows', async () => {
    const r = await t.eval(() => {
      const p = id => maPlatforms().find(x => x.id === id);
      const head = (id, k, n, layout) => maTemplateBook(p(id), k, {layout, asOn: '2026-10-30'}).sheets[0].rows.slice(0, n).map(x => x.filter(Boolean).join(' | '));
      return {fw: head('mf-finowise', 'aum', 4), njaum: head('mf-nj', 'aum', 3), njsip: head('mf-nj', 'sip', 1), ar: head('mf-anand-rathi', 'aum', 1),
        omni: head('pms-omni-science', 'aum', 6), folio: head('mf-nj', 'aum', 1, 'nj_folio')};
    });
    const want = [
      [r.fw.slice(0, 3).join(' / '), 'Finowise Freedom LLP / Investor Wise AUM Report (Oct-2026) / Report Date: 30-10-2026'],
      [r.fw[3], 'Name | PAN | Branch | RM Name | Associate Name | Inv. Cost | Current Value | XIRR | Mobile'],
      [r.njaum.join(' / '), 'Investor Wise AUM Report ( As On 30-10-2026 ) / Sr. No. | Partner/Employee | Group | Investor | AUM(₹) / EQUITY | DEBT | HYBRID | PHYSICAL ASSETS | OTHERS | TOTAL'],
      [r.njsip[0], 'Live SIP Detail Report |  As on 30-10-2026'],
      [r.ar[0].split(' | ').slice(0, 3).join(' | '), 'Since inception to 30-10-2026 | Strategy Set by the client while onboarding | Equity MF'],
      [r.omni[0] + ' / ' + r.omni[3], 'Fund Activity Report\nFor the period 30-10-2026 To 30-10-2026 / Capital IN | Capital Out | AUM'],
      [r.omni[5].split(' | ').slice(0, 6).join(' | '), 'OFINCode | PMS | Cash | Stock | Total | Cash'],
      [r.folio[0], 'Folio Detail Report( As on30-10-2026)'],
    ];
    const off = want.filter(([got, w]) => got !== w);
    if(off.length) throw new Error(off.map(([g, w]) => 'got  ' + g + '\nwant ' + w).join('\n'));
    return 'Finowise, NJ AUM / SIP / Folio, Anand Rathi and Omni Science headings as the platforms print them';
  });

  await t.step('the guide sheet is one line per row, and says what each column is', async () => {
    const r = await t.eval(() => {
      const b = maTemplateBook(maPlatforms().find(x => x.id === 'mf-anand-rathi'), 'aum');
      const g = b.sheets[1].rows;
      return {wide: g.filter(x => x.filter(c => c !== '' && c != null).length > 1).length, n: g.length,
        pan: g.map(x => x[0]).find(x => /^PAN\b/.test(x)) || '', sample: g.some(x => /Replace the sample rows/.test(x[0]))};
    });
    if(r.wide) throw new Error(r.wide + ' guide rows have more than one cell');
    if(!/ABCDE1234F/.test(r.pan) || !r.sample) throw new Error(JSON.stringify(r));
    return r.n + ' lines · e.g. "' + r.pan.slice(0, 60) + '…"';
  });

  await t.step('pressing the link downloads the .xlsx', async () => {
    const [dl] = await Promise.all([
      t.page.waitForEvent('download', {timeout: 10000}),
      t.page.click('[data-tpl="pms-ametra:aum"]'),
    ]);
    const name = dl.suggestedFilename();
    if(!/^AMETRA_PMS_AUM_template\.xlsx$/.test(name)) throw new Error('downloaded ' + name);
    const r = await t.eval(() => maTemplateBook(maPlatforms().find(x => x.id === 'pms-ametra'), 'aum').sheets[1].rows.map(x => x[0]).join(' '));
    if(!/factsheet \(PDF\) is read as it is/.test(r)) throw new Error('the Ametra guide does not say the PDF is read as it is');
    return name + ' — and its guide says the PDF factsheet can go up as it is';
  });
});

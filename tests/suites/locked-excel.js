/* AN EXCEL FILE LOCKED WITH A PASSWORD GOES IN WITH ITS PASSWORD.

   "Encrypt with Password" in Excel encrypts the whole file. What has to
   hold:

     · with the password, a locked file is read exactly as the unlocked
       workbook would be — in both schemes Excel uses: Agile (Excel 2010
       on, AES with SHA-512) and Standard (Excel 2007, AES-128);
     · without it, or with the wrong one, the upload says which, rather
       than "no sheet inside that .xls";
     · the File password box on the upload page is what is used.

   The fixtures hold made-up clients, password boss1234: one made by
   msoffcrypto-tool (Agile), one saved by LibreOffice (Standard). */
const {suite} = require('../lib/harness');
const fs = require('fs');
const path = require('path');

const FIX = path.join(__dirname, '..', 'fixtures');
const AGILE = path.join(FIX, 'locked_agile_boss1234.xlsx');
const STANDARD = path.join(FIX, 'locked_standard_boss1234.xlsx');

suite(async t => {
  await t.home();

  const read = (file, password) => t.eval(async a => {
    const bin = atob(a.b64), u = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const t0 = performance.now();
    try {
      const r = await maReadFile(new File([u], a.name), 'aum', a.password, false);
      return {ms: Math.round(performance.now() - t0), rows: r.rows.map(x => x.client_name + ' · ' + x.security_name + ' · ' + x.invested + ' → ' + x.current_value),
        asOf: (r.rows[0] || {}).as_of || '', notes: r.notes.join('; ')};
    } catch(e){ return {error: e.message}; }
  }, {b64: fs.readFileSync(file).toString('base64'), name: path.basename(file), password});
  const WANT = 'ZZ Locked One · ZZ Value Strategy · 1000000 → 1120000 / ZZ Locked Two · ZZ Value Strategy · 500000 → 515000';

  await t.step('Excel 2010 and later (Agile): with its password it reads as the workbook it is', async () => {
    const r = await read(AGILE, 'boss1234');
    if(r.error) throw new Error(r.error);
    if(r.rows.join(' / ') !== WANT || r.asOf !== '2026-11-04') throw new Error(JSON.stringify(r));
    return '2 clients, as on 4 Nov · opened in ' + r.ms + ' ms';
  });

  await t.step('Excel 2007 (Standard): the same', async () => {
    const r = await read(STANDARD, 'boss1234');
    if(r.error) throw new Error(r.error);
    if(r.rows.join(' / ') !== WANT) throw new Error(JSON.stringify(r));
    return '2 clients · opened in ' + r.ms + ' ms';
  });

  await t.step('without the password, and with the wrong one, it says so', async () => {
    const none = await read(AGILE, ''), wrong = await read(AGILE, 'not-it'), wrongStd = await read(STANDARD, 'not-it');
    if(!/locked with a password/.test(none.error || '')) throw new Error('no password: ' + JSON.stringify(none));
    if(!/password .* is incorrect/.test(wrong.error || '') || !/incorrect/.test(wrongStd.error || '')) throw new Error('wrong: ' + JSON.stringify([wrong, wrongStd]));
    return '"' + none.error + '" · "' + wrong.error + '"';
  });

  await t.step('through the upload page, with the File password box', async () => {
    await t.eval(() => { MA.picked = {}; MA.result = null; MA.uploadType = 'platform'; MA.createClients = true; maNav('upload'); });
    await t.wait(300);
    const label = await t.eval(() => (document.getElementById('maPdfPassword').closest('.field').querySelector('label') || {}).textContent || '');
    if(!/File password/.test(label) || !/Excel/.test(label)) throw new Error('the box reads "' + label + '"');
    await t.page.setInputFiles('input[data-ma="pms-nj:aum"]', AGILE);
    await t.page.fill('#maPdfPassword', 'boss1234');
    await t.page.click('#maUploadAll');
    for(let i = 0; i < 80; i++){ await t.wait(250); if(await t.eval(() => !MA.busy && !!MA.result)) break; }
    const r = await t.eval(() => {
      const x = MA.result.results.find(y => !y.job.auto) || {};
      maInvalidate();
      const held = maState().holdings.filter(h => /^ZZ Locked/.test(h._c.name)).map(h => h._c.name + ' ' + h.current_value);
      closeModal();
      return {ok: !!x.ok, error: x.error || '', held};
    });
    if(!r.ok || r.held.length !== 2) throw new Error(JSON.stringify(r));
    return r.held.join(' · ');
  });
});

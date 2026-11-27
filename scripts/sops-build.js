#!/usr/bin/env node
/* SOP GUIDES — BUILD THE REGISTRY, CONVERT THE DECKS, CHECK THE PDFs (27-11-2026)

   RIA AI answers an SOP question with its steps (from sop-registry.json) and,
   where a PDF of the deck exists, a "View Visual SOP Guide (Read-Only)" button
   that opens it in BOSS's read-only viewer. This script keeps that registry
   and the PDFs in step with the team's PowerPoint decks.

     node scripts/sops-build.js                       # index + check only
     node scripts/sops-build.js --src ~/SOPs          # read .pptx decks from a folder
     node scripts/sops-build.js --src ~/SOPs --convert --out /home/finowise-test/data/sops-pdf
     node scripts/sops-build.js --check               # every mapped pdfFile exists?

   What it does, per deck (.pptx / .pptm, or a .pdf, in --src):
     · reads every slide's text straight from the .pptx (a zip of XML), so a
       new deck gets a draft entry: title, document no., date, owner, category,
       keywords and steps ("curated": false until somebody tidies the steps);
     · with --convert, turns the deck into a compressed PDF with LibreOffice
       (soffice; images at 150 dpi, JPEG quality 70 — a 3–4 MB deck becomes
       well under 1 MB), leaving the entry's "withholdSlides" out of the page
       range so they are never rendered into it;
     · warns, deck by deck, about slides that look like client data — a PAN,
       Aadhaar or mobile number or an e-mail address in the text, and every
       slide that is only a picture (a scanned PAN / Aadhaar card or a filled
       form cannot be seen in the text; open those slides and withhold or
       redact them before the PDF is uploaded). An entry marked "flatten" has every
       page turned into a picture, because a box drawn over a screenshot in
       PowerPoint hides nothing in a PDF — the screenshot is still underneath;
       "reviewedSlides" lists picture slides somebody has looked at and cleared.
   And for the registry as a whole: a PDF placed in --out (or sops-pdf/) with
   no entry gets one; an existing entry's hand-edited fields are kept unless
   --refresh; every entry's pdfFile is checked to exist.

   Where the PDFs live: the server serves them from CRM_SOP_DIR, else
   <data dir>/sops-pdf (beside data.json, outside git — deploys never touch
   it), else the repo's sops-pdf/. Decks that show clients' names, PANs,
   Aadhaar or forms belong in the data folder (an admin uploads them from
   RIA AI's "All SOP Guides" list), not in git, where they would stay in the
   history for good.

   Nothing here is a dependency of the server: no npm package, only Node's
   own zlib / fs and, when asked to convert, LibreOffice and poppler on the
   machine running it. A run never rewrites a curated entry's own fields
   (title, steps, aliases, withholdSlides); --refresh redrafts them. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const flag = name => args.includes('--' + name);
const SRC = opt('src', path.join(ROOT, 'sops-src'));
const OUT = opt('out', process.env.CRM_SOP_DIR || path.join(ROOT, 'sops-pdf'));
const REGISTRY = opt('registry', path.join(ROOT, 'sop-registry.json'));

/* ---- a .pptx is a zip: its central directory, and each entry inflated ---- */
function unzip(buf){
  let eocd = -1;
  for(let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if(buf.readUInt32LE(i) === 0x06054b50){ eocd = i; break; }
  if(eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const files = {};
  for(let n = 0; n < count; n++){
    if(buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10), csize = buf.readUInt32LE(at + 20);
    const nlen = buf.readUInt16LE(at + 28), elen = buf.readUInt16LE(at + 30), clen = buf.readUInt16LE(at + 32), local = buf.readUInt32LE(at + 42);
    const name = buf.slice(at + 46, at + 46 + nlen).toString('utf8');
    files[name] = () => {
      const lnlen = buf.readUInt16LE(local + 26), lelen = buf.readUInt16LE(local + 28);
      const data = buf.slice(local + 30 + lnlen + lelen, local + 30 + lnlen + lelen + csize);
      return method === 8 ? zlib.inflateRawSync(data) : data;
    };
    at += 46 + nlen + elen + clen;
  }
  return files;
}
const xmlText = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d)=>String.fromCharCode(+d)).replace(/&amp;/g, '&');
/* every slide, in order, as its paragraphs of text */
function slidesOf(file){
  const z = unzip(fs.readFileSync(file));
  return Object.keys(z).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b)=>+a.match(/\d+/g).pop() - +b.match(/\d+/g).pop())
    .map(n=>{ const xml = z[n]().toString('utf8');
      return (xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g) || []).map(p=>xmlText((p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map(t=>t.replace(/<\/?a:t>/g, '')).join('')).replace(/\s+/g, ' ').trim()).filter(Boolean); });
}

const CATEGORIES = [
  ['KYC & Onboarding', /\b(kyc|ckyc|aadhaa?r|onboarding|account opening|nri|us ?\/ ?canada|fatca)\b/i],
  ['Account Changes', /\b(nominee|nomination|bank (change|update)|pan|name change|minor|major|transmission|guardian|consolidation|address change|mobile|email change)\b/i],
  ['Transactions', /\b(sip|stp|swp|switch|purchase|redemption|redeem|mandate|e-?mandate|lumpsum|transfer)\b/i],
  ['NJ / PMS / AIF / Stocks', /\b(nj|e-?wealth|pms|aif|smallcase|piper|philip|stocks?|demat|broking)\b/i],
  ['Reports & Tax', /\b(tax|report|statement|capital gain|cas)\b/i],
  ['Insurance', /\b(insurance|lic|quotation|policy|term plan|health)\b/i]];
const categoryOf = t => (CATEGORIES.find(([, re])=>re.test(t)) || ['General'])[0];
const slug = s => String(s).toLowerCase().replace(/\.(pptx|pptm|pdf)$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const STOP = new Set(['sop', 'the', 'and', 'of', 'for', 'to', 'a', 'an', 'process', 'single', 'standard', 'operating', 'procedure', 'pptx', 'pptm', 'pdf', 'ppt', 'final', 'with', 'logo', 'br', 'in', 'on', 'through']);
/* a deck's own boilerplate is not a step: the footer line, "Thank you", an index, a page number, a bare "Step 3" */
const BOILER = /^(be wise\b.*|thank you\.?|index|contents?|\d{1,3}|step\s*[-:]?\s*\d+\s*[-:]?|standard operating procedure.*|follow the instructions?\.?|instructions?\s*-?|click here)$/i;
/* the phrases a person would ask by: the title, and the file's name, without the SOP / PPT / FINAL noise or a date */
function aliasesOf(title, base){
  const clean = t => String(t || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/\d{1,2}[-./]\d{1,2}[-./]\d{2,4}/g, ' ').replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter(w=>w && !STOP.has(w) && !/^\d+$/.test(w)).join(' ').trim();
  return [...new Set([clean(title), clean(base.replace(/[_-]+/g, ' '))])].filter(a=>a.split(' ').length >= 2 && a.length <= 70);
}
/* a PDF given as the source: its pages' text, through poppler's pdftotext when it is there */
function pagesOfPdf(file){
  try { return execFileSync('pdftotext', ['-layout', file, '-'], {maxBuffer: 64 * 1048576}).toString('utf8').split('\f')
    .map(pg=>pg.split('\n').map(l=>l.replace(/\s{2,}/g, ' ').trim()).filter(Boolean)).filter((pg, i, a)=>i < a.length - 1 || pg.length); }
  catch(e){ return []; }
}
/* the cover's fields: "SOP Title : X", "Document No. :", "Date :", "RESPONSIBILITY :" — the value on the same line or the next */
function coverField(paras, label){
  for(let i = 0; i < paras.length; i++){
    const m = paras[i].match(new RegExp('^' + label + '\\s*[:.-]*\\s*(.*)$', 'i'));
    if(m){ const v = (m[1] || '').replace(/^[:\s]+/, '').trim(); if(v) return v; const nx = paras[i + 1] || ''; if(nx && !/:\s*$/.test(nx) && !/^(purpose|scope|responsibility|date|document no)/i.test(nx)) return nx.trim(); }
  }
  return '';
}
/* a draft entry from a deck's slides */
function entryOf(file, slides){
  const cover = slides[0] || [];
  const base = path.basename(file).replace(/\.(pptx|pptm|pdf)$/i, '');
  /* a placeholder title on the cover ("ABCD", "XYZ") gives way to its PURPOSE line */
  const named = coverField(cover, 'SOP Title');
  const title = ((named && named.length > 4 && !/^(abcd|xyz|title|na|tbd)$/i.test(named) ? named : '') || coverField(cover, 'PURPOSE') || base.replace(/[_-]+/g, ' ')).replace(/\s+/g, ' ').trim();
  const steps = [], imageOnly = [], pii = [];
  slides.forEach((paras, i)=>{
    const n = i + 1, text = paras.join(' ');
    if(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/.test(text)) pii.push('slide ' + n + ': a PAN-like number');
    if(/\b\d{4}\s\d{4}\s\d{4}\b/.test(text)) pii.push('slide ' + n + ': an Aadhaar-like number');
    if(/(?<!\d)[6-9]\d{9}(?!\d)/.test(text)) pii.push('slide ' + n + ': a mobile-like number');
    if(/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) pii.push('slide ' + n + ': an e-mail address');
    const words = paras.filter(p=>!/^\d{1,3}$/.test(p));
    if(!words.length){ if(i > 0) imageOnly.push(n); return; }
    if(i === 0 || /^(index|contents?)$/i.test(words[0]) || /^thank you$/i.test(words[0])) return;
    const kept = [...new Set(words.filter(w=>!BOILER.test(w.trim())))];
    if(!kept.length) return;
    const line = kept.join(' — ').replace(/\s+/g, ' ').trim();
    if(line.length > 3 && !steps.includes(line)) steps.push(line.length > 260 ? line.slice(0, 257) + '…' : line);
  });
  const kw = [...new Set((title + ' ' + base).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w=>w.length > 2 && !STOP.has(w)))];
  return {id: slug(base), title, category: categoryOf(title + ' ' + base), docNo: coverField(cover, 'Document No'), date: coverField(cover, 'Date'),
    owner: coverField(cover, 'RESPONSIBILITY'), keywords: kw, aliases: aliasesOf(title, base), sopIds: [], steps, pdfFile: base.replace(/[^A-Za-z0-9 ._()&+-]+/g, '_') + '.pdf',
    source: path.basename(file), slides: slides.length, imageOnlySlides: imageOnly, withholdSlides: [], curated: false, _pii: pii};
}

function which(cmd){ try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {stdio: 'ignore'}); return true; } catch(e){ return false; } }
/* LibreOffice's PDF export, compressed (images 150 dpi, JPEG 70). A withheld slide is left out of the page range, so it is never
   rendered at all and nothing of it — its pictures included — is in the PDF. */
const pdfExport = range => 'pdf:impress_pdf_Export:' + JSON.stringify(Object.assign({ReduceImageResolution: {type: 'boolean', value: 'true'},
  MaxImageResolution: {type: 'long', value: '150'}, Quality: {type: 'long', value: '70'}, UseLosslessCompression: {type: 'boolean', value: 'false'}},
  range ? {PageRange: {type: 'string', value: range}} : {}));
function keptRange(total, drop){
  const keep = []; for(let i = 1; i <= total; i++) if(!drop.has(i)) keep.push(i);
  const parts = []; let a = null, b = null;
  keep.forEach(n=>{ if(a === null){ a = b = n; } else if(n === b + 1) b = n; else { parts.push(a === b ? String(a) : a + '-' + b); a = b = n; } });
  if(a !== null) parts.push(a === b ? String(a) : a + '-' + b);
  return parts.join(',');
}
/* "flatten": every page becomes a picture of itself. A PowerPoint "redaction" — a box drawn over a
   screenshot — is only a shape on top: the PDF still carries the whole screenshot underneath, and any PDF
   tool lifts it out. Rendering each page to a JPEG and building the PDF from those pictures makes the box
   part of the image, so what it covers is really gone. Needs poppler's pdftoppm; the PDF is written here. */
function jpegSize(buf){
  for(let i = 2; i < buf.length - 9;){
    if(buf[i] !== 0xFF){ i++; continue; }
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if(m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return {h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7)};
    i += 2 + len;
  }
  throw new Error('not a JPEG');
}
function pdfOfJpegs(jpegs, dpi){
  const objs = [], pages = [];
  const add = body => { objs.push(body); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  jpegs.forEach(buf=>{
    const {w, h} = jpegSize(buf), pw = +(w * 72 / dpi).toFixed(2), ph = +(h * 72 / dpi).toFixed(2);
    const img = add(Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + buf.length + ' >>\nstream\n'), buf, Buffer.from('\nendstream')]));
    const draw = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /Im Do Q';
    const content = add('<< /Length ' + draw.length + ' >>\nstream\n' + draw + '\nendstream');
    pages.push(add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + pw + ' ' + ph + '] /Resources << /XObject << /Im ' + img + ' 0 R >> >> /Contents ' + content + ' 0 R >>'));
  });
  objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>';
  objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + pages.map(n=>n + ' 0 R').join(' ') + '] /Count ' + pages.length + ' >>';
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')], offsets = [];
  let at = parts[0].length;
  objs.forEach((o, i)=>{ const b = Buffer.concat([Buffer.from((i + 1) + ' 0 obj\n'), Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from('\nendobj\n')]); offsets.push(at); at += b.length; parts.push(b); });
  parts.push(Buffer.from('xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(o=>String(o).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + at + '\n%%EOF\n'));
  return Buffer.concat(parts);
}
function flattenPdf(pdf){
  const dpi = 110, tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sopflat-'));
  execFileSync('pdftoppm', ['-r', String(dpi), '-jpeg', '-jpegopt', 'quality=72', pdf, path.join(tmp, 'p')], {stdio: 'ignore', timeout: 300000});
  const jpegs = fs.readdirSync(tmp).filter(f=>/\.jpg$/.test(f)).sort().map(f=>fs.readFileSync(path.join(tmp, f)));
  if(!jpegs.length) throw new Error('pdftoppm made no pages');
  fs.writeFileSync(pdf, pdfOfJpegs(jpegs, dpi));
  fs.rmSync(tmp, {recursive: true, force: true});
}
/* a PDF source is used as it is (flattened when the entry asks; slides cannot be withheld from it — say so) */
function copyPdf(file, entry){
  if((entry.withholdSlides || []).length) throw new Error(entry.id + ': withholdSlides cannot be applied to a PDF source — export the deck instead');
  fs.mkdirSync(OUT, {recursive: true});
  const out = path.join(OUT, entry.pdfFile);
  fs.copyFileSync(file, out);
  if(entry.flatten) flattenPdf(out);
  return fs.statSync(out).size;
}
function convert(file, entry){
  fs.mkdirSync(OUT, {recursive: true});
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sop-'));
  const drop = new Set(entry.withholdSlides || []);
  const range = drop.size ? keptRange(entry.slides || 0, drop) : '';
  if(drop.size && !range) throw new Error(entry.id + ': every slide is withheld');
  execFileSync('soffice', ['--headless', '--norestore', '--convert-to', pdfExport(range), '--outdir', tmp, file], {stdio: 'ignore', timeout: 300000});
  const made = path.join(tmp, path.basename(file).replace(/\.(pptx|pptm)$/i, '.pdf'));
  if(!fs.existsSync(made)) throw new Error('LibreOffice made no PDF for ' + path.basename(file));
  fs.copyFileSync(made, path.join(OUT, entry.pdfFile));
  fs.rmSync(tmp, {recursive: true, force: true});
  if(entry.flatten) flattenPdf(path.join(OUT, entry.pdfFile));
  return fs.statSync(path.join(OUT, entry.pdfFile)).size;
}

/* ---- run ---- */
const reg = fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : {version: 1, sops: []};
reg.sops = reg.sops || [];
const byId = new Map(reg.sops.map(s=>[s.id, s]));
const warnings = [];
const decks = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter(f=>/\.(pptx|pptm|pdf)$/i.test(f) && !f.startsWith('~$')).sort() : [];
if(flag('convert') && decks.length && !which('soffice')) { console.error('--convert needs LibreOffice (soffice) on this machine.'); process.exit(2); }
for(const f of decks){
  const file = path.join(SRC, f);
  let draft;
  const isPdf = /\.pdf$/i.test(f);
  try { draft = entryOf(file, isPdf ? pagesOfPdf(file) : slidesOf(file)); } catch(e){ warnings.push(f + ': could not be read (' + e.message + ')'); continue; }
  const pii = draft._pii; delete draft._pii;
  const had = byId.get(draft.id) || reg.sops.find(s=>s.source === f);
  let entry;
  if(had && !flag('refresh')){ entry = had; entry.slides = draft.slides; entry.imageOnlySlides = draft.imageOnlySlides; entry.source = f; if(!entry.steps || !entry.steps.length) entry.steps = draft.steps; }
  else { entry = Object.assign({}, draft, had ? {withholdSlides: had.withholdSlides || [], aliases: had.aliases || [], sopIds: had.sopIds || []} : {}); if(had) reg.sops[reg.sops.indexOf(had)] = entry; else reg.sops.push(entry); byId.set(entry.id, entry); }
  pii.forEach(p=>warnings.push(f + ' — ' + p + ' (client data? withhold or redact before uploading)'));
  const unreviewed = (entry.imageOnlySlides || []).filter(n=>!(entry.withholdSlides || []).includes(n) && !(entry.reviewedSlides || []).includes(n));
  if(unreviewed.length) warnings.push(f + ' — picture-only slides ' + unreviewed.join(', ') + ': open them; a scanned PAN / Aadhaar / form must be withheld (withholdSlides) or redacted');
  if(flag('convert')){
    try { const bytes = isPdf ? copyPdf(file, entry) : convert(file, entry); console.log('converted  ' + f + ' → ' + entry.pdfFile + ' (' + Math.round(bytes / 1024) + ' KB' + (entry.withholdSlides.length ? ', slides ' + entry.withholdSlides.join(', ') + ' withheld' : '') + (entry.flatten ? ', flattened to images' : '') + ')'); }
    catch(e){ warnings.push(f + ': not converted — ' + e.message); }
  }
}
/* PDFs dropped straight into a folder get an entry too */
const dirs = [OUT, path.join(ROOT, 'sops-pdf')].filter((d, i, a)=>a.indexOf(d) === i && fs.existsSync(d));
dirs.forEach(d=>fs.readdirSync(d).filter(f=>/\.pdf$/i.test(f)).forEach(f=>{
  if(reg.sops.some(s=>s.pdfFile === f)) return;
  const title = f.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
  reg.sops.push({id: slug(f), title, category: categoryOf(title), docNo: '', date: '', owner: '', keywords: [...new Set(title.toLowerCase().split(/\s+/).filter(w=>w.length > 2 && !STOP.has(w)))],
    aliases: [], sopIds: [], steps: [], pdfFile: f, source: f, slides: null, imageOnlySlides: [], withholdSlides: [], curated: false});
  warnings.push(f + ': a PDF with no deck — registered with no steps; add its steps to sop-registry.json');
}));
const missing = reg.sops.filter(s=>s.pdfFile && !dirs.some(d=>fs.existsSync(path.join(d, s.pdfFile))));
reg.sops.sort((a, b)=>a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
if(!flag('check')) fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
console.log((flag('check') ? 'checked ' : 'registry ') + path.relative(process.cwd(), REGISTRY) + ': ' + reg.sops.length + ' SOP(s), ' + (reg.sops.length - missing.length) + ' with a PDF in ' + dirs.map(d=>path.relative(process.cwd(), d) || '.').join(' / '));
if(missing.length) console.log('no PDF yet (the button stays hidden until it is uploaded): ' + missing.map(s=>s.pdfFile).join(', '));
warnings.forEach(w=>console.log('⚠ ' + w));
process.exit(flag('check') && missing.length && flag('strict') ? 1 : 0);

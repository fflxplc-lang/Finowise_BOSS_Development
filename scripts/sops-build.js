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

   What it does, per deck (.pptx in --src):
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
       redact them before the PDF is uploaded).
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
const slug = s => String(s).toLowerCase().replace(/\.(pptx|pdf)$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const STOP = new Set(['sop', 'the', 'and', 'of', 'for', 'to', 'a', 'an', 'process', 'single', 'standard', 'operating', 'procedure', 'pptx', 'pdf']);
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
  const base = path.basename(file).replace(/\.pptx$/i, '');
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
    const line = words.join(' — ').replace(/\s+/g, ' ').trim();
    if(line.length > 3) steps.push(line.length > 260 ? line.slice(0, 257) + '…' : line);
  });
  const kw = [...new Set((title + ' ' + base).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w=>w.length > 2 && !STOP.has(w)))];
  return {id: slug(base), title, category: categoryOf(title + ' ' + base), docNo: coverField(cover, 'Document No'), date: coverField(cover, 'Date'),
    owner: coverField(cover, 'RESPONSIBILITY'), keywords: kw, aliases: [], sopIds: [], steps, pdfFile: base.replace(/[^A-Za-z0-9 ._()&+-]+/g, '_') + '.pdf',
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
function convert(file, entry){
  fs.mkdirSync(OUT, {recursive: true});
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sop-'));
  const drop = new Set(entry.withholdSlides || []);
  const range = drop.size ? keptRange(entry.slides || 0, drop) : '';
  if(drop.size && !range) throw new Error(entry.id + ': every slide is withheld');
  execFileSync('soffice', ['--headless', '--norestore', '--convert-to', pdfExport(range), '--outdir', tmp, file], {stdio: 'ignore', timeout: 300000});
  const made = path.join(tmp, path.basename(file).replace(/\.pptx$/i, '.pdf'));
  if(!fs.existsSync(made)) throw new Error('LibreOffice made no PDF for ' + path.basename(file));
  fs.copyFileSync(made, path.join(OUT, entry.pdfFile));
  fs.rmSync(tmp, {recursive: true, force: true});
  return fs.statSync(path.join(OUT, entry.pdfFile)).size;
}

/* ---- run ---- */
const reg = fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : {version: 1, sops: []};
reg.sops = reg.sops || [];
const byId = new Map(reg.sops.map(s=>[s.id, s]));
const warnings = [];
const decks = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter(f=>/\.pptx$/i.test(f) && !f.startsWith('~$')).sort() : [];
if(flag('convert') && decks.length && !which('soffice')) { console.error('--convert needs LibreOffice (soffice) on this machine.'); process.exit(2); }
for(const f of decks){
  const file = path.join(SRC, f);
  let draft;
  try { draft = entryOf(file, slidesOf(file)); } catch(e){ warnings.push(f + ': could not be read (' + e.message + ')'); continue; }
  const pii = draft._pii; delete draft._pii;
  const had = byId.get(draft.id) || reg.sops.find(s=>s.source === f);
  let entry;
  if(had && !flag('refresh')){ entry = had; entry.slides = draft.slides; entry.imageOnlySlides = draft.imageOnlySlides; entry.source = f; if(!entry.steps || !entry.steps.length) entry.steps = draft.steps; }
  else { entry = Object.assign({}, draft, had ? {withholdSlides: had.withholdSlides || [], aliases: had.aliases || [], sopIds: had.sopIds || []} : {}); if(had) reg.sops[reg.sops.indexOf(had)] = entry; else reg.sops.push(entry); byId.set(entry.id, entry); }
  pii.forEach(p=>warnings.push(f + ' — ' + p + ' (client data? withhold or redact before uploading)'));
  const unreviewed = (entry.imageOnlySlides || []).filter(n=>!(entry.withholdSlides || []).includes(n) && !(entry.reviewedSlides || []).includes(n));
  if(unreviewed.length) warnings.push(f + ' — picture-only slides ' + unreviewed.join(', ') + ': open them; a scanned PAN / Aadhaar / form must be withheld (withholdSlides) or redacted');
  if(flag('convert')){
    try { const bytes = convert(file, entry); console.log('converted  ' + f + ' → ' + entry.pdfFile + ' (' + Math.round(bytes / 1024) + ' KB' + (entry.withholdSlides.length ? ', slides ' + entry.withholdSlides.join(', ') + ' withheld' : '') + ')'); }
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

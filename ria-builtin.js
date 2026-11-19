'use strict';
/* =====================================================================
   RIA AI'S BUILT-IN ANSWER — when the AI provider cannot

   The assistant asks a provider (Gemini, Claude, or the firm's own model)
   for every answer. A provider that is overloaded ("HTTP 503 — This model
   is currently experiencing high demand"), rate-limited (429), down (5xx),
   slow past its budget, or that answers with nothing used to reach the
   person as a red error. It no longer does: the server answers instead,
   from what the page already sent with the question.

   What the page sends is enough for a useful answer, because the page does
   the reading: the firm's SOPs that match the question (<sops>), the
   records it read for it (<data>: a client's dossier, counts and lists,
   a chart's counts, live market reads), and the question itself. So:

     - "What should I do if a KYC is on hold?" → the matching SOP's steps,
       documents and TAT, in order, with its id;
     - a question about the book → the counts, totals and rows read for it;
     - a question about a client → what is pending or wrong, then the SOP;
     - the planning step ("which records should BOSS read") → a plan built
       from the question's words and the sources the page listed;
     - a report request → a report specification the page can run;
     - "rewrite this" → the passage, tidied, every fact kept;
     - total AUM → the Dashboard's Live AUM figure (book-aum.js), computed
       by the server for the person's own scope (passed in as `aum`).

   It never invents a figure: every number in an answer is one that was in
   <data> or computed by BOSS. Pure: no network, no store access.
   ===================================================================== */

const RiaKnowledge = require('./ria-knowledge');
const PLAN_MARK = 'deciding WHICH RECORDS BOSS should read';
const REPORT_MARK = 'REPORT SPECIFICATION';
const REFRAME_MARK = 'You are rewriting a passage';

function classify(system) {
  const s = String(system || '');
  if (s.includes(PLAN_MARK)) return 'plan';
  if (s.includes(REPORT_MARK)) return 'report';
  if (s.includes(REFRAME_MARK)) return 'reframe';
  return 'chat';
}

const lastUser = (messages) => {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i] && list[i].role !== 'assistant') return String(list[i].content || '');
  return '';
};
const block = (text, tag) => {
  const m = String(text).match(new RegExp('<' + tag + '>\\s*([\\s\\S]*?)\\s*</' + tag + '>'));
  return m ? m[1] : '';
};
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').split(' ').filter((w) => w.length > 2);
const STOP = new Set(['the', 'and', 'for', 'what', 'should', 'how', 'can', 'are', 'was', 'with', 'this', 'that', 'there', 'when', 'which', 'who',
  'does', 'did', 'has', 'have', 'from', 'into', 'about', 'please', 'tell', 'show', 'give', 'kya', 'hai', 'karna', 'karein', 'kaise', 'mujhe']);
const today = (now) => (now || new Date()).toISOString().slice(0, 10);

/* ---------------- sources the page listed ---------------- */
function parseSources(system) {
  const out = [];
  String(system || '').split('\n').forEach((line) => {
    const m = line.match(/^\s+([A-Za-z0-9_]+) \((.*?)\) — columns: (.*)$/);
    if (m) out.push({ name: m[1], label: m[2], cols: m[3].split(',').map((c) => c.trim()).filter(Boolean) });
  });
  return out;
}
const SOURCE_WORDS = [
  [/\b(aum|holding|holdings|portfolio|folio)\b/, ['holding', 'platform', 'aum', 'client']],
  [/\b(clients?|customers?|investors?)\b/, ['client']],
  [/\b(leads?|prospects?)\b/, ['lead']],
  [/\b(meetings?|appointments?)\b/, ['meeting']],
  [/\b(tasks?|to ?dos?|pending work)\b/, ['task']],
  [/\b(reviews?)\b/, ['review']],
  [/\b(queries|query|tickets?|complaints?)\b/, ['quer']],
  [/\b(business|sales|mobilisation|mobilization)\b/, ['business']],
  [/\b(calls?)\b/, ['call']],
  [/\b(transactions?|txns?|sips?|redemptions?|purchases?)\b/, ['transaction', 'sip']],
  [/\b(campaigns?)\b/, ['campaign']],
  [/\b(kycs?|mandates?|iins?|ucc|nominees?|risk ?profiles?|iseq|tax status|nri|huf|categor(?:y|ies)|stages?)\b/, ['client']],
];
function pickSource(q, sources) {
  const t = String(q || '').toLowerCase();
  for (const [re, hints] of SOURCE_WORDS) {
    if (!re.test(t)) continue;
    for (const h of hints) {
      const s = sources.find((x) => x.name.toLowerCase().includes(h) || x.label.toLowerCase().includes(h));
      if (s) return s;
    }
  }
  return null;
}
function period(q, now) {
  const t = String(q || '').toLowerCase();
  const d = now || new Date();
  const iso = (x) => x.toISOString().slice(0, 10);
  if (/\b(today|aaj)\b/.test(t)) return { from: iso(d), to: iso(d) };
  if (/\b(yesterday|kal)\b/.test(t)) { const y = new Date(d); y.setUTCDate(y.getUTCDate() - 1); return { from: iso(y), to: iso(y) }; }
  if (/\b(this week|is hafte|hafte)\b/.test(t)) { const m = new Date(d); m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7)); return { from: iso(m), to: iso(d) }; }
  if (/\blast month\b|pichhle mahine/.test(t)) {
    const f = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), l = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return { from: iso(f), to: iso(l) };
  }
  if (/\b(this month|is mahine|mahine)\b/.test(t)) return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))), to: iso(d) };
  if (/\b(this year|is saal)\b/.test(t)) return { from: d.getUTCFullYear() + '-01-01', to: iso(d) };
  return { from: null, to: null };
}
const COUNT_RE = /\b(how many|how much|kitne|kitna|kitni|count|number of|total|branch[- ]?wise|rm[- ]?wise|status[- ]?wise|by branch|by rm|by status|breakdown)\b/i;
const PENDING_RE = /\b(pending|baaki|baki|incomplete|outstanding|overdue|remaining|not validated|non[- ]?validated|not done)\b/i;
/* A how-to in so many words; "on hold" or "form" alone does not make a count question one. */
const STRICT_HOWTO_RE = /\b(kaise|how to|how do|process|procedure|steps?|documents?|docs|kagaz|kya karein|kya karna|what to do|what should|should i)\b/i;
/* "How many KYCs are pending", "kitne mandate pending hain", "overdue tasks". */
const isCountQ = (q) => (COUNT_RE.test(q) || PENDING_RE.test(q)) && !STRICT_HOWTO_RE.test(q);
/* The status a question names, as a column of the source: kycs → kyc. */
const FIELD_WORDS = [[/\bkycs?\b/, /kyc/], [/\bmandates?\b/, /mandate/], [/\b(risks?|risk ?profiles?|iseq)\b/, /risk|iseq/],
  [/\b(tax|nri|huf|minor)\b/, /tax/], [/\bcategor(?:y|ies)\b/, /categor/], [/\b(iins?|ucc|activation)\b/, /iin|ucc/], [/\bstages?\b/, /stage/]];
const HOWTO_RE = /\b(kaise|how to|how do|process|procedure|steps?|documents?|docs|kagaz|kya karein|kya karna|what to do|what should|should i|tat|on hold|rejected|form)\b/i;
function groupAndSum(q, src) {
  const t = String(q || '').toLowerCase();
  const col = (re) => src.cols.find((c) => re.test(c.toLowerCase()));
  let g = null;
  const field = FIELD_WORDS.find(([re]) => re.test(t));
  if (field) g = col(field[1]);
  if (g) { /* the status named */ }
  else if (/branch/.test(t)) g = col(/branch/);
  else if (/\brm\b|advis|owner|assigned/.test(t)) g = col(/^rm|rm$|owner|assigned|advis/);
  else if (/status|stage/.test(t)) g = col(/status|stage/);
  if (!g) g = col(/status|stage/) || col(/branch/) || null;
  const sum = /\b(aum|amount|value|total|sum|business|sip)\b/.test(t) ? src.cols.filter((c) => /aum|amount|value|sip/i.test(c)).slice(0, 2) : [];
  return { groupBy: g ? [g] : [], sum };
}

/* The planning step: which records to read. */
function plan(q, system, now) {
  const sources = parseSources(system);
  const src = pickSource(q, sources);
  if (!src || (HOWTO_RE.test(q) && !isCountQ(q))) return JSON.stringify({ reads: [], client: null });
  const per = period(q, now);
  const read = { source: src.name, from: per.from, to: per.to, where: [] };
  if (isCountQ(q)) Object.assign(read, groupAndSum(q, src));
  else read.cols = src.cols.slice(0, 8);
  /* "Pending SIPs" as a list is filtered; a count of pending is grouped by
     status instead, so every status and its count is in the answer. */
  if (/\bpending\b/i.test(q) && !(read.groupBy && read.groupBy.length)) { const s = src.cols.find((c) => /status/i.test(c)); if (s) read.where = [{ col: s, op: 'contains', value: 'Pending' }]; }
  return JSON.stringify({ reads: [read], client: null });
}

/* A report specification the page can run. */
function report(q, system, now) {
  const sources = parseSources(system);
  const src = pickSource(q, sources);
  if (!src) {
    return JSON.stringify({ title: '', source: '', from: null, to: null, cols: [], groupBy: [], sum: [], where: [], format: 'csv', notes: '',
      ask: 'Which records should the report cover? You can choose from: ' + sources.map((s) => s.label).join(', ') + '.' });
  }
  const per = period(q, now);
  const t = String(q || '').toLowerCase();
  const format = /\b(excel|xlsx|spreadsheet)\b/.test(t) ? 'xlsx' : /\bpdf\b/.test(t) ? 'pdf' : /\b(word|docx)\b/.test(t) ? 'docx' : 'csv';
  const gs = COUNT_RE.test(q) ? groupAndSum(q, src) : { groupBy: [], sum: [] };
  return JSON.stringify({ title: src.label + ' report' + (per.from ? ' (' + per.from + ' to ' + per.to + ')' : ''), source: src.name,
    from: per.from, to: per.to, cols: gs.groupBy.length ? [] : src.cols.slice(0, 10), groupBy: gs.groupBy, sum: gs.sum, where: [], format,
    notes: 'Prepared by BOSS’s built-in assistant: check the columns before sharing.', ask: '' });
}

/* "Rewrite this": tidy the passage and keep every fact. */
function reframe(text) {
  const instruction = String(text || '').split('<selection>')[0].toLowerCase();
  const sel = block(text, 'selection') || String(text || '');
  let out = sel.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  out = out.replace(/(^|[.!?]\s+|\n)([a-z])/g, (m, a, b) => a + b.toUpperCase());
  if (/formal|professional|polite/.test(instruction)) {
    const C = { "don't": 'do not', "can't": 'cannot', "won't": 'will not', "isn't": 'is not', "aren't": 'are not', "it's": 'it is', "we're": 'we are', "you're": 'you are', "i'm": 'I am', "doesn't": 'does not', "didn't": 'did not' };
    out = out.replace(/\b(don't|can't|won't|isn't|aren't|it's|we're|you're|i'm|doesn't|didn't)\b/gi, (m) => C[m.toLowerCase()] || m);
  }
  if (/bullet|points|list/.test(instruction)) out = out.split(/(?<=[.!?])\s+/).filter(Boolean).map((x) => '- ' + x).join('\n');
  if (out && !/[.!?:]$/.test(out) && !/\n- /.test(out)) out += '.';
  return out;
}


/* ---------------- "DWT dikhao": opening a screen ---------------- */
/* The pages the page said this person can open: the line
   "pages: dashboard (Dashboard), dwt (DWT · Daily Working Tracker), …". */
function parsePages(system) {
  const m = String(system || '').match(/pages:\s*(.+)$/m);
  if (!m) return [];
  const out = [];
  const re = /([a-z0-9]+) \(([^)]*)\)/g;
  let x;
  while ((x = re.exec(m[1]))) out.push({ view: x[1], label: x[2] });
  return out;
}
const OPEN_WORDS = /\b(open|show|go|goto|take|navigate|launch|visit|dikhao|dikhado|dikha|dikhaiye|dikhayein|dikhaye|kholo|kholiye|kholdo|khol|chalo|jao|le)\b/;
const OPEN_FILLER = new Set(('me to the a an page screen module tab section view please pls plz now ka ki ke ko mera meri mere my our hamara humara '
  + 'do de dijiye dena karo kar kariye zara jara hai na ab abhi wala wali wale par pe on up for us can you could would i want see let lets go goto take navigate '
  + 'open show launch visit dikhao dikhado dikha dikhaiye dikhayein dikhaye kholo kholiye kholdo khol chalo jao le bhai sir ji details detail').split(' '));
/* The same names the page knows (public/index.html, BOSS_PAGE_ALIAS). */
const PAGE_ALIAS = {
  home: 'dashboard', dash: 'dashboard', leads: 'lms', lead: 'lms', clients: 'cms', client: 'cms', reviews: 'rms', review: 'rms',
  tasks: 'dst', task: 'dst', 'service tasks': 'dst', dbt: 'business', 'daily business tracker': 'business', business: 'business',
  mom: 'meetings', moms: 'meetings', 'minutes of meeting': 'meetings', meeting: 'meetings', calendar: 'meetings', call: 'calls', 'call logs': 'calls',
  mail: 'mailbox', mails: 'mailbox', inbox: 'mailbox', email: 'mailbox', emails: 'mailbox', fbp: 'partners', partner: 'partners',
  campaign: 'campaigns', marketing: 'campaigns', project: 'projects', report: 'reports', import: 'import', 'bulk import': 'import',
  team: 'teammembers', 'team members': 'teammembers', 'team member': 'teammembers', setup: 'settings', setting: 'settings', settings: 'settings',
  'recycle bin': 'recyclebin', bin: 'recyclebin', trash: 'recyclebin', fq: 'fqtests', 'fq tests': 'fqtests', 'fq test': 'fqtests',
  iseq: 'iseqforms', 'iseq forms': 'iseqforms', cif: 'cifforms', 'cif forms': 'cifforms', 'plan forms': 'planforms', 'plan input forms': 'planforms',
  ct: 'ctforms', 'ct forms': 'ctforms', 'c and t forms': 'ctforms', qms: 'queries', query: 'queries', queries: 'queries', tickets: 'queries',
  profile: 'profile', 'my profile': 'profile', hr: 'hrdashboard', 'hr dashboard': 'hrdashboard', attendance: 'hrattendance',
  incentive: 'hrincentive', incentives: 'hrincentive', appraisal: 'hrappraisal', appraisals: 'hrappraisal',
  '7 events': 'sevenevents', 'seven events': 'sevenevents', 'execution tracker': 'recommendations', recommendation: 'recommendations',
  transaction: 'transactions', 'transaction tracker': 'transactions', txns: 'transactions', 'portfolio review': 'portfolio', portfolio: 'portfolio',
  'daily working tracker': 'dwt', 'daily job tracker': 'djt', 'annual review calendar': 'arc', 'management information system': 'mis',
};
const norm = (q) => String(q || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').replace(/\s+/g, ' ').trim();
const isHinglish = (q) => /\b(dikhao|dikhado|dikha|dikhaiye|kholo|kholiye|khol|chalo|jao|karo|ka|ki|ke|ko|mera|meri|mujhe|zara|hai|hain|kitne|kitna|kitni|kya|kaun|kaunsa|kijiye|dijiye|batao|hamara|humara)\b/i.test(String(q || ''));
function pageFor(name, pages) {
  const n = norm(name);
  if (!n) return null;
  const byView = (v) => pages.find((p) => p.view === v) || null;
  return byView(n.replace(/ /g, '')) || (PAGE_ALIAS[n] ? byView(PAGE_ALIAS[n]) : null)
    || pages.find((p) => p.label.split(' · ').concat([p.label]).some((part) => norm(part) === n)) || null;
}
/* "DWT (Daily Working Tracker)" from "DWT · Daily Working Tracker". */
const pageTitle = (p) => { const i = p.label.indexOf(' · '); return i > 0 ? p.label.slice(0, i) + ' (' + p.label.slice(i + 3) + ')' : p.label; };
/* A request ONLY to open a page ("DWT dikhao", "open DWT"): the page, or null. */
function openIntent(q, pages) {
  const t = norm(q);
  if (!pages.length || !OPEN_WORDS.test(' ' + t + ' ')) return null;
  const rest = t.split(' ').filter((w) => w && !OPEN_FILLER.has(w));
  return rest.length ? pageFor(rest.join(' '), pages) : null;
}
const openedLine = (q, p) => (isHinglish(q) ? '**' + pageTitle(p) + '** khol diya hai.' : 'Opened **' + pageTitle(p) + '**.') + '\nOPEN: ' + p.view;
const questionOf = (messages) => { const t = lastUser(messages); return ((t.match(/Question:\s*([\s\S]*)$/) || [])[1] || t).trim(); };
/* The whole answer to a pure page-open request, or ''. */
function pageOpenAnswer(system, messages) {
  const q = questionOf(messages);
  const p = openIntent(q, parsePages(system));
  return p ? openedLine(q, p) : '';
}
const TAB_ALIAS = { overview: 'overview', summary: 'overview', portfolio: 'portfolio', holdings: 'portfolio', goals: 'goals', goal: 'goals',
  transactions: 'transactions', transaction: 'transactions', txns: 'transactions', risk: 'risk', engagement: 'engagement',
  mail: 'mail', mails: 'mail', emails: 'mail', comms: 'comms', communication: 'comms', communications: 'comms', documents: 'documents', document: 'documents', docs: 'documents' };

/* ---------------- the chat answer ---------------- */
function parseSops(text) {
  const out = [];
  String(text || '').split(/\n(?=\[[^\]]+\] )/).forEach((chunk) => {
    const head = chunk.match(/^\[([^\]]+)\] ([^\n]*)/);
    if (!head) return;
    const lines = chunk.split('\n').slice(1);
    const steps = lines.filter((l) => /^\s+\d+\.\s/.test(l)).map((l) => l.replace(/^\s+\d+\.\s*/, '').trim());
    const pick = (re) => { const l = lines.find((x) => re.test(x)); return l ? l.replace(re, '').trim() : ''; };
    out.push({ id: head[1], title: head[2].replace(/\s*\([^)]*\)\s*$/, '').trim(), steps, docs: pick(/^\s*Documents:\s*/), tat: pick(/^\s*TAT:\s*/), notes: pick(/^\s*Notes:\s*/), raw: chunk });
  });
  return out;
}
function rankSops(sops, q) {
  const qw = words(q).filter((w) => !STOP.has(w));
  return sops.map((s, i) => {
    const hay = (s.title + ' ' + s.id + ' ' + s.steps.join(' ')).toLowerCase();
    const titleHits = qw.filter((w) => (s.title + ' ' + s.id).toLowerCase().includes(w)).length;
    const bodyHits = qw.filter((w) => hay.includes(w)).length;
    return { s, score: titleHits * 3 + bodyHits - i * 0.01 };              // the page's own order breaks ties
  }).sort((a, b) => b.score - a.score).map((x) => x.s);
}
const money = (n) => {
  const v = Number(n);
  if (!isFinite(v)) return String(n);
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};
function rowLine(row, columns) {
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    return Object.entries(row).filter(([, v]) => v !== '' && v !== null && v !== undefined && typeof v !== 'object').slice(0, 5)
      .map(([k, v]) => k + ': ' + v).join(', ');
  }
  if (Array.isArray(row)) return row.slice(0, 5).map((v, i) => ((columns || [])[i] ? columns[i] + ': ' : '') + v).join(', ');
  return String(row);
}
function describeReads(reads) {
  const lines = [];
  (reads || []).forEach((r) => {
    if (!r) return;
    if (r.error) { lines.push((r.source || 'A source') + ': could not be read (' + r.error + ').'); return; }
    if (Array.isArray(r.groups)) {
      lines.push((r.source || 'Records') + ': ' + (r.total !== undefined ? r.total + ' in all' : '') + (r.groupBy && r.groupBy.length ? ', by ' + r.groupBy.join(' / ') : '') + '.');
      r.groups.slice(0, 8).forEach((g) => {
        const name = Array.isArray(g.key) ? g.key.join(' / ') : (g.key !== undefined ? g.key : (g.group !== undefined ? g.group : rowLine(g)));
        const sums = (Array.isArray(r.sum) ? r.sum : []).filter((k) => g[k] !== undefined).map((k) => k + ' ' + (/aum|amount|value|sip/i.test(k) ? money(g[k]) : g[k])).join(', ');
        lines.push('- ' + (name === '' || name === undefined ? 'Not recorded' : name) + ': ' + (g.count !== undefined ? g.count : '') + (sums ? ' (' + sums + ')' : ''));
      });
      if (r.groups.length > 8) lines.push('- …and ' + (r.groups.length - 8) + ' more groups.');
      return;
    }
    if (Array.isArray(r.rows)) {
      lines.push((r.source || 'Records') + ': ' + (r.total !== undefined ? r.total : r.rows.length) + ' found' + (r.rows.length ? '. The first ' + Math.min(5, r.rows.length) + ':' : '.'));
      r.rows.slice(0, 5).forEach((row) => lines.push('- ' + rowLine(row, r.columns)));
      if ((r.total || 0) > 5) lines.push('- …' + (r.total - 5) + ' more on the screen this came from.');
    }
  });
  return lines;
}
/* "Priya ka DOB aur PAN": the client's own fields, as the page sent them
   (the PAN masked — it went to the provider). */
const PERSONAL_RE = /\b(dob|date of birth|birth ?day|janam|age|pan|mobile|phone|e-?mail|address|nominee|iin|ucc|anniversary|occupation|profession|personal|profile|details?)\b/i;
const PERSONAL_FIELDS = /^(date of birth|pan|mobile|email|e-?mail|mailing street|mailing city|mailing state|mailing zip|city|occupation|profession|anniversary date|gender|marital status|can \/ iin no\.?|iin|ucc no\.?|ucc|kyc status|mandate status|bank name|ifsc|nominee|first nominee name)/i;
function describePersonal(c) {
  const lines = ['**' + (c.client || c.name || 'Client') + '** — personal & KYC profile' + (c.code ? ' (' + c.code + ')' : '')];
  if (c.dob) lines.push('- Date of birth: ' + c.dob + (c.age !== undefined && c.age !== null ? ' (age ' + c.age + ')' : ''));
  Object.entries(c.fields || {}).filter(([k]) => PERSONAL_FIELDS.test(k) && !/^date of birth/i.test(k)).slice(0, 18).forEach(([k, v]) => lines.push('- ' + k + ': ' + v));
  if (c.branch || c.rm) lines.push('- Branch: ' + (c.branch || '—') + (c.rm ? ', RM ' + c.rm : ''));
  if (c.aum !== undefined && c.aum !== null && c.aum !== '') lines.push('- AUM ' + money(c.aum) + (c.monthlySip ? ', monthly SIP ' + money(c.monthlySip) : ''));
  return lines;
}
function describeClient(c, q) {
  if (!c) return [];
  if (q && PERSONAL_RE.test(q)) return describePersonal(c);
  const lines = [(c.client || c.name || 'Client') + (c.code ? ' (' + c.code + ')' : '') + (c.stage ? ' — ' + c.stage : '') + (c.rm ? ', RM ' + c.rm : '')];
  if (c.aum !== undefined && c.aum !== null && c.aum !== '') lines.push('AUM ' + money(c.aum) + (c.monthlySip ? ', monthly SIP ' + money(c.monthlySip) : '') + '.');
  (c.bossAlerts || []).slice(0, 5).forEach((a) => lines.push('- ' + a));
  if ((c.complianceGaps || []).length) lines.push('- Compliance gaps: ' + c.complianceGaps.slice(0, 5).join(', '));
  if ((c.openTasks || []).length) lines.push('- Open tasks: ' + c.openTasks.slice(0, 3).map((t) => (t.title || t.type) + (t.due ? ' (due ' + t.due + ')' : '')).join('; '));
  return lines;
}
/* The portfolio, risk and wealth analysis the page worked out (data.intel). */
function describeIntel(x) {
  if (!x || !x.scope) return [];
  const pct = (v) => (Math.round(Number(v) * 10) / 10) + '%';
  const L = ['**' + x.scope.label + '** — portfolio ' + money(x.totalValue) + ', invested ' + money(x.invested) + ', monthly SIP ' + money(x.monthlySip)
    + (x.riskProfile ? ', ' + x.riskProfile + ' risk profile' : '') + '.', ''];
  const p = x.portfolio;
  if (p) {
    L.push('**1. Portfolio analysis**');
    L.push('- Asset allocation: ' + p.classes.map((c) => c.label + ' ' + pct(c.pct)).join(', ') + '.');
    if (p.amcs.length) L.push('- Top AMCs: ' + p.amcs.slice(0, 3).map((a) => a.label + ' ' + pct(a.pct)).join(', ') + '.');
    if (p.topSchemes.length) L.push('- Top schemes: ' + p.topSchemes.slice(0, 3).map((a) => a.label + ' ' + pct(a.pct)).join(', ') + '.');
    L.push('- ' + (p.flags.length ? 'Concentration: ' + p.flags.join(' ') : 'No scheme above 25% and no AMC above 40%.'));
    L.push('- Return: ' + (p.xirr != null ? 'XIRR ' + pct(p.xirr) : 'absolute gain ' + (p.gainPct != null ? pct(p.gainPct) : 'not known')) + ' (gain ' + money(p.gain) + ') against long-run references of '
      + (p.reference || []).map((r) => r.label.replace(/ \(long-run reference\)/, '') + ' ' + r.r + '%').join(' and ') + '. Goals mapped: ' + p.goalsMapped + '.', '');
  }
  const a = x.actions;
  if (a) {
    const c = Object.keys(a.counts || {}).map((k) => k + ' ' + a.counts[k]).join(', ');
    L.push('**2. Buy / Sell / Hold / Switch**');
    L.push('- ' + (c ? 'Signals: ' + c + '.' : 'No scheme-level holdings to read signals from.'));
    (a.list || []).slice(0, 5).forEach((r) => L.push('- ' + r.action + ': ' + r.scheme + (x.scope.kind === 'book' ? ' (' + r.client + ')' : '') + ' — ' + r.why));
    const r = a.riskySafe;
    if (r) L.push('- Risky to safe: small / mid / thematic ' + pct(r.riskyPct) + ' against a ' + r.capPct + '% ceiling. ' + (r.switchAmount
      ? 'Switch about ' + money(r.switchAmount) + ' into ' + r.to.map((z) => z.category + ' ' + money(z.amount)).join(', ') + '; exit load about ' + money(r.exitLoad) + ', capital gains tax about ' + money(r.tax) + '.'
      : 'Nothing above the ceiling to switch.'));
    L.push('- ' + a.governance, '');
  }
  const t = x.tax;
  if (t) {
    L.push('**3. Tax harvesting**');
    L.push('- Unrealised equity gain ' + money(t.unrealisedEquityGain) + ' (long-term ' + money(t.longTermGain) + ', short-term ' + money(t.shortTermGain) + ').');
    L.push('- Book ' + money(t.harvestTaxFree) + ' of long-term gain tax-free under the ₹1.25 lakh allowance: about ' + money(t.taxSaved) + ' saved; taxable gain remaining ' + money(t.taxableRemaining) + '.');
    if (t.losses) L.push('- Losses of ' + money(t.losses) + ' can be booked to set off gains.');
    L.push('- ' + t.rules, '');
  }
  const o = x.opportunities;
  if (o) {
    L.push('**4. Cross-sell & up-sell**');
    if (!o.byType.length) L.push('- No gaps found in the records.');
    o.byType.forEach((b) => L.push('- ' + b.type + ': ' + b.clients + (x.scope.kind === 'book' ? ' client' + (b.clients === 1 ? '' : 's') : '') + (b.amount ? ' (' + money(b.amount) + ')' : '')));
    L.push('');
  }
  const r = x.risk;
  if (r) {
    L.push('**5. Risk analysis**');
    L.push('- Sharpe ratio ' + r.sharpe + ' · Beta (β) ' + r.beta + ' · Expected return (μ) ' + pct(r.expectedReturn) + ' · Standard deviation (σ) ' + pct(r.sigma) + '.');
    L.push('- One-sigma range (μ − σ to μ + σ): ' + pct(r.low) + ' to ' + pct(r.high) + ' a year. Portfolio risk ' + r.level + '; profile ' + r.profile + '. ' + r.fit);
    L.push('- Diversification score ' + r.diversificationScore + ' / 100. ' + r.method, '');
  }
  const g = x.plan;
  if (g) {
    L.push('**6. GAB, bucket strategy, HUF, trust & legacy**');
    g.buckets.forEach((b) => L.push('- ' + b.name + (b.pct ? ' (' + b.pct + '%)' : '') + ': ' + money(b.amount) + ' — ' + b.categories + (b.schemes ? '; e.g. ' + b.schemes.slice(0, 3).join(', ') : '')));
    if (g.gab && g.gab.swpMonthly6) L.push('- SWP income a month: ' + money(g.gab.swpMonthly4) + ' at 4%, ' + money(g.gab.swpMonthly5) + ' at 5%, ' + money(g.gab.swpMonthly6) + ' at 6% a year.');
    L.push('- ' + g.assumption);
    L.push('- GAB SWP income: ' + money(g.gab.swpMonthly4) + ' to ' + money(g.gab.swpMonthly5) + ' a month. ' + g.gab.note);
    L.push('- ' + g.huf.note);
    g.legacy.checks.forEach((c) => L.push('- ' + c));
    L.push('');
  }
  const j = x.projection;
  if (j) {
    L.push('**7. Future projection** (' + money(j.corpus) + ' + ' + money(j.monthlySip) + ' a month)');
    j.table.forEach((row) => L.push('- ' + row.years + ' years: ' + money(row.conservative) + ' / ' + money(row.moderate) + ' / ' + money(row.optimistic) + ' (9% / 12% / 15%)'));
    (j.goals || []).forEach((q) => L.push('- Goal ' + q.goal + ' (' + q.year + '): ' + q.achievementPct + '% of ' + money(q.target) + ' at 12%.'));
    L.push('- ' + j.note, '');
  }
  return L;
}
/* "How many KYCs are pending": the number first, then each status. */
function describeCount(c, q) {
  if (!c || typeof c.matching !== 'number') return [];
  const who = c.matching + ' of ' + c.total + ' ' + (c.of || 'records');
  const head = isHinglish(q) && / is not /.test(c.rule)
    ? '**' + c.total + ' mein se ' + c.matching + ' ' + (c.of || 'records') + '** ka ' + c.rule.replace(/ is not /, ' ') + ' nahi hai (pending).'
    : '**' + who + '** are pending: their ' + c.rule + '.';
  return [head, ''];
}
function describeChart(ch) {
  if (!ch || typeof ch !== 'object') return [];
  const bars = Array.isArray(ch.rows) ? ch.rows : Array.isArray(ch.bars) ? ch.bars : Array.isArray(ch.data) ? ch.data : Array.isArray(ch.groups) ? ch.groups : [];
  if (!bars.length) return [];
  const sorted = bars.slice().sort((a, b) => (Number(b.value || b.count || 0) - Number(a.value || a.count || 0)));
  return [(ch.title || 'The chart') + ' — largest groups: ' + sorted.slice(0, 3).map((b) => (b.label || b.key || b.name) + ' ' + (b.value !== undefined ? b.value : b.count)).join(', ') + '.'];
}
function describeMarket(m) {
  const quotes = (m && (m.quotes || m.items)) || (Array.isArray(m) ? m : []);
  return quotes.slice(0, 5).map((x) => {
    const t = x.technical || {}, c = t.checklist || x.checklist || {};
    return (x.name || x.symbol || 'Index') + ': ' + (x.price !== undefined ? x.price : '') + (x.changePct !== undefined ? ' (' + x.changePct + '% today)' : '')
      + (c.bias ? ' — the checklist leans ' + c.bias : '') + '.';
  });
}

function chat(messages, opts) {
  opts = opts || {};
  const text = lastUser(messages);
  const q = (text.match(/Question:\s*([\s\S]*)$/) || [])[1] || text.replace(/<sops>[\s\S]*?<\/sops>|<data>[\s\S]*?<\/data>/g, '').trim();
  const sops = rankSops(parseSops(block(text, 'sops')), q);
  let data = null;
  const raw = block(text, 'data');
  if (raw && !/^none read/i.test(raw)) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
  const out = [];
  const howTo = HOWTO_RE.test(q);
  const pages = parsePages(opts.system);
  /* "DWT dikhao": the screen, at once. */
  const pure = openIntent(q, pages);
  if (pure) return openedLine(q, pure);
  /* The firm's own advisory view answers an advisory question first. */
  const house = RiaKnowledge.knowledgeFor(q);
  if (house) out.push(house);

  if (opts.aum && opts.aum.ok) {
    const a = opts.aum;
    out.push((a.scope && a.scope.kind === 'firm' ? 'Total firm AUM: ' : 'AUM in your scope: ') + money(a.total) + '.');
    if (a.scope && a.scope.label) out.push('Scope: ' + a.scope.label + '.');
    if (a.source) out.push('Source: ' + a.source);
  } else if (opts.aum && opts.aum.message && /\baum\b/i.test(q)) out.push(opts.aum.message);

  if (data) {
    if (data.countSummary) out.push(...describeCount(data.countSummary, q));
    if (data.intel) out.push(...describeIntel(data.intel));
    if (Array.isArray(data.suggestedActions) && data.suggestedActions.length) {
      out.push('', '**Suggested next actions:**');
      data.suggestedActions.forEach((x) => out.push('- ' + x.action + ': ' + Number(x.records).toLocaleString('en-IN')));
    }
    (data.clients || []).slice(0, 3).forEach((c) => { out.push(...describeClient(c, q)); out.push(''); });
    if (data.openLead) out.push('Lead on screen: ' + rowLine(data.openLead) + '.');
    if (data.chart) out.push(...describeChart(data.chart));
    if (data.reads) out.push(...describeReads(data.reads));
    if (data.liveMarket || data.marketNow) out.push(...describeMarket(data.liveMarket || data.marketNow));
    if (data.marketZone && !/not set/i.test(String(data.marketZone)) && (data.liveMarket || data.marketNow || (Array.isArray(data.portfolioSignals) && data.portfolioSignals.length))) out.push('Market zone: ' + data.marketZone + '.');
    if (Array.isArray(data.portfolioSignals) && data.portfolioSignals.length) {
      out.push('Portfolio checks the CRM computed (for the advisor to review before anything is suggested):');
      data.portfolioSignals.slice(0, 5).forEach((s) => out.push('- ' + (s.client || '') + ': ' + [].concat(s.funds || [], s.rebalance || []).slice(0, 3).join('; ')));
    }
    if (data.note) out.push(data.note);
  }
  while (out.length && out[out.length - 1] === '') out.pop();

  /* A count question is answered by its numbers; an SOP under it is noise. */
  const countQ = isCountQ(q) && !house && !(data && data.intel) && !(data && Array.isArray(data.clients) && data.clients.length);   // a client's own question keeps its SOPs
  if (countQ) {
    if (!data || !(data.reads || data.countSummary || data.clients)) out.push(isHinglish(q)
      ? 'Is ginti ke liye BOSS ne koi records nahi padhe. Status ka naam likhiye — jaise "kitne KYC pending hain" ya "how many mandates are pending".'
      : 'BOSS read no records for that count. Name the status — for example "how many KYCs are pending" or "how many mandates are pending".');
  } else if (house && sops.length) {
    out.push('', 'Related: ' + sops.slice(0, 3).map((x) => '[' + x.id + '] ' + x.title).join('; ') + '.');
  } else if (sops.length) {
    const s = sops[0];
    if (out.length) out.push('');
    /* A note of the SOP that speaks to the question's own words ("on hold")
       comes first, and the SOP it sends the reader to, if the page sent it
       too, is spelled out after: "Hold/Rejected -> do Physical KYC". */
    const qw = words(q).filter((w) => !STOP.has(w));
    const generic = new Set(words(s.title + ' ' + s.id));
    const keyNotes = (s.notes ? s.notes.split(/\s+\/\s+/) : []).filter((n) => qw.some((w) => !generic.has(w) && n.toLowerCase().includes(w)));
    const next = keyNotes.length ? sops.slice(1).find((x) => {
      const tw = words(x.title).filter((w) => !STOP.has(w) && !generic.has(w));
      return tw.length && keyNotes.some((n) => tw.every((w) => n.toLowerCase().includes(w)) || tw.some((w) => w.length > 5 && n.toLowerCase().includes(w)));
    }) : null;
    if (keyNotes.length) out.push('In short: ' + keyNotes.join('; ') + '.', '');
    out.push((howTo || !out.length ? 'Here is what to do' : 'The process that applies') + ' — [' + s.id + '] ' + s.title + ':');
    s.steps.slice(0, howTo || !data ? 12 : 5).forEach((x, i) => out.push((i + 1) + '. ' + x));
    if (s.docs) out.push('Documents: ' + s.docs);
    if (s.tat) out.push('TAT: ' + s.tat);
    const otherNotes = s.notes ? s.notes.split(/\s+\/\s+/).filter((n) => !keyNotes.includes(n)) : [];
    if (otherNotes.length && (howTo || !data) && !keyNotes.length) out.push('Note: ' + otherNotes.join(' / '));
    if (next) {
      out.push('', 'Then — [' + next.id + '] ' + next.title + ':');
      next.steps.slice(0, 12).forEach((x, i) => out.push((i + 1) + '. ' + x));
      if (next.docs) out.push('Documents: ' + next.docs);
      if (next.tat) out.push('TAT: ' + next.tat);
    }
    const rest = sops.slice(1).filter((x) => x !== next);
    if (rest.length) out.push('Related: ' + rest.slice(0, 2).map((x) => '[' + x.id + '] ' + x.title).join('; ') + '.');
  }
  if (!out.length) {
    out.push(isHinglish(q)
      ? 'Is sawaal ke liye BOSS ke SOPs aur records mein seedha jawab nahi mila.'
      : 'BOSS\u2019s SOPs and the records read for this question do not answer it directly.');
    out.push('Try naming the client, the record or the process — for example "KYC on hold", "pending SIPs this month", "bucket strategy", "fund basket for a moderate investor, 5–7 years", or "open DWT".');
  }
  /* "Priya ka portfolio dikhao", "DWT dikhao aur batao…": the screen too. */
  const open = openLine(q, pages, data);
  if (open) out.push('OPEN: ' + open);
  /* Lines no answer should carry. */
  return out.filter((l) => !/Market zone: not set|The category could not be read from the scheme name|\(drawn below\)/.test(l)).join('\n');
}
/* Where a question that also asks to see something should go, or ''. */
function openLine(q, pages, data) {
  const t = ' ' + norm(q) + ' ';
  if (!OPEN_WORDS.test(t)) return '';
  const tabWord = Object.keys(TAB_ALIAS).find((w) => t.includes(' ' + w + ' '));
  const clients = (data && Array.isArray(data.clients) ? data.clients : []).filter((c) => c && c.id);
  if (clients.length === 1 && (tabWord || /\b(client|details?|profile|account)\b/.test(t))) return 'cms ' + clients[0].id + ' ' + (tabWord ? TAB_ALIAS[tabWord] : 'overview');
  /* A page named anywhere in the sentence, longest name first. */
  const names = Object.keys(PAGE_ALIAS).concat(pages.map((p) => p.view)).concat(...pages.map((p) => p.label.split(' · ').map(norm)))
    .filter(Boolean).sort((a, b) => b.length - a.length);
  for (const n of names) if (t.includes(' ' + n + ' ')) { const p = pageFor(n, pages); if (p) return p.view; }
  return '';
}

function answer({ system, messages, aum, now } = {}) {
  const kind = classify(system);
  const q = lastUser(messages);
  if (kind === 'plan') return plan(q, system, now);
  if (kind === 'report') return report(q, system, now);
  if (kind === 'reframe') return reframe(q);
  return chat(messages, { aum, system });
}

/* Whether a failed provider call is the provider's trouble (answer from
   here) rather than a refusal BOSS itself made. Every provider failure is
   answered from here; this only says which ones are worth one retry. */
function retryable(r) {
  if (!r || r.ok) return false;
  return [408, 425, 429, 500, 502, 503, 504, 529].includes(Number(r.status)) || /did not answer|timed? ?out|ECONNRESET|socket hang up|EAI_AGAIN/i.test(String(r.message || ''));
}

const knowledgeFor = (q) => RiaKnowledge.knowledgeFor(q);

module.exports = { answer, classify, plan, report, reframe, chat, parseSources, parseSops, parsePages, openIntent, pageOpenAnswer, questionOf,
  knowledgeFor, retryable, PLAN_MARK, REPORT_MARK, REFRAME_MARK };

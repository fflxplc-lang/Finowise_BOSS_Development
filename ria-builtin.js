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
const COUNT_RE = /\b(how many|kitne|kitna|kitni|count|number of|total|branch[- ]?wise|rm[- ]?wise|status[- ]?wise|by branch|by rm|by status|breakdown)\b/i;
const HOWTO_RE = /\b(kaise|how to|how do|process|procedure|steps?|documents?|docs|kagaz|kya karein|kya karna|what to do|what should|should i|tat|on hold|rejected|form)\b/i;
function groupAndSum(q, src) {
  const t = String(q || '').toLowerCase();
  const col = (re) => src.cols.find((c) => re.test(c.toLowerCase()));
  let g = null;
  if (/branch/.test(t)) g = col(/branch/);
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
  if (!src || (HOWTO_RE.test(q) && !COUNT_RE.test(q))) return JSON.stringify({ reads: [], client: null });
  const per = period(q, now);
  const read = { source: src.name, from: per.from, to: per.to, where: [] };
  if (COUNT_RE.test(q)) Object.assign(read, groupAndSum(q, src));
  else read.cols = src.cols.slice(0, 8);
  if (/\bpending\b/i.test(q)) { const s = src.cols.find((c) => /status/i.test(c)); if (s) read.where = [{ col: s, op: 'contains', value: 'Pending' }]; }
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
    notes: 'Prepared by BOSS’s built-in assistant while the AI service was busy: check the columns before sharing.', ask: '' });
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
function describeClient(c) {
  if (!c) return [];
  const lines = [(c.client || c.name || 'Client') + (c.code ? ' (' + c.code + ')' : '') + (c.stage ? ' — ' + c.stage : '') + (c.rm ? ', RM ' + c.rm : '')];
  if (c.aum !== undefined && c.aum !== null && c.aum !== '') lines.push('AUM ' + money(c.aum) + (c.monthlySip ? ', monthly SIP ' + money(c.monthlySip) : '') + '.');
  (c.bossAlerts || []).slice(0, 5).forEach((a) => lines.push('- ' + a));
  if ((c.complianceGaps || []).length) lines.push('- Compliance gaps: ' + c.complianceGaps.slice(0, 5).join(', '));
  if ((c.openTasks || []).length) lines.push('- Open tasks: ' + c.openTasks.slice(0, 3).map((t) => (t.title || t.type) + (t.due ? ' (due ' + t.due + ')' : '')).join('; '));
  return lines;
}
function describeChart(ch) {
  if (!ch || typeof ch !== 'object') return [];
  const bars = Array.isArray(ch.rows) ? ch.rows : Array.isArray(ch.bars) ? ch.bars : Array.isArray(ch.data) ? ch.data : Array.isArray(ch.groups) ? ch.groups : [];
  if (!bars.length) return [];
  const sorted = bars.slice().sort((a, b) => (Number(b.value || b.count || 0) - Number(a.value || a.count || 0)));
  return [(ch.title || 'The chart') + ' (drawn below) — largest groups: ' + sorted.slice(0, 3).map((b) => (b.label || b.key || b.name) + ' ' + (b.value !== undefined ? b.value : b.count)).join(', ') + '.'];
}
function describeMarket(m) {
  const quotes = (m && (m.quotes || m.items)) || (Array.isArray(m) ? m : []);
  return quotes.slice(0, 5).map((x) => {
    const t = x.technical || {}, c = t.checklist || x.checklist || {};
    return (x.name || x.symbol || 'Index') + ': ' + (x.price !== undefined ? x.price : '') + (x.changePct !== undefined ? ' (' + x.changePct + '% today)' : '')
      + (c.bias ? ' — the checklist leans ' + c.bias : '') + '.';
  });
}
const FOOT = 'BOSS answered this from the firm’s SOPs and records because the AI service was busy. Ask again in a minute for a fuller answer.';

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

  if (opts.aum && opts.aum.ok) {
    const a = opts.aum;
    out.push((a.scope && a.scope.kind === 'firm' ? 'Total firm AUM: ' : 'AUM in your scope: ') + money(a.total) + '.');
    if (a.scope && a.scope.label) out.push('Scope: ' + a.scope.label + '.');
    if (a.source) out.push('Source: ' + a.source);
  } else if (opts.aum && opts.aum.message && /\baum\b/i.test(q)) out.push(opts.aum.message);

  if (data) {
    (data.clients || []).slice(0, 3).forEach((c) => { out.push(...describeClient(c)); out.push(''); });
    if (data.openLead) out.push('Lead on screen: ' + rowLine(data.openLead) + '.');
    if (data.chart) out.push(...describeChart(data.chart));
    if (data.reads) out.push(...describeReads(data.reads));
    if (data.liveMarket || data.marketNow) out.push(...describeMarket(data.liveMarket || data.marketNow));
    if (data.marketZone && (data.liveMarket || data.marketNow || (Array.isArray(data.portfolioSignals) && data.portfolioSignals.length))) out.push('Market zone: ' + data.marketZone + '.');
    if (Array.isArray(data.portfolioSignals) && data.portfolioSignals.length) {
      out.push('Portfolio checks the CRM computed (for the advisor to review before anything is suggested):');
      data.portfolioSignals.slice(0, 5).forEach((s) => out.push('- ' + (s.client || '') + ': ' + [].concat(s.funds || [], s.rebalance || []).slice(0, 3).join('; ')));
    }
    if (data.note) out.push(data.note);
  }
  while (out.length && out[out.length - 1] === '') out.pop();

  if (sops.length) {
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
    out.push('The AI service is busy right now, and nothing BOSS read for this question answers it directly.');
    out.push('Ask again in a minute, or name the client, the record or the process (for example "KYC on hold" or "pending SIPs this month").');
    return out.join('\n');
  }
  out.push('', FOOT);
  return out.join('\n');
}

function answer({ system, messages, aum, now } = {}) {
  const kind = classify(system);
  const q = lastUser(messages);
  if (kind === 'plan') return plan(q, system, now);
  if (kind === 'report') return report(q, system, now);
  if (kind === 'reframe') return reframe(q);
  return chat(messages, { aum });
}

/* Whether a failed provider call is the provider's trouble (answer from
   here) rather than a refusal BOSS itself made. Every provider failure is
   answered from here; this only says which ones are worth one retry. */
function retryable(r) {
  if (!r || r.ok) return false;
  return [408, 425, 429, 500, 502, 503, 504, 529].includes(Number(r.status)) || /did not answer|timed? ?out|ECONNRESET|socket hang up|EAI_AGAIN/i.test(String(r.message || ''));
}

module.exports = { answer, classify, plan, report, reframe, chat, parseSources, parseSops, retryable, PLAN_MARK, REPORT_MARK, REFRAME_MARK };

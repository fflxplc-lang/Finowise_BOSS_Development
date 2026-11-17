'use strict';
/* =====================================================================
   RIA AI'S ADVISORY HOUSE VIEW

   What Finowise tells its advisors on the questions they ask the assistant
   most: the 3-bucket strategy, the Advisor Recommended Fund Basket (by
   risk profile and horizon), the recommended scheme list by category, and
   the core advisory topics (STP/SWP, asset allocation, rebalancing, goal
   planning, tax harvesting, loan against mutual funds, transfer of units,
   the QMS escalation path).

   knowledgeFor(question) returns the parts that answer the question, as
   plain text, or '' when the question is not about any of them. The server
   gives that text to the AI provider with the question, and the built-in
   answer (ria-builtin.js) uses it when the provider cannot answer.

   Matching forgives the usual typing: "buckket", "bucket stratergy",
   "3 bucket", "retirement bucket", Hinglish ("bucket strategy batao").

   Sources: ria-fund-basket.json (Mutual Fund Basket — November 2026
   refresh, Regular plan, Growth option), the MF Recommendation Master
   (Final v1, 18 Aug 2025) already in BOSS_POLICY, and the firm's 3-bucket
   scheme list. Pure: no network, no store access.
   ===================================================================== */
const BASKET = require('./ria-fund-basket.json');

/* ---- forgiving word matching ---- */
const squash = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
  .replace(/([a-z])\1+/g, '$1').replace(/\s+/g, ' ').trim();
function near(a, b) {                                   // edit distance ≤ 1 for longer words
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
function hasPhrase(qWords, phrase) {
  const p = squash(phrase).split(' ');
  for (let i = 0; i + p.length <= qWords.length; i++) if (p.every((w, k) => near(qWords[i + k], w))) return true;
  return false;
}
const any = (qWords, list) => list.some((p) => hasPhrase(qWords, p));
const hinglish = (q) => /\b(batao|bataiye|samjhao|kya|kaise|kaunsa|konsa|kaun|hai|hain|karna|karein|chahiye|mujhe|mera|hamara|humara|dikhao|ke liye|ka|ki|ke)\b/i.test(String(q || ''));

/* ---- the 3-bucket strategy ---- */
const BUCKETS = [
  { n: 1, years: '0–2 years', role: 'Liquidity', cats: 'Liquid, Overnight, Ultra Short Term and Arbitrage funds',
    eg: 'ABSL Liquid, ICICI Pru Liquid, HDFC Ultra Short Term, ABSL Arbitrage, Bandhan Arbitrage, Mirae Asset Arbitrage',
    job: 'about two years of expenses, paid out monthly by SWP; safety and instant access, not return' },
  { n: 2, years: '3–6 years', role: 'Stability', cats: 'Corporate Bond, All Seasons Bond, Equity Savings, Conservative / Aggressive Hybrid and Multi-Asset funds',
    eg: 'HDFC Corporate Bond, ICICI Pru All Seasons Bond, HDFC Multi-Asset, Nippon India Multi Asset, ICICI Pru Equity & Debt, Kotak Aggressive Hybrid',
    job: 'the next four years of expenses; steady, low-volatility growth that refills Bucket 1' },
  { n: 3, years: '7+ years', role: 'Growth', cats: 'Flexi Cap, Large & Mid Cap, Multi Cap and Value funds',
    eg: 'Bandhan Flexi Cap, SBI Flexi Cap, HDFC Flexi Cap, Bandhan Large & Mid Cap, Invesco India Multi Cap, Kotak Multi Cap, HDFC Value',
    job: 'everything else; long-term equity growth that beats inflation and refills Bucket 2' },
];
function bucketText(q) {
  const out = [hinglish(q) ? '**Finowise ki 3-Bucket Strategy** (retirement / financial-freedom income ke liye):' : '**Finowise 3-Bucket Strategy** (for retirement and financial-freedom income):', ''];
  BUCKETS.forEach((b) => {
    out.push('**Bucket ' + b.n + ' — ' + b.years + ' · ' + b.role + '**');
    out.push('- Categories: ' + b.cats + '.');
    out.push('- Finowise schemes: ' + b.eg + '.');
    out.push('- Its job: ' + b.job + '.');
    out.push('');
  });
  out.push('**How it runs**');
  out.push('1. Size it: Bucket 1 = 2 years of expenses, Bucket 2 = the next 4 years, Bucket 3 = the rest of the corpus.');
  out.push('2. Income: a monthly SWP from Bucket 1 only.');
  out.push('3. Refill: every year (or after a good market year) STP from Bucket 2 into Bucket 1, and from Bucket 3 into Bucket 2 — never sell equity in a fall to pay expenses.');
  out.push('4. Review once a year at the annual review (ARC / RMS) and rebalance a bucket that has drifted from its size.');
  out.push('5. Pick the exact schemes for the client’s ISEQ risk profile from the Finowise Fund Basket (ask "fund basket for a moderate investor, 5–7 years").');
  return out.join('\n');
}

/* ---- the Fund Basket: risk profile × horizon ---- */
const PROFILES = BASKET.profiles.map((p) => p.profile);
const HORIZONS = BASKET.horizons;
const HORIZON_SHORT = { 'Less than 1 Year': '<1Y', '1-3 Years': '1–3Y', '3-5 Years': '3–5Y', '5-7 Years': '5–7Y', '7-10 Years': '7–10Y', '10-12 Years': '10–12Y', 'Greater than 12 Years': '>12Y' };
function profileIn(q) {
  const t = squash(q);
  const order = ['moderately conservative', 'moderately agresive', 'moderate conservative', 'moderate agresive', 'conservative', 'agresive', 'moderate'];
  const map = { 'moderately conservative': 'Moderately Conservative', 'moderate conservative': 'Moderately Conservative', 'moderately agresive': 'Moderately Aggressive',
    'moderate agresive': 'Moderately Aggressive', conservative: 'Conservative', agresive: 'Aggressive', moderate: 'Moderate' };
  const w = t.split(' ');
  for (const k of order) if (hasPhrase(w, k)) return map[k];
  return '';
}
function horizonIn(q) {
  const t = String(q || '').toLowerCase();
  if (/(less than|under|below|within|<)\s*1\s*(y|yr|year|saal)|\b(few|6)\s*months?\b/.test(t)) return HORIZONS[0];
  if (/(more than|above|over|greater than|beyond|>)\s*12|\b12\s*\+/.test(t)) return HORIZONS[6];
  const r = t.match(/\b(\d{1,2})\s*(?:-|to|–|se)\s*(\d{1,2})\s*(?:y|yr|yrs|years?|saal)\b/);
  const one = t.match(/\b(\d{1,2})\s*\+?\s*(?:y|yr|yrs|years?|saal)\b/);
  const n = r ? Number(r[2]) : one ? Number(one[1]) : NaN;
  if (!isFinite(n)) return '';
  if (n < 1) return HORIZONS[0];
  if (n <= 3) return HORIZONS[1];
  if (n <= 5) return HORIZONS[2];
  if (n <= 7) return HORIZONS[3];
  if (n <= 10) return HORIZONS[4];
  if (n <= 12) return HORIZONS[5];
  return HORIZONS[6];
}
const cellLine = (c) => 'Equity ' + c.equity + ' / Debt ' + c.debt + ' — ' + c.schemes.map((s) => s[0].replace(/ Reg Gr$/, '') + ' ' + s[1] + '%').join(', ');
function basketText(q) {
  const prof = profileIn(q), hor = horizonIn(q);
  const head = '**Finowise Advisor Recommended Fund Basket** (' + BASKET.source.title.replace(/^Mutual Fund Basket - /, '') + ', ' + BASKET.source.plan + ' plan, ' + BASKET.source.option + ' option):';
  const out = [head];
  if (prof && hor) {
    const c = BASKET.profiles.find((p) => p.profile === prof).cells.find((x) => x.horizon === hor);
    out.push('', '**' + prof + ' · ' + hor + '**: ' + cellLine(c) + '.');
  } else if (prof) {
    out.push('', '**' + prof + '** investor, by horizon:');
    BASKET.profiles.find((p) => p.profile === prof).cells.forEach((c) => out.push('- ' + HORIZON_SHORT[c.horizon] + ': ' + cellLine(c)));
  } else if (hor) {
    out.push('', '**' + hor + '**, by risk profile:');
    BASKET.profiles.forEach((p) => out.push('- ' + p.profile + ': ' + cellLine(p.cells.find((c) => c.horizon === hor))));
  } else {
    out.push('- Risk profiles: ' + PROFILES.join(', ') + '.');
    out.push('- Horizons: ' + HORIZONS.map((h) => HORIZON_SHORT[h]).join(', ') + '.');
    out.push('- Each cell gives the target Equity / Debt mix and the share of the investment for each scheme. For example:');
    out.push('  - Moderate · 5–7Y: ' + cellLine(BASKET.profiles.find((p) => p.profile === 'Moderate').cells.find((c) => c.horizon === '5-7 Years')) + '.');
    out.push('  - Aggressive · >12Y: ' + cellLine(BASKET.profiles.find((p) => p.profile === 'Aggressive').cells.find((c) => c.horizon === 'Greater than 12 Years')) + '.');
    out.push('- Ask with the client’s ISEQ risk profile and goal horizon (e.g. "fund basket for moderately aggressive, 7–10 years") for the exact cell.');
  }
  out.push('', 'The bracketed % is the suggested share of the investment for that scheme; ' + BASKET.source.note.split(';')[0].toLowerCase() + '.');
  return out.join('\n');
}

/* ---- the recommended scheme list, 18 categories ---- */
const CATEGORIES = [
  ['Liquid, Overnight & Money Market', 'ICICI Pru Liquid, ABSL Liquid, HDFC Money Market'],
  ['Ultra Short Duration', 'ICICI Pru Ultra Short Term, HDFC Ultra Short Term'],
  ['Arbitrage', 'ABSL Arbitrage, Bandhan Arbitrage, Mirae Asset Arbitrage'],
  ['Short Duration', 'ICICI Pru Short Term, HDFC Short Term Debt'],
  ['Corporate Bond', 'ABSL Corporate Bond, HDFC Corporate Bond'],
  ['Banking & PSU', 'Kotak Banking & PSU Debt, HDFC Banking & PSU Debt'],
  ['Gilt', 'HDFC Gilt, SBI Magnum Gilt'],
  ['Dynamic Bond (All Seasons)', 'ICICI Pru All Seasons Bond'],
  ['Equity Savings / Conservative Hybrid', 'HDFC Equity Savings, SBI Equity Savings, Kotak Equity Savings'],
  ['Balanced Advantage', 'HDFC Balanced Advantage, ICICI Pru Balanced Advantage'],
  ['Multi-Asset Allocation', 'DSP Multi Asset Allocation, HDFC Multi-Asset, Nippon India Multi Asset, ICICI Pru Multi Asset'],
  ['Aggressive Hybrid', 'ICICI Pru Equity & Debt, Kotak Aggressive Hybrid'],
  ['Large Cap', 'ICICI Pru Large Cap, Nippon India Large Cap, HDFC Large Cap'],
  ['Flexi Cap', 'Parag Parikh Flexi Cap, HDFC Flexi Cap, Bandhan Flexi Cap, SBI Flexi Cap'],
  ['Large & Mid Cap', 'ICICI Pru Large & Mid Cap, Bandhan Large & Mid Cap, Kotak Large & Mid Cap'],
  ['Multi Cap', 'Nippon India Multi Cap, Invesco India Multi Cap, Kotak Multi Cap'],
  ['Mid & Small Cap', 'HSBC Midcap, HDFC Mid Cap, Bandhan Small Cap, HDFC Small Cap'],
  ['Value / Contra', 'DSP Value, HDFC Value, ICICI Pru Value Discovery, Kotak Contra'],
];
function schemeListText() {
  const out = ['**Finowise recommended scheme list — ' + CATEGORIES.length + ' categories** (Regular plan, Growth):'];
  CATEGORIES.forEach(([c, s], i) => out.push((i + 1) + '. **' + c + '**: ' + s));
  out.push('', 'Drawn from the November 2026 Fund Basket, the MF Recommendation Master (Final v1) and the 3-bucket list. Match the category to the client’s risk profile and horizon first; confirm the scheme against the latest master before recommending.');
  return out.join('\n');
}

/* ---- core advisory topics ---- */
const TOPICS = [
  { id: 'stp-swp', words: ['stp', 'swp', 'systematic transfer', 'systematic withdrawal', 'withdrawal plan', 'transfer plan'], text: [
    '**STP and SWP**',
    '- **STP (Systematic Transfer Plan)**: park a lump sum in a liquid / ultra short / arbitrage fund and move a fixed amount into equity every week or month (typically 6–12 months; shorter when markets are cheap, longer when they are expensive). It averages the entry and keeps the money earning meanwhile.',
    '- **SWP (Systematic Withdrawal Plan)**: a fixed monthly (or quarterly) payout from a fund — the income engine of the 3-bucket strategy (run from Bucket 1). Keep the withdrawal rate around 4–6% a year of the corpus so it lasts.',
    '- Tax: each STP/SWP instalment is a redemption, taxed as capital gains on that instalment only; withdrawals inside 12 months of purchase (equity) are short-term.',
    '- In BOSS: set them up in the Transaction Tracker; check the bank mandate first.'] },
  { id: 'allocation', words: ['asset allocation', 'allocation', 'equity debt mix', 'equity debt ratio'], text: [
    '**Asset allocation (Finowise model)**',
    '- 3-asset model (Equity / Debt / Gold): Conservative 28/61/11, Moderate 55/31/14, Aggressive 75/14/11.',
    '- Equity range allowed: Conservative 10–40%, Moderate 20–80%, Aggressive 40–100%; gold 0–25% for all.',
    '- The client’s ISEQ risk profile sets the band; the goal’s horizon sets where in it (short goals are debt-heavy whatever the profile — see the Fund Basket).'] },
  { id: 'rebalance', words: ['rebalance', 'rebalancing', 'rebalanc', 'drift'], text: [
    '**Rebalancing**',
    '- Review at every scheduled review, and on an event: a goal change, a life event, a sharp market move.',
    '- Rebalance when an asset class drifts more than about 5 percentage points from its target, or when a goal comes within 2–3 years (move it to debt step by step by STP).',
    '- Do it tax-first: use fresh SIPs and new money before selling; sell long-term holdings within the yearly LTCG exemption; avoid short-term sales and exit loads.',
    '- Write the rationale against the recommendation (BOSS keeps it with the review).'] },
  { id: 'goals', words: ['goal planning', 'goal based', 'goal-based', '7 events', 'seven events', 'gab', 'fsl', 'financial planning'], text: [
    '**Goal planning at Finowise** — four blueprints, each with its own module in BOSS:',
    '- **7 Events — Comprehensive Freedom Blueprint**: the whole of a family\u2019s finances, event by event, from the family\u2019s own figures (any age).',
    '- **GAB — Golden Age Blueprint**: retirement income, bucketed by when it is needed (the 3-bucket strategy in practice).',
    '- **FSL — Financial Success Ladder**: six levels of wealth, and what reaching the chosen rung takes.',
    '- **Goal Based Investment**: several goals at once, plus financial freedom — each goal\u2019s cost today, years to go, inflation, and the SIP or lump sum it needs.',
    '- Then each goal\u2019s horizon picks its fund mix (Fund Basket by risk profile × horizon), and progress is reviewed goal by goal at every review.'] },
  { id: 'tax-harvest', words: ['tax harvesting', 'tax harvest', 'harvesting', 'ltcg', 'tax loss', 'capital gain'], text: [
    '**Tax harvesting**',
    '- Equity long-term gains (held over 12 months) are tax-free up to ₹1.25 lakh a financial year; above that, taxed at 12.5%. Short-term equity gains are taxed at 20%.',
    '- **Gain harvesting**: before 31 March, redeem enough long-term units to book gains up to ₹1.25 lakh and reinvest at once — the cost goes up and future tax comes down.',
    '- **Loss harvesting**: book losses to set off against gains (short-term losses against any gains; long-term only against long-term), carried forward 8 years if the return is filed in time.',
    '- Mind exit loads and the switch counting as a redemption; check the client’s capital gains statement first. (Rates as set in the July 2024 Budget: confirm the current year’s rules before advising.)'] },
  { id: 'lamf', words: ['lamf', 'la mf', 'loan against mutual', 'loan against mf', 'loan on mutual', 'loan against fund', 'loan against units', 'loan against'], text: [
    '**Loan against mutual funds (LAMF)**',
    '- The client pledges units (marked as a lien with CAMS / KFintech) instead of redeeming them; the investment keeps growing and no capital gains tax arises.',
    '- Typical loan-to-value: about 45–50% for equity funds, 75–80% for debt funds; usually an overdraft line, interest only on what is drawn.',
    '- Good for a short-term need; if markets fall the lender can ask for more units or repayment. Units under lien cannot be redeemed or switched until it is released.'] },
  { id: 'transfer', words: ['transfer of units', 'unit transfer', 'transfer units', 'transmission', 'transfer the units', 'units transfer'], text: [
    '**Transfer of units and transmission**',
    '- **Transfer** (living holder to another person): units held in demat move by an off-market transfer (DIS slip); units held in statement (SOA) form can be transferred through the RTA’s online transfer facility (CAMS / KFintech) — the receiver needs KYC and a folio in the same scheme or an AMC account.',
    '- **Transmission** (on a holder’s death): the nominee, joint holder or legal heir submits the transmission request form, the death certificate, their own KYC and bank proof; without a nominee, legal-heir documents are needed as well.',
    '- Log the request in QMS and track it to the RTA’s confirmation.'] },
  { id: 'huf', words: ['huf', 'huff', 'hindu undivided family', 'huf account', 'huf folio'], text: [
    '**HUF (Hindu Undivided Family)**',
    '- A separate PAN and tax entity: its own basic exemption and slab, and its own ₹1.25 lakh equity LTCG allowance — about ₹15,625 more tax saved a year when gains are harvested in both names.',
    '- Pools family income and assets under a karta (the eldest member, or a woman karta), with the members as coparceners; needs an HUF deed, PAN, bank account and KYC for the HUF.',
    '- Fund it with ancestral or inherited assets, or gifts from relatives outside the HUF: gifts from members into it are clubbed back to them.',
    '- Open separate HUF folios; nominations are not allowed on HUF folios, so record the succession plan in the HUF deed.'] },
  { id: 'legacy', words: ['trust and legacy', 'legacy', 'family trust', 'private trust', 'private family trust', 'succession', 'estate planning', 'make a will', 'registered will', 'will and nomination'], text: [
    '**Trust & legacy planning**',
    '- 100% nomination on every folio, demat and bank account; for joint folios, “Anyone or Survivor”.',
    '- A registered Will naming an executor and every asset; review it after any life event.',
    '- A Private Family Trust where assets need protection from creditors or continuity for a minor or a special-needs dependant; the trustee runs it by the trust deed.',
    '- Keep a family asset register (folios, policies, accounts) with the Will so transmission is quick.'] },
  { id: 'risk-measures', words: ['sharpe', 'sharpe ratio', 'beta', 'standard deviation', 'std dev', 'volatility', 'sigma'], text: [
    '**Risk measures**',
    '- **Standard deviation (σ)**: how far returns swing around the average in a year; about two years in three fall within μ ± σ.',
    '- **Sharpe ratio** = (portfolio return − risk-free rate) ÷ σ: return earned per unit of risk; above 0.5 is reasonable, above 1 is good.',
    '- **Beta (β)**: how much the portfolio moves with the Nifty 50; 1 moves with it, 0.5 half as much, 0 not at all.',
    '- Read them against the client\u2019s risk profile (ISEQ): a portfolio riskier than the profile allows is a rebalance.'] },
  { id: 'qms-escalation', words: ['escalation', 'escalate', 'escalation matrix', 'qms escalation', 'complaint escalation'], text: [
    '**QMS escalation path**',
    '- Every client query or complaint is logged in QMS with a category and priority; the owner must respond within the first-response SLA set in Setup → Queries.',
    '- If the SLA is missed, BOSS escalates it to the role named in that SLA rule (Setup → SLA rules). The usual ladder: RM → Branch Head → Operations / Compliance → Principal Officer.',
    '- A complaint that is still unresolved goes to the AMC / RTA, and the client may take it to SEBI SCORES; record each step in the query’s replies.'] },
];

/* What the firm's view says about this question, or ''. */
function knowledgeFor(question) {
  const q = String(question || '');
  if (!q.trim()) return '';
  const w = squash(q).split(' ');
  const parts = [];
  const bucket = any(w, ['bucket', 'bucket strategy', '3 bucket', 'three bucket', 'retirement bucket']);
  if (bucket) parts.push(bucketText(q));
  const list = any(w, ['scheme list', 'recommended scheme', 'recommended schemes', '18 category', '18 categories', 'category wise fund', 'category wise scheme', 'all categories']);
  const basket = any(w, ['fund basket', 'basket', 'recommended fund', 'recommended funds', 'which fund', 'which funds', 'best fund', 'best funds', 'kaunsa fund', 'konsa fund',
    'kon sa fund', 'kaun sa fund', 'suggest fund', 'suggest funds', 'fund suggestion', 'fund recommendation', 'fund recommendations', 'where to invest', 'kahan invest', 'kaha invest'])
    || (!bucket && !!profileIn(q) && any(w, ['fund', 'funds', 'scheme', 'schemes', 'portfolio', 'invest']));
  if (list) parts.push(schemeListText());
  if (basket && !list && !bucket) parts.push(basketText(q));
  TOPICS.forEach((t) => { if (any(w, t.words)) parts.push(t.text.join('\n')); });
  return parts.join('\n\n');
}

module.exports = { knowledgeFor, bucketText, basketText, schemeListText, profileIn, horizonIn, squash, near, CATEGORIES, BUCKETS };

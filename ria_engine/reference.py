"""The firm's reference data, read once: the quartile ranking sheet and the fund basket.

Both already live in the repo and the browser reads the same files:
  public/ria-quartiles.js   window.RIA_QUARTILES = {years, latestLabel, source, rows: [[name, aum, launch, ranks, section], …]}
  ria-fund-basket.json      {source, horizons, profiles: [{profile, cells: [{horizon, equity, debt, schemes: [[name, pct], …]}]}]}

The matching mirrors the page (riaQFind / riaQRecord / riaQBestOf in index.html):
a holding meets a sheet row by its name's words — the sheet's abbreviations
written out, plan words dropped — at Jaccard ≥ 0.75, and only where both
names point at the same category.
"""
import json
import os
import re

from . import classify

ROOT = os.environ.get('RIA_ENGINE_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

LEXI_ALIAS = [(r'\babsl\b', 'aditya birla sun life'), (r'\bpru\b', 'prudential'), (r'\beq\b', 'equity'), (r'\bbaf\b', 'balanced advantage'),
              (r'\bflexicap\b', 'flexi cap'), (r'\bmidcap\b', 'mid cap'), (r'\bsmallcap\b', 'small cap'), (r'\blargecap\b', 'large cap'),
              (r'\bmulticap\b', 'multi cap'), (r'\bpsu\b', 'psu')]
LEXI_DROP = {'fund', 'plan', 'option', 'growth', 'direct', 'regular', 'the', 'india', 'scheme', 'idcw', 'payout', 'reinvestment', 'of', 'marked', 'a', 'c'}
Q_DROP = {'reg', 'gr', 'dir', 'pl', 'fund', 'plan', 'growth', 'opt', 'option', 'direct', 'regular', 'retail', 'institutional', 'inst'}
Q_EXPAND = [(r'\badvtg\b|\badvg\b', 'advantage'), (r'\bcorp\b', 'corporate'), (r'\bopps?\b|\boppor\w*\b|\bopport\w*\b', 'opportunities'),
            (r'\bdyn\b', 'dynamic'), (r'\bgovt\b', 'government'), (r'\bbal\b', 'balanced'), (r'\bbalance\b', 'balanced'), (r'\bhyb\b', 'hybrid'),
            (r'\binfra\b', 'infrastructure'), (r'\bbluechip\b|\bblue chip\b', 'large cap'), (r'\bsav\b', 'savings'), (r'\bst\b', 'short term'),
            (r'\bmidcap\b', 'mid cap'), (r'\bsmallcap\b', 'small cap'), (r'\blargecap\b', 'large cap')]
Q_SHORT = ['—', 'Top', 'UM', 'LM', 'Bottom']


def lexi_tokens(name):
    t = ' ' + re.sub(r'[^a-z0-9]+', ' ', re.sub(r'&', ' and ', re.sub(r'\(.*?\)', ' ', str(name or '').lower()))) + ' '
    for pat, to in LEXI_ALIAS:
        t = re.sub(pat, to, t)
    return [w for w in t.split() if w and w not in LEXI_DROP]


def q_expand(name):
    t = ' ' + str(name or '').lower().replace('&', ' and ') + ' '
    for pat, to in Q_EXPAND:
        t = re.sub(pat, to, t)
    return t.strip()


def q_tokens(name):
    return [w for w in lexi_tokens(q_expand(name)) if w not in Q_DROP]


def short_fund(name):
    t = re.sub(r'\s+', ' ', re.sub(r'ICICI Prudential', 'ICICI Pru', re.sub(r'\(.*?\)', ' ', str(name or '')), flags=re.I)).strip()
    for _ in range(4):
        t = re.sub(r'\s+(fund|reg(ular)?|dir(ect)?|gr(owth)?|plan|pl|option|opt)$', '', t, flags=re.I).strip()
    return t


class Quartiles:
    """The quartile ranking sheet, indexed: rows with tokens and category, each section's category."""

    def __init__(self, data):
        self.years = data.get('years') or []
        self.latest = data.get('latestLabel') or (str(self.years[-1]) if self.years else '')
        self.source = data.get('source') or 'Firm Mutual Fund Quartile Ranking Sheet'
        self.rows = []
        for name, aum, launch, ranks, sec in data.get('rows') or []:
            self.rows.append({'name': name, 'aum': float(aum or 0), 'launch': launch, 'ranks': [int(c) for c in str(ranks)],
                              'sec': sec, 'toks': set(q_tokens(name)), 'cat': classify.category_of(q_expand(name))})
        by_sec = {}
        for r in self.rows:
            by_sec.setdefault(r['sec'], []).append(r)
        self.by_sec = by_sec
        self._memo = {}
        self.sec_cat = {}
        for sec, lst in by_sec.items():
            n = {}
            for r in lst:
                if r['cat']:
                    n[r['cat']['id']] = n.get(r['cat']['id'], 0) + 1
            if n:
                top = max(n, key=n.get)
                if n[top] >= len(lst) * 0.4:
                    self.sec_cat[sec] = top

    def year(self, i):
        return self.latest if i == len(self.years) - 1 else str(self.years[i])

    def find(self, name):
        key = str(name or '')
        if key in self._memo:
            return self._memo[key]
        self._memo[key] = r = self._find(key)
        return r

    def _find(self, name):
        t = set(q_tokens(name))
        if not t:
            return None
        hc = classify.category_of(q_expand(name))
        best, best_score = None, 0
        for r in self.rows:
            inter = len(t & r['toks'])
            if not inter:
                continue
            jac = inter / (len(t) + len(r['toks']) - inter)
            if jac < 0.75:
                continue
            rc = r['cat']['id'] if r['cat'] else self.sec_cat.get(r['sec'])
            if hc and rc and hc['id'] != rc:
                continue
            score = jac * 100 + len([x for x in r['ranks'] if x]) + min(1, r['aum'] / 1e5)
            if score > best_score:
                best, best_score = r, score
        return best

    def record(self, r):
        n = len(self.years)
        last5, last3 = r['ranks'][n - 5:], r['ranks'][n - 3:]
        yrs = [self.year(n - 5 + i) for i in range(len(last5))]
        return {'last5': last5, 'last3': last3, 'ranked': len([x for x in r['ranks'] if x]), 'latest': r['ranks'][n - 1] if r['ranks'] else 0,
                'good5': len([x for x in last5 if x in (1, 2)]), 'bottom3': len([x for x in last3 if x == 4]), 'weak3': len([x for x in last3 if x in (3, 4)]),
                'text': ' · '.join(yrs[i] + ' ' + Q_SHORT[x] for i, x in enumerate(last5)), 'years': yrs}

    def best_of(self, sec, except_name=None):
        lst = []
        for r in self.by_sec.get(sec, []):
            if r['name'] == except_name:
                continue
            rec = self.record(r)
            if len([x for x in rec['last5'] if x]) >= 4 and rec['bottom3'] < 2:
                lst.append((r, rec))
        lst.sort(key=lambda x: (-x[1]['good5'], x[1]['latest'] or 9, -x[0]['aum']))
        return lst[0] if lst else None

    def best_of_cat(self, cat_id):
        secs = [s for s, c in self.sec_cat.items() if c == cat_id]
        found = [b for b in (self.best_of(s) for s in secs) if b]
        found.sort(key=lambda x: (-x[1]['good5'], -x[0]['aum']))
        return found[0] if found else None


def _load_js_object(path, prefix):
    with open(path, encoding='utf-8') as f:
        s = f.read()
    i = s.index(prefix) + len(prefix)
    j = s.rindex('}') + 1
    return json.loads(s[i:j].strip().lstrip('='))


_cache = {}


def quartiles():
    if 'q' not in _cache:
        path = os.path.join(ROOT, 'public', 'ria-quartiles.js')
        try:
            _cache['q'] = Quartiles(_load_js_object(path, 'window.RIA_QUARTILES'))
        except (OSError, ValueError):
            _cache['q'] = None
    return _cache['q']


def basket():
    if 'b' not in _cache:
        try:
            with open(os.path.join(ROOT, 'ria-fund-basket.json'), encoding='utf-8') as f:
                _cache['b'] = json.load(f)
        except (OSError, ValueError):
            _cache['b'] = None
    return _cache['b']

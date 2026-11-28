"""Scheme classification for the RIA engine, ported from public/index.html.

Mirrors, in the page:
  LEXI_ALIAS / LEXI_DROP / lexiTokens   -> lexi_tokens()
  LEXI_CATS / lexiCategoryOf            -> LEXI_CATS / lexi_category_of()
  RIA_THEMATIC / riaCategoryOf          -> THEMATIC / category_of()
  riaClassOf                            -> asset_class_of()
  RIA_AMCS / riaAmcOf                   -> AMCS / amc_of()
  RIA_CLASSES, RIA_CAT_RISK, RIA_SLEEVE_CLASS, RIA_MA_CLASS
                                        -> CLASSES, CAT_RISK, SLEEVE_CLASS, MA_CLASS

Standard library only; every function is pure.
"""
import re

# ---------------------------------------------------------------------------
# JavaScript-compatible string helpers (shared with normalize.py)
# ---------------------------------------------------------------------------


def js_truthy(v):
    """JavaScript truthiness: None, False, 0, NaN and '' are falsy; [] and {} are truthy."""
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v == v and v != 0
    if isinstance(v, str):
        return len(v) > 0
    return True


def js_or(*vals):
    """JavaScript `a || b || c`: the first truthy value, else the last one."""
    for v in vals:
        if js_truthy(v):
            return v
    return vals[-1] if vals else None


def js_str(v):
    """JavaScript String(v) for JSON-shaped values (None -> 'null')."""
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if v != v:
            return 'NaN'
        if v in (float('inf'), float('-inf')):
            return 'Infinity' if v > 0 else '-Infinity'
        if v.is_integer() and abs(v) < 1e21:
            return str(int(v))
        return repr(v)
    if isinstance(v, str):
        return v
    if isinstance(v, (list, tuple)):
        return ','.join('' if x is None else js_str(x) for x in v)
    if isinstance(v, dict):
        return '[object Object]'
    return str(v)


def js_s(v):
    """JavaScript String(v || ''): '' for any falsy value."""
    return js_str(v) if js_truthy(v) else ''


# ---------------------------------------------------------------------------
# Tokens and the firm's category list (LEXI_CATS)
# ---------------------------------------------------------------------------

LEXI_ALIAS = [
    (re.compile(r'\babsl\b'), 'aditya birla sun life'),
    (re.compile(r'\bpru\b'), 'prudential'),
    (re.compile(r'\beq\b'), 'equity'),
    (re.compile(r'\bbaf\b'), 'balanced advantage'),
    (re.compile(r'\bflexicap\b'), 'flexi cap'),
    (re.compile(r'\bmidcap\b'), 'mid cap'),
    (re.compile(r'\bsmallcap\b'), 'small cap'),
    (re.compile(r'\blargecap\b'), 'large cap'),
    (re.compile(r'\bmulticap\b'), 'multi cap'),
    (re.compile(r'\b360 one\b'), '360 one'),
    (re.compile(r'\bpsu\b'), 'psu'),
]
LEXI_DROP = frozenset(['fund', 'plan', 'option', 'growth', 'direct', 'regular', 'the', 'india', 'scheme', 'idcw',
                       'payout', 'reinvestment', 'of', 'marked', 'a', 'c'])

_PARENS = re.compile(r'\(.*?\)')
_NON_ALNUM = re.compile(r'[^a-z0-9]+')


def lexi_tokens(name):
    """Mirrors lexiTokens(): lower case, drop (...) parts, '&' -> 'and', aliases, drop filler words."""
    t = ' ' + _NON_ALNUM.sub(' ', _PARENS.sub(' ', js_s(name).lower()).replace('&', ' and ')) + ' '
    for rx, to in LEXI_ALIAS:
        t = rx.sub(to, t)
    return [w for w in t.strip().split() if w and w not in LEXI_DROP]


# id, label, words that place a scheme in it, [equity, debt, gold] mix. Order matters: first match wins.
LEXI_CATS = [
    {'id': 'gold', 'label': 'Gold', 'words': ['gold'], 'mix': [0, 0, 1]},
    {'id': 'arbitrage', 'label': 'Arbitrage', 'words': ['arbitrage'], 'mix': [0, 1, 0]},
    {'id': 'multi asset', 'label': 'Multi asset', 'words': ['multi asset'], 'mix': [0.4, 0.45, 0.15]},
    {'id': 'baf', 'label': 'BAF (balanced advantage)', 'words': ['balanced advantage', 'dynamic asset allocation'], 'mix': [0.5, 0.5, 0]},
    {'id': 'equity savings', 'label': 'Equity savings', 'words': ['equity savings'], 'mix': [0.35, 0.65, 0]},
    {'id': 'aggressive hybrid', 'label': 'Aggressive hybrid',
     'words': ['aggressive hybrid', 'equity and debt', 'equity hybrid', 'hybrid equity'], 'mix': [0.7, 0.3, 0]},
    {'id': 'large and mid', 'label': 'Large & mid cap', 'words': ['large and mid', 'large mid'], 'mix': [1, 0, 0]},
    {'id': 'large cap', 'label': 'Large cap', 'words': ['large cap', 'bluechip', 'top 100'], 'mix': [1, 0, 0]},
    {'id': 'mid cap', 'label': 'Mid cap', 'words': ['mid cap'], 'mix': [1, 0, 0]},
    {'id': 'small cap', 'label': 'Small cap', 'words': ['small cap'], 'mix': [1, 0, 0]},
    {'id': 'flexi cap', 'label': 'Flexi cap', 'words': ['flexi cap'], 'mix': [1, 0, 0]},
    {'id': 'multi cap', 'label': 'Multi cap', 'words': ['multi cap'], 'mix': [1, 0, 0]},
    {'id': 'focused', 'label': 'Focused equity', 'words': ['focused'], 'mix': [1, 0, 0]},
    {'id': 'value', 'label': 'Value', 'words': ['value'], 'mix': [1, 0, 0]},
    {'id': 'contra', 'label': 'Contra', 'words': ['contra'], 'mix': [1, 0, 0]},
    {'id': 'elss', 'label': 'ELSS/tax saver', 'words': ['elss', 'tax saver', 'tax relief', 'long term equity'], 'mix': [1, 0, 0]},
    {'id': 'liquid', 'label': 'Liquid', 'words': ['liquid', 'overnight'], 'mix': [0, 1, 0]},
    {'id': 'ultra short', 'label': 'Ultra short', 'words': ['ultra short'], 'mix': [0, 1, 0]},
    {'id': 'money market', 'label': 'Money market', 'words': ['money market'], 'mix': [0, 1, 0]},
    {'id': 'low duration', 'label': 'Low duration', 'words': ['low duration'], 'mix': [0, 1, 0]},
    {'id': 'short term', 'label': 'Short term', 'words': ['short term', 'short duration'], 'mix': [0, 1, 0]},
    {'id': 'medium duration', 'label': 'Medium duration', 'words': ['medium duration', 'medium term'], 'mix': [0, 1, 0]},
    {'id': 'floater', 'label': 'Floater', 'words': ['floater', 'floating rate'], 'mix': [0, 1, 0]},
    {'id': 'dynamic bond', 'label': 'Dynamic bond', 'words': ['dynamic bond'], 'mix': [0, 1, 0]},
    {'id': 'corporate bond', 'label': 'Corporate bond', 'words': ['corporate bond'], 'mix': [0, 1, 0]},
    {'id': 'banking psu', 'label': 'Banking & PSU', 'words': ['banking and psu', 'banking psu'], 'mix': [0, 1, 0]},
    {'id': 'credit risk', 'label': 'Credit risk', 'words': ['credit risk'], 'mix': [0, 1, 0]},
    {'id': 'gilt', 'label': 'Gilt', 'words': ['gilt'], 'mix': [0, 1, 0]},
    {'id': 'index', 'label': 'Index/ETF (equity)', 'words': ['nifty', 'sensex', 'index', 'etf'], 'mix': [1, 0, 0]},
]


def _cat_copy(c):
    return {'id': c['id'], 'label': c['label'], 'mix': list(c['mix'])}


def lexi_category_of(name):
    """Mirrors lexiCategoryOf(): the first LEXI_CATS entry with a word in the scheme's tokens, or None."""
    t = ' ' + ' '.join(lexi_tokens(name)) + ' '
    for c in LEXI_CATS:
        if any((' ' + w + ' ') in t for w in c['words']):
            return _cat_copy(c)
    return None


# ---------------------------------------------------------------------------
# RIA AI: category, asset class, AMC
# ---------------------------------------------------------------------------

CLASSES = ['Equity', 'Debt', 'Hybrid', 'Gold/Commodities', 'Liquid/Cash', 'Unclassified']

# [expected return %, standard deviation %, beta to Nifty 50] by category id ('_X' = fallback by class).
CAT_RISK = {
    'large cap': [12, 16, 0.95], 'index': [12, 16, 1], 'flexi cap': [13, 17, 0.95], 'multi cap': [13.5, 18, 1],
    'large and mid': [13.5, 18, 1], 'focused': [13, 18, 1], 'value': [13, 18, 0.95], 'contra': [13, 18, 0.95],
    'elss': [13, 17.5, 0.95], 'mid cap': [15, 22, 1.1], 'small cap': [16, 26, 1.2], 'thematic': [14, 24, 1.1],
    'aggressive hybrid': [11, 12, 0.7], 'baf': [9.5, 8, 0.45], 'multi asset': [10.5, 9, 0.5], 'equity savings': [8.5, 5.5, 0.3],
    'arbitrage': [7, 1, 0.02], 'liquid': [6.8, 0.6, 0], 'ultra short': [7, 0.8, 0], 'money market': [7, 0.8, 0],
    'low duration': [7.2, 1.2, 0], 'short term': [7.4, 2, 0], 'floater': [7.4, 1.8, 0], 'corporate bond': [7.5, 2.2, 0],
    'banking psu': [7.4, 2.2, 0], 'medium duration': [7.6, 3, 0], 'dynamic bond': [7.6, 4, 0], 'gilt': [7.6, 5, 0],
    'credit risk': [8, 4, 0.05], 'gold': [10, 14, 0],
    '_Equity': [13, 18, 1], '_Debt': [7.3, 2, 0], '_Hybrid': [10, 10, 0.55], '_Gold': [10, 14, 0], '_Liquid': [6.8, 0.6, 0],
    '_Unclassified': [11, 14, 0.75],
}

THEMATIC = ['thematic', 'sectoral', 'infrastructure', 'infra', 'technology', 'tech', 'digital', 'pharma', 'healthcare',
            'consumption', 'banking and financial', 'financial services', 'psu equity', 'manufacturing', 'innovation',
            'momentum', 'esg', 'energy', 'auto', 'mnc', 'business cycle', 'special opportunities']

# Order matters: the first key the name equals or starts with wins ('quantum' before 'quant').
AMCS = [
    ('icici', 'ICICI Prudential'), ('hdfc', 'HDFC'), ('sbi', 'SBI'), ('absl', 'Aditya Birla Sun Life'),
    ('aditya birla', 'Aditya Birla Sun Life'), ('nippon', 'Nippon India'), ('kotak', 'Kotak'), ('axis', 'Axis'),
    ('dsp', 'DSP'), ('mirae', 'Mirae Asset'), ('parag parikh', 'PPFAS'), ('ppfas', 'PPFAS'), ('bandhan', 'Bandhan'),
    ('idfc', 'Bandhan'), ('invesco', 'Invesco'), ('hsbc', 'HSBC'), ('franklin', 'Franklin Templeton'), ('uti', 'UTI'),
    ('tata', 'Tata'), ('quantum', 'Quantum'), ('quant', 'Quant'), ('motilal', 'Motilal Oswal'), ('edelweiss', 'Edelweiss'),
    ('canara', 'Canara Robeco'), ('whiteoak', 'WhiteOak Capital'), ('bajaj', 'Bajaj Finserv'), ('360 one', '360 ONE'),
    ('sundaram', 'Sundaram'), ('mahindra', 'Mahindra Manulife'), ('pgim', 'PGIM India'), ('baroda', 'Baroda BNP Paribas'),
    ('lic', 'LIC'), ('union', 'Union'), ('jm', 'JM Financial'), ('navi', 'Navi'), ('groww', 'Groww'), ('zerodha', 'Zerodha'),
    ('iti', 'ITI'), ('samco', 'Samco'), ('helios', 'Helios'), ('old bridge', 'Old Bridge'), ('shriram', 'Shriram'),
]

# A platform sleeve's name -> asset class (RIA_SLEEVE_CLASS).
SLEEVE_CLASS = {'Equity': 'Equity', 'Debt': 'Debt', 'Structured': 'Hybrid', 'Hybrid': 'Hybrid', 'Gold': 'Gold/Commodities',
                'Commodity': 'Gold/Commodities', 'Commodities': 'Gold/Commodities', 'Liquid': 'Liquid/Cash', 'Cash': 'Liquid/Cash'}

# A multi-asset upload row's asset_class -> asset class (RIA_MA_CLASS).
MA_CLASS = {'Equity': 'Equity', 'Debt': 'Debt', 'Fixed Income': 'Debt', 'Bond': 'Debt', 'Bonds': 'Debt',
            'Gold': 'Gold/Commodities', 'Commodity': 'Gold/Commodities', 'Cash': 'Liquid/Cash', 'Hybrid': 'Hybrid'}

_AMC_JUNK = re.compile(r'[^a-z0-9 ]+')
_SPACES = re.compile(r'\s+')


def amc_of(name):
    """Mirrors riaAmcOf(): the AMC a scheme name starts with, or ''."""
    t = _SPACES.sub(' ', _AMC_JUNK.sub(' ', js_s(name).lower())).strip()
    for k, label in AMCS:
        if t == k or t.startswith(k + ' '):
            return label
    return ''


def category_of(name):
    """Mirrors riaCategoryOf(): the firm's list (lexiCategoryOf) first, then thematic names.

    Returns {"id", "label", "mix": [equity, debt, gold]} or None.
    """
    c = lexi_category_of(name)
    if c:
        return c
    t = ' ' + _NON_ALNUM.sub(' ', js_s(name).lower()) + ' '
    if any((' ' + w + ' ') in t for w in THEMATIC):
        return {'id': 'thematic', 'label': 'Thematic / sectoral', 'mix': [1, 0, 0]}
    return None


def asset_class_of(cat):
    """Mirrors riaClassOf(): a category dict -> one of CLASSES ('Unclassified' for None)."""
    if not cat:
        return 'Unclassified'
    cid = cat.get('id')
    mix = cat.get('mix')
    if cid == 'gold':
        return 'Gold/Commodities'
    if cid in ('liquid', 'ultra short', 'money market', 'overnight'):
        return 'Liquid/Cash'
    if cid in ('multi asset', 'baf', 'equity savings', 'aggressive hybrid', 'arbitrage'):
        return 'Hybrid'
    if mix and len(mix) > 0 and mix[0] >= 1:
        return 'Equity'
    if mix and len(mix) > 1 and mix[1] >= 1:
        return 'Debt'
    return 'Unclassified'

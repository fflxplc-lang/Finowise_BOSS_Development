"""One client's portfolio, read by RIA AI's Python engine — and the answer it writes itself.

Input: a person (normalize.people) and their positions (normalize.positions).
Output: a dict with the numbers (totals, asset mix, pillars, concentration,
duplicates, gains) and every holding's Hold / Reduce / Switch / Review with
its reason, plus `answer` — plain English Markdown, written from those
numbers only (nothing is invented; a figure that is not in the records is
not in the answer).

The four actions mirror the page (riaSchemeVerdict + riaHoldingAction):
  Switch  — Bottom quartile in 2 of the last 3 years, to the best fund of the same peer group;
  Reduce  — mid / small cap for a client 55+ (de-risk), or one holding above 25% of the portfolio;
  Hold    — Top / Upper Mid in 4 of the last 5 years and not Bottom in the latest;
  Review  — no scheme name, not in the sheet, too new, weak lately or a mixed record.
RIA AI never says Buy or Sell.
"""
import datetime

from . import classify
from . import reference

ACTIONS = ['Hold', 'Reduce', 'Switch', 'Review']
CONC_LIMIT = 25.0
LTCG_EXEMPT = 125000.0          # equity long-term gains exempt each year (₹1.25 lakh)
GOVERNANCE = 'RIA AI provides analytical suggestions; human advisor & client approval is mandatory before executing any transaction.'
CLASS_MIX = {'Equity': (1, 0, 0), 'Debt': (0, 1, 0), 'Liquid/Cash': (0, 1, 0), 'Hybrid': (0.5, 0.5, 0), 'Gold/Commodities': (0, 0, 1)}


def inr(v):
    """₹ in lakh / crore, the way the firm writes it."""
    v = float(v or 0)
    a = abs(v)
    if a >= 1e7:
        s = '%.2f Cr' % (v / 1e7)
    elif a >= 1e5:
        s = '%.2f L' % (v / 1e5)
    else:
        s = '{:,.0f}'.format(v)
    return '₹' + s


def no_name(n):
    t = str(n or '').strip().lower()
    return (not t or t in ('—', '-', 'unknown', 'na', 'n/a', 'nil', 'null') or t.startswith('unclassified')
            or t.endswith(('.pdf', '.xls', '.xlsx', '.csv')) or t.startswith('statement'))


def age_of(dob):
    s = str(dob or '')[:10]
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            d = datetime.datetime.strptime(s, fmt).date()
            t = datetime.date.today()
            return t.year - d.year - ((t.month, t.day) < (d.month, d.day))
        except ValueError:
            continue
    return None


def years_since(d):
    s = str(d or '')[:10]
    for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
        try:
            return (datetime.date.today() - datetime.datetime.strptime(s, fmt).date()).days / 365.25
        except ValueError:
            continue
    return None


def verdict(name, current, ctx, q=None):
    """One scheme's quartile verdict (riaSchemeVerdict)."""
    q = q if q is not None else reference.quartiles()
    cat = classify.category_of(reference.q_expand(name))
    mature = ctx.get('age') is not None and ctx['age'] >= 55
    mid_small = bool(cat and cat['id'] in ('mid cap', 'small cap'))
    base = {'category': cat['label'] if cat else '', 'record': '', 'target': None}
    r = q.find(name) if q else None

    def derisk(record):
        cb, baf = (q.best_of_cat('corporate bond'), q.best_of_cat('baf')) if q else (None, None)
        to = ' / '.join(x for x in [cb and reference.short_fund(cb[0]['name']), baf and reference.short_fund(baf[0]['name'])] if x) or 'Corporate Bond / Balanced Advantage'
        return dict(base, status='REDUCE', record=record, target=to,
                    why='%s volatility does not suit a near horizon (age %s)%s. Shift in stages to %s.' % (
                        (cat['label'] if cat else 'Mid / small cap'), ctx.get('age'), ('; record ' + record) if record else '', to))

    if not r:
        if mature and mid_small:
            return derisk('')
        return dict(base, status='REVIEW', not_in_sheet=True, why='Not in the firm’s quartile ranking sheet; review it against its category peers before acting.')
    rec = q.record(r)
    peer = q.best_of(r['sec'], r['name'])
    peer_txt = ('%s (Top / Upper Mid in %d of the last 5 years: %s)' % (peer[0]['name'], peer[1]['good5'], peer[1]['text'])) if peer else ''
    if rec['ranked'] < 3:
        return dict(base, status='REVIEW', record=rec['text'], why='Only %d ranked year(s) in the sheet (%s); too new to judge on consistency.' % (rec['ranked'], rec['text']))
    if rec['bottom3'] >= 2 and peer:
        return dict(base, status='SWITCH', record=rec['text'], target=peer[0]['name'],
                    why='Bottom quartile in %d of the last 3 years (%s). Switch to %s.' % (rec['bottom3'], rec['text'], peer_txt))
    if mature and mid_small:
        return derisk(rec['text'])
    if rec['bottom3'] == 1 or rec['weak3'] >= 2:
        return dict(base, status='REVIEW', record=rec['text'], target=peer[0]['name'] if peer else None,
                    why='%s. Weak in the last 3 years; review next quarter%s.' % (rec['text'], (' against ' + peer_txt) if peer else ''))
    if rec['good5'] >= 4 and rec['latest'] != 4:
        return dict(base, status='HOLD', record=rec['text'], why='%s. Consistently Top / Upper Mid in its peer group; retain.' % rec['text'])
    return dict(base, status='REVIEW', record=rec['text'],
                why='A mixed quartile record (%s); neither a clear hold nor a switch — review against %s.' % (rec['text'], peer_txt or 'its peers'))


def holding_action(p, weight, ctx, q=None):
    """One holding's action (riaHoldingAction, without the firm's recommended-list overlay)."""
    name = str(p.get('scheme') or '').strip()
    w = round(weight, 1)
    if no_name(name) or p.get('src') == 'sleeve':
        why = ('A platform total with no scheme behind it — upload the detailed holdings before acting.' if p.get('src') == 'sleeve'
               else 'No scheme / scrip name on this holding — identify it (contract notes, the statement) before any action.')
        return {'action': 'Review', 'why': why, 'weight_pct': w}
    v = verdict(name, p.get('current'), ctx, q)
    conc = w > CONC_LIMIT
    conc_txt = '%s%% of the portfolio in this one holding, above the %d%% limit' % (w, CONC_LIMIT)
    out = {'weight_pct': w, 'record': v.get('record', ''), 'category': v.get('category', ''), 'target': v.get('target')}
    if v['status'] in ('SWITCH', 'REDUCE'):
        return dict(out, action=v['status'].title(), why=v['why'] + ((' It is also ' + conc_txt + '.') if conc else ''))
    if conc:
        return dict(out, action='Reduce', why=conc_txt + ' — trim toward %d%% and spread the excess across category peers.' % CONC_LIMIT)
    if v['status'] == 'HOLD':
        return dict(out, action='Hold', why=v['why'])
    return dict(out, action='Review', why=v['why'])


def enrich(p):
    """A scheme the page's category words miss in its short form ("ICICI Pru Corp Bond Gr", "Balanced Advtg")
    is read again with the sheet's abbreviations written out — so its asset class counts in the mix."""
    if p.get('category') or p.get('src') == 'sleeve' or no_name(p.get('scheme')):
        return p
    cat = classify.category_of(reference.q_expand(p.get('scheme')))
    if not cat:
        return p
    q = dict(p)
    q['category'] = cat
    q['asset_class'] = classify.asset_class_of(cat)
    return q


def pillar_of(weight, current):
    if weight > 25:
        return 'Anchor'
    if weight >= 5:
        return 'Core'
    if weight >= 1 and current >= 50000:
        return 'Mid'
    return 'Micro-tail'


def analyze(person, positions, q=None):
    q = q if q is not None else reference.quartiles()
    ctx = {'age': age_of(person.get('dob'))}
    pos = [enrich(p) for p in positions if (p.get('current') or 0) > 0]
    total = sum(p['current'] for p in pos)
    invested = sum(p.get('invested') or 0 for p in pos)
    rows = []
    for p in sorted(pos, key=lambda x: -x['current']):
        w = p['current'] / total * 100 if total else 0
        a = holding_action(p, w, ctx, q)
        cat_label = (p.get('category') or {}).get('label') if isinstance(p.get('category'), dict) else (p.get('category') or '')
        row = dict(scheme=p.get('scheme'), current=round(p['current']), invested=round(p.get('invested') or 0),
                   asset_class=p.get('asset_class') or 'Unclassified', xirr=p.get('xirr'), folio=bool(p.get('folio')),
                   pillar=pillar_of(w, p['current']))
        row.update(a)
        row['category'] = cat_label or a.get('category') or ''
        rows.append(row)
    # asset mix: by class, and the equity / debt / gold look-through
    by_class = {}
    for r in rows:
        by_class[r['asset_class']] = by_class.get(r['asset_class'], 0) + r['current']
    look = [0.0, 0.0, 0.0]
    for p in pos:
        cat = p.get('category') if isinstance(p.get('category'), dict) else None
        mix = (cat or {}).get('mix') or CLASS_MIX.get(p.get('asset_class') or '')
        if mix:
            for i in range(3):
                look[i] += p['current'] * mix[i]
    classified = sum(look) or 1
    mix_pct = {'equity': round(look[0] / classified * 100, 1), 'debt': round(look[1] / classified * 100, 1), 'gold': round(look[2] / classified * 100, 1)}
    # duplicates: two or more funds in one category
    by_cat = {}
    for r in rows:
        if r['category'] and not no_name(r['scheme']):
            by_cat.setdefault(r['category'], []).append(r['scheme'])
    duplicates = {c: s for c, s in by_cat.items() if len(s) > 1 and c.lower() not in ('liquid', 'arbitrage')}
    # gains and the LTCG allowance (equity held over a year)
    gain = total - invested if invested else None
    lt_equity_gain = 0.0
    for p in pos:
        if (p.get('asset_class') == 'Equity') and (years_since(p.get('start')) or 0) > 1 and (p.get('invested') or 0) > 0:
            lt_equity_gain += max(0.0, p['current'] - p['invested'])
    counts = {a: len([r for r in rows if r['action'] == a]) for a in ACTIONS}
    tail = [r for r in rows if r['pillar'] == 'Micro-tail' and r['action'] != 'Hold']
    findings = []
    conc = [r for r in rows if r['weight_pct'] > CONC_LIMIT]
    if conc:
        findings.append('Concentration: %s holds %s%% of the portfolio (limit %d%%).' % (conc[0]['scheme'], conc[0]['weight_pct'], CONC_LIMIT))
    if duplicates:
        findings.append('Overlap: %d categor%s with more than one fund (%s).' % (len(duplicates), 'y' if len(duplicates) == 1 else 'ies',
                                                                                   '; '.join('%s: %d' % (c, len(s)) for c, s in list(duplicates.items())[:4])))
    if len(tail) >= 3:
        findings.append('Clutter: %d micro-tail holdings (under 1%% or under ₹50,000) add tracking work without moving the portfolio.' % len(tail))
    if by_class.get('Unclassified'):
        findings.append('%s is unclassified (no scheme-level detail) — the mix above leaves it out.' % inr(by_class['Unclassified']))
    if lt_equity_gain > LTCG_EXEMPT:
        findings.append('Tax: about %s of long-term equity gain, above the ₹1.25 lakh yearly exemption — harvest in stages across financial years.' % inr(lt_equity_gain))
    elif lt_equity_gain > 0:
        findings.append('Tax: about %s of long-term equity gain, within the ₹1.25 lakh yearly exemption — it can be booked tax-free this year.' % inr(lt_equity_gain))
    out = {'client': {'id': person.get('id'), 'name': person.get('name'), 'age': ctx['age'], 'risk_profile': person.get('risk_profile')},
           'total': round(total), 'invested': round(invested), 'gain': round(gain) if gain is not None else None,
           'gain_pct': round(gain / invested * 100, 1) if gain is not None and invested else None,
           'by_class': {k: round(v) for k, v in sorted(by_class.items(), key=lambda kv: -kv[1])},
           'mix': mix_pct, 'holdings': rows, 'counts': counts, 'duplicates': duplicates,
           'lt_equity_gain': round(lt_equity_gain), 'findings': findings,
           'source': q.source if q else 'Firm Mutual Fund Quartile Ranking Sheet (not loaded)', 'governance': GOVERNANCE}
    out['answer'] = write_answer(out)
    return out


def write_answer(a):
    """The engine's own words: a short Markdown read-out of the numbers above."""
    c = a['client']
    lines = ['**🧮 Portfolio analysis — %s**' % (c.get('name') or 'client'),
             'Computed by RIA AI\'s Python engine from the BOSS records%s.' % ((' · age %s' % c['age']) if c.get('age') is not None else '')]
    if not a['holdings']:
        lines.append('\nNo holdings with a current value are on the record for this client yet.')
        return '\n'.join(lines)
    g = ''
    if a.get('gain') is not None:
        g = ' · gain %s (%s%%)' % (inr(a['gain']), a['gain_pct'])
    lines.append('\n**Value %s** · invested %s%s · %d holding%s' % (inr(a['total']), inr(a['invested']), g, len(a['holdings']), '' if len(a['holdings']) == 1 else 's'))
    m = a['mix']
    lines.append('Mix (look-through): equity %s%% · debt %s%% · gold %s%%' % (m['equity'], m['debt'], m['gold']))
    cn = a['counts']
    lines.append('Actions: %d Hold · %d Reduce · %d Switch · %d Review' % (cn['Hold'], cn['Reduce'], cn['Switch'], cn['Review']))
    if a['findings']:
        lines.append('\n**What stands out**')
        lines += ['- ' + f for f in a['findings']]
    lines.append('\n| Scheme | Value | Weight | Action | Why |')
    lines.append('|---|---|---|---|---|')
    for r in a['holdings'][:25]:
        why = str(r['why']).replace('|', '/')
        lines.append('| %s | %s | %s%% | %s | %s |' % (str(r['scheme']).replace('|', '/'), inr(r['current']), r['weight_pct'], r['action'], why))
    if len(a['holdings']) > 25:
        lines.append('\n…and %d more holdings.' % (len(a['holdings']) - 25))
    lines.append('\nSource: %s. %s' % (a['source'], a['governance']))
    return '\n'.join(lines)

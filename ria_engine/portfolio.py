"""Model portfolios and rebalancing, from the firm's fund basket.

build(profile, horizon, lumpsum, sip)
    The basket cell for that risk profile and horizon (ria-fund-basket.json,
    the November 2026 refresh): its equity / debt mix and its schemes, each
    with its share — turned into rupee amounts for the lumpsum and the SIP.

rebalance(analysis, profile, horizon)
    The client's look-through equity / debt today (analysis.analyze) against
    that cell's target: how far off it is, how much to move which way, which
    holdings to take it from (Switch and Reduce first, then the largest on the
    heavy side) and which basket schemes to put it in. Moves are suggestions in
    the firm's four words — never Buy / Sell — and need adviser and client
    approval.
"""
from . import analysis as an
from . import reference

PROFILE_WORDS = [('moderately aggressive', 'Moderately Aggressive'), ('moderately conservative', 'Moderately Conservative'),
                 ('aggressive', 'Aggressive'), ('conservative', 'Conservative'), ('moderate', 'Moderate'), ('balanced', 'Moderate'),
                 ('high', 'Aggressive'), ('low', 'Conservative'), ('medium', 'Moderate')]
DRIFT_BAND = 5.0


def profile_of(text):
    t = ' ' + str(text or '').lower().replace('-', ' ') + ' '
    for w, p in PROFILE_WORDS:
        if ' ' + w + ' ' in t:
            return p
    return None


def horizon_of(years, horizons):
    """A number of years → the basket's horizon label."""
    if isinstance(years, str) and years in horizons:
        return years
    try:
        y = float(years)
    except (TypeError, ValueError):
        return None
    bounds = [(1, 'Less than 1 Year'), (3, '1-3 Years'), (5, '3-5 Years'), (7, '5-7 Years'), (10, '7-10 Years'), (12, '10-12 Years')]
    for b, label in bounds:
        if y < b and label in horizons:
            return label
    return 'Greater than 12 Years' if 'Greater than 12 Years' in horizons else horizons[-1]


def cell(profile, horizon):
    b = reference.basket()
    if not b:
        raise ValueError('The fund basket (ria-fund-basket.json) could not be read.')
    p = next((x for x in b['profiles'] if x['profile'] == profile), None)
    if not p:
        raise ValueError('Unknown risk profile %r — one of: %s' % (profile, ', '.join(x['profile'] for x in b['profiles'])))
    c = next((x for x in p['cells'] if x['horizon'] == horizon), None)
    if not c:
        raise ValueError('Unknown horizon %r — one of: %s' % (horizon, ', '.join(b['horizons'])))
    return c, b


def build(profile, horizon, lumpsum=0, sip=0, client=None):
    c, b = cell(profile, horizon)
    lumpsum, sip = float(lumpsum or 0), float(sip or 0)
    lines = []
    for name, pct in c['schemes']:
        lines.append({'scheme': name, 'pct': pct, 'lumpsum': round(lumpsum * pct / 100), 'sip': round(sip * pct / 100 / 100) * 100 if sip else 0})
    if sip:
        diff = round(sip) - sum(l['sip'] for l in lines)
        if lines and diff:
            lines[0]['sip'] += diff
    title = '%s · %s%s' % (profile, horizon, (' · ' + client['name']) if client and client.get('name') else '')
    p = {'title': title, 'risk_profile': profile, 'horizon': horizon, 'lumpsum': lumpsum, 'sip': sip,
         'equity_pct': c['equity'], 'debt_pct': c['debt'], 'lines': lines, 'source': b['source'].get('title', 'Fund basket'),
         'client_id': client and client.get('id'), 'client_name': client and client.get('name')}
    p['answer'] = write_build(p)
    return p


def write_build(p):
    out = ['**🧩 Model portfolio — %s**' % p['title'],
           'From the firm\'s fund basket (%s), built by RIA AI\'s Python engine.' % p['source'],
           '\nTarget mix: **equity %s%% · debt %s%%**%s%s' % (p['equity_pct'], p['debt_pct'],
                                                         (' · lumpsum %s' % an.inr(p['lumpsum'])) if p['lumpsum'] else '',
                                                         (' · SIP %s a month' % an.inr(p['sip'])) if p['sip'] else ''),
           '\n| Scheme | Share | Lumpsum | SIP / month |', '|---|---|---|---|']
    for l in p['lines']:
        out.append('| %s | %s%% | %s | %s |' % (l['scheme'], l['pct'], an.inr(l['lumpsum']) if p['lumpsum'] else '—', an.inr(l['sip']) if p['sip'] else '—'))
    out.append('\n' + an.GOVERNANCE)
    return '\n'.join(out)


def rebalance(a, profile, horizon):
    """a: analysis.analyze() output for the client."""
    c, b = cell(profile, horizon)
    total = a['total'] or 0
    eq_now, debt_now = a['mix']['equity'], a['mix']['debt']
    eq_target = float(c['equity'])
    drift = round(eq_now - eq_target, 1)
    plan = {'client': a['client'], 'risk_profile': profile, 'horizon': horizon, 'target': {'equity': c['equity'], 'debt': c['debt']},
            'now': a['mix'], 'drift': drift, 'band': DRIFT_BAND, 'total': total, 'moves': [], 'into': [],
            'source': b['source'].get('title', 'Fund basket')}
    if not total:
        plan['answer'] = '**⚖️ Rebalance**\n\nNo holdings with a current value are on the record for this client yet.'
        return plan
    move = round(abs(drift) / 100 * total)
    plan['move_amount'] = move
    if abs(drift) <= DRIFT_BAND:
        plan['within_band'] = True
    else:
        heavy = 'Equity' if drift > 0 else 'Debt'
        heavy_classes = {'Equity'} if heavy == 'Equity' else {'Debt', 'Liquid/Cash'}
        # take it from Switch / Reduce first, then the largest holdings on the heavy side
        order = sorted([h for h in a['holdings'] if h['asset_class'] in heavy_classes],
                       key=lambda h: (0 if h['action'] == 'Switch' else 1 if h['action'] == 'Reduce' else 2, -h['current']))
        left = move
        for h in order:
            if left <= 0:
                break
            take = min(left, h['current'])
            plan['moves'].append({'scheme': h['scheme'], 'action': 'Switch' if h['action'] == 'Switch' else 'Reduce', 'amount': round(take),
                                  'why': h['why'] if h['action'] in ('Switch', 'Reduce') else 'Largest %s holding — trim to bring the mix back to target.' % heavy.lower()})
            left -= take
        # put it into the basket's schemes on the light side
        light_eq = heavy == 'Debt'
        light = [s for s in c['schemes'] if _is_equity(s[0]) == light_eq] or c['schemes']
        wsum = sum(p for _, p in light) or 1
        plan['into'] = [{'scheme': n, 'amount': round(move * p / wsum)} for n, p in light]
        plan['heavy'] = heavy
    plan['answer'] = write_rebalance(plan)
    return plan


def _is_equity(name):
    from . import classify
    cat = classify.category_of(name)
    mix = (cat or {}).get('mix') or [0, 0, 0]
    return mix[0] >= 0.65


def write_rebalance(p):
    cl = p['client'] or {}
    out = ['**⚖️ Rebalance — %s** (%s · %s)' % (cl.get('name') or 'client', p['risk_profile'], p['horizon']),
           'Target equity %s%% / debt %s%% (fund basket) · now equity %s%% / debt %s%% · drift %+.1f pts (band ±%d).' % (
               p['target']['equity'], p['target']['debt'], p['now']['equity'], p['now']['debt'], p['drift'], p['band'])]
    if p.get('within_band'):
        out.append('\nThe mix is **within the ±%d point band** — no rebalancing needed; keep fresh money in line with the target.' % p['band'])
    else:
        out.append('\nMove about **%s** out of %s:' % (an.inr(p['move_amount']), p['heavy'].lower()))
        out.append('\n| From | Action | Amount | Why |')
        out.append('|---|---|---|---|')
        for m in p['moves']:
            out.append('| %s | %s | %s | %s |' % (m['scheme'], m['action'], an.inr(m['amount']), str(m['why']).replace('|', '/')))
        out.append('\nInto (fund basket, %s · %s):' % (p['risk_profile'], p['horizon']))
        out += ['- %s — %s' % (i['scheme'], an.inr(i['amount'])) for i in p['into']]
        out.append('\nStage the moves across financial years where long-term gains exceed the ₹1.25 lakh exemption.')
    out.append('\n' + an.GOVERNANCE)
    return '\n'.join(out)

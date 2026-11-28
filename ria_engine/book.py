"""The book as a whole — every client the person may see — read by the Python engine.

book_report(people, positions_of, sips, q)
    people        normalize.people(stores) (only the records the server passed: the person's own scope)
    positions_of  person -> normalize.positions(person, stores)
    sips          the platformSips rows passed (monthly SIP book)

Totals, the asset-class split, branch and RM splits, the largest clients and
how much of the book they hold, the SIP book, and the clients to act on
(a Switch, a holding above 25%, or a mix more than 5 points off their risk
profile's target) — with `answer`, the engine's own read-out.
"""
from . import analysis as an
from . import normalize
from . import portfolio
from . import reference

DEFAULT_HORIZON = '7-10 Years'


def book_report(people, positions_of, sips=None, q=None, top=10):
    q = q if q is not None else reference.quartiles()
    rows = []
    for person in people:
        pos = positions_of(person)
        if not any((p.get('current') or 0) > 0 for p in pos):
            continue
        a = an.analyze(person, pos, q)
        drift = None
        prof = portfolio.profile_of(person.get('risk_profile'))
        if prof:
            try:
                c, _ = portfolio.cell(prof, DEFAULT_HORIZON)
                drift = round(a['mix']['equity'] - c['equity'], 1)
            except ValueError:
                drift = None
        rows.append({'person': person, 'a': a, 'drift': drift, 'profile': prof})
    total = sum(r['a']['total'] for r in rows)
    by_class, by_branch, by_rm = {}, {}, {}
    for r in rows:
        for k, v in r['a']['by_class'].items():
            by_class[k] = by_class.get(k, 0) + v
        b = r['person'].get('branch') or '—'
        m = r['person'].get('rm') or '—'
        by_branch[b] = by_branch.get(b, 0) + r['a']['total']
        by_rm[m] = by_rm.get(m, 0) + r['a']['total']
    ids = {i for r in rows for i in (r['person'].get('ids') or [r['person'].get('id')])}
    all_ids = {i for p in people for i in (p.get('ids') or [p.get('id')])}
    sip_total, sip_count = 0.0, 0
    for s in sips or []:
        if s.get('deletedAt') or s.get('clientId') not in all_ids:
            continue
        if str(s.get('status') or '').lower() in ('cancelled', 'canceled', 'closed', 'stopped', 'inactive', 'ceased'):
            continue
        amt = normalize.num(s.get('monthlyAmount') or s.get('amount'))
        if amt > 0:
            sip_total += amt
            sip_count += 1
    largest = sorted(rows, key=lambda r: -r['a']['total'])[:top]
    top_share = round(sum(r['a']['total'] for r in largest) / total * 100, 1) if total else 0
    act = []
    for r in rows:
        why = []
        if r['a']['counts']['Switch']:
            why.append('%d to switch' % r['a']['counts']['Switch'])
        conc = [h for h in r['a']['holdings'] if h['weight_pct'] > an.CONC_LIMIT]
        if conc:
            why.append('%s%% in one holding' % conc[0]['weight_pct'])
        if r['drift'] is not None and abs(r['drift']) > portfolio.DRIFT_BAND:
            why.append('equity %+.1f pts vs %s target' % (r['drift'], r['profile']))
        if why:
            act.append({'id': r['person'].get('id'), 'name': r['person'].get('name'), 'total': r['a']['total'], 'why': '; '.join(why)})
    act.sort(key=lambda x: -x['total'])
    rep = {'clients': len(rows), 'clients_in_scope': len(people), 'total': round(total),
           'by_class': {k: round(v) for k, v in sorted(by_class.items(), key=lambda kv: -kv[1])},
           'by_branch': {k: round(v) for k, v in sorted(by_branch.items(), key=lambda kv: -kv[1])},
           'by_rm': {k: round(v) for k, v in sorted(by_rm.items(), key=lambda kv: -kv[1])},
           'largest': [{'id': r['person'].get('id'), 'name': r['person'].get('name'), 'total': r['a']['total'],
                        'share': round(r['a']['total'] / total * 100, 1) if total else 0} for r in largest],
           'top_share': top_share, 'sip_book': round(sip_total), 'sip_count': sip_count, 'to_act': act,
           'actions': {k: sum(r['a']['counts'][k] for r in rows) for k in an.ACTIONS}, 'governance': an.GOVERNANCE}
    rep['answer'] = write_book(rep, top)
    return rep


def write_book(r, top):
    out = ['**📚 Book report**', 'Computed by RIA AI\'s Python engine from the BOSS records you can see.']
    if not r['clients']:
        out.append('\nNo client in your scope has holdings with a current value yet.')
        return '\n'.join(out)
    out.append('\n**AUM %s** across %d clients with holdings (of %d in scope) · SIP book %s a month (%d SIPs)' % (
        an.inr(r['total']), r['clients'], r['clients_in_scope'], an.inr(r['sip_book']), r['sip_count']))
    out.append('Asset classes: ' + ' · '.join('%s %s (%s%%)' % (k, an.inr(v), round(v / r['total'] * 100, 1)) for k, v in r['by_class'].items()))
    if len(r['by_branch']) > 1:
        out.append('Branches: ' + ' · '.join('%s %s' % (k, an.inr(v)) for k, v in list(r['by_branch'].items())[:6]))
    a = r['actions']
    out.append('Holding actions across the book: %d Hold · %d Reduce · %d Switch · %d Review' % (a['Hold'], a['Reduce'], a['Switch'], a['Review']))
    out.append('\n**Top %d clients** hold %s%% of the book' % (min(top, len(r['largest'])), r['top_share']))
    out.append('\n| Client | AUM | Share |')
    out.append('|---|---|---|')
    out += ['| %s | %s | %s%% |' % (str(c['name']).replace('|', '/'), an.inr(c['total']), c['share']) for c in r['largest']]
    if r['to_act']:
        out.append('\n**Clients to act on** (%d)' % len(r['to_act']))
        out.append('\n| Client | AUM | Why |')
        out.append('|---|---|---|')
        out += ['| %s | %s | %s |' % (str(c['name']).replace('|', '/'), an.inr(c['total']), c['why']) for c in r['to_act'][:20]]
        if len(r['to_act']) > 20:
            out.append('\n…and %d more.' % (len(r['to_act']) - 20))
    out.append('\n' + r['governance'])
    return '\n'.join(out)

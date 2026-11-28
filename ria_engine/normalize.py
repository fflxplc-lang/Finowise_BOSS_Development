"""People and positions for the RIA engine, ported from public/index.html and public/multi-asset.js.

The Node server passes `stores`: a dict of data.json keys -> parsed values (only the
records the signed-in user may see). Nothing here reads files, the network or globals.

Mirrors, in the page:
  numVal                                   -> num()
  cleanClientName / riaCleanNameKey        -> clean_client_name() / _clean_name_key()
  riaNamesAgree / riaPersonKeys            -> _names_agree() / _person_keys()
  clientBookAum (+ clientAum)              -> _book_aum()
  riaMergeRows / riaConsolidate            -> _merge_rows() / consolidate()
  riaRmName / riaRmOf, lexiProfileOf, riaDob
                                           -> person fields rm / rms / risk_profile / dob
  maUploads / maResolver / maState         -> _ma_holdings()      (multi-asset.js)
  riaMaSchemeRows / riaSchemeHoldingsOf    -> _ma_scheme_rows() / scheme_holdings_of()
  lexiHoldingValue                         -> holding_value()
  riaPositions / riaPositionsOne           -> positions() / positions_one()
"""
import re

from . import classify
from .classify import js_truthy, js_or, js_str, js_s

# data.json keys these functions read. Multi-asset scheme rows live under one key per
# live upload: ASSET_ROWS_PREFIX + upload id (see store_keys()).
STORES = ['clients', 'team', 'platformHoldings', 'platformSips', 'transactions', 'schemes', 'assetUploads']
ASSET_ROWS_PREFIX = 'assetRows.'


def store_keys(asset_uploads=None):
    """STORES plus the 'assetRows.<id>' key of every live (not deleted) upload in `asset_uploads`."""
    keys = list(STORES)
    for u in asset_uploads or []:
        if isinstance(u, dict) and not js_truthy(u.get('deletedAt')) and u.get('id') is not None:
            keys.append(ASSET_ROWS_PREFIX + js_str(u.get('id')))
    return keys


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

_NUM_JUNK = re.compile(r'[^0-9.\-]')


def num(v):
    """Mirrors numVal(): Number(String(v||'0').replace(/[^0-9.-]/g,'')) || 0.

    "1,23,456.78" -> 123456.78, "₹ 5,000" -> 5000.0, '' / None / 'abc' / '1.2.3' -> 0.0.
    A real int/float is returned as is (JS would stringify it first, which only differs for
    exponent forms like 1e21); NaN/Infinity and booleans give 0.0, as in JS.
    """
    if isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        f = float(v)
        if f != f or f in (float('inf'), float('-inf')):
            return 0.0
        return f or 0.0
    s = _NUM_JUNK.sub('', js_str(v) if js_truthy(v) else '0')
    if s == '':
        return 0.0
    try:
        f = float(s)
    except ValueError:
        return 0.0
    return f or 0.0


def _blank(v):
    """Mirrors riaBlank: undefined, null, '' or an empty array."""
    return v is None or (isinstance(v, str) and v == '') or (isinstance(v, list) and not v)


def _live(rows):
    """A store's rows that are dicts and not soft-deleted."""
    return [r for r in (rows or []) if isinstance(r, dict) and not js_truthy(r.get('deletedAt'))]


def _cat(d, k):
    """`'' + d.k` in JS string concatenation: missing -> 'undefined', null -> 'null'."""
    return js_str(d[k]) if k in d else 'undefined'


def _key(s):
    """Mirrors maKey(): trimmed, single-spaced, lower case."""
    return ' '.join(js_str('' if s is None else s).split()).lower()


def _tidy(s):
    """Mirrors maTidy(): trimmed and single-spaced."""
    return ' '.join(js_str('' if s is None else s).split())


# ---------------------------------------------------------------------------
# People: one per investor (riaConsolidate)
# ---------------------------------------------------------------------------

PAN_FULL = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]$')
_NAME_PAN_TAIL = re.compile(r'\s*[-–—]\s*(?:[A-Z]{5}[0-9]{4}[A-Z]|[*Xx•]{3,6}[0-9]{0,4}[A-Z]?)\s*$', re.I)
_TAIL4 = re.compile(r'^[0-9]{3}[A-Z]$|^[0-9]{4}$')
NAME_SKIP = frozenset(['mr', 'mrs', 'ms', 'miss', 'dr', 'shri', 'shree', 'smt', 'km', 'kumari', 'm', 's'])
_TEAM_ID = re.compile(r'^(USR|TM|EMP)[-_][A-Z0-9]{4,}$', re.I)


def clean_client_name(name):
    """Mirrors cleanClientName(): "Vishal Kumar Maurya - ABCDE1234F" -> "Vishal Kumar Maurya"."""
    return _NAME_PAN_TAIL.sub('', '' if name is None else js_str(name)).strip()


def _display_name(c):
    """Mirrors clientDisplayName(): salutation + cmsName."""
    sal = c.get('salutation')
    return ((js_str(sal) + ' ' if js_truthy(sal) else '') + js_s(c.get('cmsName'))).strip()


def _clean_name_key(r):
    """Mirrors riaCleanNameKey()."""
    nm = clean_client_name(js_or(r.get('cmsName'), _display_name(r)))
    return re.sub(r'[^a-z0-9]+', ' ', js_s(nm).lower()).strip()


def _name_set(nm):
    return [w for w in js_s(nm).split(' ') if w and w not in NAME_SKIP]


def _names_agree(a, b):
    """Mirrors riaNamesAgree(): equal, one a subset of the other, or same first and last word."""
    wa, wb = _name_set(a), _name_set(b)
    if not wa or not wb or ' '.join(wa) == ' '.join(wb):
        return True
    lo, hi = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    if all(w in hi for w in lo):
        return True
    return wa[0] == wb[0] and wa[-1] == wb[-1]


def _full_pan(r):
    p = js_s(r.get('pan')).strip().upper()
    return p if PAN_FULL.match(p) else ''


def _person_keys(r):
    """Mirrors riaPersonKeys(): full PAN; clean name + mobile; clean name + last four PAN characters."""
    out = []
    pan = js_s(r.get('pan')).strip().upper()
    full = pan if PAN_FULL.match(pan) else ''
    if full:
        out.append('P:' + full)
    nm = _clean_name_key(r)
    mob = re.sub(r'\D', '', js_s(r.get('mobile')))[-10:]
    if nm and len(mob) == 10 and not re.match(r'^0+$', mob):
        out.append('N:' + nm + '|' + mob)
    tail = re.sub(r'[^A-Z0-9]', '', pan)[-4:]
    if len(nm.split(' ')) >= 2 and _TAIL4.search(tail) and len(pan) >= 4:
        out.append('M:' + nm + '|' + (full[-4:] if full else tail))
    return out


def _book_aum(c, stores):
    """Mirrors clientBookAum(): platform-reported current value, else the completed ledger (clientAum)."""
    cid = c.get('id')
    h = [x for x in _live(stores.get('platformHoldings')) if x.get('clientId') == cid]
    if h:
        return sum(num(x.get('current')) for x in h)
    total = 0.0
    for t in _live(stores.get('transactions')):
        if t.get('clientId') != cid or t.get('status') != 'Completed' or js_truthy(t.get('txnRollup')):
            continue
        amt = num(t.get('amount'))
        total += -amt if re.search('redemption', js_s(t.get('transactionType')), re.I) else amt
    return total


def _merge_rows(rows, stores):
    """Mirrors riaMergeRows(): newest row's value wins, older rows fill its blanks; id is the biggest row's."""
    by_new = sorted(rows, key=lambda r: js_s(r.get('createdAt')), reverse=True)
    if len(rows) == 1:
        primary = rows[0]
    else:
        def filled(r):
            return sum(1 for k in r if not _blank(r[k]))
        primary = sorted(rows, key=lambda r: (-num(_book_aum(r, stores)), -filled(r)))[0]
    if len(rows) == 1:
        nm = clean_client_name(primary.get('cmsName'))
        m = dict(primary)
        if nm and nm != primary.get('cmsName'):
            m['cmsName'] = nm
        m['_ids'] = [primary.get('id')]
        m['_rows'] = [primary]
        m['_rms'] = None                              # single row: riaRmOf reads rmName / assignedTo
        return m
    m = {}
    for r in by_new:
        for k in r:
            if _blank(m.get(k)) and not _blank(r[k]):
                m[k] = r[k]
    m['id'] = primary.get('id')
    m['cmsName'] = clean_client_name(js_or(primary.get('cmsName'), m.get('cmsName')))
    m['branch'] = next((b for b in (js_or(r.get('branch'), r.get('branchName')) for r in by_new) if js_truthy(b)), '')
    created = sorted(js_s(r.get('createdAt')) for r in rows if js_s(r.get('createdAt')))
    if created:
        m['createdAt'] = created[0]                 # when the investor first came
    m['_ids'] = [r.get('id') for r in rows]
    m['_rows'] = list(rows)
    m['_rms'] = [x for r in by_new for x in (r.get('rmName'), r.get('assignedTo')) if js_truthy(x)]
    return m


def consolidate(rows, stores):
    """Mirrors riaConsolidate(): client rows -> merged rows, one per investor.

    Rows are joined by a shared key (_person_keys), never across two different full PANs
    and never when the clean names disagree. Group order follows the first row of each group.
    """
    rows = list(rows)
    n = len(rows)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    pan_of, names_of = {}, {}
    for i, r in enumerate(rows):
        p = _full_pan(r)
        if p:
            pan_of[i] = p
        names_of[i] = [_clean_name_key(r)]

    def union(a, b):
        a, b = find(a), find(b)
        if a == b:
            return
        pa, pb = pan_of.get(a), pan_of.get(b)
        if pa and pb and pa != pb:
            return                                  # two PANs: two people
        na, nb = names_of[a], names_of[b]
        if not all(_names_agree(x, y) for x in na for y in nb):
            return                                  # two names: two people
        parent[b] = a
        if not pa and pb:
            pan_of[a] = pb
        names_of[a] = na + nb

    seen = {}
    for i, r in enumerate(rows):
        for k in _person_keys(r):
            if k not in seen:
                seen[k] = i
            else:
                union(seen[k], i)
    groups = {}
    for i, r in enumerate(rows):
        groups.setdefault(find(i), []).append(r)    # dict keeps first-seen order
    return [_merge_rows(g, stores) for g in groups.values()]


def _team_names(stores):
    out = {}
    for t in stores.get('team') or []:
        if isinstance(t, dict) and t.get('id') is not None and t.get('id') not in out:
            out[t.get('id')] = t.get('name')
    return out


def _rm_name(x, team):
    """Mirrors riaRmName(): a team id -> the member's name; an unknown id-looking value -> ''."""
    if x in team and js_truthy(team[x]) and team[x] != '—':
        return js_str(team[x])
    return '' if _TEAM_ID.match(js_str(x)) else js_str(x).strip()


def profile_of(c):
    """Mirrors lexiProfileOf(): riskProfile or iseqCategory -> 'Aggressive' / 'Conservative' / 'Moderate' / ''."""
    p = js_s(js_or(c.get('riskProfile'), c.get('iseqCategory'))).lower()
    if re.search(r'aggress|high', p):
        return 'Aggressive'
    if re.search(r'conserv|low|safe', p):
        return 'Conservative'
    if re.search(r'moder|balanc|medium', p):
        return 'Moderate'
    return ''


def _dob_of(c):
    """Mirrors riaDob(): dob, else the first family member's dob."""
    fam = c.get('family')
    first = fam[0] if isinstance(fam, list) and fam and isinstance(fam[0], dict) else {}
    return js_or(c.get('dob'), first.get('dob'), '')


def people(stores):
    """Mirrors riaVisible() (= riaConsolidate over the visible, not-deleted clients).

    Returns one dict per investor:
      id, ids, name, branch, rm (first RM name), rms (all, as riaRmOf), risk_profile
      (lexiProfileOf), risk_profile_raw (riskProfile || iseqCategory), dob, rows (raw client rows).
    PAN, mobile, email, address and bank details stay inside "rows" only.
    """
    stores = stores or {}
    team = _team_names(stores)
    out = []
    for m in consolidate(_live(stores.get('clients')), stores):
        raw_rms = m['_rms'] if m.get('_rms') is not None else [m.get('rmName'), m.get('assignedTo')]
        rms = []
        for x in raw_rms:
            if not js_truthy(x):
                continue
            nm = _rm_name(x, team)
            if nm and nm not in rms:
                rms.append(nm)
        out.append({
            'id': m.get('id'),
            'ids': list(m['_ids']),
            'name': clean_client_name(m.get('cmsName')),
            'branch': js_s(js_or(m.get('branch'), m.get('branchName'))).strip(),
            'rm': rms[0] if rms else '',
            'rms': rms,
            'risk_profile': profile_of(m),
            'risk_profile_raw': js_s(js_or(m.get('riskProfile'), m.get('iseqCategory'))),
            'dob': js_s(_dob_of(m)),
            'rows': list(m['_rows']),
        })
    return out


# ---------------------------------------------------------------------------
# Multi-asset upload rows (multi-asset.js: maUploads / maResolver / maState)
# ---------------------------------------------------------------------------

MA_UNASSIGNED = 'Unassigned'


def _ma_pan(v):
    """Mirrors maPanOf()."""
    p = re.sub(r'\s+', '', js_s(v)).upper()
    return p if PAN_FULL.match(p) else None


def _ma_resolver(all_rows, stores):
    """Mirrors maResolver(): which client a row belongs to (by cid, then PAN, then a unique name)."""
    clients = _live(stores.get('clients'))
    by_id, by_pan, by_name = {}, {}, {}
    for c in clients:
        by_id[c.get('id')] = c                                         # new Map(): the last row with an id wins
        p = re.sub(r'[\s\-]', '', js_s(c.get('pan')).upper())          # impNormPan
        if p:
            by_pan.setdefault(p, []).append(c)
        nk = ' '.join(js_s(c.get('cmsName')).split()).lower()           # impNormKey
        if nk:
            by_name.setdefault(nk, []).append(c)
    pans_of_name = {}
    for r in all_rows:
        p = _ma_pan(js_or(r.get('pan'), r.get('client_id')))
        nm = _key(r.get('client_name'))
        if p and nm:
            pans_of_name.setdefault(nm, set()).add(p)
    memo = {}

    def who(r):
        pan = _ma_pan(js_or(r.get('pan'), r.get('client_id')))
        nm = _key(r.get('client_name'))
        mk = (js_s(r.get('cid')), pan or '', nm)
        if mk in memo:
            return memo[mk]
        out = None

        def hit(c):
            return {'ck': 'c:' + js_str(c.get('id')), 'clientId': c.get('id')}
        cid = r.get('cid')
        if js_truthy(cid) and cid in by_id:
            out = hit(by_id[cid])
        if not out and pan:
            h = by_pan.get(pan) or []
            if len(h) == 1:
                out = hit(h[0])
        if not out and nm and nm != _key(MA_UNASSIGNED) and not pan:
            h = by_name.get(nm) or []
            if len(h) == 1:
                out = hit(h[0])
        if not out:
            p = pan
            if not p and nm and nm in pans_of_name and len(pans_of_name[nm]) == 1:
                p = next(iter(pans_of_name[nm]))
            if p:
                h = by_pan.get(p) or []
                out = hit(h[0]) if len(h) == 1 else {'ck': 'p:' + p, 'clientId': ''}
            else:
                out = {'ck': 'n:' + (nm or _key(MA_UNASSIGNED)), 'clientId': ''}
        memo[mk] = out
        return out
    return who


def _ma_holdings(stores):
    """Mirrors maState().holdings: the newest version of each holding row across live uploads.

    Returns a list of (row, upload, who) tuples. A detail row wins per client + product +
    platform (MF: any platform) + identifier + ISIN/name; a summary row counts only where
    that client + product + platform has no detail rows.
    """
    ups = [u for u in (stores.get('assetUploads') or []) if isinstance(u, dict) and not js_truthy(u.get('deletedAt'))]
    if not ups:
        return []
    allr = []
    for u in ups:
        rows = stores.get(ASSET_ROWS_PREFIX + js_str(u.get('id')))
        if isinstance(rows, list):
            allr.extend((r, u) for r in rows if isinstance(r, dict))
    who = _ma_resolver([r for r, _ in allr], stores)
    items = [(r, u, who(r)) for r, u in allr if u.get('kind') != 'sip']

    def seq(it):
        return js_or(it[1].get('seq'), 0)

    def id_key(it):
        r, _, w = it
        return (w['ck'] + '|' + _cat(r, 'product') + '|' + ('' if r.get('product') == 'MF' else _cat(r, 'platform_key')) + '|'
                + js_s(r.get('identifier')).lower() + '|'
                + (js_s(r.get('isin')).upper() or js_s(r.get('security_name')).lower()))

    def scope_key(it):
        r, _, w = it
        return w['ck'] + '|' + _cat(r, 'product') + '|' + _cat(r, 'platform_key')

    def newest(lst, key_of):
        best = {}
        for it in lst:
            k, s = key_of(it), seq(it)
            if k not in best or s > best[k]:
                best[k] = s
        return [it for it in lst if seq(it) == best[key_of(it)]]

    detail = newest([it for it in items if it[0].get('level') != 'summary'], id_key)
    with_detail = set(scope_key(it) for it in detail)
    summary = [it for it in newest([it for it in items if it[0].get('level') == 'summary'], scope_key)
               if scope_key(it) not in with_detail]
    return detail + summary


def _ma_scheme_rows(client_id, stores):
    """Mirrors riaMaSchemeRows(): a client's multi-asset scheme rows, grouped by the summary key
    'ma|<platform_key>|<product>|<clientId>' that platformHoldings summaries carry."""
    by = {}
    if not js_truthy(client_id):
        return by
    for r, _, w in _ma_holdings(stores):
        if r.get('level') == 'summary' or js_truthy(r.get('removed')) or w['clientId'] != client_id:
            continue
        if not js_s(r.get('security_name')).strip():
            continue
        if not (num(r.get('current_value')) > 0 or num(r.get('invested')) > 0):
            continue
        k = 'ma|' + _cat(r, 'platform_key') + '|' + _cat(r, 'product') + '|' + js_str(client_id)
        by.setdefault(k, []).append(r)
    return by


def scheme_holdings_of(client_id, stores):
    """Mirrors riaSchemeHoldingsOf(): the client's platform holdings, each multi-asset summary
    (source 'multiasset', no schemeName) that has scheme rows replaced by those rows."""
    holdings = [h for h in _live(stores.get('platformHoldings')) if h.get('clientId') == client_id]
    rows = _ma_scheme_rows(client_id, stores)
    if not rows:
        return holdings
    out = []
    for h in holdings:
        mine = rows.get(h.get('key')) if h.get('source') == 'multiasset' and not js_truthy(h.get('schemeName')) else None
        if not mine:
            out.append(h)
            continue
        for r in mine:
            xirr = r.get('xirr')
            out.append({
                'id': js_str(h.get('id')) + '|' + (js_s(r.get('isin')) or _key(r.get('security_name'))) + '|' + _key(js_or(r.get('identifier'), '')),
                'clientId': client_id, 'schemeName': _tidy(r.get('security_name')),
                'isin': js_or(r.get('isin'), ''), 'folio': js_or(r.get('identifier'), ''),
                'invested': num(r.get('invested')), 'current': num(r.get('current_value')),
                'xirr': '' if xirr is None or xirr == '' else xirr,
                'purchaseDate': js_or(r.get('start_date'), r.get('purchase_date'), r.get('as_of'), ''),
                'platform': h.get('platform'), 'product': r.get('product'),
                'category': js_or(r.get('category'), ''), 'assetClass': js_or(r.get('asset_class'), ''),
                'source': 'multiasset-scheme', 'summaryId': h.get('id'),
            })
    return out


# ---------------------------------------------------------------------------
# Positions (riaPositions / riaPositionsOne)
# ---------------------------------------------------------------------------


def holding_value(h):
    """Mirrors lexiHoldingValue() without live NAVs: the record's own current value
    (current || currentValue || marketValue). The page uses units x live NAV when it has one;
    the server has no NAV feed here, so the uploaded value is used."""
    return num(js_or(h.get('current'), h.get('currentValue'), h.get('marketValue')))


def _xirr(v):
    return None if v is None or v == '' else num(v)


def _pos(scheme, invested, current, start, xirr, src):
    """Mirrors asPos() inside riaPositionsOne()."""
    cat = classify.category_of(scheme)
    return {'scheme': scheme, 'invested': num(invested), 'current': num(current), 'start': js_or(start, ''),
            'xirr': _xirr(xirr), 'amc': classify.amc_of(scheme), 'category': cat,
            'asset_class': classify.asset_class_of(cat), 'src': src}


def positions_one(client_id, stores):
    """Mirrors riaPositionsOne() for one client row id.

    Order of evidence: platform holdings with a scheme name (multi-asset summaries replaced by
    their scheme rows); else platform sleeves; SIP schemes standing in for a client-level total;
    an "Unclassified holdings" remainder; and, with no platform data at all, the BOSS ledger
    (completed transactions, scheme by scheme).
    """
    out = []

    def add(p):
        if num(p.get('current')) > 0 or num(p.get('invested')) > 0:
            base = {'scheme': '', 'invested': 0.0, 'current': 0.0, 'start': '', 'xirr': None, 'amc': '',
                    'category': None, 'asset_class': 'Unclassified', 'folio': '', 'src': '', 'client_id': client_id}
            base.update(p)
            out.append(base)

    holdings = scheme_holdings_of(client_id, stores)
    unclassified, u_inv, u_x = 0.0, 0.0, None
    for h in holdings:
        cur = holding_value(h)
        if js_truthy(h.get('schemeName')):
            p = _pos(h.get('schemeName'), h.get('invested'), cur,
                     js_or(h.get('purchaseDate'), h.get('startDate'), h.get('accountOpenDate')), h.get('xirr'), 'holding')
            # a stock, bond or FD row from a multi-asset upload: its asset class says what it is
            if not p['category'] and h.get('source') == 'multiasset-scheme':
                cat = classify.category_of(h.get('category')) if js_truthy(h.get('category')) else None
                if cat:
                    p['category'] = cat
                    p['asset_class'] = classify.asset_class_of(cat)
                elif h.get('assetClass') in classify.MA_CLASS:
                    p['asset_class'] = classify.MA_CLASS[h.get('assetClass')]
            if js_truthy(h.get('folio')):
                p['folio'] = h.get('folio')
            add(p)
            continue
        sleeves = h.get('sleeves')
        sl = []
        if isinstance(sleeves, dict):
            sl = [k for k in sleeves if num((sleeves.get(k) if isinstance(sleeves.get(k), dict) else {}).get('current')) > 0]
        if sl:
            for k in sl:
                s = sleeves[k]
                cls = classify.SLEEVE_CLASS.get(k, 'Unclassified')
                cat = ({'id': '_Equity', 'label': 'Equity (sleeve)', 'mix': [1, 0, 0]} if cls == 'Equity' else
                       {'id': '_Debt', 'label': 'Debt (sleeve)', 'mix': [0, 1, 0]} if cls == 'Debt' else None)
                add({'scheme': k + ' (platform sleeve)', 'invested': num(s.get('invested')), 'current': num(s.get('current')),
                     'start': js_or(h.get('accountOpenDate'), ''), 'xirr': _xirr(s.get('xirr')), 'asset_class': cls,
                     'category': cat, 'src': 'sleeve'})
            continue
        unclassified += cur
        u_inv += num(h.get('invested'))
        if h.get('xirr') is not None and h.get('xirr') != '':
            u_x = num(h.get('xirr'))

    # SIP schemes say what a client-level total is made of.
    sips = [s for s in _live(stores.get('platformSips'))
            if s.get('clientId') == client_id and js_truthy(s.get('schemeName')) and num(s.get('current')) > 0]
    if not any(p['src'] == 'holding' for p in out):
        sip_sum = sum(num(s.get('current')) for s in sips)
        if sips and (not holdings or unclassified >= sip_sum * 0.98):
            for s in sips:
                add(_pos(s.get('schemeName'), s.get('invested'), s.get('current'),
                         js_or(s.get('startDate'), s.get('regDate')), s.get('xirr'), 'sip'))
            unclassified = max(0.0, unclassified - sip_sum)
            u_inv = max(0.0, u_inv - sum(num(s.get('invested')) for s in sips))
    if unclassified > 0:
        add({'scheme': 'Unclassified holdings (no scheme in the report)', 'invested': u_inv, 'current': unclassified,
             'xirr': u_x, 'asset_class': 'Unclassified', 'src': 'holding'})

    # No platform data at all: the BOSS ledger, scheme by scheme.
    if not holdings and not out:
        scheme_names = {}
        for s in stores.get('schemes') or []:
            if isinstance(s, dict) and s.get('id') not in scheme_names:
                scheme_names[s.get('id')] = s.get('schemeName')
        by = {}
        for t in _live(stores.get('transactions')):
            if t.get('clientId') != client_id or t.get('status') != 'Completed':
                continue
            if js_truthy(t.get('schemeId')):
                name = scheme_names.get(t.get('schemeId'), '—')       # schemeName(id): '—' when not found
            else:
                name = js_or(t.get('schemeName'), '')
            k = js_str(name) if js_truthy(name) and name != '—' else 'Unclassified (no scheme on the transaction)'
            amt = num(t.get('amount')) * (-1 if re.search('redemption', js_s(t.get('transactionType')), re.I) else 1)
            d = js_str(js_or(t.get('initiatedDate'), t.get('createdAt'), ''))[:10]
            e = by.setdefault(k, {'amt': 0.0, 'start': d})
            e['amt'] += amt
            if d and (not e['start'] or d < e['start']):
                e['start'] = d
        for k, e in by.items():
            if e['amt'] <= 0:
                continue
            unc = k.startswith('Unclassified')
            p = _pos('' if unc else k, e['amt'], e['amt'], e['start'], None, 'ledger')
            if unc:
                p['scheme'] = k
            add(p)
    return out


def positions(person, stores):
    """Mirrors riaPositions(): every row the person is filed under, through positions_one().

    `person` is a dict from people() (its "ids" are used), or a single raw client row.
    Each position: scheme, invested, current, start, xirr, amc, category ({id,label,mix} or None),
    asset_class (one of classify.CLASSES), folio, src ('holding' | 'sleeve' | 'sip' | 'ledger'), client_id.
    """
    stores = stores or {}
    ids = person.get('ids') if isinstance(person.get('ids'), list) and person.get('ids') else [person.get('id')]
    out = []
    for cid in ids:
        out.extend(positions_one(cid, stores))
    return out

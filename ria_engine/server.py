"""RIA AI's Python engine — a small HTTP service on 127.0.0.1, called only by the BOSS Node server.

    python3 -m ria_engine.server            # listens on 127.0.0.1:${RIA_ENGINE_PORT:-8765}

Who may call it: the Node server, on the same machine. It binds to 127.0.0.1
only, and when RIA_ENGINE_TOKEN is set every request must carry it in
X-Ria-Engine-Token (Node reads the same value from the server's env file).

What it is given: Node passes, with each request, only the records the signed-in
person may see (the same scope as BOSS's own reads) plus who they are. The
engine never opens data.json itself, so it can never show anybody more than
BOSS would.

Endpoints (JSON in, JSON out):
  GET  /health                      engine up, what it has loaded, its database's counts
  POST /client/analyze              {client_id, stores, user}       → analysis (and saved to its database)
  POST /portfolio/build             {client_id?, profile?, horizon?|years?, lumpsum?, sip?, save?, stores, user}
  POST /portfolio/rebalance         {client_id, profile?, horizon?|years?, stores, user}
  POST /book/report                 {stores, user}
  POST /portfolios                  {client_ids?}                    → saved model portfolios
  POST /client/history              {client_id}                      → past analyses

Standard library only (http.server, json, sqlite3).
"""
import hmac
import json
import os
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import analysis as an
from . import book
from . import db as dbmod
from . import normalize
from . import portfolio
from . import reference

VERSION = '1.0.0'
MAX_BODY = 64 * 1024 * 1024


class Engine:
    """Everything a request needs, independent of HTTP (the tests call it directly)."""

    def __init__(self, store=None):
        self.store = store or dbmod.Store()

    # -- helpers --
    @staticmethod
    def _person(stores, client_id):
        people = normalize.people(stores)
        for p in people:
            if client_id == p.get('id') or client_id in (p.get('ids') or []):
                return p, people
        raise LookupError('That client is not among the records you can see.')

    @staticmethod
    def _who(req):
        u = req.get('user') or {}
        return str(u.get('email') or u.get('name') or u.get('id') or '')

    @staticmethod
    def _horizon(req, default='7-10 Years'):
        b = reference.basket() or {'horizons': [default]}
        h = req.get('horizon')
        if h in b['horizons']:
            return h
        if req.get('years') is not None:
            return portfolio.horizon_of(req.get('years'), b['horizons'])
        return default

    # -- endpoints --
    def health(self):
        q, b = reference.quartiles(), reference.basket()
        return {'ok': True, 'engine': 'ria-engine', 'version': VERSION, 'python': sys.version.split()[0],
                'quartiles': bool(q), 'quartile_rows': len(q.rows) if q else 0, 'basket': bool(b),
                'db': self.store.counts(), 'stores': normalize.STORES}

    def client_analyze(self, req):
        stores = req.get('stores') or {}
        person, _ = self._person(stores, req.get('client_id'))
        a = an.analyze(person, normalize.positions(person, stores))
        before = self.store.last_recommendations(person['id'])
        changed = [{'scheme': h['scheme'], 'was': before[h['scheme']], 'now': h['action']}
                   for h in a['holdings'] if h['scheme'] in before and before[h['scheme']] != h['action']]
        a['changed_since_last'] = changed
        if changed:
            a['answer'] += '\n\n**Changed since the last analysis:** ' + '; '.join('%s %s → %s' % (c['scheme'], c['was'], c['now']) for c in changed[:8])
        summary = {k: a[k] for k in ('total', 'invested', 'gain', 'mix', 'counts', 'findings')}
        a['analysis_id'] = self.store.save_analysis('client', summary, person['id'], person.get('name'), self._who(req),
                                                    [{'scheme': h['scheme'], 'action': h['action'], 'why': h['why'],
                                                      'weight_pct': h['weight_pct'], 'current': h['current']} for h in a['holdings']])
        return a

    def portfolio_build(self, req):
        stores = req.get('stores') or {}
        person = None
        if req.get('client_id'):
            person, _ = self._person(stores, req['client_id'])
        prof = portfolio.profile_of(req.get('profile')) or (person and portfolio.profile_of(person.get('risk_profile')))
        if not prof:
            raise ValueError('Which risk profile? One of Conservative, Moderately Conservative, Moderate, Moderately Aggressive, Aggressive'
                             + (' — this client has none on record.' if person else '.'))
        p = portfolio.build(prof, self._horizon(req), req.get('lumpsum'), req.get('sip'),
                            {'id': person['id'], 'name': person.get('name')} if person else None)
        if req.get('save', True):
            p['id'] = self.store.save_portfolio(p, self._who(req))
        return p

    def portfolio_rebalance(self, req):
        stores = req.get('stores') or {}
        person, _ = self._person(stores, req.get('client_id'))
        prof = portfolio.profile_of(req.get('profile')) or portfolio.profile_of(person.get('risk_profile'))
        if not prof:
            raise ValueError('This client has no risk profile on record — say which one to rebalance to (e.g. "moderate").')
        a = an.analyze(person, normalize.positions(person, stores))
        plan = portfolio.rebalance(a, prof, self._horizon(req))
        self.store.save_analysis('rebalance', {k: plan.get(k) for k in ('risk_profile', 'horizon', 'drift', 'move_amount', 'moves', 'into')},
                                 person['id'], person.get('name'), self._who(req))
        return plan

    def book_report(self, req):
        stores = req.get('stores') or {}
        people = normalize.people(stores)
        rep = book.book_report(people, lambda p: normalize.positions(p, stores), stores.get('platformSips'))
        self.store.save_analysis('book', {k: rep[k] for k in ('clients', 'total', 'by_class', 'sip_book', 'actions')}, None, None, self._who(req))
        return rep

    def portfolios(self, req):
        ids = req.get('client_ids')
        return {'portfolios': self.store.portfolios(ids if isinstance(ids, list) else None)}

    def client_history(self, req):
        return {'history': self.store.history(req.get('client_id'))}


ROUTES = {
    ('GET', '/health'): lambda e, r: e.health(),
    ('POST', '/client/analyze'): lambda e, r: e.client_analyze(r),
    ('POST', '/portfolio/build'): lambda e, r: e.portfolio_build(r),
    ('POST', '/portfolio/rebalance'): lambda e, r: e.portfolio_rebalance(r),
    ('POST', '/book/report'): lambda e, r: e.book_report(r),
    ('POST', '/portfolios'): lambda e, r: e.portfolios(r),
    ('POST', '/client/history'): lambda e, r: e.client_history(r),
}


def make_handler(engine, token):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'ria-engine/' + VERSION

        def log_message(self, fmt, *args):  # one line per request, never a body
            sys.stderr.write('%s %s\n' % (time.strftime('%Y-%m-%d %H:%M:%S'), fmt % args))

        def _send(self, code, obj):
            body = json.dumps(obj, default=str).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def _handle(self, method):
            if token and not hmac.compare_digest(self.headers.get('X-Ria-Engine-Token', ''), token):
                return self._send(401, {'error': 'not allowed'})
            fn = ROUTES.get((method, self.path.split('?')[0]))
            if not fn:
                return self._send(404, {'error': 'no such endpoint'})
            req = {}
            if method == 'POST':
                n = int(self.headers.get('Content-Length') or 0)
                if n > MAX_BODY:
                    return self._send(413, {'error': 'request too large'})
                try:
                    req = json.loads(self.rfile.read(n) or b'{}')
                except ValueError:
                    return self._send(400, {'error': 'not JSON'})
            try:
                return self._send(200, fn(engine, req))
            except LookupError as e:
                return self._send(404, {'error': str(e)})
            except ValueError as e:
                return self._send(400, {'error': str(e)})
            except Exception:  # noqa — log the trace, never the request body
                traceback.print_exc()
                return self._send(500, {'error': 'the engine could not finish this request'})

        def do_GET(self):
            self._handle('GET')

        def do_POST(self):
            self._handle('POST')

    return Handler


def main():
    port = int(os.environ.get('RIA_ENGINE_PORT') or 8765)
    token = os.environ.get('RIA_ENGINE_TOKEN') or ''
    engine = Engine()
    srv = ThreadingHTTPServer(('127.0.0.1', port), make_handler(engine, token))
    sys.stderr.write('ria-engine %s on 127.0.0.1:%d · db %s · token %s\n' % (VERSION, port, engine.store.path, 'set' if token else 'NOT SET'))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()

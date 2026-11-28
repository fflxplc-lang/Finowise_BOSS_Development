"""The engine end to end, on synthetic records: analysis, model portfolio, rebalance, book report, its database, its HTTP door.

    python3 -m unittest discover -s ria_engine/tests -v
"""
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from ria_engine import db as dbmod
from ria_engine import server

HOLD = 'Quant Flexi Cap Gr Reg Plan'          # Top / Upper Mid in 4 of the last 5 years in the firm's sheet
SWITCH = 'Tata Flexi Cap Reg Gr'              # Bottom in 2 of the last 3 years
BOND = 'ICICI Pru Corp Bond Gr'


def stores():
    clients = [
        {'id': 'c1', 'cmsName': 'ZZ Asha Test', 'pan': 'ZZZPA1234Z', 'branch': 'Mumbai', 'rmName': 't1', 'riskProfile': 'Aggressive', 'dob': '1980-05-01'},
        {'id': 'c2', 'cmsName': 'ZZ Bhavesh Test', 'pan': 'ZZZPB1234Z', 'branch': 'Pune', 'rmName': 't1', 'riskProfile': 'Conservative', 'dob': '1960-01-01'},
        {'id': 'c3', 'cmsName': 'ZZ No Holdings', 'pan': 'ZZZPC1234Z', 'branch': 'Pune', 'rmName': 't1'},
    ]
    h = lambda i, c, name, inv, cur, d='2021-01-01': {'id': i, 'clientId': c, 'schemeName': name, 'invested': inv, 'current': cur, 'purchaseDate': d}
    holdings = [h('h1', 'c1', HOLD, 400000, 700000), h('h2', 'c1', SWITCH, 300000, 280000), h('h3', 'c1', BOND, 200000, 230000),
                h('h4', 'c1', 'ZZ Mystery Holding', 1000, 1200),
                h('h5', 'c2', HOLD, 500000, 900000), h('h6', 'c2', BOND, 50000, 60000)]
    sips = [{'id': 's1', 'clientId': 'c1', 'schemeName': HOLD, 'monthlyAmount': 10000, 'status': 'Active'},
            {'id': 's2', 'clientId': 'c2', 'schemeName': BOND, 'monthlyAmount': 5000, 'status': 'Cancelled'}]
    return {'clients': clients, 'team': [{'id': 't1', 'name': 'ZZ RM'}], 'platformHoldings': holdings, 'platformSips': sips,
            'transactions': [], 'schemes': []}


class EngineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.store = dbmod.Store(os.path.join(self.tmp, 'ria.sqlite'))
        self.e = server.Engine(self.store)

    def tearDown(self):
        self.store.close()

    def test_client_analysis_actions_and_answer(self):
        a = self.e.client_analyze({'client_id': 'c1', 'stores': stores(), 'user': {'email': 'zz@test'}})
        acts = {h['scheme']: h['action'] for h in a['holdings']}
        self.assertEqual(acts[SWITCH], 'Switch')
        self.assertEqual(acts[HOLD], 'Reduce')          # 57% of the portfolio: above the 25% limit, even with a good record
        self.assertEqual(acts['ZZ Mystery Holding'], 'Review')
        self.assertEqual(a['total'], 700000 + 280000 + 230000 + 1200)
        self.assertGreater(a['mix']['equity'], 60)
        self.assertGreater(a['mix']['debt'], 15)         # "Corp Bond" read with the sheet's abbreviations written out
        self.assertIn('Portfolio analysis — ZZ Asha Test', a['answer'])
        self.assertNotRegex(a['answer'], r'\bBuy\b|\bSell\b')
        self.assertTrue(any('Concentration' in f for f in a['findings']))
        self.assertNotIn('ZZZPA1234Z', json.dumps(a))   # no PAN in what comes back
        self.assertEqual(self.store.counts()['analyses'], 1)

    def test_changed_since_last_analysis(self):
        s = stores()
        self.e.client_analyze({'client_id': 'c1', 'stores': s})
        s['platformHoldings'][0]['current'] = 100000     # no longer above 25%: Reduce → Hold
        a = self.e.client_analyze({'client_id': 'c1', 'stores': s})
        self.assertTrue(any(c['scheme'] == HOLD and c['was'] == 'Reduce' and c['now'] == 'Hold' for c in a['changed_since_last']))
        self.assertIn('Changed since the last analysis', a['answer'])
        self.assertEqual(len(self.e.client_history({'client_id': 'c1'})['history']), 2)

    def test_unknown_client_is_refused(self):
        with self.assertRaises(LookupError):
            self.e.client_analyze({'client_id': 'not-mine', 'stores': stores()})

    def test_model_portfolio_from_the_basket(self):
        p = self.e.portfolio_build({'profile': 'moderate', 'years': 6, 'lumpsum': 1000000, 'sip': 15000, 'stores': stores()})
        self.assertEqual(p['risk_profile'], 'Moderate')
        self.assertEqual(p['horizon'], '5-7 Years')
        self.assertEqual(sum(l['pct'] for l in p['lines']), 100)
        self.assertEqual(sum(l['lumpsum'] for l in p['lines']), 1000000)
        self.assertEqual(sum(l['sip'] for l in p['lines']), 15000)
        self.assertTrue(p['id'].startswith('pf_'))
        self.assertEqual(len(self.e.portfolios({})['portfolios']), 1)

    def test_model_portfolio_uses_the_clients_profile(self):
        p = self.e.portfolio_build({'client_id': 'c2', 'stores': stores()})
        self.assertEqual(p['risk_profile'], 'Conservative')
        self.assertEqual(p['client_name'], 'ZZ Bhavesh Test')
        with self.assertRaises(ValueError):
            self.e.portfolio_build({'client_id': 'c3', 'stores': stores()})

    def test_rebalance_conservative_client(self):
        plan = self.e.portfolio_rebalance({'client_id': 'c2', 'years': 4, 'stores': stores()})
        self.assertEqual(plan['risk_profile'], 'Conservative')
        self.assertGreater(plan['drift'], 5)
        self.assertEqual(plan['heavy'], 'Equity')
        self.assertTrue(plan['moves'] and plan['into'])
        self.assertAlmostEqual(sum(i['amount'] for i in plan['into']), plan['move_amount'], delta=len(plan['into']))
        self.assertIn('Rebalance — ZZ Bhavesh Test', plan['answer'])

    def test_book_report(self):
        r = self.e.book_report({'stores': stores()})
        self.assertEqual(r['clients'], 2)
        self.assertEqual(r['clients_in_scope'], 3)
        self.assertEqual(r['sip_book'], 10000)           # the cancelled SIP is not in the book
        self.assertEqual(r['largest'][0]['name'], 'ZZ Asha Test')
        names = [c['name'] for c in r['to_act']]
        self.assertIn('ZZ Asha Test', names)
        self.assertIn('Book report', r['answer'])


class HttpTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.engine = server.Engine(dbmod.Store(os.path.join(self.tmp, 'ria.sqlite')))
        self.srv = ThreadingHTTPServer(('127.0.0.1', 0), server.make_handler(self.engine, 'zz-token'))
        self.port = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.engine.store.close()

    def call(self, method, path, body=None, token='zz-token'):
        req = urllib.request.Request('http://127.0.0.1:%d%s' % (self.port, path), method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={'Content-Type': 'application/json', 'X-Ria-Engine-Token': token})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_token_health_and_analysis(self):
        self.assertEqual(self.call('GET', '/health', token='wrong')[0], 401)
        st, h = self.call('GET', '/health')
        self.assertEqual(st, 200)
        self.assertTrue(h['quartiles'] and h['basket'])
        st, a = self.call('POST', '/client/analyze', {'client_id': 'c1', 'stores': stores()})
        self.assertEqual(st, 200)
        self.assertIn('holdings', a)
        self.assertEqual(self.call('POST', '/client/analyze', {'client_id': 'nobody', 'stores': stores()})[0], 404)
        self.assertEqual(self.call('POST', '/portfolio/build', {'profile': 'nonsense', 'stores': stores()})[0], 400)
        self.assertEqual(self.call('POST', '/nowhere', {})[0], 404)


if __name__ == '__main__':
    unittest.main()

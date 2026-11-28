"""Tests for ria_engine.classify and ria_engine.normalize, on small synthetic stores only."""
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from ria_engine import classify, normalize  # noqa: E402


def cid(c):
    return c['id'] if c else None


class ClassifyTest(unittest.TestCase):
    CASES = [
        # name, category id, asset class
        ('ICICI Prudential Bluechip Fund - Direct Growth', 'large cap', 'Equity'),
        ('Parag Parikh Flexi Cap Fund Regular Growth', 'flexi cap', 'Equity'),
        ('Nippon India Small Cap Fund', 'small cap', 'Equity'),
        ('HDFC Midcap Opportunities', 'mid cap', 'Equity'),
        ('Mirae Asset Tax Saver Fund (ELSS)', 'elss', 'Equity'),
        ('Axis Long Term Equity Fund', 'elss', 'Equity'),
        ('ABSL Liquid Fund - Growth', 'liquid', 'Liquid/Cash'),
        ('Kotak Equity Arbitrage Fund', 'arbitrage', 'Hybrid'),
        ('HDFC Balanced Advantage Fund', 'baf', 'Hybrid'),
        ('ICICI Pru BAF', 'baf', 'Hybrid'),
        ('ICICI Prudential Multi-Asset Fund', 'multi asset', 'Hybrid'),
        ('ICICI Pru Equity & Debt Fund', 'aggressive hybrid', 'Hybrid'),
        ('HDFC Corporate Bond Fund', 'corporate bond', 'Debt'),
        ('SBI Magnum Gilt Fund', 'gilt', 'Debt'),
        ('Nippon India Gold Savings Fund', 'gold', 'Gold/Commodities'),
        ('Mirae Asset Large & Midcap Fund', 'large and mid', 'Equity'),
        ('UTI Nifty 50 Index Fund', 'index', 'Equity'),
        ('ICICI Prudential Technology Fund', 'thematic', 'Equity'),
        ('SBI Banking & Financial Services Fund', 'thematic', 'Equity'),
        ('Some Unknown Growth Opportunities', None, 'Unclassified'),
        ('', None, 'Unclassified'),
    ]

    def test_categories_and_classes(self):
        for name, want_cat, want_cls in self.CASES:
            with self.subTest(name=name):
                cat = classify.category_of(name)
                self.assertEqual(cid(cat), want_cat)
                self.assertEqual(classify.asset_class_of(cat), want_cls)
                self.assertIn(classify.asset_class_of(cat), classify.CLASSES)

    def test_category_shape(self):
        c = classify.category_of('HDFC Balanced Advantage Fund')
        self.assertEqual(c, {'id': 'baf', 'label': 'BAF (balanced advantage)', 'mix': [0.5, 0.5, 0]})
        self.assertIsNone(classify.category_of(None))
        # every category the classifier can return has a risk row
        for c in classify.LEXI_CATS:
            self.assertIn(c['id'], classify.CAT_RISK)
        self.assertIn('thematic', classify.CAT_RISK)

    def test_amc(self):
        cases = [
            ('ICICI Prudential Bluechip Fund', 'ICICI Prudential'),
            ('Aditya Birla Sun Life Frontline Equity', 'Aditya Birla Sun Life'),
            ('ABSL Liquid Fund', 'Aditya Birla Sun Life'),
            ('Parag Parikh Flexi Cap', 'PPFAS'),
            ('Quant Small Cap Fund', 'Quant'),
            ('Quantum Long Term Equity Value', 'Quantum'),
            ('IDFC Core Equity', 'Bandhan'),
            ('Motilal Oswal Midcap', 'Motilal Oswal'),
            ('360 ONE Focused Equity', '360 ONE'),
            ('UTI Nifty 50 Index Fund', 'UTI'),
            ('LIC MF Large Cap', 'LIC'),
            ('Unknown House Equity Fund', ''),
            ('Equity fund by HDFC', ''),               # the AMC must lead the name
            ('', ''),
        ]
        for name, want in cases:
            with self.subTest(name=name):
                self.assertEqual(classify.amc_of(name), want)


class NumTest(unittest.TestCase):
    def test_num(self):
        self.assertEqual(normalize.num('1,23,456.78'), 123456.78)
        self.assertEqual(normalize.num('₹ 5,000'), 5000.0)
        self.assertEqual(normalize.num('-2,500'), -2500.0)
        self.assertEqual(normalize.num(''), 0.0)
        self.assertEqual(normalize.num(None), 0.0)
        self.assertEqual(normalize.num('abc'), 0.0)
        self.assertEqual(normalize.num('1.2.3'), 0.0)
        self.assertEqual(normalize.num(42), 42.0)
        self.assertEqual(normalize.num(0), 0.0)
        self.assertEqual(normalize.num(True), 0.0)
        self.assertEqual(normalize.num(float('nan')), 0.0)


def base_stores(**extra):
    s = {k: [] for k in normalize.STORES}
    s.update(extra)
    return s


class PeopleTest(unittest.TestCase):
    def test_two_rows_same_pan_merge(self):
        clients = [
            {'id': 'C-1', 'cmsName': 'Test Person Alpha', 'pan': 'ZZZPZ9999Z', 'branch': 'North Branch',
             'createdAt': '2024-01-01T00:00:00Z', 'riskProfile': '', 'mobile': '9000000001'},
            {'id': 'C-2', 'cmsName': 'Test Person Alpha - ZZZPZ9999Z', 'pan': 'zzzpz9999z', 'createdAt': '2025-06-01T00:00:00Z',
             'dob': '1960-05-01', 'riskProfile': 'Moderately Aggressive', 'assignedTo': 'TM-ABCD1', 'rmName': 'USR-ZZZZ9'},
            {'id': 'C-3', 'cmsName': 'Another Synthetic Investor', 'pan': 'ZZZPZ9998Y', 'iseqCategory': 'Conservative',
             'family': [{'dob': '1970-01-01'}]},
            {'id': 'C-4', 'cmsName': 'Deleted Row', 'pan': 'ZZZPZ9997X', 'deletedAt': '2025-01-01'},
        ]
        holdings = [{'id': 'H1', 'clientId': 'C-1', 'schemeName': 'HDFC Flexi Cap', 'current': '1,00,000'}]
        team = [{'id': 'TM-ABCD1', 'name': 'Synthetic RM'}]
        ps = normalize.people(base_stores(clients=clients, platformHoldings=holdings, team=team))
        self.assertEqual(len(ps), 2)
        p = ps[0]
        self.assertEqual(p['id'], 'C-1')                       # the row holding the AUM is primary
        self.assertEqual(p['ids'], ['C-1', 'C-2'])
        self.assertEqual(p['name'], 'Test Person Alpha')
        self.assertEqual(p['branch'], 'North Branch')
        self.assertEqual(p['rm'], 'Synthetic RM')              # team id resolved; the unknown USR id dropped
        self.assertEqual(p['rms'], ['Synthetic RM'])
        self.assertEqual(p['risk_profile'], 'Aggressive')      # newest row fills the blank
        self.assertEqual(p['dob'], '1960-05-01')
        self.assertEqual(len(p['rows']), 2)
        for k in ('pan', 'mobile', 'email', 'address'):
            self.assertNotIn(k, p)
        q = ps[1]
        self.assertEqual(q['ids'], ['C-3'])
        self.assertEqual(q['risk_profile'], 'Conservative')
        self.assertEqual(q['dob'], '1970-01-01')

    def test_different_names_same_pan_not_merged(self):
        clients = [{'id': 'A', 'cmsName': 'Anil Deshpande', 'pan': 'ZZZPZ9999Z'},
                   {'id': 'B', 'cmsName': 'Ramesh Kumar', 'pan': 'ZZZPZ9999Z'}]
        self.assertEqual(len(normalize.people(base_stores(clients=clients))), 2)

    def test_name_and_mobile_merge_without_pan(self):
        clients = [{'id': 'A', 'cmsName': 'Vishal Maurya', 'mobile': '+91 90000 00002'},
                   {'id': 'B', 'cmsName': 'Mr Vishal Maurya', 'mobile': '9000000002'}]
        ps = normalize.people(base_stores(clients=clients))
        self.assertEqual(len(ps), 2)                           # clean names differ ("mr ..."): no N: key match
        clients[1]['cmsName'] = 'vishal  maurya'
        ps = normalize.people(base_stores(clients=clients))
        self.assertEqual(len(ps), 1)


class PositionsTest(unittest.TestCase):
    def person(self, stores, cid_='C-1'):
        return next(p for p in normalize.people(stores) if cid_ in p['ids'])

    def test_scheme_holdings(self):
        stores = base_stores(
            clients=[{'id': 'C-1', 'cmsName': 'Synthetic One', 'pan': 'ZZZPZ9999Z'},
                     {'id': 'C-2', 'cmsName': 'Synthetic One', 'pan': 'ZZZPZ9999Z'}],
            platformHoldings=[
                {'id': 'H1', 'clientId': 'C-1', 'schemeName': 'Parag Parikh Flexi Cap Fund', 'invested': '50,000',
                 'current': '75,000', 'purchaseDate': '2021-04-01', 'xirr': '14.2', 'folio': 'F-1'},
                {'id': 'H2', 'clientId': 'C-2', 'schemeName': 'HDFC Corporate Bond Fund', 'invested': 20000,
                 'currentValue': 21000, 'xirr': ''},
                {'id': 'H3', 'clientId': 'C-1', 'schemeName': 'Zero Fund', 'current': 0, 'invested': 0},
                {'id': 'H4', 'clientId': 'C-1', 'schemeName': 'Gone Fund', 'current': 9, 'deletedAt': 'x'},
            ])
        pos = normalize.positions(self.person(stores), stores)
        self.assertEqual([p['scheme'] for p in pos], ['Parag Parikh Flexi Cap Fund', 'HDFC Corporate Bond Fund'])
        a, b = pos
        self.assertEqual((a['invested'], a['current'], a['start'], a['xirr']), (50000.0, 75000.0, '2021-04-01', 14.2))
        self.assertEqual((a['amc'], a['category']['id'], a['asset_class'], a['folio'], a['src']),
                         ('PPFAS', 'flexi cap', 'Equity', 'F-1', 'holding'))
        self.assertEqual((b['current'], b['xirr'], b['asset_class'], b['amc'], b['client_id']), (21000.0, None, 'Debt', 'HDFC', 'C-2'))
        for p in pos:
            self.assertEqual(set(['scheme', 'invested', 'current', 'start', 'xirr', 'amc', 'category', 'asset_class', 'folio', 'src']) - set(p), set())

    def test_multiasset_summary_replaced_by_scheme_rows(self):
        summary = {'id': 'PHD1', 'key': 'ma|mf-synthetic|MF|C-1', 'clientId': 'C-1', 'source': 'multiasset', 'platform': 'Synthetic',
                   'product': 'MF', 'invested': 300, 'current': 400,
                   'sleeves': {'Equity': {'invested': 200, 'current': 300}, 'Others': {'invested': 100, 'current': 100}}}
        rows = [
            {'client_name': 'Synthetic One', 'pan': 'ZZZPZ9999Z', 'platform_key': 'mf-synthetic', 'product': 'MF',
             'security_name': 'DSP  Midcap Fund', 'isin': 'INF000000001', 'identifier': 'FOL1', 'invested': 100,
             'current_value': 150, 'xirr': 12.5, 'start_date': '2022-01-01'},
            {'client_name': 'Synthetic One', 'pan': 'ZZZPZ9999Z', 'platform_key': 'mf-synthetic', 'product': 'MF',
             'security_name': 'Synthetic Corp 7.5% NCD', 'invested': 100, 'current_value': 110, 'asset_class': 'Bonds'},
            {'client_name': 'Synthetic One', 'pan': 'ZZZPZ9999Z', 'platform_key': 'mf-synthetic', 'product': 'MF',
             'security_name': 'Old Version Of Midcap', 'isin': 'INF000000009', 'invested': 1, 'current_value': 1,
             'removed': True},
            {'client_name': 'Synthetic One', 'cid': 'C-1', 'platform_key': 'mf-synthetic', 'product': 'MF',
             'security_name': 'Synthetic Opportunities', 'category': 'Large Cap', 'invested': 100, 'current_value': 140},
        ]
        older = [dict(rows[0], current_value=999)]          # an older upload of the same holding loses
        stores = base_stores(
            clients=[{'id': 'C-1', 'cmsName': 'Synthetic One', 'pan': 'ZZZPZ9999Z'}],
            platformHoldings=[summary],
            assetUploads=[{'id': 'U1', 'kind': 'aum', 'seq': 2}, {'id': 'U0', 'kind': 'aum', 'seq': 1},
                          {'id': 'U9', 'kind': 'aum', 'seq': 9, 'deletedAt': 'x'}],
            **{'assetRows.U1': rows, 'assetRows.U0': older,
               'assetRows.U9': [dict(rows[0], current_value=5555)]})
        self.assertIn('assetRows.U1', normalize.store_keys(stores['assetUploads']))
        self.assertNotIn('assetRows.U9', normalize.store_keys(stores['assetUploads']))
        pos = normalize.positions(self.person(stores), stores)
        self.assertEqual([p['scheme'] for p in pos], ['DSP Midcap Fund', 'Synthetic Corp 7.5% NCD', 'Synthetic Opportunities'])
        dsp, ncd, opp = pos
        self.assertEqual((dsp['current'], dsp['category']['id'], dsp['asset_class'], dsp['folio'], dsp['amc'], dsp['xirr'], dsp['start']),
                         (150.0, 'mid cap', 'Equity', 'FOL1', 'DSP', 12.5, '2022-01-01'))
        self.assertEqual((ncd['category'], ncd['asset_class'], ncd['src']), (None, 'Debt', 'holding'))
        self.assertEqual((opp['category']['id'], opp['asset_class']), ('large cap', 'Equity'))
        self.assertFalse(any(p['src'] == 'sleeve' for p in pos))

    def test_sleeves(self):
        stores = base_stores(
            clients=[{'id': 'C-1', 'cmsName': 'Synthetic One'}],
            platformHoldings=[{'id': 'PHD1', 'key': 'ma|x|MF|C-1', 'clientId': 'C-1', 'source': 'multiasset',
                               'accountOpenDate': '2020-02-02', 'current': 600,
                               'sleeves': {'Equity': {'invested': 200, 'current': 300, 'xirr': 11},
                                           'Debt': {'invested': 100, 'current': '1,00'},
                                           'Gold': {'invested': 50, 'current': 60},
                                           'Others': {'invested': 100, 'current': 140, 'xirr': ''},
                                           'Empty': {'invested': 10, 'current': 0}}}])
        pos = normalize.positions(self.person(stores), stores)
        got = [(p['scheme'], p['asset_class'], p['category']['id'] if p['category'] else None, p['src']) for p in pos]
        self.assertEqual(got, [('Equity (platform sleeve)', 'Equity', '_Equity', 'sleeve'),
                               ('Debt (platform sleeve)', 'Debt', '_Debt', 'sleeve'),
                               ('Gold (platform sleeve)', 'Gold/Commodities', None, 'sleeve'),
                               ('Others (platform sleeve)', 'Unclassified', None, 'sleeve')])
        self.assertEqual((pos[0]['xirr'], pos[0]['start'], pos[1]['current'], pos[3]['xirr']), (11.0, '2020-02-02', 100.0, None))

    def test_sip_fallback(self):
        stores = base_stores(
            clients=[{'id': 'C-1', 'cmsName': 'Synthetic One'}],
            platformHoldings=[{'id': 'T1', 'clientId': 'C-1', 'current': '1,000', 'invested': 800, 'xirr': 9}],
            platformSips=[{'id': 'S1', 'clientId': 'C-1', 'schemeName': 'SBI Small Cap Fund', 'current': 600, 'invested': 500,
                           'startDate': '2023-03-01'},
                          {'id': 'S2', 'clientId': 'C-1', 'schemeName': 'Kotak Arbitrage Fund', 'current': 300, 'invested': 250,
                           'regDate': '2023-05-01', 'xirr': '7.1'},
                          {'id': 'S3', 'clientId': 'C-1', 'schemeName': 'No Value', 'current': 0}])
        pos = normalize.positions(self.person(stores), stores)
        got = [(p['scheme'], p['current'], p['invested'], p['asset_class'], p['src']) for p in pos]
        self.assertEqual(got, [('SBI Small Cap Fund', 600.0, 500.0, 'Equity', 'sip'),
                               ('Kotak Arbitrage Fund', 300.0, 250.0, 'Hybrid', 'sip'),
                               ('Unclassified holdings (no scheme in the report)', 100.0, 50.0, 'Unclassified', 'holding')])
        self.assertEqual((pos[1]['start'], pos[1]['xirr'], pos[2]['xirr']), ('2023-05-01', 7.1, 9.0))

    def test_sip_fallback_skipped_when_total_too_small(self):
        stores = base_stores(
            clients=[{'id': 'C-1', 'cmsName': 'Synthetic One'}],
            platformHoldings=[{'id': 'T1', 'clientId': 'C-1', 'current': 500}],
            platformSips=[{'id': 'S1', 'clientId': 'C-1', 'schemeName': 'SBI Small Cap Fund', 'current': 600}])
        pos = normalize.positions(self.person(stores), stores)
        self.assertEqual([(p['scheme'], p['current']) for p in pos], [('Unclassified holdings (no scheme in the report)', 500.0)])

    def test_ledger_fallback(self):
        stores = base_stores(
            clients=[{'id': 'C-1', 'cmsName': 'Synthetic One'}],
            schemes=[{'id': 'SC1', 'schemeName': 'HDFC Balanced Advantage Fund'}],
            transactions=[
                {'id': 'T1', 'clientId': 'C-1', 'schemeId': 'SC1', 'amount': '1,00,000', 'transactionType': 'Lumpsum',
                 'status': 'Completed', 'initiatedDate': '2022-07-10T10:00:00Z'},
                {'id': 'T2', 'clientId': 'C-1', 'schemeId': 'SC1', 'amount': '25,000', 'transactionType': 'Redemption',
                 'status': 'Completed', 'initiatedDate': '2023-01-01'},
                {'id': 'T3', 'clientId': 'C-1', 'schemeName': 'Axis Gilt Fund', 'amount': 5000, 'transactionType': 'SIP',
                 'status': 'Completed', 'createdAt': '2021-01-05T00:00:00Z'},
                {'id': 'T4', 'clientId': 'C-1', 'amount': 700, 'status': 'Completed', 'initiatedDate': '2024-02-02'},
                {'id': 'T5', 'clientId': 'C-1', 'schemeName': 'Pending Fund', 'amount': 9999, 'status': 'Pending'},
                {'id': 'T6', 'clientId': 'C-1', 'schemeName': 'Fully Redeemed Fund', 'amount': 100, 'status': 'Completed'},
                {'id': 'T7', 'clientId': 'C-1', 'schemeName': 'Fully Redeemed Fund', 'amount': 100, 'status': 'Completed',
                 'transactionType': 'Redemption'},
            ])
        pos = normalize.positions(self.person(stores), stores)
        got = [(p['scheme'], p['invested'], p['current'], p['start'], p['asset_class'], p['amc'], p['src']) for p in pos]
        self.assertEqual(got, [
            ('HDFC Balanced Advantage Fund', 75000.0, 75000.0, '2022-07-10', 'Hybrid', 'HDFC', 'ledger'),
            ('Axis Gilt Fund', 5000.0, 5000.0, '2021-01-05', 'Debt', 'Axis', 'ledger'),
            ('Unclassified (no scheme on the transaction)', 700.0, 700.0, '2024-02-02', 'Unclassified', '', 'ledger'),
        ])

    def test_no_ledger_when_platform_data_exists(self):
        stores = base_stores(
            clients=[{'id': 'C-1', 'cmsName': 'Synthetic One'}],
            platformHoldings=[{'id': 'H1', 'clientId': 'C-1', 'schemeName': 'Zero', 'current': 0}],
            transactions=[{'id': 'T1', 'clientId': 'C-1', 'schemeName': 'X Gilt', 'amount': 100, 'status': 'Completed'}])
        self.assertEqual(normalize.positions(self.person(stores), stores), [])


if __name__ == '__main__':
    unittest.main()

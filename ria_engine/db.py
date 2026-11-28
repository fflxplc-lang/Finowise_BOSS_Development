"""RIA AI's own database — a SQLite file beside the CRM's data, never in git.

What BOSS keeps (clients, holdings, transactions) stays in BOSS. This file
keeps what RIA AI itself makes:

  portfolios       a model portfolio built for a client or a brief, line by line
  analyses         every client / book analysis it ran, with its summary
  recommendations  each Hold / Reduce / Switch / Review it gave, holding by holding

so an adviser can see what RIA AI said last month next to what it says
today. Python's own sqlite3: nothing to install.

The file is RIA_ENGINE_DB, else <CRM data dir>/ria-engine.sqlite (CRM_DB_FILE's
folder), else ./ria-engine.sqlite.
"""
import json
import os
import sqlite3
import threading
import time
import uuid

SCHEMA = """
CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY, client_id TEXT, client_name TEXT, title TEXT NOT NULL,
  risk_profile TEXT, horizon TEXT, lumpsum REAL, sip REAL, equity_pct REAL, debt_pct REAL,
  lines_json TEXT NOT NULL, created_by TEXT, created_at REAL NOT NULL, archived INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS analyses (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, client_id TEXT, client_name TEXT,
  summary_json TEXT NOT NULL, created_by TEXT, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL, client_id TEXT, scheme TEXT, action TEXT,
  why TEXT, weight_pct REAL, current REAL, created_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS ix_analyses_client ON analyses(client_id, created_at);
CREATE INDEX IF NOT EXISTS ix_portfolios_client ON portfolios(client_id, created_at);
CREATE INDEX IF NOT EXISTS ix_recs_client ON recommendations(client_id, created_at);
"""


def default_path():
    if os.environ.get('RIA_ENGINE_DB'):
        return os.environ['RIA_ENGINE_DB']
    crm = os.environ.get('CRM_DB_FILE')
    if crm:
        return os.path.join(os.path.dirname(os.path.abspath(crm)), 'ria-engine.sqlite')
    return os.path.abspath('ria-engine.sqlite')


class Store:
    """A small, thread-safe wrapper: one connection, one lock."""

    def __init__(self, path=None):
        self.path = path or default_path()
        d = os.path.dirname(self.path)
        if d:
            os.makedirs(d, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.executescript(SCHEMA)
            self._db.commit()
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def close(self):
        with self._lock:
            self._db.close()

    # ---- portfolios ----
    def save_portfolio(self, p, by=''):
        pid = p.get('id') or 'pf_' + uuid.uuid4().hex[:12]
        row = (pid, p.get('client_id'), p.get('client_name'), p.get('title') or 'Model portfolio',
               p.get('risk_profile'), p.get('horizon'), p.get('lumpsum') or 0, p.get('sip') or 0,
               p.get('equity_pct'), p.get('debt_pct'), json.dumps(p.get('lines') or []), by, time.time())
        with self._lock:
            self._db.execute('INSERT OR REPLACE INTO portfolios (id, client_id, client_name, title, risk_profile, horizon, lumpsum, sip, '
                             'equity_pct, debt_pct, lines_json, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', row)
            self._db.commit()
        return pid

    def portfolios(self, client_ids=None, limit=50):
        q, args = 'SELECT * FROM portfolios WHERE archived = 0', []
        if client_ids is not None:
            if not client_ids:
                return []
            q += ' AND client_id IN (%s)' % ','.join('?' * len(client_ids))
            args += list(client_ids)
        q += ' ORDER BY created_at DESC LIMIT ?'
        args.append(int(limit))
        with self._lock:
            rows = self._db.execute(q, args).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d['lines'] = json.loads(d.pop('lines_json') or '[]')
            out.append(d)
        return out

    # ---- analyses + recommendations ----
    def save_analysis(self, kind, summary, client_id=None, client_name=None, by='', recs=None):
        aid = 'an_' + uuid.uuid4().hex[:12]
        now = time.time()
        with self._lock:
            self._db.execute('INSERT INTO analyses (id, kind, client_id, client_name, summary_json, created_by, created_at) VALUES (?,?,?,?,?,?,?)',
                             (aid, kind, client_id, client_name, json.dumps(summary), by, now))
            for r in recs or []:
                self._db.execute('INSERT INTO recommendations (id, analysis_id, client_id, scheme, action, why, weight_pct, current, created_at) '
                                 'VALUES (?,?,?,?,?,?,?,?,?)',
                                 ('rc_' + uuid.uuid4().hex[:12], aid, client_id, r.get('scheme'), r.get('action'), r.get('why'),
                                  r.get('weight_pct'), r.get('current'), now))
            self._db.commit()
        return aid

    def history(self, client_id, limit=10):
        with self._lock:
            rows = self._db.execute('SELECT id, kind, client_name, summary_json, created_by, created_at FROM analyses '
                                    'WHERE client_id = ? ORDER BY created_at DESC LIMIT ?', (client_id, int(limit))).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d['summary'] = json.loads(d.pop('summary_json') or '{}')
            out.append(d)
        return out

    def last_recommendations(self, client_id):
        """The recommendations of the client's previous analysis, scheme → action."""
        with self._lock:
            row = self._db.execute('SELECT id FROM analyses WHERE client_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1',
                                   (client_id, 'client')).fetchone()
            if not row:
                return {}
            recs = self._db.execute('SELECT scheme, action FROM recommendations WHERE analysis_id = ?', (row['id'],)).fetchall()
        return {r['scheme']: r['action'] for r in recs}

    def counts(self):
        with self._lock:
            return {t: self._db.execute('SELECT COUNT(*) FROM ' + t).fetchone()[0] for t in ('portfolios', 'analyses', 'recommendations')}

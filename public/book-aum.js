/*!
 * book-aum.js  —  the Live AUM book, in one place
 * -----------------------------------------------------------------------------
 * Pure functions only: no DOM, no storage, no globals. The browser loads it
 * with <script src> (the Dashboard's Live AUM / Live SIP cards are built from
 * it) and the server require()s the same file (RIA AI's total AUM is built
 * from it), so the two can never compute the book differently.
 *
 * THE BOOK (unchanged from the Dashboard's mdBookRows):
 *   per client, the imported platform report where there is one —
 *     each asset-class sleeve as a row, plus whatever the sleeves do not
 *     account for, so the rows always sum to the report's total;
 *   otherwise the BOSS ledger — completed, undeleted, non-Main transactions,
 *     redemptions taken off.
 *   SIP: the imported SIP report where there is one, otherwise SIP-type
 *   ledger transactions.
 *
 * The caller decides WHICH clients and transactions are in scope (the
 * Dashboard by its visibility rules, the server by the signed-in account);
 * this file only adds them up.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BookAum = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Identical to the page's numVal(): the same text, so the same number. */
  function numVal(v){ return Number(String(v||'0').replace(/[^0-9.-]/g,'')) || 0; }

  const SLEEVE_BUCKET = {Equity:'Equity', Debt:'Debt', Hybrid:'Hybrid', Physical:'Others',
    Structured:'Others', WealthPlus:'Others', Cash:'Others', Tax:'Others',
    NonARequity:'Equity', Others:'Others',
    Stocks:'Equity', IAP:'Equity', FD:'Debt', Bonds:'Debt', MutualFund:'Others', PMS:'Others',
    AIF:'Others', PE:'Others', Ledger:'Others'};
  /* A report that gives one total and no breakdown is not guessed at. */
  const NO_SPLIT = 'Not broken out';

  /* A record names a product category from Settings; anything that is not one
     of the three falls into Others rather than being dropped, so the parts
     always add to the whole. */
  function productBucket(x){
    const s = String((x && (x.productCategory || x.product || x.fundCategory)) || '').toLowerCase();
    if(/equity|large|mid|small|flexi|multi|focused|elss|index|international/.test(s)) return 'Equity';
    if(/debt|liquid|gilt|bond/.test(s)) return 'Debt';
    if(/hybrid|balanced/.test(s)) return 'Hybrid';
    return 'Others';
  }
  function signed(t){ return /redemption/i.test(t.transactionType||'') ? -numVal(t.amount) : numVal(t.amount); }
  function isMain(t){ return !!(t && t.txnRollup); }

  /* The ledger lines that count: completed, undeleted, and not a Main
     (rollup) record, which stands for its children rather than adding to them. */
  function eligibleTxns(transactions){
    return (transactions || []).filter(t=>!t.deletedAt && t.status==='Completed').filter(t=>!isMain(t));
  }

  /* The rows behind the Live AUM and Live SIP cards.
     in.clients  — the clients in scope, undeleted
     in.holdings — platform AUM snapshots (filtered here to undeleted, in scope)
     in.sips     — platform SIP registrations (likewise)
     in.txns     — eligible ledger lines already narrowed to the same scope
     h.platformLabel(id), h.teamName(id) — display names only */
  function bookRows(input, h){
    h = h || {};
    const platformLabel = h.platformLabel || (id=>id);
    const teamName = h.teamName || (id=>id);
    const clients = input.clients || [];
    const mine = new Set(clients.map(c=>c.id));
    const hold = {}, sips = {}, txn = {};
    (input.holdings || []).filter(x=>!x.deletedAt && mine.has(x.clientId))
      .forEach(x=>{ (hold[x.clientId] = hold[x.clientId] || []).push(x); });
    (input.sips || []).filter(s=>!s.deletedAt && mine.has(s.clientId))
      .forEach(s=>{ (sips[s.clientId] = sips[s.clientId] || []).push(s); });
    (input.txns || []).forEach(t=>{ (txn[t.clientId] = txn[t.clientId] || []).push(t); });

    const rows = [];
    clients.forEach(c=>{
      const base = {clientId:c.id, branch:c.branch, rm:teamName(c.rmName), category:c.clientCategory};
      const push = o => rows.push(Object.assign({aum:0, sip:0}, base, o));

      if(hold[c.id]){
        hold[c.id].forEach(x=>{
          const pl = platformLabel(x.platform);
          const src = pl + ' (imported)';
          const sleeves = Object.entries(x.sleeves || {})
            .filter(([,v])=>numVal(v.current) || numVal(v.invested));
          sleeves.forEach(([name, v])=>push({source:src, platform:pl,
            product: SLEEVE_BUCKET[name] || 'Others', aum: numVal(v.current)}));
          /* The sleeves need not add to the reported total — a report can
             carry both, and the total is the one to trust. Whatever the
             sleeves do not account for is carried as its own row so the
             cut still sums to the figure on the card. */
          const covered = sleeves.reduce((s,[,v])=>s + numVal(v.current), 0);
          const rest = numVal(x.current) - covered;
          if(Math.round(rest) !== 0) push({source:src, platform:pl,
            product: sleeves.length ? 'Others' : NO_SPLIT, aum: rest});
        });
      } else {
        (txn[c.id] || []).forEach(t=>push({source:'BOSS ledger', platform: t.platform || '—',
          product: productBucket(t), aum: signed(t)}));
      }

      if(sips[c.id]){
        sips[c.id].forEach(s=>{
          const pl = platformLabel(s.platform);
          push({source: pl + ' (imported)', platform: pl, product: NO_SPLIT,
                sip: numVal(s.monthlyAmount || s.amount)});
        });
      } else {
        (txn[c.id] || []).filter(t=>/sip/i.test(t.transactionType||''))
          .forEach(t=>push({source:'BOSS ledger', platform: t.platform || '—',
            product: productBucket(t), sip: numVal(t.amount)}));
      }
    });
    return rows;
  }

  /* The Live AUM figure itself and what it is made of — the card's own sum
     (rows with an AUM), plus what a reader needs to trust it. */
  function aumSummary(rows, input){
    const aumRows = rows.filter(r=>r.aum);
    const total = aumRows.reduce((s,r)=>s+r.aum, 0);
    let fromPlatform = 0, fromLedger = 0;
    aumRows.forEach(r=>{ if(r.source === 'BOSS ledger') fromLedger += r.aum; else fromPlatform += r.aum; });
    const withAum = new Set(aumRows.map(r=>r.clientId));
    const clients = input.clients || [];
    const mine = new Set(clients.map(c=>c.id));
    const holdings = (input.holdings || []).filter(x=>!x.deletedAt && mine.has(x.clientId));
    const withHold = new Set(holdings.map(x=>x.clientId));
    const ledgerClients = new Set((input.txns || []).map(t=>t.clientId));
    const asOn = {}; let undated = 0;
    holdings.forEach(x=>{
      const d = String(x.reportAsOn || '').trim();
      if(!d){ undated++; return; }
      const k = String(x.platform || '—');
      if(!asOn[k] || d > asOn[k]) asOn[k] = d;
    });
    return {
      total,
      fromPlatformHoldings: fromPlatform,
      fromBossLedger: fromLedger,
      clientsInScope: clients.length,
      clientsWithAum: withAum.size,
      clientsWithoutAum: clients.length - withAum.size,
      clientsUsingPlatformHoldings: withHold.size,
      clientsUsingLedger: [...ledgerClients].filter(id=>mine.has(id) && !withHold.has(id)).length,
      clientsWithBothLedgerIgnored: [...ledgerClients].filter(id=>withHold.has(id)).length,
      holdingsInScope: holdings.length,
      holdingsWithoutReportDate: undated,
      platformAsOn: asOn,
    };
  }

  return { VERSION: '1', numVal, SLEEVE_BUCKET, NO_SPLIT, productBucket, signed, isMain,
           eligibleTxns, bookRows, aumSummary };
});

#!/usr/bin/env node
'use strict';
/*
 * Finowise B2C — RIA AI Phase 0 data census (read-only, counts only).
 *
 * Usage:   node ria-b2c-census.js /path/to/data.json [--json]
 *
 * Guarantees
 *   - Reads the given data.json ONCE with fs.readFileSync. Never writes,
 *     renames, locks or deletes anything; no network; only Node's fs/path.
 *   - Prints COUNTS ONLY. No client or team names, PAN, mobile, email,
 *     record ids, amounts per client or money totals of any kind.
 *   - Configured labels (statuses, transaction types, frequencies, platform
 *     codes) are printed with their counts because the SIP mapping needs
 *     them. Any label that looks identifying (PAN/phone/email/id-like, equal
 *     to a client/team/project name, or over 40 characters) is replaced by
 *     "[redacted …]".
 *
 * Run it against the B2C TEST data copy only.
 */
const fs = require('fs');
const path = require('path');

const VERSION = 'b2c-census-1.0';
const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const asJson = args.includes('--json');
if (!file) { console.error('Usage: node ria-b2c-census.js /path/to/data.json [--json]'); process.exit(2); }

let raw;
try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error('Could not read that file as JSON: ' + e.message); process.exit(1); }

function store(key, fallback) {
  const v = raw[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return fallback; } }
  return v;
}
const all = (key) => { const v = store(key, []); return Array.isArray(v) ? v.filter(Boolean) : []; };
const live = (key) => all(key).filter(r => !r.deletedAt);

const clients = live('clients'), team = live('team'), tasks = live('tasks');
const txns = live('transactions'), biz = live('businessEntries');
const holdings = live('platformHoldings'), psips = live('platformSips'), batches = live('importBatches');
const schemes = live('schemes'), amcs = live('amcs');
const projects = live('projects'), projLinks = live('projectClients');
const aumMonthly = all('aumMonthly');
const settings = store('settings', {}) || {};
const config = store('config', {}) || {};

/* ---- label redaction ---- */
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const knownNames = new Set();
clients.forEach(c => [c.cmsName, c.name].forEach(n => { const k = norm(n); if (k) knownNames.add(k); }));
team.forEach(t => { const k = norm(t.name); if (k) knownNames.add(k); });
projects.forEach(p => { const k = norm(p.name); if (k) knownNames.add(k); });
const SAFE = '\u0000';
function safeLabel(v) {
  if (typeof v === 'string' && v[0] === SAFE) return v.slice(1);
  const s = String(v == null ? '' : v).trim();
  if (!s) return '(blank)';
  if (s.length > 40) return '[redacted: long value]';
  if (/[A-Z]{5}[0-9]{4}[A-Z]/i.test(s)) return '[redacted: PAN-like]';
  if (s.replace(/\D/g, '').length >= 10) return '[redacted: phone-like]';
  if (/@/.test(s)) return '[redacted: email-like]';
  if (/^[A-Z]{2,6}-[A-Z0-9]{5,}$/i.test(s) || /^\d{6,}$/.test(s)) return '[redacted: id-like]';
  if (knownNames.has(norm(s))) return '[redacted: matches a name]';
  return s;
}
function tally(list, fn) {
  const m = new Map();
  list.forEach(r => { let k; try { k = fn(r); } catch (e) { k = ''; } k = safeLabel(k); m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}
function settingLabels(key, def) {
  const rec = settings[key];
  let v = rec && rec.value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { v = v.split(/\r?\n|,/); } }
  if (!Array.isArray(v) || !v.length) return { source: 'default (not changed in Setup)', labels: def };
  return { source: 'Setup (configured)', labels: v.filter(i => i && (typeof i !== 'object' || (i.isActive !== false && !i.isArchived)))
    .map(i => typeof i === 'object' ? i.label : i).filter(Boolean).map(safeLabel) };
}
const num = (v) => Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')) || 0;
const has = (v) => String(v == null ? '' : v).trim() !== '';

const clientIds = new Set(clients.map(c => c.id));
const teamById = new Map(team.map(t => [t.id, t]));
const inactive = (t) => /inactive|left|disabled|deactivated/i.test(String(t.status || 'Active'));
const isSipKind = (v) => /sip|monthly/i.test(String(v || ''));
const isMain = (t) => !!(t && t.txnRollup);
const leaf = txns.filter(t => !isMain(t));
const completed = leaf.filter(t => t.status === 'Completed');

/* ---- AUM (the dashboard's book logic: holdings first, else completed ledger) ---- */
const withHold = new Set(holdings.map(h => h.clientId).filter(id => clientIds.has(id)));
const withLedger = new Set(completed.map(t => t.clientId).filter(id => clientIds.has(id)));
const aum = {
  clients: clients.length,
  clientsWithPlatformHoldings: withHold.size,
  clientsWithCompletedLedgerOnly: [...withLedger].filter(id => !withHold.has(id)).length,
  clientsWithBoth_ledgerIgnoredByDashboard: [...withLedger].filter(id => withHold.has(id)).length,
  clientsWithNeither_noAumFigure: clients.filter(c => !withHold.has(c.id) && !withLedger.has(c.id)).length,
  holdings: holdings.length,
  holdingsByPlatform: tally(holdings, h => h.platform),
  holdingsWithAssetClassSleeves: holdings.filter(h => h.sleeves && Object.keys(h.sleeves).length).length,
  holdingsWithoutSleeves_noProductSplit: holdings.filter(h => !(h.sleeves && Object.keys(h.sleeves).length)).length,
  holdingsWithSchemeLevelDetail: holdings.filter(h => has(h.schemeName) || has(h.schemeId) || has(h.isin)).length,
  holdingsWithoutReportAsOnDate: holdings.filter(h => !has(h.reportAsOn)).length,
  holdingsCurrentValueBlankOrZero: holdings.filter(h => !num(h.current)).length,
  holdingsWhoseClientIsMissing: holdings.filter(h => !clientIds.has(h.clientId)).length,
  clientsWithStaticAumFieldSet: clients.filter(c => num(c.aum)).length,
  aumImportBatchesByPlatform: tally(batches.filter(b => b.report === 'AUM'), b => b.platform),
};

/* ---- branches ---- */
const cfgBranches = Array.isArray(config.branches) ? config.branches.map(norm) : [];
const branchVals = clients.map(c => norm(c.branch)).filter(Boolean);
const branch = {
  configuredBranches: cfgBranches.length,
  distinctBranchValuesOnClients: new Set(branchVals).size,
  clientsWithoutBranch: clients.filter(c => !has(c.branch)).length,
  clientsWhoseBranchIsNotInConfiguredList: clients.filter(c => has(c.branch) && cfgBranches.length && !cfgBranches.includes(norm(c.branch))).length,
  distinctUnlistedBranchValues: new Set(branchVals.filter(b => cfgBranches.length && !cfgBranches.includes(b))).size,
};

/* ---- relationship managers ---- */
const rm = {
  teamMembers: team.length,
  distinctRmsOnClients: new Set(clients.map(c => c.rmName).filter(Boolean)).size,
  clientsWithoutRmName: clients.filter(c => !has(c.rmName)).length,
  clientsWhoseRmIsNotInTeam: clients.filter(c => has(c.rmName) && !teamById.has(c.rmName)).length,
  clientsWhoseRmIsInactive: clients.filter(c => teamById.has(c.rmName) && inactive(teamById.get(c.rmName))).length,
  clientsUsingAssignedToField: clients.filter(c => has(c.assignedTo)).length,
};

/* ---- projects ---- */
const projIds = new Set(projects.map(p => p.id));
const linkKey = new Map(), perClient = new Map(), perProject = new Map();
let dupLinks = 0;
projLinks.forEach(l => {
  const k = l.projectId + '|' + l.clientId;
  if (linkKey.has(k)) dupLinks++; else linkKey.set(k, 1);
  if (clientIds.has(l.clientId) && projIds.has(l.projectId)) {
    perClient.set(l.clientId, (perClient.get(l.clientId) || new Set()).add(l.projectId));
    perProject.set(l.projectId, (perProject.get(l.projectId) || new Set()).add(l.clientId));
  }
});
const linkedClientCountSum = [...perProject.values()].reduce((s, set) => s + set.size, 0);
const project = {
  projects: projects.length,
  projectsByCategory: tally(projects, p => p.category),
  projectClientLinks: projLinks.length,
  linksToMissingProject: projLinks.filter(l => !projIds.has(l.projectId)).length,
  linksToMissingClient: projLinks.filter(l => !clientIds.has(l.clientId)).length,
  duplicateLinks: dupLinks,
  projectsWithNoClients: projects.filter(p => !perProject.has(p.id)).length,
  clientsInNoProject: clients.filter(c => !perClient.has(c.id)).length,
  clientsInExactlyOneProject: [...perClient.values()].filter(s => s.size === 1).length,
  clientsInTwoOrMoreProjects: [...perClient.values()].filter(s => s.size >= 2).length,
  doubleCountFactor_sumOfProjectClientCounts_vs_distinctLinkedClients:
    perClient.size ? (linkedClientCountSum / perClient.size).toFixed(3) + ' (' + linkedClientCountSum + ' / ' + perClient.size + ')' : 'n/a',
};

/* ---- transactions, schemes, AMCs ---- */
const schemeById = new Map(schemes.map(s => [s.id, s]));
const amcIds = new Set(amcs.map(a => a.id));
const schemeNames = new Set(schemes.map(s => norm(s.schemeName)).filter(Boolean));
const transaction = {
  transactions: txns.length,
  mainRollups: txns.length - leaf.length,
  byType: tally(leaf, t => t.transactionType),
  byStatus: tally(leaf, t => t.status),
  completed: completed.length,
  withoutInitiatedDate: leaf.filter(t => !has(t.initiatedDate)).length,
  withoutAmount: leaf.filter(t => !num(t.amount)).length,
  withoutClient: leaf.filter(t => !clientIds.has(t.clientId)).length,
  withSchemeId: leaf.filter(t => has(t.schemeId)).length,
  schemeIdFoundInSchemeMaster: leaf.filter(t => schemeById.has(t.schemeId)).length,
  schemeHasAmcFoundInAmcMaster: leaf.filter(t => schemeById.has(t.schemeId) && amcIds.has(schemeById.get(t.schemeId).amcId)).length,
  schemesInMaster: schemes.length,
  schemesWithAmc: schemes.filter(s => amcIds.has(s.amcId)).length,
  amcsInMaster: amcs.length,
};

/* ---- SIPs ---- */
const TXN_DEF = ['Not Started', 'In Progress', 'Initiated', 'Submitted', 'Processed', 'Completed', 'Rejected'];
const BIZ_DEF = ['Pending from Client Consent', 'Not Started', 'In Process', 'Completed', 'Declined'];
const sipTx = leaf.filter(t => isSipKind(t.transactionType));
const today = new Date().toISOString().slice(0, 10), in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
const isoOf = (v) => {
  const s = String(v || '').trim(); const q = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (q) return (+q[2] >= 1 && +q[2] <= 12 && +q[3] >= 1 && +q[3] <= 31) ? q[0] : '';
  const m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3}|\d{1,2})[-\/ ](\d{2,4})$/); if (!m) return '';
  const mon = isNaN(+m[2]) ? 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[2].toLowerCase()) / 3 + 1 : +m[2];
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return (mon >= 1 && mon <= 12 && +m[1] >= 1 && +m[1] <= 31) ? `${y}-${String(mon).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}` : '';
};
const endBucket = (s) => { if (!has(s.endDate)) return 'blank'; const d = isoOf(s.endDate); if (!d) return 'unreadable date';
  if (d < today) return 'past'; if (d <= in30) return 'within 30 days'; return 'future'; };
const latest = {};
batches.filter(b => b.report === 'SIP').forEach(b => { const k = b.platform || ''; const at = String(b.at || b.createdAt || b.importedAt || b.id || '');
  if (!latest[k] || at > latest[k].at) latest[k] = { id: b.id, at }; });
const stopPause = tasks.filter(t => /sip\s*(stop|pause|cancel|cease)/i.test(String(t.taskType || '')));
const txnCfg = settingLabels('business.transactionStatuses', TXN_DEF);
const txnSet = new Set(txnCfg.labels.map(norm));
const sip = {
  configuredTransactionStatuses: txnCfg,
  configuredSipTransactionTypes: settingLabels('business.transactionTypes', ['Purchase', 'SIP', 'Redemption', 'Switch', 'Insurance Premium', 'Other']).labels.filter(isSipKind),
  configuredBusinessStatuses: settingLabels('business.statuses', BIZ_DEF),
  sipTransactions: sipTx.length,
  sipTransactionsByType: tally(sipTx, t => t.transactionType),
  sipTransactionsByStatus: tally(sipTx, t => t.status),
  sipTransactionStatusNotInConfiguredList: sipTx.filter(t => !txnSet.has(norm(t.status))).length,
  sipTransactionStageDates: {
    withPlacedAt: sipTx.filter(t => t.placedAt || t.placedOn).length,
    withAllottedAt: sipTx.filter(t => t.allottedAt).length,
    withCompletedDate: sipTx.filter(t => t.completedDate).length,
    withRejectedAttempt: sipTx.filter(t => Array.isArray(t.attempts) && t.attempts.some(a => a && a.rejectedAt)).length,
  },
  sipStatusVsStage: tally(sipTx, t => SAFE + safeLabel(t.status) + ' | ' + (t.allottedAt ? 'allotted' : (t.placedAt || t.placedOn) ? 'placed' : 'no stage date')),
  sipBusinessEntries: biz.filter(b => !b.dbtRollup && isSipKind(b.transactionType)).length,
  sipBusinessEntriesByStatus: tally(biz.filter(b => !b.dbtRollup && isSipKind(b.transactionType)), b => b.status),
  platformSips: psips.length,
  platformSipsByPlatform: tally(psips, s => s.platform),
  platformSipsWithAnyStatusField: psips.filter(s => has(s.status) || has(s.sipStatus) || has(s.state)).length,
  platformSipsEndDate: tally(psips, endBucket),
  platformSipsType: tally(psips, s => s.sipType),
  platformSipsFrequency: tally(psips, s => s.frequency),
  platformSipsWithMonthlyAmount: psips.filter(s => num(s.monthlyAmount)).length,
  platformSipsWithOnlyAmount: psips.filter(s => !num(s.monthlyAmount) && num(s.amount)).length,
  platformSipsWithNoAmount: psips.filter(s => !num(s.monthlyAmount) && !num(s.amount)).length,
  platformSipsSchemeNameMatchesSchemeMaster: psips.filter(s => schemeNames.has(norm(s.schemeName))).length,
  platformSipsWhoseClientIsMissing: psips.filter(s => !clientIds.has(s.clientId)).length,
  platformSipsNotInLatestReportOfTheirPlatform: psips.filter(s => latest[s.platform || ''] && s.batchId !== latest[s.platform || ''].id).length,
  platformSipsWithoutReportAsOnDate: psips.filter(s => !has(s.reportAsOn)).length,
  sipImportBatchesByPlatform: tally(batches.filter(b => b.report === 'SIP'), b => b.platform),
  sipStopPauseTasksByType: tally(stopPause, t => t.taskType),
  sipStopPauseTasksByStatus: tally(stopPause, t => t.overallStatus || t.status),
};

/* ---- monthly history ---- */
const months = aumMonthly.map(r => String(r.month || '')).filter(m => /^\d{4}-\d{2}$/.test(m)).sort();
const history = {
  aumMonthlyRows: aumMonthly.length,
  firstMonth: months[0] || '(none)',
  lastMonth: months[months.length - 1] || '(none)',
  rowsWithReportDate: aumMonthly.filter(r => r.dated === true).length,
  rowsFiledUnderArrivalMonth: aumMonthly.filter(r => r.dated === false).length,
  missingMonthsBetweenFirstAndLast: (() => {
    if (months.length < 2) return 0; let [y, m] = months[0].split('-').map(Number); const set = new Set(months); let miss = 0;
    while (`${y}-${String(m).padStart(2, '0')}` < months[months.length - 1]) { if (!set.has(`${y}-${String(m).padStart(2, '0')}`)) miss++; m++; if (m > 12) { m = 1; y++; } }
    return miss; })(),
};

/* ---- other field health ---- */
const health = {
  tasksWithoutAssignTo: tasks.filter(t => !has(t.assignTo)).length,
  tasksUsingAssignedToField: tasks.filter(t => has(t.assignedTo)).length,
  tasksByOverallStatus: tally(tasks, t => t.overallStatus),
};

const out = { census: VERSION, file: path.basename(file), generatedAt: new Date().toISOString(),
  storeCounts: { clients: clients.length, team: team.length, transactions: txns.length, businessEntries: biz.length, tasks: tasks.length,
    platformHoldings: holdings.length, platformSips: psips.length, importBatches: batches.length, schemes: schemes.length, amcs: amcs.length,
    projects: projects.length, projectClients: projLinks.length, aumMonthly: aumMonthly.length },
  aum, branch, rm, project, transaction, sip, history, health };

if (asJson) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); process.exit(0); }
const L = [];
const kv = (o, ind = '  ') => Object.entries(o).forEach(([k, v]) => {
  if (Array.isArray(v)) { L.push(ind + k + ':'); if (!v.length) L.push(ind + '  (none)'); v.forEach(x => L.push(ind + '  ' + (x && x.value !== undefined ? `${x.value}: ${x.count}` : String(x)))); }
  else if (v && typeof v === 'object') { L.push(ind + k + ':'); kv(v, ind + '  '); }
  else L.push(ind + k + ': ' + v);
});
L.push(`Finowise B2C — RIA AI Phase 0 census (${VERSION}) — ${out.file} — ${out.generatedAt}`);
L.push('Counts only. No names, PAN, mobile, email, ids, per-client amounts or money totals.', '');
[['STORE COUNTS', out.storeCounts], ['AUM (dashboard book logic)', aum], ['BRANCHES', branch], ['RELATIONSHIP MANAGERS', rm],
 ['PROJECTS', project], ['TRANSACTIONS, SCHEMES, AMCs', transaction], ['SIPs', sip], ['MONTHLY HISTORY (aumMonthly)', history],
 ['OTHER FIELD HEALTH', health]].forEach(([t, o]) => { L.push(t); kv(o); L.push(''); });
process.stdout.write(L.join('\n'));

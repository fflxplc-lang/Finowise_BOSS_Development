'use strict';
/* =====================================================================
   WHERE THE SERVER MAY SEND A REQUEST  (Phase 1, step 4 — day 1)

   Every outbound call that carries a stored credential, or that a person
   can point somewhere, goes through check() first and then out through
   request(), which connects to the address check() approved and nothing
   else:

     1. the URL parses, and its scheme is https (http only where a policy
        allows it, and then only to a private address — see allowHttp);
     2. its host is one of the policy's allowed hosts, exactly (the host an
        administrator saved, or a provider's fixed host);
     3. the name is resolved ONCE, and every address it resolves to is
        classified. Cloud metadata, link-local, "this network", multicast
        and reserved addresses are always refused. Loopback, private, CGNAT
        and unique-local addresses are refused unless the policy says
        allowPrivate (only the firm's own self-hosted model, decision
        2026-11-17);
     4. the connection is pinned to that address (a lookup override), so a
        name that answers differently a second later (DNS rebinding) cannot
        redirect it;
     5. redirects are never followed: a 3xx is returned as it is.

   Node built-ins only.
   ===================================================================== */
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');

function v4parts(ip) { return ip.split('.').map(Number); }
/* 'always' (never reachable), 'private' (only with allowPrivate), 'public'. */
function classify(ip) {
  let a = String(ip || '').toLowerCase();
  if (a.startsWith('::ffff:') && net.isIPv4(a.slice(7))) a = a.slice(7);          // IPv4-mapped IPv6
  if (net.isIPv4(a)) {
    const [p, q] = v4parts(a);
    if (p === 0) return 'always';                                  // 0.0.0.0/8 "this network"
    if (p === 169 && q === 254) return 'always';                   // link-local, incl. 169.254.169.254 metadata
    if (p >= 224) return 'always';                                 // multicast and reserved
    if (p === 100 && q >= 64 && q <= 127) return 'private';        // CGNAT 100.64/10
    if (p === 127) return 'private';                               // loopback
    if (p === 10) return 'private';
    if (p === 172 && q >= 16 && q <= 31) return 'private';
    if (p === 192 && q === 168) return 'private';
    if (p === 192 && q === 0 && v4parts(a)[2] === 0) return 'always';   // 192.0.0.0/24 IETF
    if (p === 198 && (q === 18 || q === 19)) return 'private';     // benchmarking
    return 'public';
  }
  if (net.isIPv6(a)) {
    if (a === '::' ) return 'always';
    if (a === '::1') return 'private';
    if (/^fe[89ab]/.test(a)) return 'always';                      // fe80::/10 link-local
    if (/^f[cd]/.test(a)) return 'private';                        // fc00::/7 unique local
    if (/^ff/.test(a)) return 'always';                            // multicast
    if (a.startsWith('fd00:ec2::254') ) return 'always';           // AWS metadata over IPv6
    return 'public';
  }
  return 'always';
}

function lookupAll(host) {
  return new Promise((resolve) => {
    if (net.isIP(host)) return resolve([{ address: host, family: net.isIP(host) }]);
    dns.lookup(host, { all: true, verbatim: true }, (err, addrs) => resolve(err ? null : addrs));
  });
}

/* policy: { hosts: [allowed host names] (required), allowPrivate, allowHttp }
   -> { ok, reason, url, address, family } */
async function check(urlString, policy) {
  policy = policy || {};
  let url;
  try { url = new URL(String(urlString || '')); } catch (e) { return { ok: false, reason: 'not_a_url', message: 'That is not a valid URL.' }; }
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url', message: 'A URL with a user name or password in it is not allowed.' };
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && policy.allowHttp))
    return { ok: false, reason: 'scheme', message: 'Use an https:// endpoint — a credential must not travel over plain http.' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const allowed = (policy.hosts || []).map((h) => String(h || '').replace(/^\[|\]$/g, '').toLowerCase()).filter(Boolean);
  if (!allowed.includes(host)) return { ok: false, reason: 'host_not_approved', message: 'That address is not the one saved for this connector.' };
  if (host === 'localhost' || host.endsWith('.localhost')) {
    if (!policy.allowPrivate) return { ok: false, reason: 'private_address', message: 'That address is on this server’s own network, which a connector may not reach.' };
  }
  const addrs = await lookupAll(host === 'localhost' ? '127.0.0.1' : host);
  if (!addrs || !addrs.length) return { ok: false, reason: 'dns', message: 'That host name could not be resolved.' };
  for (const a of addrs) {
    const k = classify(a.address);
    if (k === 'always') return { ok: false, reason: 'blocked_address', message: 'That address (a link-local, metadata or reserved address) may never be reached.' };
    if (k === 'private' && !policy.allowPrivate) return { ok: false, reason: 'private_address', message: 'That address is on this server’s own network, which a connector may not reach.' };
  }
  const priv = addrs.some((a) => classify(a.address) === 'private');
  if (url.protocol === 'http:' && !priv) return { ok: false, reason: 'scheme', message: 'Plain http is only for a model server on the firm’s own network; a public address needs https://.' };
  return { ok: true, url, address: addrs[0].address, family: addrs[0].family || net.isIP(addrs[0].address) };
}

/* A request to an address check() approved, pinned to it. Same shape as
   http.request; the callback gets the response. Never follows redirects
   (Node does not, and nothing here does either). */
function request(checked, opts, onResponse) {
  const url = checked.url;
  const lib = url.protocol === 'http:' ? http : https;
  const pinned = (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    if (options && options.all) return cb(null, [{ address: checked.address, family: checked.family }]);
    cb(null, checked.address, checked.family);
  };
  return lib.request(Object.assign({
    hostname: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port || (url.protocol === 'http:' ? 80 : 443),
    path: url.pathname + url.search,
    lookup: pinned,
    servername: net.isIP(url.hostname) ? undefined : url.hostname,
  }, opts || {}), onResponse);
}

module.exports = { check, request, classify };

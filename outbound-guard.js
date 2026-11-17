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
function classifyV4(p, q, r, t) {
  if (p === 168 && q === 63 && r === 129 && t === 16) return 'always';    // Azure WireServer / metadata
  if (p === 0) return 'always';                                    // 0.0.0.0/8 "this network"
  if (p === 169 && q === 254) return 'always';                     // link-local, incl. 169.254.169.254 metadata
  if (p >= 224) return 'always';                                   // multicast and reserved
  if (p === 192 && q === 0 && r === 0) return 'always';            // 192.0.0.0/24 IETF
  if ((p === 192 && q === 0 && r === 2) || (p === 198 && q === 51 && r === 100) || (p === 203 && q === 0 && r === 113)) return 'always';   // documentation
  if (p === 100 && q >= 64 && q <= 127) return 'private';          // CGNAT 100.64/10
  if (p === 127) return 'private';                                 // loopback
  if (p === 10) return 'private';
  if (p === 172 && q >= 16 && q <= 31) return 'private';
  if (p === 192 && q === 168) return 'private';
  if (p === 198 && (q === 18 || q === 19)) return 'private';       // benchmarking
  return 'public';
}
/* An IPv6 address as its eight 16-bit groups, whatever the spelling
   (compressed, with an embedded dotted IPv4, mixed case, a zone id). */
function v6words(addr) {
  let a = String(addr || '').replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (!net.isIPv6(a)) return null;
  let tail = [];
  const m = a.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const b = m.slice(1).map(Number);
    tail = [(b[0] << 8) | b[1], (b[2] << 8) | b[3]];
    a = a.slice(0, a.length - m[0].length);
    if (a.endsWith(':') && !a.endsWith('::')) a = a.slice(0, -1);
  }
  const dbl = a.indexOf('::');
  const part = (x) => (x ? x.split(':').filter((y) => y !== '') : []);
  let words;
  if (dbl >= 0) {
    const h = part(a.slice(0, dbl)), t = part(a.slice(dbl + 2));
    const fill = 8 - tail.length - h.length - t.length;
    if (fill < 0) return null;
    words = h.concat(new Array(fill).fill('0'), t);
  } else words = part(a);
  words = words.map((x) => parseInt(x, 16)).concat(tail);
  return words.length === 8 && words.every((w) => w >= 0 && w <= 0xffff) ? words : null;
}
const v4of = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
/* 'always' (never reachable), 'private' (only with allowPrivate), 'public'.
   Step 6b: every IPv6 form that carries or reaches an IPv4 address is
   classified by that IPv4 address (mapped ::ffff:a.b.c.d in either
   spelling, IPv4-compatible ::a.b.c.d, IPv4-translated ::ffff:0:a.b.c.d,
   NAT64 64:ff9b::/96, 6to4 2002::/16); Teredo, documentation, site-local
   and the cloud metadata address over IPv6 are refused. */
function classify(ip) {
  const a = String(ip || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (net.isIPv4(a)) { const [p, q, r, t] = v4parts(a); return classifyV4(p, q, r, t); }
  const w = v6words(a);
  if (!w) return 'always';
  const z = (from, to) => w.slice(from, to).every((x) => x === 0);
  if (z(0, 8)) return 'always';                                                   // ::
  if (z(0, 7) && w[7] === 1) return 'private';                                    // ::1 loopback
  if (z(0, 5) && w[5] === 0xffff) return classifyV4(...v4of(w[6], w[7]));         // ::ffff:a.b.c.d mapped
  if (z(0, 4) && w[4] === 0xffff && w[5] === 0) return classifyV4(...v4of(w[6], w[7]));   // ::ffff:0:a.b.c.d translated
  if (z(0, 6)) return classifyV4(...v4of(w[6], w[7]));                            // ::a.b.c.d compatible (deprecated)
  if (w[0] === 0x64 && w[1] === 0xff9b && z(2, 6)) return classifyV4(...v4of(w[6], w[7]));   // NAT64 well-known
  if (w[0] === 0x64 && w[1] === 0xff9b && w[2] === 1) return 'private';         // 64:ff9b:1::/48 local NAT64
  if (w[0] === 0x2002) return classifyV4(...v4of(w[1], w[2]));                    // 6to4
  if (w[0] === 0x2001 && w[1] === 0) return 'always';                             // Teredo (the IPv4 inside is obscured)
  if (w[0] === 0x2001 && w[1] === 0xdb8) return 'always';                         // documentation
  if (w[0] === 0xfd00 && w[1] === 0xec2 && z(2, 7) && w[7] === 0x254) return 'always';   // AWS metadata over IPv6
  if ((w[0] & 0xffc0) === 0xfe80) return 'always';                               // fe80::/10 link-local
  if ((w[0] & 0xffc0) === 0xfec0) return 'private';                              // fec0::/10 site-local (deprecated)
  if ((w[0] & 0xfe00) === 0xfc00) return 'private';                              // fc00::/7 unique local
  if ((w[0] & 0xff00) === 0xff00) return 'always';                               // multicast
  return 'public';
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

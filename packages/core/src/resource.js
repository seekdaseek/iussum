// Resource matching with boundaries (Addendum C, fix 10). Compare PARSED URLs: scheme, host and port exactly; the path prefix must end at a
// '/' boundary or be exact. Plain string startsWith let https://api.x.com match https://api.x.com.evil.io/... and /v1 match /v10.
import { fails, registerCheck } from './guard.js';
export const RESOURCE_CHECKS = ['resource.origin_exact', 'resource.path_boundary', 'resource.no_userinfo', 'resource.https_only'].map(registerCheck);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const DEFAULT_PORT = { 'http:': '80', 'https:': '443' };
export function parseHttpUrl(s) {
  if (typeof s !== 'string' || s.length === 0) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u;
}
// A prefix must be an absolute http(s) URL with no credentials, no query and no fragment.
export function prefixErrors(p) {
  const u = parseHttpUrl(p);
  if (!u) return 'not an absolute http(s) URL';
  if (u.username || u.password) return 'must not contain credentials';
  if (u.search || u.hash) return 'must not contain a query or fragment';
  // http:// would let a man in the middle rewrite a 402; only local development hosts may use it (Addendum E, S8)
  if (fails('resource.https_only', u.protocol === 'http:' && !LOCAL_HOSTS.has(u.hostname))) return 'must be https:// (http:// is allowed only for localhost, 127.0.0.1 and [::1])';
  return null;
}
// What a resource is for matching: origin + path, no query, no fragment (the seller signs origin + path).
export function normalizeResource(s) {
  const u = parseHttpUrl(s);
  return u ? `${u.origin}${u.pathname}` : null;
}
const portOf = (u) => u.port || DEFAULT_PORT[u.protocol];
export function resourceAllowed(prefixes, resource) {
  const r = parseHttpUrl(resource);
  if (!r) return false;
  if (fails('resource.no_userinfo', r.username || r.password)) return false;
  for (const prefix of prefixes) {
    const p = parseHttpUrl(prefix);
    if (!p) continue;
    if (fails('resource.origin_exact', !(p.protocol === r.protocol && p.hostname === r.hostname && portOf(p) === portOf(r)))) continue;
    const pp = p.pathname, rp = r.pathname;
    const onBoundary = rp === pp || (pp.endsWith('/') ? rp.startsWith(pp) : rp.startsWith(`${pp}/`));
    if (fails('resource.path_boundary', !onBoundary)) continue;
    return true;
  }
  return false;
}

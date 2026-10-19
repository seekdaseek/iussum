// RFC 8785 JSON Canonicalization Scheme for the JSON subset iussum uses: null, booleans, finite numbers
// (ECMAScript number serialization, which is what RFC 8785 specifies), strings, arrays, objects. Keys are
// sorted by UTF-16 code units (Array.prototype.sort default). Amounts travel as decimal strings, so BigInt is refused.
import { createHash } from 'node:crypto';
export function canonicalize(v) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean': return v ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('jcs: non-finite number');
      return JSON.stringify(v);
    case 'string': return JSON.stringify(v);
    case 'object': {
      if (Array.isArray(v)) return `[${v.map(canonicalize).join(',')}]`;
      const keys = Object.keys(v).sort();
      return `{${keys.map((k) => { if (v[k] === undefined) throw new TypeError(`jcs: undefined at ${k}`); return `${JSON.stringify(k)}:${canonicalize(v[k])}`; }).join(',')}}`;
    }
    default: throw new TypeError(`jcs: unsupported ${typeof v}`);
  }
}
export const sha256Hex = (s) => createHash('sha256').update(typeof s === 'string' ? Buffer.from(s, 'utf8') : s).digest('hex');

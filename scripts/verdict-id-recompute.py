# Independent recomputation of verdict_id from each response alone (RFC 8785 JCS, records here hold only ASCII-keyed objects, strings, ints, bools, null).
import json, hashlib, sys
def jcs(v):
    if v is None: return 'null'
    if v is True: return 'true'
    if v is False: return 'false'
    if isinstance(v, int): return str(v)
    if isinstance(v, float):
        if v.is_integer() and abs(v) < 2**53: return str(int(v))
        raise SystemExit('non-integer number: ' + repr(v))
    if isinstance(v, str): return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list): return '[' + ','.join(jcs(x) for x in v) + ']'
    if isinstance(v, dict):
        ks = sorted(v.keys(), key=lambda k: k.encode('utf-16-be'))
        return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + jcs(v[k]) for k in ks) + '}'
    raise SystemExit('type ' + str(type(v)))
h = lambda s: hashlib.sha256(s.encode('utf-8')).hexdigest()
FIELDS = ['tx_sig', 'mandate_id', 'grant_tx', 'receipt_sha256', 'verdict', 'reason', 'liable', 'delta', 'unjudged', 'provisional']
bad = 0
for r in json.load(open(sys.argv[1])):
    if r['kind'] == 'dispute':
        b = r['body']
        if 'verdict_id' not in b: print(f"{r['name']:<44} status {r['status']} no verdict_id ({b.get('reason')})"); continue
        rec = b.get('record'); vid = b['verdict_id']
        ok = rec is not None and h(jcs(rec)) == vid
        extra = ''
        if rec is not None:
            if sorted(rec.keys()) != sorted(FIELDS): extra += f' record keys {sorted(rec.keys())}'
            # does the record describe the verdict the response's top level reports? (a duplicate reports the stored one)
            top = b.get('original_reason', b.get('reason'))
            if rec['reason'] != top or rec['liable'] != b.get('liable') or rec['verdict'] != b.get('verdict'): extra += f" record({rec['reason']},{rec['liable']}) vs top({top},{b.get('liable')})"
            if r['sent_receipt'] and not b.get('duplicate') and rec['receipt_sha256'] != h(jcs(r['sent_receipt'])): extra += ' receipt_sha256 != sha256(JCS(sent receipt))'
        reps = []
        for e in b.get('replaced', []) or []:
            v = e['verdict']
            orec = {'tx_sig': rec['tx_sig'], 'mandate_id': v.get('mandate_id'), 'grant_tx': e.get('grant_tx'), 'receipt_sha256': e.get('receipt_sha'), 'verdict': v['verdict'], 'reason': v['reason'], 'liable': v.get('liable'), 'delta': v.get('delta', []), 'unjudged': v.get('unjudged', []), 'provisional': e.get('provisional')}
            reps.append('ok' if e.get('verdict_id') == h(jcs(orec)) else f"MISMATCH(kept {str(e.get('verdict_id'))[:8]} recomputed {h(jcs(orec))[:8]})")
        bad += (not ok) + sum(x != 'ok' for x in reps)
        print(f"{r['name']:<44} id {vid[:12]} recompute {'ok' if ok else 'MISMATCH'}{extra}{' replaced: ' + ','.join(reps) if reps else ''}")
    else:
        lines = r['text'].split('\n'); vid = next(l for l in lines if l.startswith('Verdict id:')).split(':', 1)[1].strip()
        rec = json.loads(next(l for l in lines if l.startswith('Record:')).split(':', 1)[1].strip())
        ok = h(jcs(rec)) == vid; bad += not ok
        print(f"{r['name']:<44} id {vid[:12]} recompute {'ok' if ok else 'MISMATCH'}")
print('mismatches:', bad)

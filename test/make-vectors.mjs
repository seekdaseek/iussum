// Generates test/vectors/*.json from test/fixtures.mjs. Inputs are deterministic; the EXPECTED values are written by hand here
// (never computed by the code under test). Run: node test/make-vectors.mjs
import fs from 'node:fs';
import { mandateId, summaryLine, signReceipt, receiptKey, offerHash, canonicalize, sha256Hex, COMPUTE_BUDGET, MEMO_V2 } from '@iussum/core';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { A, T0, DAY, SRC, DEST, RES, SELLER_KEY, WRONG_KEY, mandate, M, MID, key, grantTx, payTx, SIG, receipt } from './fixtures.mjs';
const OUT = new URL('./vectors/', import.meta.url);
const base = () => ({ tx_sig: SIG('P'), network: A.net, mandate: M, grant_tx: SIG('G'), grant_tx_parsed: grantTx(M), receipt: receipt(), seller_pubkey: SELLER_KEY.publicKey, payment: payTx(), history: null });
const R = (name, change, expect, note) => ({ name, kind: 'resolve', note, input: change(base()), expect });
const exp = (verdict, reason, liable, more = {}) => ({ verdict, reason, liable, ...more });

const vec = {};
// ---------------- jcs
vec.jcs = [
  { name: 'key order and unicode (RFC 8785 3.2.3 order)', kind: 'jcs', input: { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' }, expect: '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude00":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}' },
  { name: 'nested objects and arrays keep array order, sort object keys', kind: 'jcs', input: { b: [3, 1, 2], a: { z: null, y: true, x: '\u00fc' } }, expect: '{"a":{"x":"\u00fc","y":true,"z":null},"b":[3,1,2]}' },
  { name: 'integers serialise as ECMAScript numbers', kind: 'jcs', input: { n: 1, m: 0, big: 9007199254740991 }, expect: '{"big":9007199254740991,"m":0,"n":1}' },
  { name: 'amounts above 2^53 stay decimal strings', kind: 'jcs', input: { amount: '9007199254740993' }, expect: '{"amount":"9007199254740993"}' },
];
// ---------------- mandate id and summary (pinned: regression for the byte format)
vec.mandate = [
  { name: 'mandate id is sha256 of the JCS bytes (pinned)', kind: 'mandate-id', input: M, expect: { id: sha256Hex(canonicalize(M)), jcs: canonicalize(M) } },
  { name: 'key order does not change the id', kind: 'mandate-id', input: JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(M).reverse()))), expect: { id: MID, jcs: canonicalize(M) } },
  { name: 'summary line ends in the full 64-hex id', kind: 'summary', input: M, expect: summaryLine(M) },
  { name: 'amounts above 2^53 are valid mandates', kind: 'mandate-valid', input: mandate({ total_cap: '90071992547409930', per_payment_max: '9007199254740993', period_budget: '90071992547409930' }), expect: [] },
  { name: 'a number instead of a decimal string is refused', kind: 'mandate-valid', input: { ...M, total_cap: 1000000 }, expect: ['total_cap must be a positive decimal string'] },
  { name: 'unknown key is refused', kind: 'mandate-valid', input: { ...M, delegation: 'x' }, expect: ['unknown key delegation'] },
  { name: 'old v0.1 field principal_sig is refused', kind: 'mandate-valid', input: { ...M, principal_sig: 'x' }, expect: ['unknown key principal_sig'] },
  { name: 'per_payment_max above total_cap is refused', kind: 'mandate-valid', input: mandate({ per_payment_max: '2000000' }), expect: ['per_payment_max exceeds total_cap'] },
  { name: 'expires_at not after not_before is refused', kind: 'mandate-valid', input: mandate({ expires_at: T0 }), expect: ['expires_at must be after not_before'] },
];
// ---------------- scope (pure tier 1)
const P0 = { amount: '10000', pay_to: A.sellerA, resource: `${RES}quote`, asset: A.asset, network: A.net, payer: A.agent, time: T0 + 100 };
const S = (name, p, expectCodes) => ({ name, kind: 'scope', input: { mandate: M, payment: { ...P0, ...p } }, expect: expectCodes });
vec.scope = [
  S('in scope', {}, []),
  S('amount exactly at the cap is in scope', { amount: '50000' }, []),
  S('amount one above the cap', { amount: '50001' }, ['amount_over_cap']),
  S('amount above 2^53 compared as BigInt', { amount: '9007199254740993' }, ['amount_over_cap']),
  S('pay_to not on the list', { pay_to: A.sellerC }, ['pay_to_not_allowed']),
  S('resource outside the prefix', { resource: 'https://evil.example/v1/quote' }, ['resource_not_allowed']),
  S('resource missing', { resource: null }, ['resource_not_allowed']),
  S('asset differs', { asset: A.otherMint }, ['asset_mismatch']),
  S('network differs', { network: A.mainnet }, ['network_mismatch']),
  S('before not_before', { time: T0 - 1 }, ['mandate_not_yet_valid']),
  S('at expires_at is expired', { time: T0 + 7 * DAY }, ['mandate_expired']),
  S('one second before expiry is valid', { time: T0 + 7 * DAY - 1 }, []),
  S('payer is not the agent', { payer: A.thief }, ['agent_mismatch']),
  S('several violations are all reported in fixed order', { amount: '60000', pay_to: A.sellerC, asset: A.otherMint }, ['asset_mismatch', 'amount_over_cap', 'pay_to_not_allowed']),
];
// ---------------- grant (inspectGrantTx), expectations by hand
const G = (name, tx, expect, mand = M) => ({ name, kind: 'grant', input: { mandate: mand, tx }, expect });
const okG = { ok: true };
const mm = (detail) => ({ ok: false, reason: 'grant_mismatch', detailIncludes: detail });
vec.grant = [
  G('minimal grant: ApproveChecked + Memo', grantTx(M, { seedVault: false }), okG),
  G('Seed Vault appends two ComputeBudget instructions: allowed', grantTx(M), okG),
  G('transaction not found', null, { ok: false, reason: 'grant_not_found' }),
  G('transaction failed on chain', grantTx(M, { err: { InstructionError: [0, 'Custom'] } }), mm('failed')),
  G('fee payer is not the principal', grantTx(M, { feePayer: A.thief }), mm('fee payer')),
  G('a second signer', grantTx(M, { signers: [A.thief] }), mm('signers')),
  G('address lookup tables are refused', grantTx(M, { lookup: true }), mm('lookup')),
  G('an extra non-ComputeBudget instruction (a system transfer)', grantTx(M, { extra: { programId: '11111111111111111111111111111111', program: 'system', parsed: { type: 'transfer', info: { source: A.principal, destination: A.thief, lamports: 1 } } } }), mm('unexpected instruction')),
  G('an extra token Transfer (drain) is not ComputeBudget', grantTx(M, { extra: { programId: TOKEN_PROGRAM_ADDRESS, program: 'spl-token', parsed: { type: 'transferChecked', info: { source: SRC, destination: A.thief, mint: A.asset, authority: A.principal, tokenAmount: { amount: '1' } } } } }), mm('unexpected instruction')),
  G('memo text one byte off', grantTx(M, { memo: summaryLine(M).slice(0, -1) + '0' }), mm('memo')),
  G('memo carries a different mandate id', grantTx(M, { memo: summaryLine(mandate({ nonce: 'ffffffffffffffffffffffffffffffff' })) }), mm('memo')),
  G('memo is the v0.1 style line (real T1 transaction 5gUy9rev on devnet is of this kind)', grantTx(M, { memo: 'iussum v0.1 | agent ' + A.agent }), mm('memo')),
  G('ApproveChecked amount differs from total_cap', grantTx(M, { amount: '2500000' }), mm('amount')),
  G('ApproveChecked delegate is not the agent', grantTx(M, { delegate: A.thief }), mm('delegate')),
  G('ApproveChecked owner is not the principal', grantTx(M, { owner: A.thief }), mm('owner')),
  G('ApproveChecked mint is not the asset', grantTx(M, { mint: A.otherMint }), mm('mint')),
  G('ApproveChecked source is not the principal ATA', grantTx(M, { source: DEST[A.sellerA] }), mm('source')),
  G('no ApproveChecked', grantTx(M, { seedVault: false, drop: [0] }), mm('0 ApproveChecked')),
  G('no Memo', grantTx(M, { seedVault: false, drop: [1] }), mm('0 Memo')),
  G('two ApproveChecked', (() => { const t = grantTx(M, { seedVault: false }); t.transaction.message.instructions.push(t.transaction.message.instructions[0]); return t; })(), mm('2 ApproveChecked')),
  G('two Memo instructions', (() => { const t = grantTx(M, { seedVault: false }); t.transaction.message.instructions.push(t.transaction.message.instructions[1]); return t; })(), mm('2 Memo')),
  G('grant built for another mandate fails against this one (tampered mandate)', grantTx(M), mm('memo'), mandate({ per_payment_max: '50001' })),
];
// ---------------- grant active (inspectGrantActive)
const acct = (o = {}) => ({ data: { parsed: { info: { owner: A.principal, mint: A.asset, delegate: A.agent, delegatedAmount: { amount: '500000' }, ...o } } } });
vec.active = [
  { name: 'delegate is the agent and amount above 0', kind: 'active', input: { mandate: M, account: acct() }, expect: { ok: true } },
  { name: 'delegate replaced after the grant', kind: 'active', input: { mandate: M, account: acct({ delegate: A.thief }) }, expect: { ok: false, reason: 'grant_inactive' } },
  { name: 'delegate cleared (revoke)', kind: 'active', input: { mandate: M, account: acct({ delegate: undefined, delegatedAmount: undefined }) }, expect: { ok: false, reason: 'grant_inactive' } },
  { name: 'delegated amount 0', kind: 'active', input: { mandate: M, account: acct({ delegatedAmount: { amount: '0' } }) }, expect: { ok: false, reason: 'grant_inactive' } },
  { name: 'source account missing', kind: 'active', input: { mandate: M, account: null }, expect: { ok: false, reason: 'grant_inactive' } },
  { name: 'account of another owner', kind: 'active', input: { mandate: M, account: acct({ owner: A.thief }) }, expect: { ok: false, reason: 'grant_inactive' } },
];
// ---------------- receipt
const rcp = receipt();
vec.receipt = [
  { name: 'valid receipt verifies', kind: 'receipt', input: { receipt: rcp, pubkey: SELLER_KEY.publicKey }, expect: { ok: true } },
  { name: 'one changed field (amount) breaks the signature', kind: 'receipt', input: { receipt: { ...rcp, amount: '20000' }, pubkey: SELLER_KEY.publicKey }, expect: { ok: false } },
  { name: 'signature from another key', kind: 'receipt', input: { receipt: receipt({ key: WRONG_KEY }), pubkey: SELLER_KEY.publicKey }, expect: { ok: false } },
  { name: 'receipt naming a different seller key than the trusted one', kind: 'receipt', input: { receipt: rcp, pubkey: WRONG_KEY.publicKey }, expect: { ok: false } },
  { name: 'a receipt without mandate verifies and carries null/null', kind: 'receipt', input: { receipt: receipt({ mandate_id: null, grant_tx: null }), pubkey: SELLER_KEY.publicKey }, expect: { ok: true } },
  { name: 'mandate_id set but grant_tx null is malformed', kind: 'receipt', input: { receipt: receipt({ grant_tx: null }), pubkey: SELLER_KEY.publicKey }, expect: { ok: false } },
  { name: 'unknown key in the receipt', kind: 'receipt', input: { receipt: { ...rcp, extra: 1 }, pubkey: SELLER_KEY.publicKey }, expect: { ok: false } },
];
// ---------------- resolve: R1 to R4 and the rest
const recorded = JSON.parse(fs.readFileSync(new URL('./vectors/recorded/payment-5KsYz26T.json', import.meta.url), 'utf8')).result;
vec.resolve = [
  R('R1 in scope, receipt bound: principal bears it, dispute invalid', (b) => b, exp('invalid', 'in_scope', 'principal', { time_source: 'block' })),
  R('R2 amount over cap, mandate presented: seller bears it', (b) => ({ ...b, receipt: receipt({ amount: '60000' }), payment: payTx({ amount: '60000' }) }), exp('valid', 'amount_over_cap', 'seller', { deltaCodes: ['amount_over_cap'] })),
  R('R2 pay_to not allowed, mandate presented: seller', (b) => ({ ...b, receipt: receipt({ pay_to: A.sellerC }), payment: payTx({ payTo: A.sellerC }) }), exp('valid', 'pay_to_not_allowed', 'seller')),
  R('R2 resource outside the prefix: seller', (b) => ({ ...b, receipt: receipt({ resource: 'https://other.example/x' }) }), exp('valid', 'resource_not_allowed', 'seller')),
  R('R2 asset mismatch: seller', (b) => ({ ...b, receipt: receipt({ asset: A.otherMint }), payment: payTx({ mint: A.otherMint }) }), exp('valid', 'asset_mismatch', 'seller')),
  R('R2 network mismatch (resolver watches another cluster): seller', (b) => ({ ...b, network: A.mainnet }), exp('valid', 'network_mismatch', 'seller')),
  R('R2 payment before not_before: seller', (b) => ({ ...b, payment: payTx({ blockTime: T0 - 5 }), receipt: receipt({ settled_at: T0 + 5 }) }), exp('valid', 'mandate_not_yet_valid', 'seller', { time_source: 'block' })),
  R('R2 payment after expiry: seller', (b) => ({ ...b, payment: payTx({ blockTime: T0 + 8 * DAY }), receipt: receipt({ settled_at: T0 + 8 * DAY }) }), exp('valid', 'mandate_expired', 'seller')),
  R('settled_at inside the window but block time outside it: block time wins', (b) => ({ ...b, payment: payTx({ blockTime: T0 + 8 * DAY }), receipt: receipt({ settled_at: T0 + 50 }) }), exp('valid', 'mandate_expired', 'seller', { time_source: 'block' })),
  R('no block time on chain: fall back to settled_at, say so', (b) => ({ ...b, payment: payTx({ blockTime: null }) }), exp('invalid', 'in_scope', 'principal', { time_source: 'receipt' })),
  R('wrong agent paid (authority is not the agent)', (b) => ({ ...b, receipt: receipt({ payer: A.thief }), payment: payTx({ authority: A.thief }) }), exp('valid', 'agent_mismatch', 'seller')),
  R('R3 receipt with no mandate binding, out of scope: agent operator', (b) => ({ ...b, receipt: receipt({ mandate_id: null, grant_tx: null, pay_to: A.sellerC }), payment: payTx({ payTo: A.sellerC }) }), exp('valid', 'pay_to_not_allowed', 'agent_operator')),
  R('R3 receipt bound to a different mandate id: agent operator', (b) => ({ ...b, receipt: receipt({ mandate_id: 'ab'.repeat(32), pay_to: A.sellerC }), payment: payTx({ payTo: A.sellerC }) }), exp('valid', 'pay_to_not_allowed', 'agent_operator')),
  R('R3 receipt names another grant_tx than the dispute: not presented', (b) => ({ ...b, receipt: receipt({ grant_tx: SIG('H'), pay_to: A.sellerC }), payment: payTx({ payTo: A.sellerC }) }), exp('valid', 'pay_to_not_allowed', 'agent_operator')),
  R('R4 tampered receipt (amount edited after signing)', (b) => ({ ...b, receipt: { ...receipt(), amount: '1' } }), exp('invalid', 'signature_invalid', null)),
  R('R4 receipt signed by another key', (b) => ({ ...b, receipt: receipt({ key: WRONG_KEY }) }), exp('invalid', 'signature_invalid', null)),
  R('R4 seller key unknown to the resolver', (b) => ({ ...b, seller_pubkey: null }), exp('invalid', 'signature_invalid', null)),
  R('R4 tampered mandate (does not match its grant memo)', (b) => ({ ...b, mandate: mandate({ per_payment_max: '50001' }) }), exp('invalid', 'grant_mismatch', null)),
  R('R4 grant transaction not found', (b) => ({ ...b, grant_tx_parsed: null }), exp('invalid', 'grant_not_found', null)),
  R('R4 grant with an extra instruction', (b) => ({ ...b, grant_tx_parsed: grantTx(M, { extra: { programId: '11111111111111111111111111111111', program: 'system', parsed: { type: 'transfer', info: {} } } }) }), exp('invalid', 'grant_mismatch', null)),
  R('R4 invalid mandate document', (b) => ({ ...b, mandate: { ...M, total_cap: 5 } }), exp('invalid', 'mandate_invalid', null)),
  R('transaction not found on chain', (b) => ({ ...b, payment: { found: false } }), exp('invalid', 'tx_not_found', null)),
  R('transaction failed on chain', (b) => ({ ...b, payment: payTx({ err: 'boom' }) }), exp('invalid', 'tx_not_found', null)),
  R('receipt says another tx_sig', (b) => ({ ...b, receipt: receipt({ tx_sig: SIG('Q') }) }), exp('invalid', 'tx_mismatch', null)),
  R('receipt amount differs from chain (tx_mismatch)', (b) => ({ ...b, receipt: receipt({ amount: '10001' }) }), exp('invalid', 'tx_mismatch', null, { deltaFields: ['amount'] })),
  R('receipt pay_to differs from the chain destination owner', (b) => ({ ...b, receipt: receipt({ pay_to: A.sellerB }) }), exp('invalid', 'tx_mismatch', null, { deltaFields: ['pay_to'] })),
  R('receipt payer differs from the chain authority', (b) => ({ ...b, receipt: receipt({ payer: A.thief }) }), exp('invalid', 'tx_mismatch', null, { deltaFields: ['payer'] })),
  R('receipt asset differs from chain mint', (b) => ({ ...b, receipt: receipt({ asset: A.otherMint }) }), exp('invalid', 'tx_mismatch', null, { deltaFields: ['asset'] })),
  R('payment is not out of the granted account (source differs)', (b) => ({ ...b, payment: payTx({ source: DEST[A.sellerB] }) }), exp('invalid', 'tx_mismatch', null, { deltaFields: ['source'] })),
  R('two transfers in one transaction cannot be judged', (b) => ({ ...b, payment: payTx({ twoTransfers: true }) }), exp('invalid', 'tx_mismatch', null)),
  R('control: no receipt (seller never checked, nothing signed)', (b) => ({ ...b, receipt: null, payment: payTx({ payTo: A.sellerC }) }), exp('invalid', 'receipt_missing', null, { missing: ['seller receipt (what the seller saw)'] })),
  R('no mandate supplied by the disputing party', (b) => ({ ...b, mandate: null }), exp('invalid', 'mandate_missing', null)),
  // recorded devnet response (payment 5KsYz26T..., settled through payai in Phase 0): the chain side is REAL, the mandate/grant/receipt are synthetic
  ...(() => {
    const REAL = '5KsYz26TFRGqzk7KdjUg8z2tGL6neRed37Cj211kYFgTX8ATNDKwXfqwuRnLzC8zTMDf2Z4QS7SweCd41Lrd2Hur';
    const MR = mandate({ not_before: recorded.blockTime - 1000, expires_at: recorded.blockTime + 7 * DAY }), MRID = mandateId(MR);
    const bR = (rc) => ({ tx_sig: REAL, network: A.net, mandate: MR, grant_tx: SIG('G'), grant_tx_parsed: grantTx(MR), receipt: rc, seller_pubkey: SELLER_KEY.publicKey, payment: 'RECORDED', history: null });
    const rr = (o) => receipt({ mandate_id: MRID, tx_sig: REAL, settled_at: recorded.blockTime, ...o });
    return [
      { name: 'recorded devnet payment: receipt amount differs from the real chain (tx_mismatch)', kind: 'resolve', note: 'test/vectors/recorded/payment-5KsYz26T.json is a real getTransaction response', input: bR(rr({ amount: '20000' })), expect: exp('invalid', 'tx_mismatch', null, { deltaFields: ['amount'] }) },
      { name: 'recorded devnet payment: consistent receipt, mandate allows it: in scope', kind: 'resolve', note: 'real chain data, synthetic grant and receipt', input: bR(rr({})), expect: exp('invalid', 'in_scope', 'principal') },
      { name: 'recorded devnet payment: mandate that does not allow its pay_to: seller liable', kind: 'resolve', note: 'real chain data', input: { ...bR(rr({})), mandate: mandate({ not_before: recorded.blockTime - 1000, expires_at: recorded.blockTime + 7 * DAY, allow: { pay_to: [A.sellerB], resource_prefix: [RES] } }), grant_tx_parsed: grantTx(mandate({ not_before: recorded.blockTime - 1000, expires_at: recorded.blockTime + 7 * DAY, allow: { pay_to: [A.sellerB], resource_prefix: [RES] } })), receipt: rr({ mandate_id: mandateId(mandate({ not_before: recorded.blockTime - 1000, expires_at: recorded.blockTime + 7 * DAY, allow: { pay_to: [A.sellerB], resource_prefix: [RES] } })) }) }, expect: exp('valid', 'pay_to_not_allowed', 'seller') },
    ];
  })(),
];
// ---------------- period budget (Addendum B): one overrun split across two sellers
const hist = (rows) => rows.map(([tx_sig, slot, bt, amount, dest_owner]) => ({ tx_sig, slot, block_time: bt, amount, dest_owner }));
const PM = mandate({ period_budget: '30000', per_payment_max: '20000' }), PMID = mandateId(PM);
const prBase = (txsig, pay_to, amount, history) => ({ tx_sig: txsig, network: A.net, mandate: PM, grant_tx: SIG('G'), grant_tx_parsed: grantTx(PM), receipt: receipt({ mandate_id: PMID, tx_sig: txsig, pay_to, amount }), seller_pubkey: SELLER_KEY.publicKey, payment: payTx({ payTo: pay_to, amount, blockTime: T0 + 100 }), history });
const H2 = hist([[SIG('1'), 2001, T0 + 100, '20000', A.sellerA], [SIG('2'), 2002, T0 + 110, '20000', A.sellerB]]);
vec.period = [
  { name: 'first payment of 20000 stays inside the 30000 budget', kind: 'resolve', input: prBase(SIG('1'), A.sellerA, '20000', H2), expect: exp('invalid', 'in_scope', 'principal') },
  { name: 'second payment (other seller) crosses the budget: agent operator, not the seller', kind: 'resolve', input: prBase(SIG('2'), A.sellerB, '20000', H2), expect: exp('valid', 'period_over_budget', 'agent_operator', { deltaCodes: ['period_over_budget'] }) },
  { name: 'a new period resets the spend', kind: 'resolve', input: prBase(SIG('2'), A.sellerB, '20000', hist([[SIG('1'), 2001, T0 + 100, '20000', A.sellerA], [SIG('2'), 2002, T0 + DAY + 100, '20000', A.sellerB]])), expect: exp('invalid', 'in_scope', 'principal') },
  { name: 'spend made before the grant (an earlier grant) is not counted against this mandate', kind: 'resolve', input: prBase(SIG('2'), A.sellerB, '20000', hist([[SIG('0'), 900, T0 + 50, '30000', A.sellerA], [SIG('2'), 2002, T0 + 110, '20000', A.sellerB]])), expect: exp('invalid', 'in_scope', 'principal') },
  { name: 'ordering is by slot, not by listing order', kind: 'resolve', input: prBase(SIG('1'), A.sellerA, '20000', hist([[SIG('2'), 2002, T0 + 110, '20000', A.sellerB], [SIG('1'), 2001, T0 + 100, '20000', A.sellerA]])), expect: exp('invalid', 'in_scope', 'principal') },
  { name: 'period overrun and a seller-visible violation together: seller still liable for the visible one', kind: 'resolve', input: { ...prBase(SIG('2'), A.sellerC, '20000', hist([[SIG('1'), 2001, T0 + 100, '20000', A.sellerA], [SIG('2'), 2002, T0 + 110, '20000', A.sellerC]])), receipt: receipt({ mandate_id: PMID, tx_sig: SIG('2'), pay_to: A.sellerC, amount: '20000' }), payment: payTx({ payTo: A.sellerC, amount: '20000' }) }, expect: exp('valid', 'pay_to_not_allowed', 'seller', { deltaCodes: ['pay_to_not_allowed', 'period_over_budget'] }) },
];
fs.mkdirSync(OUT, { recursive: true });
for (const [k, v] of Object.entries(vec)) fs.writeFileSync(new URL(`${k}.json`, OUT), JSON.stringify(v, null, 1) + '\n');
console.log(Object.entries(vec).map(([k, v]) => `${k}:${v.length}`).join(' '), 'mandate id', MID);

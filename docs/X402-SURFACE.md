# X402-SURFACE — gate G0.2 (2026-10-19)

Packages, exact versions from `/tmp/af-ro/package.json` (agentfeed clone): `@x402/core`, `@x402/express`, `@x402/fetch`, `@x402/svm`, `@x402/extensions` = 2.28.0. `express` 4.22.3 (agentfeed pins `^4.19.2`). Probe dir `/tmp/x402-probe`; scripts copied to `/Volumes/D/iussum/probes/g02-local.mjs`, `g02-real.mjs`. All `file:line` below are in `/tmp/x402-probe/node_modules/@x402/<pkg>/dist/cjs/`.

## Verdict

| Question | Result | Evidence |
|---|---|---|
| Does a custom key in `PaymentPayload.extensions` travel client → seller hook/handler → facilitator? | **YES, locally.** | `g02-local.mjs`, output below |
| Does a real facilitator's verify reject an unknown extension key? | **payai: YES unless the value has an `info` property. x402.org: no.** | differential run below |
| Funded end-to-end verify+settle on devnet with the extension attached? | **YES on both facilitators**, extension `{info:{…}}`, seller hook saw it, HTTP 200, settle success | ALLOWANCE.md Live section: payai `5KsYz26T…d2Hur`, x402.org `3m4mkzxR…iDjR` |

Consequence for §4 of the brief: carry the mandate as `PaymentPayload.extensions.iussum = { info: { mandate, principal_sig } }`, not `{ mandate, principal_sig }`. The `info` wrapper is what passes payai; it is the same shape x402 uses for its own extensions. The funded devnet runs (both facilitators) confirm it end to end, so the header fallback `X-IUSSUM-MANDATE` is not needed.

## How the extension travels (read from installed source)

- Client hook: `core/client/index.js:321` `registerExtension(extension)`; `:559` `enrichPaymentPayloadWithExtensions` calls each registered extension's `enrichPaymentPayload(payload, paymentRequired)` and then `:506` `mergeExtensions(paymentRequired.extensions, enriched.extensions)`. A key the server did not declare is kept as is (`:513` `merged[key] = clientValue` when the server has no object under that key).
- Server hooks: `core/server/index.js:1183` `onBeforeVerify(hook)`; `:1527` `verifyPayment` runs `beforeVerify` hooks with `{ paymentPayload, requirements, declaredExtensions, transportContext }` BEFORE the facilitator `/verify` call. A hook returning `{ abort: true, reason, message }` makes `verifyPayment` return `{ isValid: false, invalidReason: reason }` without calling the facilitator. This is where the seller-side mandate check goes (verify before settle). The HTTP status of that refusal is the middleware's 402 payment-error path (`express/dist/cjs/index.js:236-247`), NOT the 403 the brief wants; a 403 needs a handler/middleware ahead of `paymentMiddleware`. Phase 1 decision, UNTESTED.
- Server echo check: `core/server/index.js:1900` `validateExtensions` only compares a client key against the server's advertised value when the server advertised that key (`hasOwnProperty`); an undeclared key such as `iussum` is not compared.
- Handler access: the express middleware does not put the payload on `req`; the handler reads the `payment-signature` header and base64-decodes it (`g02-local.mjs`), or the seller uses the `onBeforeVerify` hook context (cleaner).

## Local carriage proof (mock facilitator on localhost, real client, real middleware)

Command: `cd /tmp/x402-probe && node g02-local.mjs` (mock facilitator records what `/verify` and `/settle` receive). Observed:

```
http status 200 body {"ok":true}
facilitator /verify extensions: {"iussum":{"mandate":{"v":"iussum/0.1","note":"probe-not-a-real-mandate"},"principal_sig":"PROBE"}}
facilitator /settle extensions: {"iussum":{"mandate":{"v":"iussum/0.1","note":"probe-not-a-real-mandate"},"principal_sig":"PROBE"}}
seller onBeforeVerify hook extensions: {"iussum":{"mandate":{...},"principal_sig":"PROBE"}}
seller handler (decoded PAYMENT-SIGNATURE) extensions: {"iussum":{"mandate":{...},"principal_sig":"PROBE"}}
counts verify/settle/hook/handler 1 1 1 1
```

The mock accepts anything, so this proves carriage and nothing about a real facilitator's validation.

## Live facilitators: differential run (unfunded agent, so every run ends in a simulation failure; what matters is whether it gets that far)

Facilitators and their `/supported` (fetched live 2026-10-19, saved in `/tmp/x402-probe/payai-supported.json`, `x402org-supported.json`):

- `https://facilitator.payai.network`: v2 `exact` on `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet) with fee payer `2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4`; also v1 `solana-devnet`. `extensions`: `["bazaar","eip2612GasSponsoring","erc20ApprovalGasSponsoring"]`. No `features.smartWalletSupported` flag.
- `https://x402.org/facilitator`: v2 `exact` on the same devnet id, fee payer `CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5`, `extra.features.smartWalletSupported: true`; `extensions`: `["builder-code","eip2612GasSponsoring","erc20ApprovalGasSponsoring"]`.
- Devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: from `@x402/svm` `USDC_DEVNET_ADDRESS` (`svm/dist/cjs/index.js:185`) and Circle's published table (https://developers.circle.com/stablecoins/usdc-contract-addresses, fetched 2026-10-19). The facilitators' `/supported` do not list assets.

Command: `FAC_URL=<facilitator> EXT=<n> node g02-real.mjs`; `EXT=0` no extension, `1` `{mandate, principal_sig}`, `2` `{info:{mandate,principal_sig}}`, `3` `{info:{...}, schema:{type:'object'}}`. Result = `error` in the decoded `payment-required` header of the 402 the seller returned.

| facilitator | EXT=0 | EXT=1 (flat) | EXT=2 (`info`) | EXT=3 (`info`+`schema`) |
|---|---|---|---|---|
| payai | `invalid_exact_svm_transaction_simulation_failed` | **`Extension validation failed: Extension 'iussum' missing required 'info' property`** | `invalid_exact_svm_transaction_simulation_failed` | same |
| x402.org | `..._simulation_failed` | `..._simulation_failed` | `..._simulation_failed` | `..._simulation_failed` |

Reading: payai validates every extension key as `{ info, schema? }` before simulating; x402.org passed all four to simulation. Both reached simulation with `info`, which is the only claim made. They failed at simulation because the agent wallet is unfunded; that failure is the expected control.

## UNTESTED

- Whether either facilitator echoes the extension in its settle response: the `PAYMENT-RESPONSE` header decoded in the live runs showed `success`, `payer`, `transaction`, `network` and no extension (`docs/ALLOWANCE-live.jsonl`); the response body was not inspected further.
- Whether either facilitator adds a size cap on extensions. The mandate JSON plus signature will be about 1 KB; the payment header is base64 of the whole payload. No limit observed up to the small probe value; larger values UNTESTED.
- `@x402/extensions` was installed to match agentfeed but not exercised.
- HTTP 403 on out-of-scope (see above).

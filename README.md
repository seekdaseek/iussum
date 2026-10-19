# iussum

Meta's Muse terms put all risk of financial loss on the user, who is "solely responsible for setting transaction limits", and cap Meta's own liability at the greater of $250 or twelve months of fees; Instinct's terms (revised 26 Aug 2026) make the agent's transactions binding on the user as if made directly, with the company's liability capped at the greater of $100 or six months of fees (as reported by vr.org on 30 Sep 2026 and amanwhoblogs.substack.com, cited from this project's brief and not re-read by the author). Cards have no dispute reason code that separates "my agent exceeded what I allowed" from fraud. iussum fills that gap for x402 payments on Solana: **what the person authorised is signed on chain, the seller can check it before it takes the money, and a dispute is decided from signed artifacts alone.**

It is pronounced YOOS-sum (Latin *iussum*, "an order, an authorisation"), and written lowercase.

## How it works (Phase 1: devnet and localnet only)

1. **The grant.** The person signs ONE transaction, fee payer and only signer: an SPL `ApproveChecked` (delegate = the agent, amount = `total_cap`) plus one `Memo` holding a summary line that ends in the full SHA-256 id of the mandate. The mandate (v0.2, canonicalised with RFC 8785 JCS) carries `total_cap`, `per_payment_max`, `period_budget`, allowed `pay_to` addresses, allowed resource prefixes, asset, network and a validity window. The on-chain amount is the person's loss ceiling; the memo binds every other limit to the same transaction by hash.
2. **The agent** attaches `extensions.iussum = { info: { mandate, grant_tx } }` to each x402 payment and refuses locally, before signing, when a payment would break the mandate (including its own running period spend).
3. **The seller** mounts one middleware ahead of x402's `paymentMiddleware`. In `enforce` mode it verifies the grant (one shared function in `@iussum/core`: err null, the principal the only signer, exactly one matching `ApproveChecked`, exactly one `Memo` equal byte for byte to the rebuilt line, everything else `ComputeBudget`), that the grant is still active, and window, network, asset, amount, its own `pay_to`, the resource prefix and payer = agent. Violations answer **HTTP 403** `{error:"iussum_out_of_scope", reason, delta}` and nothing settles. After settlement it returns a seller-signed receipt carrying `mandate_id` and `grant_tx`.
4. **The resolver** decides a dispute from the signed artifacts and the chain only, as a pure function:
   - **R1** in scope: the principal bears it. **R2** out of scope and the receipt shows the mandate was presented: the seller. **R3** out of scope and it was not presented: the agent operator. **R4** artifacts that do not verify: the dispute is rejected, liable null.
   - `period_over_budget`: a seller cannot see other sellers' payments, so the resolver rebuilds the agent's period spend from chain history and assigns the payment that crossed the budget to the agent operator.
   - A payment is judged at its own slot. A repeat dispute returns the stored verdict (`duplicate_dispute`) and never pays a second refund.

## What the person saw (read this before quoting it)

On the Seeker, Seed Vault showed the **token and the amount** for the grant transaction (the spending cap, `total_cap`). It did not show the delegate and it did not show the memo. The wallet displayed no `signMessages` or Sign-In-With-Solana text at all (`docs/SEED-VAULT.md`). Every other limit has to be shown by the iussum app before the wallet opens; that app is Phase 2 and does not exist yet. The same signed transaction binds those limits by hash on chain. **Do not read this as "the wallet displayed the limits": it did not.**

## Verify it

```bash
npm ci
npm test                 # 155 tests, no network
npm run mutation         # breaks each of the checks one at a time and requires a test to fail
npm run demo:devnet      # nine scenarios on devnet with real USDC and a real facilitator (needs funded throw-away keys, see JUDGE_GUIDE.md)
```

`JUDGE_GUIDE.md` has the five-minute path, the devnet transaction links and the expected output. `REPORT-phase1.md` has the numbers.

## Layout

| path | what |
|---|---|
| `packages/core` | JCS, mandate v0.2, grant check, receipt, the pure resolver, chain parsing |
| `packages/seller` | Express middleware: `IUSSUM_MODE=off|observe|enforce`, 403 refusals, receipts, `/.well-known/iussum.json` |
| `packages/agent` | x402 client wrapper that carries the mandate and refuses locally |
| `apps/resolver` | HTTP service: `POST /dispute`, `GET /v/:tx`, verdict store, demo refund executor |
| `apps/seeker-probe` | the Phase 0 Seed Vault display probe (not part of the product) |
| `test/vectors` | golden vectors, including a recorded real devnet payment |
| `docs/` | Phase 0 and Phase 1 evidence: X402-SURFACE, SEED-VAULT, ALLOWANCE, MERCHANT-TRACK, FEEDBACK |

## Demo output

The demo prints one block per scenario. A real run is kept in `demo-runs/` (five clean runs). The shape of scenario 3:

```
=== Scenario 3. observe-mode seller settles an out-of-scope payment: dispute valid, SELLER liable, refund paid (R2)
  - grant (ApproveChecked 1000000 + Memo, principal only signer): <devnet signature>
    PASS grant check on the real chain: true
      [seller C] mode=observe saw pay_to_not_allowed
    PASS seller C (observe) settles although C is not on the list: 200
  - verdict: valid | reason pay_to_not_allowed | liable seller | time_source block | refund_tx <devnet signature>
    PASS principal paid 0.01 then got 0.01 back (on chain): ["10000","10000"]
```

## Status and limits

Devnet and localnet only. No mainnet transaction, deploy or publish has been made. Seller-side checking works against stock x402 facilitators (payai and x402.org settled the Phase 0 and Phase 1 devnet payments with the extension attached). A Subscriptions-program delegate cannot pay through the live facilitators today (`docs/ALLOWANCE.md`), so Phase 1 uses a plain SPL delegate. What is not proven: the Seeker-signed grant through the iussum app, a recognised-domain Seed Vault flow, third-party sellers that adopt the middleware, and anything on mainnet. See `REPORT-phase1.md` for the list.

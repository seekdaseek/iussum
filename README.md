# iussum

Meta's Muse supplemental terms (muse.ai/terms, last updated 8 Sep 2026) say the user bears "all risk of financial loss" from the agent's financial actions, that the user is solely responsible for setting limits and safeguards, and cap Meta's own liability at the greater of $250 or what the user paid in the previous twelve months; Instinct's terms of service (instinct.com/terms, revised 26 Aug 2026) make its actions "binding on you as if entered into directly by you" and cap its liability at the greater of $100 and, per two secondary sources, what the user paid in the previous six months (sources and how they were read are listed under "Sources" below). Cards have no dispute reason code that separates "my agent exceeded what I allowed" from fraud. iussum fills that gap for x402 payments on Solana: **what the person authorised is signed on chain, the seller can check it before it takes the money, and a dispute is decided from signed artifacts alone.**

It is pronounced YOOS-sum (Latin *iussum*, "an order, an authorisation"), and written lowercase.

## How it works (Phase 1: devnet and localnet only)

1. **The grant.** The person signs ONE transaction, fee payer and only signer: an SPL `ApproveChecked` (delegate = the agent, amount = `total_cap`) plus one `Memo` holding a summary line that ends in the full SHA-256 id of the mandate. The mandate (v0.2, canonicalised with RFC 8785 JCS) carries `total_cap`, `per_payment_max`, `period_budget`, allowed `pay_to` addresses, allowed resource prefixes, asset, network and a validity window. The on-chain amount is the person's loss ceiling; the memo binds every other limit to the same transaction by hash.
2. **The agent** attaches `extensions.iussum = { info: { mandate, grant_tx } }` to each x402 payment and refuses locally, before signing, when a payment would break the mandate (including its own running period spend).
3. **The seller** (configured with its own canonical `origin`: the resource it signs is `origin + path`, never the Host header) mounts one middleware ahead of x402's `paymentMiddleware`. In `enforce` mode it verifies the grant is still **current** (a later Approve, ApproveChecked, Revoke, SetAuthority or CloseAccount on the source account supersedes it) and that the payment comes out of the granted account, and checks the grant itself (one shared function in `@iussum/core`: err null, the principal the only signer, exactly one matching `ApproveChecked`, exactly one `Memo` equal byte for byte to the rebuilt line, everything else `ComputeBudget`), that the grant is still active, and window, network, asset, amount, its own `pay_to`, the resource prefix and payer = agent. Violations answer **HTTP 403** `{error:"iussum_out_of_scope", reason, delta}` and nothing settles. After settlement it returns a seller-signed receipt carrying `mandate_id` and `grant_tx`.
4. **The resolver** decides a dispute from the signed artifacts and the chain only, as a pure function:
   - **R1** in scope: the principal bears it. **R2** out of scope and the receipt shows the mandate was presented: the seller. **R3** out of scope and it was not presented: the agent operator. **R4** artifacts that do not verify: the dispute is rejected, liable null.
   - `period_over_budget`: a seller cannot see other sellers' payments, so the resolver rebuilds the agent's period spend from COMPLETE chain history (paginated; a history it cannot show to be complete gives `history_incomplete`, liable null, never `in_scope`) and assigns the payment that crossed the budget to the agent operator.
   - **No receipt** (most sellers will never run iussum): everything the chain proves is still judged. A violation is the agent operator's (R3), a clean payment the principal's; what the seller was asked for (the resource) is listed as `unjudged`.
   - **The disputer does not choose the mandate.** A receipt that binds a mandate id fixes it (`mandate_mismatch` otherwise), and a mandate that a later grant on the same account superseded before the payment slot is rejected as `mandate_superseded`; both are liable null and resubmittable.
   - A payment is judged at its own slot. A repeat dispute returns the stored verdict (`duplicate_dispute`) and never pays a second refund.

## What the person saw (read this before quoting it)

On the Seeker, Seed Vault showed the **token and the amount** for the grant transaction (the spending cap, `total_cap`). It did not show the delegate and it did not show the memo. The wallet displayed no `signMessages` or Sign-In-With-Solana text at all (`docs/SEED-VAULT.md`). Every other limit has to be shown by the iussum app before the wallet opens; that app is Phase 2 and does not exist yet. The same signed transaction binds those limits by hash on chain. **Do not read this as "the wallet displayed the limits": it did not.**

## Verify it

Requires **Node 24 or newer** (`engines` says `>=24`; `node:sqlite` and a dependency need it, `npm ci` warns on Node 22).

```bash
npm ci
npm test                 # 230 tests, no network
npm run mutation         # breaks each of the checks one at a time and requires a test to fail
npm run demo:devnet      # ten scenarios on devnet with real USDC and a real facilitator (needs funded throw-away keys, see JUDGE_GUIDE.md)
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

## Sources for the terms quoted in the first paragraph

Read on 2026-10-19 through a fetch tool that summarises pages, so a person should re-check the quotes in a browser before this README is made public.

- **Meta Muse**: https://muse.ai/terms, titled "Muse Supplemental User Agreement", last updated 8 Sep 2026 (sections 7.7 and 15). The copy that could be read was served in Russian; the English wording of the quoted phrases comes from vr.org, "Who Pays When Muse Shops From Your Meta Glasses?" (Sam Whitfield, 30 Sep 2026): https://vr.org/articles/meta-muse-glasses-shopping-stripe-link-transaction-fee-2026. The $250 / twelve-month cap is in the primary page's section 15. Meta's own help page ("How Muse works with payments", https://www.meta.com/help/artificial-intelligence/1436362127544482/) also says Muse asks for approval before completing a purchase, which the terms paragraph above does not mention.
- **Instinct**: https://instinct.com/terms, "Terms of Service | Instinct", last revised August 26, 2026 (section 3 for "binding on you as if entered into directly by you", section 9 for the cap). The "greater of $100" limb was visible on the primary page; the six-month limb was not in the text that could be read and rests on https://amanwhoblogs.substack.com/p/ai-agent-payments-liability-credit-card (18 Oct 2026) and https://www.eesel.ai/blog/instinct-ai (28 Sep 2026).

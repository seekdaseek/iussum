# iussum

Meta's Muse supplemental terms (https://muse.ai/terms, "Muse Supplemental Terms of Service", last updated 8 September 2026) say in section 7.7 that "you bear all risk of financial loss arising from such actions and your use of Muse" and that "you are solely responsible for setting appropriate limits and safeguards (including transaction limits and category restrictions)", and in section 15 that Meta's liability "WILL NOT EXCEED THE GREATER OF USD 250 OR THE AMOUNT YOU HAVE PAID US IN THE TWELVE MONTHS PRECEDING THE EVENTS GIVING RISE TO THE MOST RECENT CLAIM", a limit that applies to "MUSE TAKING ANY UNINTENDED, ERRONEOUS OR UNAUTHORISED ACTION". Instinct's terms of service (https://instinct.com/terms, "Terms of Service | Instinct", last revised on August 26, 2026) say in section 3: "You hereby appoint the Services as your agent to enter into agreements, commitments or transactions on your behalf" and that such agreements "shall be binding on you as if entered into directly by you", and in section 9 cap the company entities' liability at "THE GREATER OF ONE HUNDRED DOLLARS ($100.00), OR THE AMOUNT YOU PAID THE COMPANY ENTITIES FOR THE SERVICES, IF ANY, IN THE PAST SIX (6) MONTHS GIVING RISE TO THE CLAIM" (full quotes and how they were read are under "Sources" below). Cards have no dispute reason code that separates "my agent exceeded what I allowed" from fraud. iussum fills that gap for x402 payments on Solana: **what the person authorised is signed on chain, the seller can check it before it takes the money, and a dispute is decided from signed artifacts alone.**

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

On the Seeker, Seed Vault showed the **token and the amount** for the grant transaction (the spending cap, `total_cap`). The transaction sheet also showed the generic warning "Approving this transaction will allow a third party to spend your asset in the future." (`docs/seedvault/t1/t1-sheet-2-loaded-trust-off.png`). It did not show the delegate and it did not show the memo. The wallet displayed no `signMessages` or Sign-In-With-Solana text at all (`docs/SEED-VAULT.md`). Every other limit has to be shown by the iussum app before the wallet opens; that app is Phase 2 and does not exist yet. The same signed transaction binds those limits by hash on chain. **Do not read this as "the wallet displayed the limits": it did not.**

## Verify it

Requires **Node 24 or newer** (`engines` says `>=24`; `node:sqlite` and a dependency need it, `npm ci` warns on Node 22).

```bash
npm ci
npm test                 # 241 tests, no network
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

Read on 2026-10-19 in a browser from the primary pages.

- **Meta Muse**: https://muse.ai/terms, page title "Muse Supplemental Terms of Service", "Last updated: 8 September 2026".
  - Section 7.7 "Financial actions": "(ii) you bear all risk of financial loss arising from such actions and your use of Muse; (iii) you are solely responsible for setting appropriate limits and safeguards (including transaction limits and category restrictions), monitoring your accounts and timely disputing errors with the applicable financial institution or payment provider".
  - Section 15 "Limitation of liability": "OUR AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR OUR SERVICES (INCLUDING MUSE) HEREUNDER WILL NOT EXCEED THE GREATER OF USD 250 OR THE AMOUNT YOU HAVE PAID US IN THE TWELVE MONTHS PRECEDING THE EVENTS GIVING RISE TO THE MOST RECENT CLAIM." The same section says: "FOR CLARITY, THIS LIMITATION APPLIES TO ANY CLAIM ARISING FROM MUSE TAKING ANY UNINTENDED, ERRONEOUS OR UNAUTHORISED ACTION, INCLUDING, BUT NOT LIMITED TO, SENDING UNINTENDED COMMUNICATIONS, EXECUTING UNINTENDED TRANSACTIONS OR MODIFYING OR DELETING DATA."
  - Meta's own help page ("How Muse works with payments", https://www.meta.com/help/artificial-intelligence/1436362127544482/) also says Muse asks for approval before completing a purchase, which the paragraph above does not mention.
- **Instinct**: https://instinct.com/terms, "Terms of Service | Instinct", "Last revised on August 26, 2026".
  - Section 3 "Using the services", Actions: "You hereby appoint the Services as your agent to enter into agreements, commitments or transactions on your behalf" and "Any such agreements or commitments shall be binding on you as if entered into directly by you." The same subsection says "disputes regarding any such purchase are between you and the applicable Connected Service provider, not us."
  - Section 9 "Limitations of liability": "THE COMPANY ENTITIES' TOTAL LIABILITY TO YOU FOR ANY DAMAGES FINALLY AWARDED SHALL NOT EXCEED THE GREATER OF ONE HUNDRED DOLLARS ($100.00), OR THE AMOUNT YOU PAID THE COMPANY ENTITIES FOR THE SERVICES, IF ANY, IN THE PAST SIX (6) MONTHS GIVING RISE TO THE CLAIM."

# iussum

**Who pays when an AI agent pays wrong.** The person signs what the agent may spend in one Solana transaction, the seller checks it before it takes the money, and a dispute is decided from signed artifacts and the chain alone: in scope, the principal bears it; out of scope after the seller was shown the mandate, the seller; out of scope when nobody showed it, the agent operator. x402 on Solana, devnet.

Today the person carries that loss. Meta's Muse terms say "you bear all risk of financial loss arising from such actions and your use of Muse" and cap Meta's liability at the greater of USD 250 or what you paid in the twelve months before the claim, a cap that applies to "MUSE TAKING ANY UNINTENDED, ERRONEOUS OR UNAUTHORISED ACTION". Instinct's terms say agreements its agent enters "shall be binding on you as if entered into directly by you" and cap liability at the greater of $100 or what you paid in the past six months. Card disputes cannot even mark the case: "Nothing in the dispute system labels a transaction as agent-made." Exact quotes, dates and links are under Sources.

It is pronounced YOOS-sum (Latin *iussum*, "an order, an authorisation"), and written lowercase.

## How it works (Phase 1: devnet and localnet only)

1. **The grant.** The person signs ONE transaction, fee payer and only signer: an SPL `ApproveChecked` (delegate = the agent, amount = `total_cap`) plus one `Memo` holding a summary line that ends in the full SHA-256 id of the mandate. The mandate (v0.2, canonicalised with RFC 8785 JCS) carries `total_cap`, `per_payment_max`, `period_budget`, allowed `pay_to` addresses, allowed resource prefixes, asset, network and a validity window. The on-chain amount is the person's loss ceiling; the memo binds every other limit to the same transaction by hash.
2. **The agent** attaches `extensions.iussum = { info: { mandate, grant_tx } }` to each x402 payment and refuses locally, before signing, when a payment would break the mandate (including its own running period spend). It reserves its period spend before signing and releases a reservation only on a proven expiry (the payload's own blockhash is invalid and past its last valid height, both asked of the node at the slot the blockhash came from, and no transaction carrying the agent's signature is on chain, read from a node that has reached the slot of that proof); with a data directory the held reservations are written to disk before a payload leaves the agent and survive a restart. It pays only the associated token account of the `payTo` it checked.
3. **The seller** (configured with its own canonical `origin`: the resource it signs is `origin + path`, never the Host header) mounts one middleware ahead of x402's `paymentMiddleware`. In `enforce` mode it verifies the grant is still **current** (a later Approve, ApproveChecked, Revoke, SetAuthority or CloseAccount on the source account supersedes it) and that the payment comes out of the granted account, and checks the grant itself (one shared function in `@iussum/core`: err null, the principal the only signer, exactly one matching `ApproveChecked`, exactly one `Memo` equal byte for byte to the rebuilt line, everything else `ComputeBudget`), that the grant is still active, and window, network, asset, amount, its own `pay_to`, the resource prefix and payer = agent. Violations answer **HTTP 403** `{error:"iussum_out_of_scope", reason, delta}` and nothing settles. After settlement it returns a seller-signed receipt carrying `mandate_id`, `grant_tx` and `offer_hash`, the sha256 of the JCS of the payment requirements it accepted. With no mandate presented, both ids are null, and the receipt then shows the seller saw none. The gate signs one receipt per settled transaction: a facilitator that reports success twice gets the same receipt bytes back.
4. **The resolver** decides a dispute from the signed artifacts and the chain only, as a pure function:
   - **R1** in scope: the principal bears it. **R2** out of scope and the receipt shows the mandate was presented: the seller. **R3** out of scope and it was not presented: the agent operator. **R4** artifacts that do not verify: the dispute is rejected, liable null.
   - `period_over_budget`: a seller cannot see other sellers' payments, so the resolver rebuilds the agent's period spend from COMPLETE chain history and assigns the payment that crossed the budget to the agent operator. What is counted is every debit the agent signed as delegate out of the granted account (Transfer, TransferChecked, Burn, BurnChecked, top level or by CPI), each transaction reconciled against the balance change of the account, ordered by position in the block, never by signature. The total is cross-checked against the allowance: while the grant is current, the debits found must add up to `total_cap` minus what the account still has delegated. A history it cannot show to be complete gives `history_incomplete`, liable null, never `in_scope`.
   - `debit_not_x402`: anything the agent took from the granted account that is not exactly one top-level TransferChecked (a plain Transfer, a burn, a debit made by CPI, two debits in one transaction) cannot have gone through x402 or a seller gate. It is the agent operator's, with each debit listed in the delta.
   - `tx_mismatch`, liable null: the transaction is not a debit of the granted account signed by the agent (for example the principal's own transfer), or it was made before the grant transaction. It can be resubmitted with the mandate that was current.
   - **No receipt** (most sellers will never run iussum): everything the chain proves is still judged. A violation is the agent operator's (R3), a clean payment the principal's; what the seller was asked for (the resource) is listed as `unjudged`.
   - **The disputer does not choose the mandate.** A receipt that binds a mandate id fixes it (`mandate_mismatch` otherwise), and a mandate that a later grant on the same account superseded before the payment slot is rejected as `mandate_superseded`; both are liable null and resubmittable.
   - A payment is judged at its own position in the chain (slot, then its index in the block). A repeat dispute returns the stored verdict (`duplicate_dispute`) and never pays a second refund.
   - A seller that signs two different receipts for one payment is liable for it (`receipt_equivocation`).
   - **Provisional verdicts.** A verdict decided without a seller receipt is stored as provisional, so whoever files first does not pick the evidence. A later dispute that carries a receipt which verifies against the seller key and binds the same mandate replaces it (the replaced verdict stays in the record, and the refund is paid if the seller is liable). A verdict decided with a verifying receipt is final. The response and `/v/:tx` say which it is.
   - **Verdict id.** Every stored verdict has a `verdict_id`: the hex sha256 of the RFC 8785 JCS of the stored record (`tx_sig`, `mandate_id`, `grant_tx`, the receipt's sha256 or null, `verdict`, `reason`, `liable`, `delta`, `unjudged`, `provisional`). `/dispute` returns it, `/v/:tx` shows it, and a duplicate dispute returns the same one. A replaced verdict (provisional, or `receipt_equivocation`) gets a new id, and the record keeps the old id beside the replaced verdict. `verdict_id` is the intended external reference for a decided dispute, for example for an auditor or a journal entry.

## What the person saw (read this before quoting it)

On the Seeker, Seed Vault showed the **token and the amount** for the grant transaction (the spending cap, `total_cap`). The transaction sheet also showed the generic warning "Approving this transaction will allow a third party to spend your asset in the future." (`docs/seedvault/t1/t1-sheet-2-loaded-trust-off.png`). It did not show the delegate and it did not show the memo. The wallet displayed no `signMessages` or Sign-In-With-Solana text at all (`docs/SEED-VAULT.md`). Every other limit has to be shown by the iussum app before the wallet opens; that app is Phase 2 and does not exist yet. The same signed transaction binds those limits by hash on chain. **Do not read this as "the wallet displayed the limits": it did not.**

## Verify it

Requires **Node 24 or newer** (`engines` says `>=24`; `node:sqlite` and a dependency need it, `npm ci` warns on Node 22).

```bash
npm ci
npm test                 # 356 tests (600 random histories among them), no network
npm run mutation         # breaks each of the checks one at a time and requires a test to fail
npm run demo:devnet      # fifteen scenarios on devnet with real USDC and a real facilitator (needs funded throw-away keys, see JUDGE_GUIDE.md)
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
| `docs/` | Phase 0 and Phase 1 evidence: X402-SURFACE, SEED-VAULT, ALLOWANCE, FEEDBACK |

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

Devnet and localnet only. No mainnet transaction, deploy or publish has been made. Seller-side checking works against stock x402 facilitators (payai and x402.org settled the Phase 0 and Phase 1 devnet payments with the extension attached). A Subscriptions-program delegate cannot pay through the live facilitators today (`docs/ALLOWANCE.md`), so Phase 1 uses a plain SPL delegate. What is not proven: the Seeker-signed grant through the iussum app, a recognised-domain Seed Vault flow, third-party sellers that adopt the middleware, and anything on mainnet. See `REPORT-phase1.md` and `REPORT-phase1.2.md` for the list.

- The period budget is enforced by the agent and attributed by the resolver. It is not enforced on chain: the allowance (`total_cap`) is.
- SPL Token, non-native mints only. A Token-2022 `ApproveChecked` fails the grant check, and a mandate whose asset is the native mint (wrapped SOL) is refused, because an ordinary unwrap closes the account with a balance and SyncNative changes it without a token instruction.
- While a grant is current, the allowance cross-check needs every debit since the grant, so the **first** dispute (or agent start) on a grant reads the account's whole history since the grant: one `getSignaturesForAddress` page per 100 signatures and one `getTransaction` per signature. Anyone can add history to the account with dust credits. Each signature is read once: the verified debits are kept as a checkpoint per grant (the resolver's SQLite store, the agent's data directory) and the next read starts after it. A read that reaches `maxPages` (1000 pages of 100 signatures by default) answers `history_incomplete` ("more than N pages") and keeps its progress, so the next dispute continues instead of starting over. The RPC client's transaction cache is bounded (5,000 entries).
- An agent without a data directory keeps its reservations in memory only: a restart forgets a payload that a seller kept and lands later within its blockhash lifetime. With one, they are restored at start. One agent per grant in a data directory: the agent's lock, reservations, checkpoint and scan files are keyed by `grant_tx`, source, agent and asset; the lock is a file with the PID created with `O_EXCL` (a stale lock is cleared only when that PID is not running); a partial or corrupt reservations file makes the agent refuse to pay instead of reading it as empty. Files of another grant (for example after the principal re-granted the same mandate) are ignored and never deleted, which also means a payload a seller kept before the re-grant and lands afterwards is not counted by the agent on the new grant.
- A seller gate keeps the receipts it signs in its own SQLite file when it has a `dataDir` (written before the response that carries the receipt; a failed write sends the response without a receipt header; a corrupt store stops the gate from starting), together with its supersession scan marker. Without a `dataDir` the memory is the 10,000 most recent receipts of the process.
- The first grant check of a seller gate (and the first read of an agent or a resolver) reads every signature since the grant, and anyone can lengthen that with dust credits. A gate does not hang a request on it: the check has a time budget (`grantCheckBudgetMs`, default 10 s); past it the gate answers `503` with `Retry-After` (`retryAfterSeconds`, default 5) and nothing settles, while the check keeps running in the background and its progress is kept (in observe mode the gate never blocks and records the payment unchecked). The reference agent honours `Retry-After` up to 3 times (`retry: { max, maxWaitMs }`), re-sending the same signed payload, so a retry does not add a reservation; a payload that was still answered with 503 stays reserved until it is proven expired or landed. Transactions are read in JSON-RPC batches (25 per POST, 2 in flight, rate-limited elements retried on their own). That cuts HTTP calls; it does not beat a rate-limited public RPC, where 250 dust credits still took minutes (numbers in `REPORT-phase1.6.md`): use a keyed RPC.
- `/dispute` is open to anyone, because principal-signed disputes are Phase 2. A verdict without a receipt is therefore provisional.

## Sources

Read on 2026-10-19 in a browser from the primary pages.

- **Meta Muse**: https://muse.ai/terms, page title "Muse Supplemental Terms of Service", "Last updated: 8 September 2026".
  - Section 7.7 "Financial actions": "(ii) you bear all risk of financial loss arising from such actions and your use of Muse; (iii) you are solely responsible for setting appropriate limits and safeguards (including transaction limits and category restrictions), monitoring your accounts and timely disputing errors with the applicable financial institution or payment provider".
  - Section 15 "Limitation of liability": "OUR AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR OUR SERVICES (INCLUDING MUSE) HEREUNDER WILL NOT EXCEED THE GREATER OF USD 250 OR THE AMOUNT YOU HAVE PAID US IN THE TWELVE MONTHS PRECEDING THE EVENTS GIVING RISE TO THE MOST RECENT CLAIM." The same section says: "FOR CLARITY, THIS LIMITATION APPLIES TO ANY CLAIM ARISING FROM MUSE TAKING ANY UNINTENDED, ERRONEOUS OR UNAUTHORISED ACTION, INCLUDING, BUT NOT LIMITED TO, SENDING UNINTENDED COMMUNICATIONS, EXECUTING UNINTENDED TRANSACTIONS OR MODIFYING OR DELETING DATA."
  - Meta's own help page ("How Muse works with payments", https://www.meta.com/help/artificial-intelligence/1436362127544482/) also says Muse asks for approval before completing a purchase, which the paragraph above does not mention.
- **Instinct**: https://instinct.com/terms, "Terms of Service | Instinct", "Last revised on August 26, 2026".
  - Section 3 "Using the services", Actions: "You hereby appoint the Services as your agent to enter into agreements, commitments or transactions on your behalf" and "Any such agreements or commitments shall be binding on you as if entered into directly by you." The same subsection says "disputes regarding any such purchase are between you and the applicable Connected Service provider, not us."
  - Section 9 "Limitations of liability": "THE COMPANY ENTITIES' TOTAL LIABILITY TO YOU FOR ANY DAMAGES FINALLY AWARDED SHALL NOT EXCEED THE GREATER OF ONE HUNDRED DOLLARS ($100.00), OR THE AMOUNT YOU PAID THE COMPANY ENTITIES FOR THE SERVICES, IF ANY, IN THE PAST SIX (6) MONTHS GIVING RISE TO THE CLAIM."
- **chargeback.io** (a chargeback-management vendor, so a secondary source with a commercial interest): "Agentic Payments and Chargebacks: A Merchant Guide", Theodore Sterling, "Date posted August 21, 2026", https://www.chargeback.io/blog/agentic-payments-chargebacks. "A disputed agent purchase files under a reason code you already work with, most often Visa 10.4, 13.1, or 13.3. Nothing in the dispute system labels a transaction as agent-made." Its summary line: "Agentic payments create chargebacks under existing reason codes, while the still-unsolved merchant need is evidence of the customer's mandate to the agent." The card networks' own rules were not read.

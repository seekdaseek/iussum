# REPORT: iussum Phase 1.2 (2026-10-19)

Commit hashes cited here are public commits on GitHub. **The section 1 HEAD, on which every regression test below fails, is `057ff14`** (the public history after the private files were removed; see [docs/COMMITS.md](docs/COMMITS.md) for the older hashes quoted in the earlier reports). The tests were committed first (`23cb020`, failing on `057ff14`), the fixes next (`ad94ef7`).

Devnet and localnet only. Nothing was posted anywhere (the x402#3500 comment was not posted).

## Gate

| gate | result |
|---|---|
| `npm test` | **307 tests, 307 pass, 0 fail, 0 skipped** (was 241) |
| `npm run mutation` | baseline 307 / 307; **98 checks mutated, survived 0** (was 76). The first run had four survivors, killed by stronger tests, not by deleting checks (`TESTS.md`) |
| the seven review scripts | wrong outcome on `057ff14`, correct outcome after the fixes: both outputs below |
| the new regression tests | 46 tests in `test/phase12`: on `057ff14` 32 fail and 12 pass (controls such as "a normal payment is judged", and guards for behaviour that did not exist yet, such as "a payment that was never created releases its reservation"): [docs/phase12/regression-on-057ff14.txt](docs/phase12/regression-on-057ff14.txt); after the fixes 46 pass: [docs/phase12/regression-on-fixed.txt](docs/phase12/regression-on-fixed.txt) |
| five clean devnet runs | `demo-runs-1.2/run-1.txt` to `run-5.txt`, each `61/61 checks passed`, exit code 0; 160 signatures, every one checked with `getSignatureStatuses` (160 finalized, 0 missing, 0 with an error): [demo-runs-1.2/signatures.md](demo-runs-1.2/signatures.md) |
| fresh clone of github.com/seekdaseek/iussum | `npm ci && npm test` on a clone of `ff6e3d3`: **307 tests, 307 pass, 0 fail, 0 skipped**; no BRIEF, mp4, log, publish-report, merchant-research or review-script file in the tree or in any commit; all 20 commits authored and committed by `seekdaseek <ochinimus@gmail.com>`; no Co-Authored-By or Claude-Session line; repo PUBLIC, MIT |
| sensitive scan over all public history | the Addendum D patterns plus the device serial, run over every commit; positive controls first (the pattern finds the serial in the private bundle and `4a8o45sk` in the private brief files). Result: the only hits are the `.env*` ignore line in `.gitignore` and the provider name in `vendor/nuntius-mandate` (unchanged and byte-identical, as the addendum says). The pattern list is not written into any tracked file |
| relative links in tracked `.md` | all resolve to tracked files |

## Before and after

| # | finding | before (`057ff14`) | after |
|---|---|---|---|
| B1 | spend history misses debits and still says complete | a hidden 0.05 debit as a plain Transfer, a BurnChecked or a CPI TransferChecked: the later payment that crossed the budget was `in_scope`, principal; the debit itself was `tx_mismatch`, liable null; an unreadable transaction was skipped with `complete:true`; a debit in the grant's own slot was dropped | **one parser** reads Transfer, TransferChecked, Burn and BurnChecked, top level and CPI, in execution order (`parseDebits`, `packages/core/src/chain.js`); every counted transaction is **reconciled** (parsed movement out of the account = balance drop) or the history is incomplete and names the signature; an unreadable listed transaction makes `complete:false`; position, not slot, decides "after the grant". The crossing payment is `period_over_budget`, agent operator; the hidden debit is **`debit_not_x402`**, agent operator, each debit listed in the delta; the unreadable case is `history_incomplete`, liable null |
| B2 | supersession fails open on an unreadable transaction | the old M1 passed the grant check while G2 was unreadable and **kept passing after the RPC recovered**; the resolver stored `in_scope` under M1 and a later M2 dispute got `duplicate_dispute` | an unreadable transaction in the scan **throws**: the gate and agent answer `grant_inactive` "could not verify", the resolver `history_incomplete`; the checker does not advance past it; the earliest superseding transaction is chosen by block position. Added: concurrent checks of one grant share one scan |
| B3 | payments the agent did not sign are put on the agent operator | the principal's own transfer, even 100 slots before the grant, was `valid`, agent operator, stored | no debit of the granted account signed by the agent, or a payment not after the grant transaction: **`tx_mismatch`, liable null, not stored**, resubmittable |
| B4 | whoever files first picks the evidence | a seller filing without the receipt got `in_scope` (principal) stored; the principal's later dispute with the receipt got `duplicate_dispute` and no refund | a verdict decided without a receipt is **provisional** (flag in `/dispute` and on `/v/:tx`); a later dispute with a receipt that verifies and binds the same mandate **replaces** it (the replaced verdict stays in the record) and pays the refund if the seller is liable; a verdict decided with a verifying receipt is final. A verifying receipt that binds no mandate does not replace it. `/dispute` stays open (said in the README) |
| B5 | agent checks its budget before it records the spend | five concurrent payments against a 30000 budget: all five settled (50000); an overlapping pair lost a settled payment from the ledger; a settled payment whose response was lost was never counted | the budget is **reserved before signing**, in the same synchronous step as the check; the reservation id travels in the per-call store and the global `pending` is gone; held counts as spent until it is consumed (success response, or the chain shows the agent's signature landed) or released (no payload was created, or the blockhash expired and no such transaction is on chain). Five concurrent: exactly three settle, two are refused locally |
| S6 | the agent pays a destination the seller names | the signed TransferChecked went to the thief's account while only `payTo` was checked | the destination is always the associated token account of `payTo`; a requirement naming another is refused locally, **`destination_mismatch`**, never signed |
| S7 | same-slot payments ordered by signature string | A (20000, first) and B (90000, second): with sig(B) < sig(A) the principal was held for 90000 and the agent operator for 20000 | slot, then the transaction's index in the block (`getBlock`, signatures only, fetched only when two relevant transactions share a slot), then instruction position; an unreadable block makes the history incomplete. The real `getBlock` path was exercised on devnet (a payment at index 41 of a 51-transaction block) |
| S8 | `http://` resource prefixes | accepted | refused except `localhost`, `127.0.0.1` and `[::1]` |
| C1 | allowance cross-check | none | while the grant is current, the debits since the grant must equal `total_cap` minus the source account's delegated amount (account read first, with its context slot; 0 left when the delegate is gone); a mismatch is `history_incomplete` with both numbers. Used by the resolver and by the agent's ledger rebuild. On the real chain it agreed in all five runs (160 signatures) |
| C2 | Token-2022 | not stated | vector `grant: ApproveChecked on the Token-2022 program ...` shows the grant check refuses it. **This vector passes on `057ff14` too**: it documents existing behaviour; the README says SPL Token only |

### The seven review scripts

Run from `review-20261019/` (kept out of git). On `057ff14`:

```
### d1-history.mjs
control          | P2 (true spend 110000 > budget 100000): period_over_budget/agent_operator | dispute of H itself: in_scope/principal stored=2
transfer         | P2 (true spend 110000 > budget 100000): in_scope/principal | dispute of H itself: tx_mismatch/null stored=1
burnChecked      | P2 (true spend 110000 > budget 100000): in_scope/principal | dispute of H itself: tx_mismatch/null stored=1
cpi              | P2 (true spend 110000 > budget 100000): in_scope/principal | dispute of H itself: tx_mismatch/null stored=1
twoTransfers     | P2 (true spend 110000 > budget 100000): period_over_budget/agent_operator | dispute of H itself: tx_mismatch/null stored=1
unreadable       | P2 (true spend 110000 > budget 100000): in_scope/principal | dispute of H itself: tx_not_found/null stored=1
sameSlotAsGrant  | P2 (true spend 110000 > budget 100000): in_scope/principal | dispute of H itself: history_incomplete/null stored=1
### d2-agent-mismatch.mjs
principal pays 100 slots BEFORE the grant: verdict=valid reason=pay_to_not_allowed liable=agent_operator codes=agent_mismatch,pay_to_not_allowed stored=1
principal pays after the grant: verdict=valid reason=pay_to_not_allowed liable=agent_operator codes=agent_mismatch,pay_to_not_allowed stored=1
### d3-lockin.mjs
resource outside prefix (seller-visible only via receipt)
  receipt filed first : resource_not_allowed/seller refunds=1
  seller files first  : in_scope/principal; principal then: duplicate_dispute (orig in_scope)/principal refunds=0
amount over per_payment_max
  receipt filed first : amount_over_cap/seller refunds=1
  seller files first  : amount_over_cap/agent_operator; principal then: duplicate_dispute (orig amount_over_cap)/agent_operator refunds=0
### d4-agent.mjs
(a) 5 concurrent fetches, 10000 each, period_budget 30000: 200,200,200,200,200 | settled=5 (=50000) | ledger entries=5
    next sequential fetch: period_over_budget | settled total=50000
(b) budget 30000, price 20000; 1st response lost after settle: fetch failed: socket hang up; ledger=1; 2nd: 200 | settled total=40000
(c) declared payTo=sellerA (allowed); agent result=402; signed TransferChecked destination=thief's ATA (sellerA ATA would be GvDNmYMmCvnzhgZVZ1XGxWznCgL3BvpEJBPfTvjL1yps)
### d5-agent-pending.mjs
A=200 B=200: settled=20000, ledger=10000
then 3 sequential fetches: 200,200,period_over_budget -> settled total=40000 vs period_budget 30000
(b) 1st: "fetch failed: socket hang up" (settled=20000, ledger entries=0); 2nd: 200 -> settled total=40000 vs period_budget 30000
### d6-supersede-unreadable.mjs
seller/agent grant check of superseded M1: G2 unreadable -> ok=true; same checker after RPC recovers -> ok=true; fresh checker -> ok=false (superseded by G2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)
resolver, P (40000) judged with superseded M1 while G2 unreadable: in_scope/principal stored=1; later dispute under the real M2: duplicate_dispute (orig in_scope)/principal
### d7-sameslot-order.mjs
A (executed 1st, 20000): spent 110000 over=true -> agent_operator
B (executed 2nd, 90000): spent 90000 over=false -> principal
```

After the fixes:

```
### d1-history.mjs
control          | P2 (true spend 110000 > budget 100000): period_over_budget/agent_operator | dispute of H itself: in_scope/principal stored=2
transfer         | P2 (true spend 110000 > budget 100000): period_over_budget/agent_operator | dispute of H itself: debit_not_x402/agent_operator stored=2
burnChecked      | P2 (true spend 110000 > budget 100000): period_over_budget/agent_operator | dispute of H itself: debit_not_x402/agent_operator stored=2
cpi              | P2 (true spend 110000 > budget 100000): period_over_budget/agent_operator | dispute of H itself: debit_not_x402/agent_operator stored=2
twoTransfers     | P2 (true spend 110000 > budget 100000): history_incomplete/null | dispute of H itself: history_incomplete/null stored=0
unreadable       | P2 (true spend 110000 > budget 100000): history_incomplete/null | dispute of H itself: tx_not_found/null stored=0
sameSlotAsGrant  | P2 (true spend 110000 > budget 100000): period_over_budget/agent_operator | dispute of H itself: in_scope/principal stored=2
### d2-agent-mismatch.mjs
principal pays 100 slots BEFORE the grant: verdict=invalid reason=tx_mismatch liable=null codes= stored=0
principal pays after the grant: verdict=invalid reason=tx_mismatch liable=null codes= stored=0
### d3-lockin.mjs
resource outside prefix (seller-visible only via receipt)
  receipt filed first : resource_not_allowed/seller refunds=1
  seller files first  : in_scope/principal; principal then: resource_not_allowed (orig undefined)/seller refunds=1
amount over per_payment_max
  receipt filed first : amount_over_cap/seller refunds=1
  seller files first  : amount_over_cap/agent_operator; principal then: amount_over_cap (orig undefined)/seller refunds=1
### d4-agent.mjs
(a) 5 concurrent fetches, 10000 each, period_budget 30000: 200,200,period_over_budget,period_over_budget,200 | settled=3 (=30000) | ledger entries=3
    next sequential fetch: period_over_budget | settled total=30000
(b) budget 30000, price 20000; 1st response lost after settle: fetch failed: socket hang up; ledger=0; 2nd: period_over_budget | settled total=20000
(c) declared payTo=sellerA (allowed); agent result=destination_mismatch; signed TransferChecked destination=undefined (sellerA ATA would be GvDNmYMmCvnzhgZVZ1XGxWznCgL3BvpEJBPfTvjL1yps)
### d5-agent-pending.mjs
A=200 B=200: settled=20000, ledger=10000+10000
then 3 sequential fetches: 200,period_over_budget,period_over_budget -> settled total=30000 vs period_budget 30000
(b) 1st: "fetch failed: socket hang up" (settled=20000, ledger entries=0); 2nd: period_over_budget -> settled total=20000 vs period_budget 30000
### d6-supersede-unreadable.mjs
seller/agent grant check of superseded M1: G2 unreadable -> ok=false; same checker after RPC recovers -> ok=false; fresh checker -> ok=false (superseded by G2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx)
resolver, P (40000) judged with superseded M1 while G2 unreadable: history_incomplete/null stored=1; later dispute under the real M2: amount_over_cap (orig undefined)/agent_operator
### d7-sameslot-order.mjs
A (executed 1st, 20000): spent 20000 over=false -> principal
B (executed 2nd, 90000): spent 110000 over=true -> agent_operator
```

Reading the "after" output: `twoTransfers` in `d1` shows `history_incomplete`, not `debit_not_x402`, because that script's transaction is internally inconsistent (it adds a second 50000 transfer but leaves the source balance dropping by 50000, so the reconcile refuses it); the same scenario with consistent balances is a test in `test/phase12/b1-history.test.js` and gives `debit_not_x402`. `d3` shows `orig undefined` because the second dispute is now a fresh verdict, not a duplicate.

## Changes to tests that existed before

Stated because they change what the suite asserts:

- `test/fixtures.mjs`: `payTx` now carries pre/post token balances (real responses have them, and the reconcile needs them); the vectors were regenerated from it.
- Two vector expectations changed on purpose: "payment signed by someone other than the agent" was `valid`/agent_mismatch/seller and is now `tx_mismatch`, liable null (B3); "two TransferChecked in one transaction" was `tx_mismatch` and is now `debit_not_x402`, agent operator (B1). The old `resolver.source` check was replaced by `resolver.agent_debit` (same outcome for a payment from another account).
- `agent.test.js` "grant revoked": the fake chain now contains the Revoke transaction (a delegate that vanished with no Revoke on chain is, correctly, a history that does not add up). `fixes.test.js` F7: the account's delegated amount reflects the earlier payment. `f5-host-header.test.js`: the allowed origin is `http://localhost:<port>` because `http://` prefixes are valid only for local hosts since S8.
- `scripts/mutation.mjs` now runs each mutated suite with `--test-force-exit --test-timeout=60000`, because a mutated run that left a server open hung the whole mutation check.

## Devnet

- Five clean runs, `demo-runs-1.2/`: 13 scenarios, 61 checks each. New scenarios: **11** (the agent signs a plain Transfer out of the principal's account outside x402; the x402 payment that then crosses the budget is `period_over_budget`, agent operator; a dispute of the Transfer is `debit_not_x402`), **12** (five concurrent `agent.fetch` against a budget that fits three: three settled and confirmed on chain, two refused locally, the principal paid exactly 0.03 USDC), **13** (the seller files first without the receipt, provisional; the principal files with it; the verdict is replaced, the seller is liable and the refund is on chain).
- Signatures: [demo-runs-1.2/signatures.md](demo-runs-1.2/signatures.md), 160 signatures (70 grants, 65 payments, 15 refunds, 5 revokes, 5 plain transfers).
- **Two earlier attempts were not clean and are kept.** `demo-runs-1.2-attempt1/`: runs 1 and 2 failed two checks of scenario 12 (some of the five concurrent payments were refused `grant_inactive` by the seller or the agent, so fewer than three settled; the reservation of a payment the seller refused with a 403 stays held until its blockhash expires, which is the rule, so the budget stayed occupied). I could not isolate the cause: it did not reproduce in three standalone tries, and the diagnostic output that would show the detail did not exist yet. Many identical grant checks were hitting the public devnet RPC at once (a parallel test with four processes did show HTTP 429 from it), and a failed check refuses (fail closed). The change made: concurrent checks of one grant now share one supersession scan (`grant.coalesce_scans`, with a test), and scenario 12 now prints any unexpected outcome in full. This is a mitigation of a plausible cause, **not a confirmed fix**: scenario 12 passed in all 10 runs after the change (the five runs of `attempt2` and the five final runs), and in attempt1 runs 3 to 5 before it, which is evidence, not proof. `demo-runs-1.2-attempt2/`: runs 3 to 5 failed only the refund checks because the refund-float wallet had run out of devnet USDC (0 left; the resolver reported `refund_error` and did not crash). I funded it with 2 USDC from the throw-away principal (devnet transaction `3DsPXisCwfmuz6DmP1R2jLP9F4xAEMsMuxu2F6PYmDKFWXGmvEDAofzmFNk2gfpo7hUDzmRQjiw4FkGfgFB8ygqz`) and reran all five.

## Still UNTESTED

- The Seeker-signed grant through the iussum app (Phase 2), a recognised-domain Seed Vault flow, third-party sellers that adopt the middleware, and anything on mainnet.
- The release of a held reservation on a real chain (blockhash expiry with no landing): tested with a stubbed RPC only. Consume-on-landing is also stub-only.
- Two transactions in the same slot on a real chain: the `getBlock` read was checked on devnet, but no demo scenario produced a same-slot tie, so the tie-break is tested on the simulated chain only.
- A Token-2022 grant on chain: vector only.
- `/dispute` is open to anyone; a principal-signed dispute is Phase 2. A provisional verdict can be wrong until a receipt is filed.
- The period budget is enforced by the agent and attributed by the resolver. It is not enforced on chain; only `total_cap` is.
- The resolver's RPC cost: every dispute scans the account history and reads the account; no load or rate-limit testing beyond the demo runs.

# REPORT: iussum Phase 1.3 (2026-10-19)

Baseline for every regression test below: **`e065db0`** (the public HEAD the follow-up review ran against). The tests were committed first (`e8779f9`, failing on `e065db0`), the fixes next (`00ba46a`), then the property test and the devnet and docs commits. Normal pushes only: no history rewrite, no force-push. Devnet and localnet only; nothing was posted anywhere (the x402#3500 comment was not posted).

## Gate

| gate | result |
|---|---|
| `npm test` | **331 tests, 331 pass, 0 fail, 0 skipped** (was 307), about 14 s |
| `npm run mutation` | baseline 331 / 331; **104 checks mutated, survived 0** (was 98) |
| the five v2 review scripts | wrong outcome on `e065db0`, correct outcome after the fixes: both outputs below |
| the new regression tests | `test/phase13`: 20 at the time of the baseline run, **15 fail and 5 pass on `e065db0`** (the 5 are controls, e.g. "50 payments in period 0 is judged", "the same receipt filed twice is a duplicate"): [docs/phase13/regression-on-e065db0.txt](docs/phase13/regression-on-e065db0.txt); after the fixes all pass: [docs/phase13/regression-on-fixed.txt](docs/phase13/regression-on-fixed.txt) |
| property test | 600 seeded histories, passes in about 12 s; the same file **fails on `e065db0`** (I1 at seed 2, I2 at seed 15, I4 at seed 1): see below |
| five clean devnet runs | `demo-runs-1.3/run-1.txt` to `run-5.txt`, each `63/63 checks passed`, exit code 0; 160 signatures, every one checked with `getSignatureStatuses` (160 finalized): [demo-runs-1.3/signatures.md](demo-runs-1.3/signatures.md) |
| fresh clone of the final pushed HEAD | `npm ci && npm test` on a clone of `1ffba7e` (the pushed HEAD that carries everything else in this report): **331 tests, 331 pass, 0 fail, 0 skipped**; no private file in the tree or in any commit; all 27 commits authored and committed by `seekdaseek <ochinimus@gmail.com>`; no Co-Authored-By or Claude-Session line. The one commit after it only fills in this line, and a second clone of that final HEAD was tested the same way (result in the closing message and the local log) |
| sensitive scan over the new commits | the Addendum D patterns plus the device serial, positive controls first, over every commit of the history: nothing new; the only hits are the environment-file ignore line in `.gitignore` and the provider name in `vendor/nuntius-mandate` (unchanged). The pattern list is not written into any tracked file |
| relative links in tracked `.md` | all resolve to tracked files |

## Before and after

| # | finding | before (`e065db0`) | after |
|---|---|---|---|
| N4 | the seller signs a second receipt and files it first | a second in-prefix receipt gave `in_scope`, principal, final; a null-mandate receipt gave agent operator, final; the principal's genuine receipt then got `duplicate_dispute` and no refund | the store keeps the receipt body with the verdict. A later dispute whose receipt verifies against the same seller key and differs from the stored one in any signed field is **`receipt_equivocation`**, valid, liable seller: it replaces what is stored (provisional or final, the replaced verdict stays in the record) and the refund is paid once per payment. Filing the same receipt again is a duplicate; a receipt that does not verify changes nothing |
| N2 | an extra TransferChecked from another account turns a violation into no verdict | 40000 to a seller not on the list plus 1 unit from the agent's own account: `tx_mismatch`, liable null, not stored (the control gave `pay_to_not_allowed`, agent operator) | the x402 path needs the **whole transaction** to be the x402 shape: the parsed debits of the transaction, top level and inner, are exactly one, and it is the agent's top-level TransferChecked out of the granted account. Anything else with an agent debit of the source is `debit_not_x402`, agent operator, every debit listed. The agent's own debit is judged, never `transfers[0]` |
| N1 | the allowance cross-check was fed a history cut at the period start | 150 payments in period 0 then an honest payment in period 1: `history_incomplete` ("15100 expected, 10000 found"); an honest agent restarted in period 1 refused every payment; dust credits could push the history past a page | while the grant is current the history is paged back **to the grant**, no cut, in the resolver and in the agent's rebuild (the supersession scan now runs first, because only a superseded grant, which skips the cross-check, may stop at the period start). Cost, stated in the README limits: a dispute reads the account's whole history since the grant |
| N3 | one agent self-transfer switched off every verdict while the grant is current | after one self-transfer of 50000, an in-scope P1 and an out-of-scope P2 both came back `history_incomplete`, null | `transfer` and `transferChecked` with source = destination are neither a debit nor a credit (`parseDebits` skips them), as in SPL Token. A disputed transaction whose only agent instruction on the source is a self-transfer is `tx_mismatch`, liable null |
| N12 | the agent trusted the seller's blockhash expiry | a seller answering `lastValidBlockHeight: 1`, keeping payload 1 and replying 502: the agent released the reservation, the next payment passed, the seller landed payload 1, **40000 settled against a 30000 budget** | the agent never takes `recentBlockhash` or `lastValidBlockHeight` from the 402; it always uses its own `getLatestBlockhash`. A held reservation is released only when `isBlockhashValid` for that payload's own blockhash says false AND no transaction carrying the agent's signature from it is on chain; an answer that cannot be read leaves it held. Same scenario: the second payment is refused, 20000 settled |
| N5 | closing the source account made earlier payments unjudgeable for good | after the principal emptied and closed the account an earlier `pay_to_not_allowed` payment became `history_incomplete`, null (re-creating the account had the same effect) | a balance entry missing on one side (the account was created or closed in that transaction) counts as 0 on that side; any other mismatch still fails closed. The earlier payment is `pay_to_not_allowed`, agent operator |

C1 (the allowance cross-check) is unchanged apart from N1. The README gained the equivocation line and the cost line.

### The five v2 review scripts

Run from `review-20261019b/` (kept out of git). On `e065db0`:

```
### v2-new.mjs
--- N1: C1 compares ALL debits since the grant with a history cut at the period start (stopAtTime)
  50 payments in period 0, honest in-scope payment in period 1: in_scope/principal 
  150 payments in period 0, honest in-scope payment in period 1: history_incomplete/null {"field":"allowance","authorized":"15100 (total_cap 1000000 minus 984900 still delegated at slot 90000)","actual":"10000 found in the history"}
--- N2: one agent debit of the source + a second top-level TransferChecked from ANOTHER account (the agent's own)
  40000 to a seller not on the list (control): valid/pay_to_not_allowed/agent_operator stored=1
  40000 to a seller not on the list + 1 unit from the agent's own account: invalid/tx_mismatch/null stored=0
--- N3: agent self-transfer (source -> source): counted as a debit, but the token program does not lower the allowance
  control: P2 (pay_to not allowed) pay_to_not_allowed/agent_operator; P1 (in scope) in_scope/principal
  after one self-transfer: P2 (pay_to not allowed) history_incomplete/null; P1 (in scope) history_incomplete/null
--- N4: the seller signs its own second receipt and files first; a receipt verdict is final
  control: genuine receipt first: resource_not_allowed/seller provisional=false; principal with genuine receipt: duplicate_dispute/seller refunds=1
  seller files forged in-scope receipt first: in_scope/principal provisional=false; principal with genuine receipt: duplicate_dispute/principal refunds=0
  seller files forged no-mandate receipt first: resource_not_allowed/agent_operator provisional=false; principal with genuine receipt: duplicate_dispute/agent_operator refunds=0
### v2-new2.mjs
N12 control (agent's own blockhash, valid to 5000): 1st 502 [held] -> 2nd period_over_budget [held] -> withheld payload settled later: 200 | settled total 20000 vs budget 30000
N12 seller says lastValidBlockHeight=1: 1st 502 [held] -> 2nd 200 [released,consumed] -> withheld payload settled later: 200 | settled total 40000 vs budget 30000
N5 control: P (pay_to not allowed, made before) pay_to_not_allowed/agent_operator 
N5 principal later empties and closes the account: P (pay_to not allowed, made before) history_incomplete/null {"field":"history","authorized":"complete history of the agent's payments from the granted account","actual":"transaction CLOSExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
### v2-new3.mjs
N1 after a revoke: in_scope/principal
N3 after a revoke: P2 pay_to_not_allowed/agent_operator
N1 honest agent restarted in period 1 after 50 in-scope payments in period 0: 200
N1 honest agent restarted in period 1 after 150 in-scope payments in period 0: history_incomplete: "could not be rebuilt from chain: the debits found (10000) do not add up to the allowance that is gone (15000): total_cap 1000000 minus 985000 still d
### v2-agent.mjs
(a) 5 concurrent x 10000, budget 30000: 200,200,period_over_budget,period_over_budget,200 | settled=30000
(b) lost response after settle: 1st "fetch failed: socket hang up", 2nd period_over_budget | settled=20000 | reservations=held
(c) injected destination: agent result=destination_mismatch; anything signed and sent: nothing
(d5) staggered A=200 B=200; ledger=10000+10000+10000; then 3 sequential: 200,period_over_budget,period_over_budget | settled=30000
### v2-ports.mjs
--- d1 history (budget 100000; hidden 50000, P1 40000, P2 20000)
  control          P2: period_over_budget/agent_operator | H: in_scope/principal | stored=2
  transfer         P2: period_over_budget/agent_operator | H: debit_not_x402/agent_operator | stored=2
  burnChecked      P2: period_over_budget/agent_operator | H: debit_not_x402/agent_operator | stored=2
  cpi              P2: period_over_budget/agent_operator | H: debit_not_x402/agent_operator | stored=2
  twoTransfers     P2: period_over_budget/agent_operator | H: debit_not_x402/agent_operator | stored=2
  unreadable       P2: history_incomplete/null | H: tx_not_found/null | stored=0
  sameSlotAsGrant  P2: period_over_budget/agent_operator | H: in_scope/principal | stored=2
--- d2 payer is the principal
  before the grant: invalid/tx_mismatch/null stored=0
  after the grant: invalid/tx_mismatch/null stored=0
--- d3 first filer without the receipt
  resource outside prefix: receipt first resource_not_allowed/seller refunds=1 | seller first in_scope/principal provisional=true; principal then resource_not_allowed/seller refunds=1
  amount over per_payment_max: receipt first amount_over_cap/seller refunds=1 | seller first amount_over_cap/agent_operator provisional=true; principal then amount_over_cap/seller refunds=1
--- d6 superseding grant unreadable
  checker M1 while G2 unreadable: ok=false (could not verify the grant is current: transaction G2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx could not be read); after recovery: ok=false (superseded by G2xxxxxxxxxxxxxx)
  resolver M1 while G2 unreadable: history_incomplete/null stored=1; then M2 no receipt: amount_over_cap/agent_operator
--- d7 same slot: A (20000) executes first, B (90000) second, sig(B) < sig(A), budget 100000
  A: in_scope/principal
  B: period_over_budget/agent_operator
```

After the fixes:

```
### v2-new.mjs
--- N1: C1 compares ALL debits since the grant with a history cut at the period start (stopAtTime)
  50 payments in period 0, honest in-scope payment in period 1: in_scope/principal 
  150 payments in period 0, honest in-scope payment in period 1: in_scope/principal 
--- N2: one agent debit of the source + a second top-level TransferChecked from ANOTHER account (the agent's own)
  40000 to a seller not on the list (control): valid/pay_to_not_allowed/agent_operator stored=1
  40000 to a seller not on the list + 1 unit from the agent's own account: valid/debit_not_x402/agent_operator stored=1
--- N3: agent self-transfer (source -> source): counted as a debit, but the token program does not lower the allowance
  control: P2 (pay_to not allowed) pay_to_not_allowed/agent_operator; P1 (in scope) in_scope/principal
  after one self-transfer: P2 (pay_to not allowed) pay_to_not_allowed/agent_operator; P1 (in scope) in_scope/principal
--- N4: the seller signs its own second receipt and files first; a receipt verdict is final
  control: genuine receipt first: resource_not_allowed/seller provisional=false; principal with genuine receipt: duplicate_dispute/seller refunds=1
  seller files forged in-scope receipt first: in_scope/principal provisional=false; principal with genuine receipt: receipt_equivocation/seller refunds=1
  seller files forged no-mandate receipt first: resource_not_allowed/agent_operator provisional=false; principal with genuine receipt: receipt_equivocation/seller refunds=1
### v2-new2.mjs
N12 control (agent's own blockhash, valid to 5000): 1st 502 [held] -> 2nd period_over_budget [held] -> withheld payload settled later: 200 | settled total 20000 vs budget 30000
N12 seller says lastValidBlockHeight=1: 1st 502 [held] -> 2nd period_over_budget [held] -> withheld payload settled later: 200 | settled total 20000 vs budget 30000
N5 control: P (pay_to not allowed, made before) pay_to_not_allowed/agent_operator 
N5 principal later empties and closes the account: P (pay_to not allowed, made before) pay_to_not_allowed/agent_operator 
### v2-new3.mjs
N1 after a revoke: in_scope/principal
N3 after a revoke: P2 pay_to_not_allowed/agent_operator
N1 honest agent restarted in period 1 after 50 in-scope payments in period 0: 200
N1 honest agent restarted in period 1 after 150 in-scope payments in period 0: 200
### v2-agent.mjs
(a) 5 concurrent x 10000, budget 30000: 200,200,period_over_budget,period_over_budget,200 | settled=30000
(b) lost response after settle: 1st "fetch failed: socket hang up", 2nd period_over_budget | settled=20000 | reservations=held
(c) injected destination: agent result=destination_mismatch; anything signed and sent: nothing
(d5) staggered A=200 B=200; ledger=10000+10000+10000; then 3 sequential: 200,period_over_budget,period_over_budget | settled=30000
### v2-ports.mjs
--- d1 history (budget 100000; hidden 50000, P1 40000, P2 20000)
  control          P2: period_over_budget/agent_operator | H: in_scope/principal | stored=2
  transfer         P2: period_over_budget/agent_operator | H: debit_not_x402/agent_operator | stored=2
  burnChecked      P2: period_over_budget/agent_operator | H: debit_not_x402/agent_operator | stored=2
  cpi              P2: period_over_budget/agent_operator | H: debit_not_x402/agent_operator | stored=2
  twoTransfers     P2: period_over_budget/agent_operator | H: debit_not_x402/agent_operator | stored=2
  unreadable       P2: history_incomplete/null | H: tx_not_found/null | stored=0
  sameSlotAsGrant  P2: period_over_budget/agent_operator | H: in_scope/principal | stored=2
--- d2 payer is the principal
  before the grant: invalid/tx_mismatch/null stored=0
  after the grant: invalid/tx_mismatch/null stored=0
--- d3 first filer without the receipt
  resource outside prefix: receipt first resource_not_allowed/seller refunds=1 | seller first in_scope/principal provisional=true; principal then resource_not_allowed/seller refunds=1
  amount over per_payment_max: receipt first amount_over_cap/seller refunds=1 | seller first amount_over_cap/agent_operator provisional=true; principal then amount_over_cap/seller refunds=1
--- d6 superseding grant unreadable
  checker M1 while G2 unreadable: ok=false (could not verify the grant is current: transaction G2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx could not be read); after recovery: ok=false (superseded by G2xxxxxxxxxxxxxx)
  resolver M1 while G2 unreadable: history_incomplete/null stored=1; then M2 no receipt: amount_over_cap/agent_operator
--- d7 same slot: A (20000) executes first, B (90000) second, sig(B) < sig(A), budget 100000
  A: in_scope/principal
  B: period_over_budget/agent_operator
```

## Property test

`test/phase13/property.test.js`: a seeded random test over the simulated chain, deterministic (a failure prints the seed; `PROPERTY_SEED=n` reruns one, `PROPERTY_SEEDS=N` sets the count), under half a minute. Each history is a random sequence for one principal and one agent mixing honest x402 payments (amounts inside and over the caps, allowed and not-allowed `pay_to`), x402-shaped payments with a second agent debit, hidden agent debits (plain transfer, burn, burnChecked, a CPI inner transfer), self-transfers, dust credits from strangers, a re-grant or a revoke or a close of the emptied source (and a re-creation of the account), and same-slot ties (a quarter of the events share the slot of the one before; the block order is the execution order). The **reference model is written in the test file from the README rules** and imports nothing from the resolver. Faults for I2: an unreadable transaction, an unreadable block, a not-found that heals after a few reads.

```
property I1: 600 histories (seeds 1..600), 2953 disputes, 1980 with a decided model verdict
✔ property I1: 600 random histories, every dispute gets the model's verdict on a readable chain (seeds 1..600)
property I2: 2347 disputes with no verdict, 606 with the model's verdict, 0 different
✔ property I2: RPC faults give the model's verdict or no verdict, never a different decided verdict (600 histories)
property I3: 649 refunds over 200 histories, never two for one payment
✔ property I3: at most one refund per payment, and only on a seller-liable verdict (200 histories)
property I4: 60 seeds, 203 payments settled, 859 local refusals (all period_over_budget), 16 restarts, never above the budget
✔ property I4: the agent never settles more than period_budget under concurrency, lost responses, seller blockhash fields and restarts (60 seeds)
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

- **I1** (600 histories, 2953 disputes, 1980 with a decided model verdict): every dispute got the model's verdict, liable party and stored/not-stored state, and never `history_incomplete`.
- **I2**: with a fault injected in a random transaction or block, 2347 disputes got no verdict (liable null, nothing stored) and 606 got the model's verdict; none got a different decided verdict.
- **I3** (200 histories): each payment was disputed six times with and without receipts, genuine and forged; 649 refunds in total, never two for one payment, and a refund only where the stored verdict was seller-liable.
- **I4** (60 seeds): random batches of 1 to 5 concurrent payments, lost responses (settled, response dropped), a seller that tampers the blockhash fields of its 402s, a seller that keeps payloads (502) and lands them later, and restarts of the agent from the chain: 203 payments settled, 859 local refusals (all `period_over_budget`, none for a history reason), never above `period_budget`, including after the seller landed everything it kept.
- **The test has teeth.** The same file run against `e065db0` fails: I1 at seed 2 (the N2 shape: model says `debit_not_x402`, the code said `tx_mismatch`), I2 at seed 15 (a self-transfer judged as a debit) and I4 at seed 1 (40000 settled against 30000, the N12 attack).
- **Model/code disagreements.** On the fixed code the model and the code never disagreed. The disagreements with `e065db0` were exactly the defects above (N2, N3, N12). Two modelling choices are worth stating because the README does not spell them out: a payment that is not a debit signed by the agent (a self-transfer, the principal's own transfer) has no decided verdict at all, and when several violations apply the reported reason follows a fixed priority (amount, pay_to, resource, period), which the model copies from the README's listing, not from the code.
- **A limit the test made explicit and I did not fix:** the agent's reservations live in memory. A restart rebuilds the ledger from the chain, so a payload that a seller kept and lands later, within its blockhash lifetime, is unknown to the restarted agent. I4 therefore does not restart while a kept payload is outstanding. It is stated in the README limits.

## Changes to tests that existed before

- `test/phase12/b4-lockin.test.js` "a verdict decided WITH a verifying receipt is final": the second dispute used a DIFFERENT valid receipt, which is now `receipt_equivocation` by design; it now files the same receipt again (duplicate), and the different-receipt case is in `test/phase13/n4-equivocation.test.js`.
- `apps/resolver/test/service.test.js` "only hashes and verdicts are stored": the row now also keeps the seller-signed receipt body (N4 requires it); the test still asserts that no mandate body and no agent address are stored outside that receipt.
- One vector changed on purpose: an agent debit plus a second TransferChecked from another account was `tx_mismatch`, liable null, and is now `debit_not_x402`, agent operator (N2). The `resolver.single_transfer` check was folded into `resolver.debit_not_x402`.
- `test/phase12/b5-agent-reserve.test.js` and the property test stub `isBlockhashValid` instead of `getBlockHeight`; `test/regression/chainsim.mjs` ignores self-transfers when it computes the allowance.
- `scripts/mutation.mjs` runs the property test with 120 histories per mutated run (the full 600 run in `npm test`).

## Devnet

- Five clean runs, `demo-runs-1.3/`: 13 scenarios, 63 checks each, 160 signatures (70 grants, 65 payments, 15 refunds, 5 revokes, 5 plain transfers), all finalized.
- **Scenario 12 now files a dispute on each of the three payments that settled. All three were `in_scope`, principal, in all five runs.** Any two payments in one slot? **Yes, in all five runs**, and `getBlock` was read for the shared slot every time, so the tie-break has now run on a real tie:

| run | slots of the three payments | shared slot read with `getBlock` |
|---|---|---|
| 1 | 512904484, 512904484, 512904484 | 512904484 |
| 2 | 512905151, 512905152, 512905151 | 512905151 |
| 3 | 512905768, 512905768, 512905769 | 512905768 |
| 4 | 512906405, 512906405, 512906404 | 512906405 |
| 5 | 512907041, 512907040, 512907040 | 512907040 |

- The Phase 1.2 attempts that were not clean stay in `demo-runs-1.2-attempt1/` and `demo-runs-1.2-attempt2/` (`REPORT-phase1.2.md`).

## Still UNTESTED

- The Seeker-signed grant through the iussum app (Phase 2), a recognised-domain Seed Vault flow, third-party sellers that adopt the middleware, and anything on mainnet.
- Release of a held reservation on a real chain (the blockhash really expiring with nothing landed): tested with a stubbed RPC, including the property test; `isBlockhashValid` itself was not called against devnet by any run.
- A restart of the agent while a seller holds an unlanded payload (see the limit above): not handled, not tested beyond the explicit exclusion.
- Receipt equivocation against a real seller key on devnet: unit and property tested only; no demo scenario produces two receipts.
- The resolver's cost on a long-lived account: the full-history read is now unbounded while a grant is current; no load test, and the public devnet RPC rate-limits.
- A Token-2022 grant on chain: vector only. The period budget is not enforced on chain; only `total_cap` is.
- Two leftovers disclosed earlier stay in the public history by decision (removing them would change every hash, including the `057ff14` baseline): the treasury-address prefix in two commits of `REPORT-phase1.2.md` (the prefix of a public receiving address) and one line about a payout-documentation check in older versions of the Phase 0 and 1 reports.

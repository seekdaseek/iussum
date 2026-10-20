# REPORT: iussum Phase 1.4 (2026-10-20)

Baseline for every regression test below: **`73fd95a`**, the public HEAD the third review ran against. The tests were committed first (`1b4c576`, failing on `73fd95a`), the fixes next (`1982e07`), then the extended property test and the devnet and docs commits. Normal pushes only: no history rewrite, no force-push. Devnet and localnet only; nothing was posted anywhere.

## Gate

| gate | result |
|---|---|
| `npm test` | **348 tests, 348 pass, 0 fail, 0 skipped** (was 331), about 25 s, the property test included |
| `npm run mutation` | baseline 348 / 348; **115 checks mutated, survived 0** (was 104). The first run had two survivors (`agent.own_blockhash`, `agent.blockhash_valid`), killed by stronger assertions, not by deleting checks |
| `v3-new4.mjs` | T1 wrong on `73fd95a`, right after the fix: both outputs below |
| every v3 script | the other outputs are byte-identical before and after (the diff is the one T1 line); every earlier scenario still gives its fixed outcome |
| the new regression tests | `test/phase14`: 15 at the time of the baseline run, **12 fail and 3 pass on `73fd95a`** (the 3 are controls and guards: "the node says the blockhash is valid", "a restarted agent releases a proven-expired reservation", "an ordinary mint is accepted"): [docs/phase14/regression-on-73fd95a.txt](docs/phase14/regression-on-73fd95a.txt); a 16th test was added later; all pass after the fixes |
| property test | passes on the fixed code in about 22 s; the same file **fails on `73fd95a`** (I1, I4 at seed 21: 70000 settled against a budget of 50000, I5 at seed 1: three different receipts for one transaction): [docs/phase14/property-on-73fd95a.txt](docs/phase14/property-on-73fd95a.txt) |
| five clean devnet runs | `demo-runs-1.4/run-1.txt` to `run-5.txt`, each `63/63 checks passed`, exit code 0; 160 signatures, every one checked with `getSignatureStatuses` (160 finalized): [demo-runs-1.4/signatures.md](demo-runs-1.4/signatures.md) |
| fresh clone of the final pushed HEAD | `npm ci && npm test` on a clone of `12668bb` (the pushed HEAD that carries everything else in this report): **348 tests, 348 pass, 0 fail, 0 skipped**; no private file in the tree or in any commit; all 36 commits authored and committed by `seekdaseek <ochinimus@gmail.com>`; no Co-Authored-By or Claude-Session line. The one commit after it only fills in this line; a second clone of that final HEAD was tested the same way (result in the closing message and the local log) |
| sensitive scan over the new commits | the Addendum D patterns plus the device serial, positive controls first, over every commit since `73fd95a`: nothing new; the only hits are the environment-file ignore line in `.gitignore` and the provider name in `vendor/nuntius-mandate` (unchanged). The pattern list is not written into any tracked file |
| relative links in tracked `.md` | all resolve to tracked files |

## Before and after

| # | finding | before (`73fd95a`) | after |
|---|---|---|---|
| T1 | a lagging node makes the agent release a reservation | A's seller is slow, B starts, the RPC answers `isBlockhashValid: false`: both settled, **40000 against a 30000 budget**, the ledger showed 20000 (a success that arrived after the release was never counted) | each payload keeps the context slot `getLatestBlockhash` returned. A reservation is released only when `isBlockhashValid` is false AND `getBlockHeight` is above the payload's own `lastValidBlockHeight`, both asked with `minContextSlot` set to that slot, AND no transaction carrying the agent's signature is on chain; any error leaves it held. A success that arrives for a released reservation is consumed and the ledger dedupes by signature. Same scenario: B is refused, 20000 settled, ledger 20000 |
| R1 | reservations live in memory | a restarted agent forgot a payload a seller kept and landed later | with `cfg.dataDir` the held reservations (amount, time, blockhash, lastValidBlockHeight, context slot, the agent's signature) are written before the signed payload leaves the agent: temp file, fsync, rename. A restarted agent loads them and resolves them by the T1 rule. Test: restart while a seller holds a payload: the new agent counts it as held, refuses the next payment, and the total stays within the budget when the seller lands it; with a proven expiry it releases it and the file forgets it |
| T2 | reading the history back to the grant costs whatever an outsider wants | every dispute and every agent restart read every signature since the grant; past 1000 pages of 100 the resolver said `history_incomplete` and the agent refused to pay; `makeRpc`'s cache grew without limit | a checkpoint per grant (the newest signature read plus the verified debits up to it) in the resolver's SQLite store and in the agent's data directory; it advances only after a page has been read and reconciled completely, so each signature is read once. A read that hits `maxPages` keeps its progress and the next dispute continues. The supersession scan's marker is persisted the same way, and the checkpoint is used for a superseded grant too. The RPC transaction cache is an LRU of 5,000. The README limits state the first-read cost and what happens past `maxPages` |
| S1 | an honest seller framed by a facilitator that reports success twice | a second success for one transaction gave a second receipt with another `settled_at`, which is `receipt_equivocation` | one receipt per tx_sig in the gate: a repeated success returns the stored receipt bytes (LRU of 10,000, in memory). Test and property I5: both responses carry the identical receipt |
| S2 | native-mint grants | for a wSOL grant an ordinary unwrap (close with a balance) or a SyncNative top-up made every later verdict `history_incomplete` | `validateMandate` refuses the native mint; the README says "SPL Token, non-native mints only" |
| P1 | property test gaps | none of the listed cases existed | see the property test below |

On the two `T2` lines of `v3-new4.mjs` (`nativeCloseWithBalance`, `syncNativeTopUp`): they still print `history_incomplete`, because the script builds an ordinary mandate and feeds it native-style transactions. That is the fail-closed outcome the review described; the fix is that such a mandate can no longer be created (S2), not that the transactions become reconcilable.

### The v3 review scripts

Run from `review-20261019c/` (kept out of git). On `73fd95a`:

```
### v3-new.mjs
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
### v3-new2.mjs
N12 control (agent's own blockhash, valid to 5000): 1st 502 [held] -> 2nd period_over_budget [held] -> withheld payload settled later: 200 | settled total 20000 vs budget 30000
N12 seller says lastValidBlockHeight=1: 1st 502 [held] -> 2nd period_over_budget [held] -> withheld payload settled later: 200 | settled total 20000 vs budget 30000
N5 control: P (pay_to not allowed, made before) pay_to_not_allowed/agent_operator 
N5 principal later empties and closes the account: P (pay_to not allowed, made before) pay_to_not_allowed/agent_operator 
### v3-new3.mjs
N1 after a revoke: in_scope/principal
N3 after a revoke: P2 pay_to_not_allowed/agent_operator
N1 honest agent restarted in period 1 after 50 in-scope payments in period 0: 200
N1 honest agent restarted in period 1 after 150 in-scope payments in period 0: 200
### v3-new4.mjs
T1 control: isBlockhashValid=true: A=200 B=period_over_budget | settled 20000 vs budget 30000 | reservations consumed | ledger 20000
T1 isBlockhashValid=false (lagging node): A=200 B=200 | settled 40000 vs budget 30000 | reservations released,consumed | ledger 20000
T2 control: P (pay_to not allowed, earlier) pay_to_not_allowed/agent_operator
T2 nativeCloseWithBalance: P (pay_to not allowed, earlier) history_incomplete/null
T2 syncNativeTopUp: P (pay_to not allowed, earlier) history_incomplete/null
### v3-agent.mjs
(a) 5 concurrent x 10000, budget 30000: 200,200,period_over_budget,period_over_budget,200 | settled=30000
(b) lost response after settle: 1st "fetch failed: socket hang up", 2nd period_over_budget | settled=20000 | reservations=held
(c) injected destination: agent result=destination_mismatch; anything signed and sent: nothing
(d5) staggered A=200 B=200; ledger=10000+10000+10000; then 3 sequential: 200,period_over_budget,period_over_budget | settled=30000
### v3-ports.mjs
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
### v3-new.mjs
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
### v3-new2.mjs
N12 control (agent's own blockhash, valid to 5000): 1st 502 [held] -> 2nd period_over_budget [held] -> withheld payload settled later: 200 | settled total 20000 vs budget 30000
N12 seller says lastValidBlockHeight=1: 1st 502 [held] -> 2nd period_over_budget [held] -> withheld payload settled later: 200 | settled total 20000 vs budget 30000
N5 control: P (pay_to not allowed, made before) pay_to_not_allowed/agent_operator 
N5 principal later empties and closes the account: P (pay_to not allowed, made before) pay_to_not_allowed/agent_operator 
### v3-new3.mjs
N1 after a revoke: in_scope/principal
N3 after a revoke: P2 pay_to_not_allowed/agent_operator
N1 honest agent restarted in period 1 after 50 in-scope payments in period 0: 200
N1 honest agent restarted in period 1 after 150 in-scope payments in period 0: 200
### v3-new4.mjs
T1 control: isBlockhashValid=true: A=200 B=period_over_budget | settled 20000 vs budget 30000 | reservations consumed | ledger 20000
T1 isBlockhashValid=false (lagging node): A=200 B=period_over_budget | settled 20000 vs budget 30000 | reservations consumed | ledger 20000
T2 control: P (pay_to not allowed, earlier) pay_to_not_allowed/agent_operator
T2 nativeCloseWithBalance: P (pay_to not allowed, earlier) history_incomplete/null
T2 syncNativeTopUp: P (pay_to not allowed, earlier) history_incomplete/null
### v3-agent.mjs
(a) 5 concurrent x 10000, budget 30000: 200,200,period_over_budget,period_over_budget,200 | settled=30000
(b) lost response after settle: 1st "fetch failed: socket hang up", 2nd period_over_budget | settled=20000 | reservations=held
(c) injected destination: agent result=destination_mismatch; anything signed and sent: nothing
(d5) staggered A=200 B=200; ledger=10000+10000+10000; then 3 sequential: 200,period_over_budget,period_over_budget | settled=30000
### v3-ports.mjs
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

## Property test (P1)

`test/phase13/property.test.js`, extended. Deterministic, 600 seeded histories, about 22 s in total. The reference model is still written in the test file from the README rules and imports nothing from the resolver.

```
property I1: 600 histories (seeds 1..600), 3059 disputes, 2074 with a decided model verdict, 755 with a 3-signature page and maxPages 2 (the page limit was hit 391 times and the verdict still arrived)
✔ property I1: 600 random histories, every dispute gets the model's verdict on a readable chain (seeds 1..600)
property I2: 2234 disputes with no verdict, 825 with the model's verdict, 0 different (faults: account 616, page 588, unreadable 611, heal 623, block 621)
✔ property I2: RPC faults give the model's verdict or no verdict, never a different decided verdict (600 histories)
property I3: 559 refunds over 200 histories, never two for one payment
✔ property I3: at most one refund per payment, and only on a seller-liable verdict (200 histories)
property I4: 60 seeds, 201 payments settled, 1179 local refusals (all period_over_budget), 62 restarts (7 while a seller held a payload), 27 expiries, 27 lagging-node phases, never above the budget
✔ property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds)
property I5: 39 repeated successes over 20 seeds, always the identical receipt
✔ property I5: a facilitator that reports success twice for one transaction does not make an honest seller sign two receipts (20 seeds)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

What the generators now produce, and where it shows in the numbers:

- **Histories longer than one page:** every fourth seed runs the resolver with a 3-signature page and `maxPages` 2. The limit was hit 391 times; every such dispute answered `history_incomplete` for "more than 2 pages" only, and the model's verdict arrived after a few more disputes (progress carried over).
- **Expired blockhashes, a lagging node, restarts with a kept payload (I4):** the chain has a height and a last valid height per blockhash the agent was handed; `expire` advances the height (kept payloads can then no longer land), `lag` makes the node answer false and report a stale height. 27 expiries, 27 lagging phases, 62 restarts, 7 of them while a seller held a payload (the new agent loaded it from disk). Never above `period_budget`, and every refusal was `period_over_budget`.
- **Two agent debits in one transaction, inner and multisig self-transfers, receipts that bind no mandate, validity-window and network violations:** in the generator and the model (`hidden2`, `selfInner`, `selfMulti`, `unbound` receipts, a window that opens late or closes in the middle of the history, a resolver that watches another network).
- **RPC faults on signature pages and on the account read** join the unreadable transaction, the unreadable block and the heal-after-retry: 825 disputes got the model's verdict, 2234 got no verdict, none a different one.
- **A facilitator that reports success twice (I5):** 39 repeated successes over 20 seeds, always the identical receipt.
- **Not generated:** an asset violation. A token account has one mint, so a payment of another mint out of the granted account cannot exist on a real chain; the scope vectors cover that code path.

**Model/code disagreements.** On the fixed code the model and the code never disagreed. While extending the test the property found two real defects in my own Phase 1.4 work, which I fixed and which are in the table above: (1) a superseded grant was read with a period cut and no checkpoint, so a history longer than `pageSize x maxPages` could never be completed (fixed: the checkpoint is used for a superseded grant too); (2) a restarted agent still re-read every signature for the supersession scan (fixed: its marker is persisted). Three other failures were artifacts of the test, not of the code, and I fixed the test: the fake RPC ignored `until` (so checkpointed reads double-counted), the mirrored chain was not updated before each batch (so a landed payload looked absent), and one existing test used the native mint as its 9-decimal mint.

## Changes to tests that existed before

- `test/harness.mjs`: the fake RPC honours `before`, `until` and `limit` in `getSignaturesForAddress`; `blockhash()` returns a `contextSlot`; the mock facilitator can report one fixed transaction and records the payloads it settled.
- `test/phase12/b5-agent-reserve.test.js` and `test/phase13/n12-seller-blockhash.test.js` stub `getBlockHeight` as well as `isBlockhashValid`, because a release now needs both.
- `test/phase11/fixes.test.js` F11 uses another mint as its 9-decimal mint (the native mint is refused now).
- `scripts/mutation.mjs` runs the property test with 120 histories per mutated run.

## Devnet

- Five clean runs, `demo-runs-1.4/`: 13 scenarios, 63 checks each, 160 signatures (70 grants, 65 payments, 15 refunds, 5 revokes, 5 plain transfers), all finalized.
- Scenario 12 again disputes the three payments that settled: **all `in_scope`, principal, in all five runs**, and again in every run two of the three shared a slot and `getBlock` was read for it (slots 513020776, 513021408, 513022089, 513022720 and 513023356 were the shared ones).
- The runs do not set a data directory, so the persisted reservations and checkpoint files of R1 and T2 are tested on the simulated chain only (see below).

## Still UNTESTED

- `isBlockhashValid` and `getBlockHeight` with `minContextSlot` against a real RPC node: no run reached an expiry. A node that returns an error for a `minContextSlot` it has not reached is treated as "cannot tell" (the reservation stays held); that is reasoned from the code, not observed.
- The agent's data directory on devnet (the demo does not use one), and a crash between the temp file and the rename (the rename is atomic on a local file system; not crash-tested). Two agent processes sharing one data directory are not handled.
- The cost of a first read on a very long account: bounded by `maxPages` and resumable, but not measured at scale on a public RPC, which rate-limits.
- The gate's one-receipt-per-tx memory is in memory: a facilitator that repeats a success after a gate restart can still get a second receipt signed. Only a mock facilitator was used for S1.
- A wSOL account on chain: refused by `validateMandate`, so there is nothing to run.
- The Seeker-signed grant through the iussum app (Phase 2), third-party sellers that adopt the middleware, anything on mainnet; a Token-2022 grant on chain (vector only); the period budget is still not enforced on chain.
- Two leftovers disclosed earlier stay in the public history by decision (removing them would change every hash, including the baseline commits the reports cite): the treasury-address prefix in two commits of `REPORT-phase1.2.md`, and one line about a payout-documentation check in older versions of the Phase 0 and 1 reports.

# REPORT: iussum Phase 1.5 (2026-10-20)

Baseline for the new regression tests: **`b5dfa77`**, the public HEAD at the end of Phase 1.4. The tests were committed first (`bac6f79`, all 8 failing on `b5dfa77`), then the fixes (`dd57da4`), the devnet scenarios and the H5 run. Normal pushes only; devnet and localnet only; nothing was posted anywhere.

## Gate

| gate | result |
|---|---|
| `npm test` | **356 tests, 356 pass, 0 fail, 0 skipped** (was 348), about 25 s, the property test included |
| `npm run mutation` | baseline 356 / 356; **121 checks mutated, survived 0** (was 115) |
| property test | green: 600 histories, same numbers as before the change (`docs/phase14/property-run.txt`); its restarts now close the old agent first, because of the new lock |
| the new regression tests | `test/phase15`: 8 tests, **all 8 fail on `b5dfa77`**: [docs/phase15/regression-on-b5dfa77.txt](docs/phase15/regression-on-b5dfa77.txt) |
| five clean devnet runs of scenarios 1 to 15 | `demo-runs-1.5/run-1.txt` to `run-5.txt`, each ends `exit code 0` (79, 79, 78, 79, 79 checks passed; run 3 has one check fewer because no two of its scenario 12 payments shared a slot); 180 signatures, every one checked with `getSignatureStatuses` (180 finalized): [demo-runs-1.5/signatures.md](demo-runs-1.5/signatures.md). An earlier set of five clean runs (78 checks each) is kept in `demo-runs-1.5-first/`; I reran because its scenario 14 diagnostic printed a poll that lagged the agent's own check, which looked inconsistent |
| H5 | run once: [demo-runs-1.5/h5-scale.txt](demo-runs-1.5/h5-scale.txt); the 250 credit signatures: [demo-runs-1.5/h5-dust-signatures.txt](demo-runs-1.5/h5-dust-signatures.txt) |
| fresh clone of the final pushed HEAD | see the last section |
| sensitive scan over the new commits | the Addendum D patterns plus the device serial, positive controls first: nothing new; the only hits are the environment-file ignore line in `.gitignore` and the provider name in `vendor/nuntius-mandate`. The pattern list is not written into any tracked file |
| relative links in tracked `.md` | all resolve to tracked files |

## Before and after

| # | item | before (`b5dfa77`) | after |
|---|---|---|---|
| H1 | the gate's one-receipt memory does not survive a restart | a `Map` in the gate process: a facilitator repeating a success after a restart got a second receipt with a new `settled_at` (`receipt_equivocation` against an honest seller) | with `cfg.dataDir` the gate keeps issued receipts by tx_sig in its own SQLite file (`receipts.sqlite`), written **before** the response that carries the receipt; a repeated success returns the stored bytes. A failed write sends the response without a receipt header and logs it (the payment still settled). A store that is unreadable, not a database, or fails its integrity check stops the gate from starting. Test: restart the gate between two successes for the same tx_sig: byte-identical receipts. The devnet demo's sellers now run with a `dataDir` |
| H2 | two agents on one data directory | nothing stopped it; a corrupt reservations file was read as empty | an exclusive lock file with the PID, created with `O_EXCL`; a stale lock is cleared only when the PID is not running (tested with a dead PID and a live one); a second agent refuses to start; `agent.close()` releases it. A truncated or malformed reservations file makes the agent refuse to pay (`history_incomplete`), it is never read as empty. A temp file left by a crash between write and rename is ignored and removed once the lock is held; the last complete file is loaded. A failed reservations write now releases the reservation instead of leaving it held |
| H3 | the expiry path never ran on a real node | tested with a stubbed RPC only | scenario 14, five runs: see below |
| H4 | a restart with a data directory on devnet | tested on the simulated chain only | scenario 15, five runs: see below |
| H5 | first read at scale | not measured | measured once: see below |

### H3, scenario 14: expiry on the public devnet node

The seller keeps the agent's signed payload and answers 502. Every run: (1) the next payment, which would cross the 0.03 budget, is refused (`period_over_budget`) while the blockhash is valid; (2) the agent's own release rule fires (`isBlockhashValid` false and `getBlockHeight` above the payload's `lastValidBlockHeight`, both asked at the payload's context slot); (3) the next payment then settles; (4) the kept payload no longer lands: the facilitator answers HTTP 402 `invalid_exact_svm_transaction_simulation_failed`, and the node itself, asked to simulate the kept transaction, says `BlockhashNotFound`; no money moved.

| run | context slot of the payload | lastValidBlockHeight | block height when the payload was created | wall time to the release | polls | right after the release |
|---|---|---|---|---|---|---|
| 1 | 513054101 | 500264749 | 500264599 | 44.5 s | 7 | invalid, node slot 513054289, height 500264787 |
| 2 | 513055020 | 500265660 | 500265511 | 38.4 s | 6 | invalid, node slot 513055186, height 500265676 |
| 3 | 513055927 | 500266563 | 500266414 | 38.7 s | 6 | invalid, node slot 513056095, height 500266581 |
| 4 | 513056805 | 500267441 | 500267291 | 44.2 s | 7 | invalid, node slot 513056993, height 500267479 |
| 5 | 513057703 | 500268336 | 500268186 | 44.1 s | 7 | invalid, node slot 513057891, height 500268370 |

The lifetime is 150 blocks, and the release fired 38 to 45 s after the payload was created (the wall time is measured from the first poll after the refusal, polling every 5 s). The poll before the release is logged in each run output; in runs 2 and 3 it still showed "valid" at the very last block (height 500265661 and 500266563 against the last valid heights 500265660 and 500266563), which is the point of the rule: the agent releases only when the node says the blockhash is invalid AND the height is past the last valid one.

### H4, scenario 15: restart with a data directory

Five runs, 8 checks each, all pass: the agent signs a payload, the seller keeps it, the process "restarts" (`close()`, then a new `createAgent` on the same `dataDir`); the restarted agent loads the held reservation (same agent signature) and refuses a payment that would cross the budget; the seller then lands the kept payload (HTTP 200, a settlement signature); after another restart the rebuilt ledger holds that payment exactly once, the restored reservation is `consumed` (not held a second time), 0.01 more fits the 0.03 budget and a further 0.01 does not.

### H5, the first read at scale (once)

```
H5 on devnet, rpc https://api.devnet.solana.com
throw-away principal Hz5hz3LBiKDu9dXu8fcG7yLXuGucmH6tfb7FxUYNNLGC
grant (dedicated principal): 358HUopkMtgMRWZyNX5EGASApqBM34vADuGSeRRTqPJfqfCgdZR2aDTDereY5MLVZCsMASiCm3PD2oGXysBqrGsx
mandate id f1464e9dc3b3690d9ede85bc344550d4520e2b96d50066c1fb3444569923927d
  50 dust credits sent (143 s)
  100 dust credits sent (294 s)
  150 dust credits sent (453 s)
  200 dust credits sent (604 s)
  250 dust credits sent (752 s)
250 dust credits of 1 base unit into HUKEm4vtpMKZtZWZtn6TtqSsuo5UkVZtPDMk9zGjLaxg; signatures in demo-runs-1.5/h5-dust-signatures.txt (250 distinct)
the seller gate's first grant check (reads the history since the grant): ok true, 3 signature pages, 674 getTransaction calls, 678 RPC calls, 626.3 s
the agent's first read at start (250 dust credits in the account): 6 signature pages, 673 transactions fetched, 680 RPC calls, 637.4 s
agent payment 1: 3s2Nv2Ez72sEnQrBrCtQJuujFL4vdKC3qga34SGNf2FeyN9uv4oTyY5gi7EzhXpTAbvcLCL7wqgc1mveC3YAmaM6
agent payment 2: LtkpkGveWg5FdQHecVG7tVqQwGR6Zs74oww5sbUo1MdkNFvR8TWZq45vFZZ3cpFuAEkHfY9MZejM3MzJVciD4N6
agent payment 3: k64YyT449AAerwbeZx6uFzHvUkA2k8gTZx1FrSWzZSPKD3Moy2bnxKqT5wixYTq8esY16BuNKNf1pYeQVWdYFwU
dispute 1 (first read of the whole history since the grant): verdict invalid/in_scope/principal | pages (getSignaturesForAddress) 6 | transactions fetched (getTransaction) 695 | RPC calls 702 | wall time 630.1 s
dispute 2 (a different payment, the checkpoint is used): verdict invalid/in_scope/principal | pages (getSignaturesForAddress) 2 | transactions fetched (getTransaction) 0 | RPC calls 3 | wall time 1.3 s
both disputes decided (not history_incomplete): YES
```

- **What it shows.** The verdicts were decided (`in_scope`, principal), not `history_incomplete`. The first dispute read the whole history: 6 signature pages and 695 `getTransaction` HTTP calls for about 253 signatures in 630 s. The count is above the number of signatures because the counter sees every HTTP attempt and `makeRpc` retries a rate-limited (HTTP 429) call; I did not count the 429s separately. The second dispute, on a different payment, used the checkpoint: 2 signature pages, 0 transactions fetched, 3 RPC calls, 1.3 s.
- **What it costs.** The first read of 250 dust credits took about 10 minutes on the public devnet RPC, for the resolver (630 s), the agent (637 s) and the seller gate (626 s) alike. Each pays it once per grant (the agent and the resolver keep a checkpoint; the gate keeps its supersession marker only in memory).
- **A finding the first attempt made** (`demo-runs-1.5/h5-attempt1.txt`): without the pre-warm, the seller gate's first grant check ran inside the agent's first payment request and exceeded the HTTP client's 300 s wait for response headers (`UND_ERR_HEADERS_TIMEOUT`), so the first payment failed. The second attempt pre-warmed that check with the gate's own client. This is the same first-read cost, now on the request path of a seller: a seller facing a grant with a long history needs a keyed RPC or a pre-warm. The README limits say so. I did not change the code for it.

First attempt, for the record:

```
H5 on devnet, rpc https://api.devnet.solana.com
throw-away principal Hz5hz3LBiKDu9dXu8fcG7yLXuGucmH6tfb7FxUYNNLGC
funded the throw-away principal (0.03 SOL, 0.2 USDC): 2eWynztbi4xqM1jsJDeWC8KcWovGAub4NhDFQG1qzqBDADRtpi5Lg2aWywKg55cvmXnAYFZTdtWv1gH2cfFftz54
grant (dedicated principal): 5DK8ej2TxXRN614WfuobJ5dNRfdVVUPnXhQZKquMcuQWmtnZWQkGD7m7Phs9ijTFZJnqehji5ECYWsYUZRMdqUP4
mandate id 43e7eeacebc51cafd381f22d24fb7ae6bff3dee422b361474ea60c8ce84bb0ed
  50 dust credits sent (149 s)
  100 dust credits sent (311 s)
  150 dust credits sent (445 s)
  200 dust credits sent (585 s)
  250 dust credits sent (722 s)
250 dust credits of 1 base unit into HUKEm4vtpMKZtZWZtn6TtqSsuo5UkVZtPDMk9zGjLaxg; signatures in demo-runs-1.5/h5-dust-signatures.txt (250 distinct)
the agent's first read at start (250 dust credits in the account): 6 signature pages, 689 transactions fetched, 696 RPC calls, 649.5 s
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

[TypeError: fetch failed] {
  [cause]: HeadersTimeoutError: Headers Timeout Error
      at FastTimer.onParserTimeout [as _onTimeout] (node:internal/deps/undici/undici:7612:32)
      at Timeout.onTick [as _onTimeout] (node:internal/deps/undici/undici:731:17)
      at listOnTimeout (node:internal/timers:605:17)
      at process.processTimers (node:internal/timers:541:7) {
    code: 'UND_ERR_HEADERS_TIMEOUT'
  }
}

Node.js v24.16.0
```

## Changes to tests that existed before

- `test/phase14/r1-persistence.test.js`, `t2-checkpoint.test.js` and `test/phase13/property.test.js` close the old agent before the "restart" (the lock requires it).
- `test/harness.mjs`: `startSeller` takes `gateOpts` and returns `restartGate()`.

## Still UNTESTED

Moved out by H1 to H5: the gate's receipt memory across a restart, the agent's data directory on devnet, the `minContextSlot` expiry path on a real node, the persisted-reservation restart on devnet, and the first read at scale.

- A real second agent PROCESS on one data directory: the lock is tested with the same process (its PID is alive), a dead PID and a live parent PID; no second OS process was started. A crash between the temp file and the rename: the state a crash leaves (a stray temp file) is tested, the crash itself is not.
- A facilitator that really repeats a success: H1 is tested with a mock facilitator that reports one transaction twice.
- The gate's supersession marker is in memory only (a restarted gate rescans the history on its first request); a seller facing a long history needs a keyed RPC or a pre-warm. A first read on a keyed RPC was not measured.
- A wSOL account on chain (refused by `validateMandate`, nothing to run); a Token-2022 grant on chain (vector only).
- The Seeker-signed grant through the iussum app (Phase 2), third-party sellers that adopt the middleware, anything on mainnet. The period budget is still not enforced on chain; only `total_cap` is.
- Two leftovers disclosed earlier stay in the public history by decision: the treasury-address prefix in two commits of `REPORT-phase1.2.md`, and one line about a payout-documentation check in older versions of the Phase 0 and 1 reports.

## Fresh clone

(Filled in by the closing commit.)

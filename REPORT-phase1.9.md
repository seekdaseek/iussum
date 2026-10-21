# REPORT: iussum Phase 1.9 (2026-10-21)

Baseline for the new regression tests: **`ade248e`**, the public HEAD at the end of Phase 1.8. This pass answers Addendum O, the eighth review of `f62ae84..ade248e`. Every repro script of the review (`review-20261021h/`, gitignored) was run against `ade248e` first and again after the fixes: [docs/phase19/repro-before-ade248e.txt](docs/phase19/repro-before-ade248e.txt) and [docs/phase19/repro-after-fix.txt](docs/phase19/repro-after-fix.txt). The two earlier review folders (`review-20261020f`, `review-20261021g`) were run again on the final tree: [docs/phase19/earlier-repros-after-fix.txt](docs/phase19/earlier-repros-after-fix.txt). Normal pushes only; devnet and localnet only; nothing on the VPS; nothing was posted anywhere.

Of the review's items, O1 (a restart forgets a superseder) is the one that mattered most: it failed open on a lagging node, the class that N2 had closed. O3 and O4 were liveness: an abort signal that killed a running agent, and a way for an attacker to make a legitimate seller answer 503. All four O7 items that the review could not verify turned out to be real.

## Gate

| gate | result |
|---|---|
| `npm test` as an ordinary user (uid 501) | **490 tests, 490 pass, 0 fail, 0 cancelled, 0 skipped**, 38 s (a fresh clone of the pushed HEAD, `npm ci && npm test`) |
| `npm test` as root (uid 0, a fresh clone of the final pushed HEAD in a `node:24-bookworm` container, `npm ci` there) | **490 / 490**, 40 s (uid 0, Linux aarch64, Node 24.22) |
| `npm run mutation` | baseline 490 / 490; **190 checks mutated, survived 0** (was 174; 16 new rows); 103 minutes. A first run was stopped and restarted when `r4b` of the earlier review folder showed that the first version of the re-org eviction doubled the reads of a node whose answers disagree with its own listing (40001 getTransaction elements instead of 2020); the fix and a test (`history.reorg_known`) went in before the run that counts |
| the new regression tests | `test/phase19`: 19 tests; **17 fail on `ade248e`** (one of them a hang that the test timeout turns into a failure), the other 2 are a control and a guard ([docs/phase19/phase19-all-on-ade248e.txt](docs/phase19/phase19-all-on-ade248e.txt)) |
| property test | green: [docs/phase19/property-run.txt](docs/phase19/property-run.txt) |
| every repro script of the review | wrong at `ade248e`, right after; see the table |
| earlier repro folders | `review-20261020f` and `review-20261021g` still right (the differences from the earlier after-fix files are listed below) |
| `g6-fuzz-resume.mjs` seeds 1 and 2 | still `wrong 0` (answers 1568 and 1579) |
| `g4-recompute.py` | still `mismatches: 0` |
| `a2-reverse-lock.mjs` with the real `142276f` worktree | both directions REFUSED |
| five clean devnet runs of scenarios 1 to 16 plus 16b | **98, 97, 98, 97 and 97 checks, 205 signatures, all `finalized` or the expected failed-on-chain 16b ones, checked with `getSignatureStatuses`** ([demo-runs-1.9/](demo-runs-1.9/), [signatures.md](demo-runs-1.9/signatures.md)). The first start found the principal at 0 USDC (the five Phase 1.8 runs and the review passes had paid it out to the demo sellers); with the owner's yes one devnet `transferChecked` of 3 USDC from seller A back to the principal funded the runs. Run 1 of that first start failed scenario 16b on the balance check only and was discarded |
| fresh clone of the final pushed HEAD | **490 / 490** as uid 501 and as uid 0 in a fresh clone of the pushed HEAD `ac94995` (details below); the closing commit changes only this report and TESTS.md's run line, and a fresh clone of it was run again the same way |
| sensitive scan over the new commits | clean: 13 patterns, a positive control per pattern first, 2714 added lines and 15 added paths in `ade248e..ac94995`, zero hits |
| relative links in tracked `.md` | 88 relative links in tracked `.md`, all resolve (the checker was shown to report a missing target first) |

## Before and after

| # | item | before (`ade248e`) | after |
|---|---|---|---|
| O1 | the -32020 restart throws away the superseders already read (`r5-reset-drops-found`) | call 1 reads a Revoke on page 1 and stores `partial.found [{REVOKE, 1300}]`; call 2 on a lagging node: **`NOT superseded (null)`**, stored as completed | the restart carries `partial.found` (and an older `carry`) into the new scan and merges it into `found`; a state whose restart is cut short again keeps the carry. Call 2: `superseded by REVOKE at slot 1300`, stored. Two tests (the lagging node; a restart that is itself cut short, then a lagging node) |
| O2 | a stored `found` entry without a slot blocks that grant's scan for good (`r4-stored-found-slotless`) | calls 1, 2 and 3 each `THREW ... no usable slot`, stored `partial.found = [null]` never changes | every `found` entry needs a string `sig` and a safe-integer `slot`, else the state restarts from the grant; the well-formed entries it carried are kept. Calls 1 to 3: `superseded = REVOKE slot 1200` |
| O3 | aborting `cfg.signal` after the start kills the agent (`r1`, `r1b`) | `200`, then `THREW ... closed or abandoned` twice, settled 1; with `AbortSignal.timeout(1500)` the same | a `started` flag set at the end of the build; the guard is `closed \|\| (!started && cfg.signal?.aborted)`. `200, 200, 200`, settled 3; the timeout signal: `200` at 0 s and at 2 s |
| O4 a | cold-scan reads starve a warm check through the shared bucket (`r2`, rate 5, burst 2, budget 2000 ms) | legit payments 3, 4, 5 during the attack: `200, 503, 503`, **settled 3**; with rate 200 the same three took 809, 1511 and 1532 ms | the bucket has two classes. A scan's reads (transaction pages, a cold scan's listing pages) are `bulk`; a check's own reads are served first, and a bulk waiter still gets one grant in four. `200, 200, 200`, **settled 5**; rate 200: 206, 271 and 264 ms. The unit test with a fake clock shows both halves (a normal waiter is served second, a bulk waiter is never starved) |
| O4 b | the warm lane is taken by an attacker's own warm grants (`r3`) | the two attacker grants hold both warm slots: legit `503 x3`, **settled 3** | (1) a warm check asks for one newer signature outside every lane and takes no slot when there is none; (2) one warm scan per source account; (3) a warm scan reads one page and a full page gives the slot back and continues in the cold lane, serialised per account. `200, 200, 200` in 8, 10, 8 ms, **settled 6**. Five tests (the lane statistics show `warmRunning 0` while the continuation runs in the cold lane) |
| O5 | the pending memo outlasts the agent's retries (`r6`, Retry-After 1, 2, 5) | `503` after 3059 ms, settled 0 (1 s); 6136 ms (2 s); 5081 ms (5 s) | the memo is at most `retryAfterSeconds * 1000`. `200` after 1076, 2072 and 5071 ms; the gate reads the grant twice, settled 1 each time |
| O6 | `close({ timeoutMs })` is not validated (`r7`) | `Infinity`, `2147483648`, `2592000000` and `NaN` all become a 1 ms timer: close rejects after 1 ms | an integer from 0 to 2147483647, or `Infinity` (no timer); anything else is rejected at the call with a `TypeError` and the agent is not closed. `Infinity` resolved after 1024 ms once the payment returned |
| O7 | a re-orged transaction stays in the `makeRpc` cache with its old slot | every later scan throws `has no usable slot (transaction 1300, listing 1350)` until restart | a cache copy whose slot disagrees with the listing is evicted and read again, once (`rpc.forget`, `rpc.cached`, `readListed`); a node that disagrees with its own listing (the stub of `r4b`) is read again once and then left alone, so that `r4b` is back to 2020 getTransaction elements, not 40001 (the first version of this fix did that and the review folder showed it) |
| O7 | a node that answers without `transaction.signatures` | a restart counts each of two settled payments twice (`ledger.length` 4, the third payment refused) | an unsigned history entry carries its signers and recent blockhash; it matches a payment the agent made when the agent is a signer, the blockhash and the amount are the payload's (or the transaction id is the agent's signature); one entry matches one payment. `ledger.length` 2, the third payment goes through, the fourth is `period_over_budget`. The control with signatures is unchanged |
| O7 | two spellings of one data directory | `d` and `d/../d`: closing one agent removes the `agent.lock` of the other, which still runs | the map is keyed by `fs.realpathSync` |
| O7 | read amplification of repeated -32020 restarts | measured with a stub whose node forgets a deep cursor: 10, then **19 listing requests per call, for ever** (5 pages of history; it scales with the history) | `maxScanRestartsPerHour` (6): beyond it the scan fails closed as `busy` (the gate answers 503) and a call reads at most the one failing page (9 requests: the client asks a cursor the node does not know 9 times) |
| O7 | close during the grant check | `Failed to create payment payload: closed or abandoned` | the `agent_closed` refusal (done with O3, test in `o3-o7-agent-gate`) |

## Changes to tests and scripts that existed before

- `test/phase11/fixes.test.js` (F1) and `test/phase12/b2-supersede-unreadable.test.js` (B2): a warm second check now makes one more listing call, the probe (`limit: 1`, `until` the newest signature), before it reads the page. The expectation lists the probe.
- `packages/core/src/chain.js`: the "Transaction not found" retry of `getSignaturesForAddress` waits with the client's `sleep` instead of a raw timer, so a test can pass a fake one.
- `scripts/mutation.mjs` and `package.json`: the globs include `test/phase19`.
- The r2 test uses a 3000 ms budget (the review script uses 2000): at rate 5 the third legitimate payment took 1.8 s of the 2 s because the attackers' own first reads (grant and account, normal class) queue in front of it too; the test still fails on `ade248e` (`200,503,503`).

## Still UNTESTED

Moved out by this pass: the -32020 restart with a lagging node, a stored `found` entry without a slot, an abort after the start, the shared bucket and the warm lane under a cold-scan attack, the pending memo against 1, 2 and 5 s of Retry-After, `close({ timeoutMs })` bounds, a re-orged transaction, a node without `transaction.signatures`, two spellings of one directory, the amplification of restarts.

- **The priority bucket is tested against a local node and a fake clock, not against a public node.** The one-in-four share for bulk reads and the 8-token cost of an attacker's own first reads are constants, not measurements.
- **An attacker with several accounts can still fill the warm lane.** A warm scan that finds new history on two different accounts, with a node that answers slowly, holds both warm slots for as long as the node takes for one page. The probe makes a check with nothing new immune; a check with something new waits for a slot up to its budget. Said as a residual risk, not closed.
- **Every warm check costs one more listing request** (the probe). On the public node that is one token of the paced bucket, at normal priority.
- **The unsigned-entry matching is a heuristic** (agent signer, recent blockhash and amount), tested against a stub. A real node always sends `transaction.signatures`; no node in this repo's history has omitted them. Two payments with the same blockhash and amount are told apart only by the one-entry-one-payment rule.
- **A real re-org was not produced.** The re-org test changes a transaction's slot in a stub; devnet re-orgs are rare enough that none was seen.
- **`maxScanRestartsPerHour` (6) is a default, not a measurement.** Behind a load balancer that really switches nodes, six restarts an hour per grant may be too few or too many.
- **The `realpath` key does not see through a bind mount** or two mounts of one file system under different paths.
- **Root was tested in a Linux arm64 container** (`node:24-bookworm` on Docker Desktop), not on native root on macOS and not on x86 CI.
- **The rollback guard is per directory, not per grant.** Two new agents of different grants in one directory but different processes share `agent.lock`; the first creator's exit removes it, which ends the rollback guard for the other.
- **An unknown grant is 503, never 403**, and the pending memo is now shorter (the Retry-After). A request with a made-up `grant_tx` therefore costs the gate one read per Retry-After, where it cost one per 5 s.
- **`close({ timeoutMs })` keeps the lock on timeout** and does not release it when the payment returns later.
- **Carried over, unchanged:** one keyed provider, one afternoon (Phase 1.7); the mainnet public default is the devnet node's measured one by host name; the empty-page `before` case behind a load balancer; a real lagging history node on devnet; power loss for the directory fsync; held reservations count against the current period whatever period they were reserved in; `verdict_id` is a reference, not a signature; a wSOL account and a Token-2022 grant on chain; the Seeker-signed grant (Phase 2); third-party sellers; anything on mainnet; the period budget is not enforced on chain, only `total_cap` is (scenarios 16 and 16b).

## Differences from the earlier after-fix files

Only the following changed in `review-20261020f` and `review-20261021g` against the Phase 1.8 tree, all by design: the resume repro lists one more `top` page read (the warm probe), the data directory listing shows `lock` among the files (Phase 1.8), and the random mandate ids differ. `r4b` is the same as before (2020 getTransaction elements for 20 grants).

## Commits of this pass

- `30a5130` O1, O2: a restart keeps the superseders a scan had read; a stored found entry without a usable slot restarts the scan from the grant and keeps the well-formed ones
- `75f5d05` O3, O5, O6, O7: cfg.signal covers the start only; the pending memo never outlasts Retry-After; close({ timeoutMs }) is validated; a close during the grant check is agent_closed
- `824347f` O4: priority classes in the RPC token bucket; warm checks with nothing new take no lane slot, warm scans read one page and run one per account
- `75099f9` O7: re-orged transactions are evicted from the rpc cache, payments are matched when a node omits transaction.signatures, data directories are keyed by realpath, scan restarts are capped per grant per hour
- `fa6d13a` O7: evict only cache-served copies whose slot disagrees with the listing, and leave a node that disagrees with itself alone after one re-read; the r2 test budget is 3 s
- `ac94995` Phase 1.9: evidence (repros before and after, earlier review folders, property run), five devnet runs (205 signatures checked), mutation table 190/0, README and TESTS.md

## Final HEAD, fresh clone, scan, links

- **Pushed HEAD that carries everything else in this report: `ac94995`.** A fresh clone of it, `npm ci && npm test`, as uid 501 (38 s) and as uid 0 (40 s, `node:24-bookworm`, Linux aarch64): **490 / 490** both ways; no BRIEF, review or secret file in its tree. All commits since `ade248e` (7 with the closing one, which changes only this report and one line of `TESTS.md`) are authored and committed by `seekdaseek <ochinimus@gmail.com>`, with no trailer and no AI attribution line.
- **Sensitive scan over the new commits** (`ade248e..ac94995`): the Addendum D patterns (the VPS address, server paths, the treasury and studio markers, PEM headers, key field names, environment files, a JSON array of 64 numbers) and two patterns for a keyed RPC URL, a positive control per pattern first (each matched its own known positive). Zero hits; no environment-file, secrets-folder, PEM, BRIEF or review-folder path was added. The devnet runs used the throw-away demo keys in `.secrets/` through the existing scripts; no key was read into a message or a tracked file, and the one extra devnet transfer (3 USDC, seller A to the principal) used the repo's own `demo-lib` helpers. The pattern list is not in any tracked file.
- **Relative links in tracked `.md`:** 88 links, all the relative ones resolve to tracked files.

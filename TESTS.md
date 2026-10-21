# TESTS

`npm test` runs **471 tests, 471 pass, 0 fail, 0 cancelled, 0 skipped** (node:test, no network; measured 70 s on the Mac that produced this table, 161 s on a 2-CPU Linux box). It was run both ways for Phase 1.8: as an ordinary user and as root (uid 0, in a fresh clone of the final pushed HEAD inside a `node:24-bookworm` container, `npm ci` there): @@ROOTSTAT@@. `npm run mutation` runs the suite once as a baseline and then once per check with that single check skipped (175 runs), so it takes about 2 hours (measured: 123 minutes); a test that hangs until its timeout counts as a kill; it exits non-zero if any run stays green: **174 checks, none survived**.

| suite | tests | what |
|---|---|---|
| `packages/core/test` | 169 | the golden vectors below, plus unit tests (JCS refusals, recorded real devnet transactions, receipt keys, grant-checker caching, period indexing, the RPC index-lag retry) |
| `packages/seller/test` | 19 | the gate on the REAL `@x402/express` middleware with a mock facilitator: enforce, observe, off, 403 reasons, receipts, caching |
| `packages/agent/test` | 13 | local refusals before signing, ledger, extension carriage, payer-side-caps control, the copied `verify.js` guard |
| `apps/resolver/test` | 11 | R1 to R4, refund once, duplicate dispute, concurrent disputes, HTTP, what is stored |
| `test/regression` | 21 | Phase 1.1 findings 1 to 5 (written first; 18 of the 21 fail on commit 222697b, `docs/phase11/regression-on-222697b.txt`, all pass after the fix, `docs/phase11/regression-on-fixed.txt`) |
| `test/phase11` | 28 | Phase 1.1 fixes 6 to 12 and the supporting behaviour of 1 and 2 (restarted agent ledger, lying resource.url, refund retry and pending guard, decimals, scan failure, incremental scan, pagination) |
| `test/phase12` | 46 | Phase 1.2 (Addendum E), written first (44 at the time; 32 of those fail on 057ff14, the other 12 are controls and guards that pass on both) (`docs/phase12/regression-on-057ff14.txt`): B1 hidden debits (Transfer, Burn, BurnChecked, CPI, two debits, unreadable, same slot as the grant, balance mismatch), B2 unreadable superseding transaction, B3 payments the agent did not sign or made before the grant, B4 provisional verdicts, B5 reservations (concurrency, lost response, release and consume), S6 destination, S7 block order, S8 http prefixes, C1 allowance cross-check |
| `test/phase13` | 26 | Phase 1.3 (Addendum F), written first, 15 of the 20 then failing on e065db0 (`docs/phase13/regression-on-e065db0.txt`): N1 history reaches the grant (150 payments, dust credits, restarted agent), N2 whole-transaction x402 shape, N3 self-transfers, N4 receipt equivocation, N5 closed source account, N12 seller-named blockhash; plus the **seeded property test** (`property.test.js`, extended in Phase 1.4: 600 random histories against a reference model written from the README rules, invariants I1 to I5; run: `docs/phase14/property-run.txt`) |
| `test/phase14` | 16 | Phase 1.4 (Addendum G), written first, 12 of the 15 then failing on 73fd95a (`docs/phase14/regression-on-73fd95a.txt`): T1 a lagging node cannot make the agent release a reservation (proven expiry at `minContextSlot`, a late success is still counted), R1 persisted reservations and a restart while a seller holds a payload, T2 checkpoints (each signature read once, progress kept at maxPages, a restarted agent, the bounded RPC cache), S1 one receipt per transaction, S2 the native mint is refused |
| `test/phase15` | 8 | Phase 1.5 (Addendum H), written first, all 8 failing on b5dfa77 (`docs/phase15/regression-on-b5dfa77.txt`): H1 the gate keeps its receipts in SQLite (a restarted gate returns byte-identical receipts, written before the response, a failed write sends no receipt header, a corrupt store stops the start), H2 one agent per data directory (a second agent refuses, a stale lock of a dead PID is cleared, a truncated reservations file makes the agent refuse to pay, a temp file left by a crash is ignored) |
| `test/phase16` | 36 | Phase 1.6 (Addendums I, K, L), 28 of the 36 failing on 142276f. Written first and committed first: the I3, I4, J1 and first J2 tests (`1af5464`) and the K tests (`18c6138`). Written before their fix and shown failing, but committed together with it: the L2 test (`6ff06f5`), the J2 element-retry test (`c6a9fdc`) and the three J2 rate-limit tests (`a9cda52`) ([docs/phase16/phase16-all-on-142276f.txt](docs/phase16/phase16-all-on-142276f.txt)) ([docs/phase16/regression-on-142276f.txt](docs/phase16/regression-on-142276f.txt), [k-regression-on-142276f.txt](docs/phase16/k-regression-on-142276f.txt), [l2-regression-on-142276f.txt](docs/phase16/l2-regression-on-142276f.txt); the other 8 are controls and guards; the three J2 rate-limit tests were also run on the commit before their fix, [j2-ratelimit-on-c6a9fdc.txt](docs/phase16/j2-ratelimit-on-c6a9fdc.txt)): I3 the landed read after a proven expiry carries `minContextSlot` and any error leaves the reservation held, I4 the agent files are keyed by grant, J1 a cold gate answers 503 with Retry-After and the agent retries, J2 JSON-RPC batches with fail-closed elements, K the data-directory lock is an OS lock (two real processes, SIGTERM and SIGKILL of the holder, `close()` refuses), L2 `verdict_id` (golden vectors, duplicates, replaced verdicts) |
| `test/phase17` | 47 | Phase 1.7 (Addendum M), each written before its fix and shown failing on `c521b31` ([docs/phase17/phase17-all-on-c521b31.txt](docs/phase17/phase17-all-on-c521b31.txt)); the Retry-After and directory-fsync tests (M8) and the pacing tests (M6) were written after the first version of their code and before the final one: M1 a resumed supersession scan (core, real gate with and without a restart, resolver), non-jsonParsed elements, an unparseable scan state; M2 `close()` (in flight, `agent.client`, the naive agent, no request at all), a failed or abandoned start; M3 period boundary, restart against a lagging node, upgrade from a 142276f directory, expiry answers without a context slot; M4 the verdict record (verified grant, legacy rows, recomputable from a response, compare-and-swap); M5 gate limits; M6 the token bucket against a model of the measured limiter; M7 `usdc()`; M8 Retry-After and the directory fsync |
| `test/phase18` | 31 | Phase 1.8 (Addendum N), each written before its fix and shown failing on `f62ae84` ([docs/phase18/phase18-all-on-f62ae84.txt](docs/phase18/phase18-all-on-f62ae84.txt): 25 of the 31 fail; the 6 that pass are controls and guards: three controls, the independent verdict_id recomputation (n9: a regression for something that was already right) and the fairness test of the token bucket (p2), which on the old code passes by timing luck in the unit test although `p2-starve.mjs` shows the starvation every time, 5044 ms against 23 ms; the mutation of `rpc.pace_fifo` kills it): N1 the ledger dedupes on the agent's own signature (live path, restart, kept payload that lands), N2 a superseder without a usable slot, N3 warm lane and one cold scan per source account, N4 and N6 close during a paid request, abort before the lock, an abandoned start's reads, the rollback lock, `close({ timeoutMs })`, N5 pending grant, scan caps, a stored cursor the node no longer knows, N7 pacing edges and fairness, N9 the independent verdict_id check |

## Golden vectors (`test/vectors/*.json`, generated by `test/make-vectors.mjs` from `test/fixtures.mjs`): 153

The inputs are deterministic (fixed addresses, fixed Ed25519 seeds, fixed times). **The expected values are written by hand in the generator, never computed by the code under test.**

| file | count | covers |
|---|---|---|
| `jcs.json` | 4 | RFC 8785 key ordering with the 3.2.3 unicode example, nesting, integers, amounts above 2^53 as strings |
| `mandate.json` | 12 | pinned id (sha256 of the JCS bytes), key-order independence, summary line ending in the 64-hex id, schema refusals (number instead of string, unknown keys, old `principal_sig`, resource prefixes with a query, credentials or no scheme) |
| `scope.json` | 21 | every tier-1 reason code, boundary values, BigInt comparison above 2^53, several violations in fixed order, resource boundary cases |
| `resource.json` | 18 | URL matching: host suffix attack, `/v1` vs `/v10`, userinfo, dot segments (plain and percent-encoded), port, scheme, host case, default port, query ignored |
| `grant.json` | 23 | the grant check: minimal grant; Seed Vault's two extra ComputeBudget instructions (allowed); extra non-ComputeBudget instruction; extra token transfer; memo one byte off; memo with another mandate id; v0.1-style memo; ApproveChecked amount, delegate, owner, mint, source each wrong; no/two ApproveChecked; no/two Memo; a second signer; wrong fee payer; failed transaction; lookup tables; tampered mandate |
| `active.json` | 6 | `grant_inactive`: delegate replaced after the grant, delegate cleared, amount 0, account missing, foreign owner |
| `receipt.json` | 7 | valid, one field changed, other key, other seller, no mandate binding, malformed binding, unknown key |
| `resolve.json` | 56 | R1, R2 (each reason), R3 (no binding, other grant_tx), `mandate_mismatch`, `mandate_superseded` (before and after the payment slot), `history_incomplete` (incomplete, missing, payment absent), R4 variants, `tx_mismatch` field by field, no receipt (chain-only judgement, unjudged resource and time), and a **recorded real devnet RPC response** (`recorded/payment-5KsYz26T.json`) for `tx_mismatch`, in scope and seller liable |
| `period.json` | 6 | the budget across two sellers: first payment inside, second crosses (liable `agent_operator`), new period resets, ordering by slot, seller-visible violation plus overrun, spend before the grant not counted |

`test/vectors/recorded/` holds two real devnet `getTransaction` responses: the Phase 0 payment `5KsYz26T…` and the T1 grant `5gUy9rev…` signed on the Seeker (its memo is the v0.1 format, so it is used as a real memo-mismatch case, not as a passing grant).

## Mutation table

Mechanism: every check is written as `fails(name, condition)` (`packages/core/src/guard.js`); with `IUSSUM_MUTATE=name` that check never reports a violation. A mutation that leaves the suite green would be a vacuous check. **174 checks, none survived.** Mutation proves that every check that exists is load-bearing; it cannot find a check that is missing, which is how Phase 1.1 happened: the gate review found twelve missing checks and each one now has a row below.

| check skipped | tests that fail | first failing test |
|---|---|---|
| `agent.abort_early` | 1 | N6 a signal already aborted: createAgent rejects and the lock is not leaked (a3-signal-early) |
| `agent.attach_mandate` | 27 | an in-scope payment goes through, attaches extensions.iussum.info, and is recorded in the ledger |
| `agent.blockhash_valid` | 4 | T1 both answers are needed: a node that says the blockhash is still valid keeps the reservation held even when the height is past lastValidBlockHeight |
| `agent.checkpoint` | 1 | T2 a restarted agent reads only what is new since its checkpoint |
| `agent.close_timeout` | 2 | N4 close() while a paid request is in flight: the settled response is returned and the consumed entry is on disk (a1-close-paid-lost) |
| `agent.close_waits` | 3 | M2 close() waits for the payments in flight, then releases the lock |
| `agent.closed_hook` | 1 | M2 agent.client used after close() reads no chain, writes nothing, and cannot erase the next agent's held reservation (close-client) |
| `agent.closed_refuses` | 1 | M2 a closed agent sends no request at all, not even the unpaid first one (the top-level refusal in fetch) |
| `agent.closed_scheme` | 1 | M2 the naive agent cannot sign or pay through agent.client after close() (close-client-naive) |
| `agent.consume_released` | 1 | T1 a success that arrives AFTER a proven release is still counted (the reservation is consumed, the ledger has it) |
| `agent.corrupt_reservations_refuse` | 1 | H2 a truncated reservations file makes the agent refuse to pay (it is never read as empty) |
| `agent.datadir_lock` | 39 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.decimals` | 1 | F11: the agent builds TransferChecked with the mint's decimals (9), not a constant 6 |
| `agent.dedupe_own_sig` | 4 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.destination_ata` | 1 | S6 even without local checks the agent signs the associated token account of payTo, not the destination the 402 names |
| `agent.destination_mismatch` | 1 | S6 a requirement whose destination is not the associated token account of payTo is refused locally (destination_mismatch) and never signed |
| `agent.expiry_context` | 1 | M3 (d) an expiry answer without an integer context slot is not proof: { value: false } (no context) (i3-nocontext) |
| `agent.fsync_dir` | 2 | M8 the reservations file is fsynced, then its directory after the rename (fsync-trace) |
| `agent.grant` | 2 | refuses locally: grant revoked (grant_inactive) |
| `agent.held_any_period` | 1 | M3 (a) a payload kept in period 0 that lands at period 1 cannot take period 1 over budget (period-edge) |
| `agent.history_complete` | 3 | F7: if the ledger cannot be rebuilt completely the agent refuses to pay (history_incomplete) |
| `agent.history_min_context` | 3 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.history_to_grant` | 3 | N1 an honest agent restarted in period 1 after 150 in-scope payments in period 0 still pays |
| `agent.hold_until_proven` | 4 | B5 a payment that settled but whose response was lost still counts: the next one is refused locally |
| `agent.keep_settled` | 3 | M3 (b) a restart against a lagging node does not forget a payment that settled (restart-lag) |
| `agent.keyed_by_grant` | 4 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.landed_consumed` | 3 | B5 held becomes consumed (still counted) when the chain shows the lost payment landed |
| `agent.ledger` | 11 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.ledger_rebuild` | 18 | F7: a restarted agent rebuilds its ledger from chain and refuses the payment that would cross the period budget |
| `agent.legacy_import` | 1 | M3 (c) the held entries of a 142276f reservations file are imported: a payload kept before the upgrade is not forgotten (upgrade-reservations) |
| `agent.legacy_lock` | 1 | M3 (c) a live legacy agent.lock (a 142276f process on the same directory) stops a new agent; a dead one and our own pid do not |
| `agent.min_context_slot` | 1 | T1 isBlockhashValid and getBlockHeight are both asked with minContextSlot = the slot getLatestBlockhash returned |
| `agent.own_blockhash` | 1 | N12 a seller that says lastValidBlockHeight=1 cannot make the agent release the reservation: the second payment is refused and the total stays at the budget |
| `agent.period` | 31 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.persist_before_send` | 9 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.rebuild_allowance` | 2 | C1 the agent's ledger rebuild uses the same check: a restarted agent whose history misses a debit refuses to pay (history_incomplete) |
| `agent.release_needs_height` | 2 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.release_on_expiry` | 2 | B5 held is released when the blockhash has expired and no transaction with the agent's signature is on chain |
| `agent.release_uncreated` | 1 | B5 a payment that was never created (signing failed) releases its reservation: the next payment goes through |
| `agent.requested_url` | 1 | review 1: a seller that OMITS resource.url does not stop an in-scope payment: the agent judges the URL it requested |
| `agent.requested_url_present` | 1 | review 1: a payment that was not created through agent.fetch has no requested URL and is refused (resource_mismatch) |
| `agent.reserve_atomic` | 3 | B5 five concurrent payments against a budget that fits three: exactly three settle, two are refused locally with period_over_budget |
| `agent.reserve_held` | 20 | B5 five concurrent payments against a budget that fits three: exactly three settle, two are refused locally with period_over_budget |
| `agent.resource_mismatch` | 1 | F8: a seller that DECLARES an allowed resource.url while the agent asked for another URL is refused as resource_mismatch |
| `agent.restore_reservations` | 9 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.retry_after` | 2 | J1 the reference agent honours Retry-After: it re-sends the same payload and the payment settles once, with one reservation |
| `agent.retry_after_header` | 1 | M8 a 503 is retried only when Retry-After is whole seconds or a future HTTP-date; otherwise the paid request is sent once (retry-after) |
| `agent.rollback_lock` | 4 | K2 the holder is stopped with SIGKILL: a new agent starts at once, even when the restart gets the same pid as a live process (a container: pid 1) |
| `agent.rpc_guard` | 1 | N6 an abandoned start makes no more chain calls once it is aborted (a5-abandoned-keeps-reading) |
| `agent.scope` | 7 | refuses locally: amount over per_payment_max |
| `agent.start_releases` | 4 | M2 a start that fails after the lock was taken releases it (leak-enospc: a write of the start fails with ENOSPC) |
| `agent.tmp_cleanup` | 1 | H2 a temp file left behind by a crash between write and rename: the last complete file is loaded |
| `agent.tx_guard` | 1 | payer path guard: a signer that changes the amount is rejected, ComputeBudget-only changes are not required |
| `agent.write_needs_lock` | 1 | M2 a start the caller abandons through cfg.signal releases the lock at once and writes nothing afterwards (leak-abandoned) |
| `agent_mismatch` | 2 | scope: payer is not the agent |
| `allowance.crosscheck` | 4 | allowanceCheck: debits since the grant add up to total_cap minus what is still delegated; counts only entries up to the read slot |
| `amount_over_cap` | 14 | refuses locally: amount over per_payment_max |
| `asset_mismatch` | 3 | scope: asset differs |
| `chain.missing_balance_zero` | 3 | N5 the principal later empties and closes the account: the earlier out-of-scope payment is still pay_to_not_allowed, agent operator |
| `chain.self_transfer` | 7 | N3 after one agent self-transfer (transferChecked) an in-scope P1 and an out-of-scope P2 are still judged |
| `grant.active_amount` | 1 | grant active: delegated amount 0 |
| `grant.active_delegate` | 2 | grant active: delegate replaced after the grant |
| `grant.active_owner_mint` | 1 | grant active: account of another owner |
| `grant.approve_amount` | 1 | grant: ApproveChecked amount differs from total_cap |
| `grant.approve_count` | 2 | grant: no ApproveChecked |
| `grant.approve_delegate` | 1 | grant: ApproveChecked delegate is not the agent |
| `grant.approve_mint` | 1 | grant: ApproveChecked mint is not the asset |
| `grant.approve_owner` | 1 | grant: ApproveChecked owner is not the principal |
| `grant.approve_source` | 1 | grant: ApproveChecked source is not the principal ATA |
| `grant.cache_bound` | 1 | M5 (b) the grant cache is bounded and a grant_mismatch is not cached per mandate id (r8) |
| `grant.coalesce_scans` | 1 | B2 concurrent checks of one grant share one supersession scan (five concurrent payments do not make five scans), and a later call scans again |
| `grant.extra_instruction` | 5 | grant: an extra non-ComputeBudget instruction (a system transfer) |
| `grant.fee_payer` | 1 | grant: fee payer is not the principal |
| `grant.memo_count` | 5 | grant: no Memo |
| `grant.memo_text` | 9 | refuses locally: grant transaction does not match the mandate (memo) |
| `grant.mismatch_uncached` | 2 | K1 L0 control: two processes start at once on one data directory: exactly one runs, the other is refused |
| `grant.no_lookup_tables` | 3 | grant: address lookup tables are refused |
| `grant.not_found_cached` | 2 | N4 close() while a paid request is in flight: the settled response is returned and the consumed entry is on disk (a1-close-paid-lost) |
| `grant.not_found_pending` | 4 | enforce: an unknown grant_tx is PENDING (503 + Retry-After), not a refusal: the seller's node may only lag (Addendum N, N5 a) |
| `grant.only_signer` | 1 | grant: a second signer |
| `grant.scan_cap` | 2 | N3 different accounts still scan in parallel, up to the cap |
| `grant.scan_failed` | 11 | F1: if the chain cannot be scanned for a superseding instruction the grant is NOT treated as current |
| `grant.scan_first` | 2 | M5 (a) an active check stops at the first superseding signature it finds |
| `grant.scan_found_slot` | 1 | N2 core: the slot must equal the listing entry's slot when the listing has one, and a stored found list with a slot that is not a safe integer cannot reach NaN |
| `grant.scan_options` | 1 | N5 (b) maxConcurrentScans must be an integer >= 1 and maxQueuedScans an integer >= 0, in the gate and in the checker (g5) |
| `grant.scan_reset_unknown` | 1 | N5 (c) a stored since or cursor that the node no longer knows (-32020) restarts that grant's scan from the grant instead of failing for ever |
| `grant.scan_resume_top` | 6 | M1 core: a resumed scan sees the re-grant that landed after the cut-short scan began (r1) |
| `grant.scan_slot` | 1 | N2 core: the slot must equal the listing entry's slot when the listing has one, and a stored found list with a slot that is not a safe integer cannot reach NaN |
| `grant.scan_state_tolerant` | 1 | M1 (b): a scan_state row that does not parse is treated as absent: the scan restarts from the grant and the gate recovers |
| `grant.scan_store` | 1 | T2 a restarted agent reads only what is new since its checkpoint |
| `grant.scan_unreadable` | 1 | B1 an unreadable transaction in the history makes the later payment history_incomplete, never in_scope; nothing is stored |
| `grant.scan_wellformed` | 1 | M1 (a): a non-null element that is not a jsonParsed transaction is unreadable, not "does not supersede" |
| `grant.source_serial` | 1 | N3 one cold scan per source account: three grants of one account scan one after the other |
| `grant.superseded` | 22 | review 2: a approve made by CPI (meta.innerInstructions) supersedes the grant |
| `grant.superseded_inner` | 7 | review 2: a approve made by CPI (meta.innerInstructions) supersedes the grant |
| `grant.superseded_position` | 2 | B2 the earliest superseding transaction is chosen by position, not by signature string |
| `grant.tx_err` | 1 | grant: transaction failed on chain |
| `grant.warm_lane` | 2 | N3 a warm grant's incremental check is answered at once while cold scans hold every cold slot |
| `history.min_context` | 3 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `history.reconcile` | 1 | B1 reconcile: a transaction whose balance drop no parsed instruction explains makes the history incomplete and names the signature |
| `mandate.native_mint` | 1 | S2 a mandate whose asset is the native mint is refused |
| `mandate_expired` | 5 | refuses locally: mandate expired |
| `mandate_not_yet_valid` | 5 | refuses locally: mandate not yet valid |
| `network_mismatch` | 4 | scope: network differs |
| `pay_to_not_allowed` | 30 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `period_over_budget` | 15 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `receipt.shape` | 1 | receipt: mandate_id set but grant_tx null is malformed |
| `receipt.signature` | 3 | R4: a tampered receipt is rejected, liable null, nothing stored, and a corrected dispute can be resubmitted |
| `resolver.after_grant` | 5 | resolve: a payment before the grant: tx_mismatch, liable null (resubmit with the mandate that was current) |
| `resolver.agent_debit` | 7 | resolve: a payment the agent did not sign (authority is the thief) is not under this mandate: tx_mismatch, liable null (not the agent operator) |
| `resolver.allowance` | 3 | resolve: the debits found do not add up to the allowance that is gone: history_incomplete, liable null |
| `resolver.cas` | 2 | M4 (d) two services on one store: a replaced[] entry pairs a verdict with its own id, and an id a response returned is kept in the record (l2-two-instances) |
| `resolver.chain_amount` | 5 | resolve: receipt amount differs from chain (tx_mismatch) |
| `resolver.chain_asset` | 1 | resolve: receipt asset differs from chain mint |
| `resolver.chain_pay_to` | 1 | resolve: receipt pay_to differs from the chain destination owner |
| `resolver.chain_payer` | 1 | resolve: receipt payer differs from the chain authority |
| `resolver.checkpoint` | 3 | property I1: 120 random histories, every dispute gets the model's verdict on a readable chain (seeds 1..120) |
| `resolver.debit_not_x402` | 14 | resolve: two debits by the agent in one transaction cannot have gone through x402: debit_not_x402, agent operator |
| `resolver.duplicate` | 6 | a repeat dispute returns the stored verdict as duplicate_dispute and never refunds twice |
| `resolver.eq_grant_stored` | 1 | M4 (a) a second filer's grant_tx never enters the record of a receipt-equivocation verdict (l2-eq-http) |
| `resolver.equivocation` | 8 | N4 the seller files first with a second receipt it signed (an in-scope resource); the principal's genuine receipt gets receipt_equivocation, seller liable, one refund |
| `resolver.history_complete` | 6 | resolve: history not shown to be complete: history_incomplete, never in_scope |
| `resolver.history_found` | 1 | resolve: the disputed payment is not in the history: history_incomplete |
| `resolver.history_to_grant` | 5 | N1 150 in-scope payments in period 0, then an honest in-scope payment in period 1: in_scope, principal |
| `resolver.mandate_mismatch` | 2 | resolve: receipt bound to a different mandate id than the dispute carries: mandate_mismatch, liable null (the disputer does not choose the mandate) |
| `resolver.mandate_presented` | 18 | R3: out of scope with no mandate presented: agent operator liable, no refund from the seller |
| `resolver.no_receipt_judged` | 8 | resolve: no receipt and nothing out of scope on chain: invalid, principal, resource unjudged |
| `resolver.period_since_grant` | 1 | resolve: spend made before the grant (an earlier grant) is not counted against this mandate |
| `resolver.provisional` | 4 | B4 resource outside the prefix: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund |
| `resolver.provisional_needs_receipt` | 5 | B4 resource outside the prefix: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund |
| `resolver.receipt_tx` | 1 | resolve: receipt says another tx_sig |
| `resolver.reconcile` | 3 | resolve: the balance of the granted account fell by more than the parsed instructions explain: history_incomplete, liable null |
| `resolver.record_out` | 4 | M4 (a) a second filer's grant_tx never enters the record of a receipt-equivocation verdict (l2-eq-http) |
| `resolver.refund_decimals` | 1 | F11: the refund uses the decimals of the disputed payment (9), read from the chain |
| `resolver.refund_pending_guard` | 1 | F9: a refund signed but not confirmed is not resent while it can still land, and is adopted if it did land |
| `resolver.refund_retry` | 3 | F9: a refund that failed after the verdict was reserved is retried on the next dispute, once |
| `resolver.refund_seller_only` | 10 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `resolver.replace_binds_mandate` | 1 | B4 a verifying receipt that binds NO mandate cannot replace a provisional verdict (it must bind the same mandate) |
| `resolver.seller_visible` | 13 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `resolver.superseded` | 7 | resolve: mandate superseded before the payment slot: mandate_superseded, liable null |
| `resolver.verdict_id` | 9 | L2 golden vectors: a fixed record gives a fixed verdict_id (expected values computed outside this code base, sorted-key JSON + sha256) |
| `resolver.verdict_id_kept` | 5 | L2 a provisional verdict replaced by one with a receipt gets a new id; the record keeps the old id beside the replaced verdict |
| `resource.https_only` | 2 | S8 http://example.com/ is refused |
| `resource.no_userinfo` | 2 | resource: credentials in the URL are refused even when the host matches |
| `resource.origin_exact` | 9 | resource: host-only prefix does not match api.x.com.evil.io |
| `resource.path_boundary` | 9 | refuses locally: resource outside the prefix |
| `resource_not_allowed` | 21 | refuses locally: resource outside the prefix |
| `rpc.batch` | 2 | J2 the spend history and the supersession scan use the batch call when the RPC has it |
| `rpc.batch_burst` | 3 | M6 a paced read of 60 transactions through the measured limiter is never rejected, and takes about 60 / 0.8 s |
| `rpc.batch_json_limit` | 1 | N7 a whole batch refused via json200 empties the bucket and halves the rate |
| `rpc.cache_bound` | 1 | T2 makeRpc keeps at most 5000 transactions in its cache (least recently used goes first) |
| `rpc.clock_clamp` | 1 | N7 a wall clock that steps back one hour does not stall the next call for an hour (and the default clock is monotonic) |
| `rpc.floor_cap` | 1 | N7 a configured rate below the floor is never raised by a 429 |
| `rpc.option_bounds` | 2 | N4 close() while a paid request is in flight: the settled response is returned and the consumed entry is on disk (a1-close-paid-lost) |
| `rpc.pace` | 6 | J2 a long rate-limited stretch is waited out: 60 signatures through a node that answers 9 elements per 10 s window |
| `rpc.pace_fifo` | 1 | N7 (p2-starve) the bucket serves its waiters in order: a batch that needs 2 tokens is not starved by a loop of single calls |
| `rpc.pace_halve` | 4 | J2 a long rate-limited stretch is waited out: 60 signatures through a node that answers 9 elements per 10 s window |
| `seller.enforce` | 18 | enforce: amount over per_payment_max answers 403 and nothing settles |
| `seller.grant_budget` | 4 | J1 the first request on a cold grant check answers 503 with Retry-After within the budget; nothing settles |
| `seller.grant_budget_observe` | 2 | J1 an observe-mode gate never blocks on the cold check (it proceeds and records what was presented) |
| `seller.mandate_invalid` | 1 | enforce: an invalid mandate document is refused |
| `seller.no_receipt_on_failed_write` | 1 | H1 a failed write sends the response WITHOUT a receipt header and logs it; the payment still settled |
| `seller.observe_passes` | 7 | observe: an out-of-scope payment settles, and the receipt still records what was presented |
| `seller.off_skips` | 6 | a naive agent (localChecks off) sends the payment anyway |
| `seller.one_receipt_per_tx` | 2 | property I5: a facilitator that reports success twice for one transaction does not make an honest seller sign two receipts (20 seeds) |
| `seller.origin_required` | 1 | F5: createSellerGate refuses to start without a canonical origin |
| `seller.payment_source` | 2 | F6: a payment from another token account than the grant's source is grant_mismatch in enforce |
| `seller.payment_unreadable` | 1 | enforce: an unreadable payment transaction is refused before x402 sees it |
| `seller.pending_scope` | 1 | M5 (e) observe mode on a cold check still runs the scope checks and marks the check as pending (r6) |
| `seller.receipt_binds_mandate` | 2 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.receipt_issued` | 8 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.require_mandate` | 1 | enforce with requireMandate refuses an unmandated payment |
| `seller.resource_from_origin` | 1 | F5: an agent that forges Host: <allowed origin> does not get an in-scope receipt |
| `seller.store_receipts` | 5 | H1 restart the gate between two success responses for the same tx_sig: both receipts are byte-identical |

Phase 1: two checks survived the first run and were killed by adding tests, not by deleting the check (`resolver.duplicate`, `seller.payment_unreadable`). Phase 1.1: no survivors; a planned row `agent.requested_url` was wrongly dropped in Phase 1.1 (a string replace also deleted its name from the line it guards, leaving `fails(true)`, so the agent judged the seller-declared URL); it is back, with `agent.requested_url_present` and `grant.superseded_inner`, see `docs/phase11/followups.md`. Phase 1.8: no survivors in the run that counts (174 checks); its first two runs found `agent.closed_hook` and `agent.legacy_lock` redundant next to the new guarded `rpc` and rollback guard (a test and a shared condition made them load-bearing again) and the mutation script learnt to count a hung (cancelled) test as a kill. Phase 1.7: no survivors in the run that counts (157 checks); its first run had one survivor (`agent.closed_refuses`, made redundant by the new hook and scheme checks; a test that sends a request after `close()` made it load-bearing) and a second run was stopped because a mutated `rpc.pace` spun on a fake clock (a skipped check now still yields a millisecond). Phase 1.6: no survivors (130 checks). Phase 1.5: no survivors (121 checks). Phase 1.4: the first mutation run had two survivors (`agent.own_blockhash`, `agent.blockhash_valid`), killed by assertions that the payload carries the agent's own blockhash and that a node answering "valid" keeps a reservation held even past the last valid height. Phase 1.3: no survivors in the run (104 checks; the property test runs 120 histories per mutated run to keep the check fast). Phase 1.2: the first mutation run had four survivors (`agent.landed_consumed`, `agent.reserve_atomic`, `resolver.replace_binds_mandate`, `resolver.single_transfer`); each was killed by a stronger test or vector (the landed reservation must be `consumed` and in the ledger once; the atomic-reservation mutation yields for 50 ms between check and reservation; a receipt that binds no mandate cannot replace a provisional verdict; a vector with a second, foreign TransferChecked), none by deleting the check.

## What the tests do not cover

- The live facilitators and the real chain: that is the devnet demo (`demo-runs/` for Phase 1, `demo-runs-1.1/` for Phase 1.1, each 5 clean runs), not the unit suite. The demo found a failure the fake chain cannot show (the RPC signature-index lag, `docs/FEEDBACK.md`).
- The mutation mechanism skips a check; it does not prove a check is *correct*, only that some test depends on it.
- Concurrency beyond two simultaneous disputes and five simultaneous payments (`test/phase12/b5-agent-reserve.test.js`; the devnet scenario 12 repeats it on the real chain), and RPC failure paths other than retry on 429, 5xx, the index-lag error and the unreadable transaction / block cases of Phase 1.2.

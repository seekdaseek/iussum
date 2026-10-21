baseline: 530 tests, 530 pass, 0 fail
checks mutated: 204, survived (vacuous): 0

| check skipped | tests that fail | first failing test |
|---|---|---|
| `agent.abort_early` | 1 | N6 a signal already aborted: createAgent rejects and the lock is not leaked (a3-signal-early) |
| `agent.amount_decimal` | 1 | P1 a 402 with a negative amount is refused before anything is reserved: it cannot cancel the period budget for payments checked meanwhile (a1) |
| `agent.attach_mandate` | 38 | an in-scope payment goes through, attaches extensions.iussum.info, and is recorded in the ledger |
| `agent.blockhash_valid` | 4 | T1 both answers are needed: a node that says the blockhash is still valid keeps the reservation held even when the height is past lastValidBlockHeight |
| `agent.checkpoint` | 1 | T2 a restarted agent reads only what is new since its checkpoint |
| `agent.close_maps_guard` | 1 | O7 a close() during the grant check surfaces the agent_closed refusal, not "Failed to create payment payload: closed or abandoned" |
| `agent.close_timeout` | 1 | N6 close({ timeoutMs }) rejects when a payment is still in flight and KEEPS the lock; without a timeout close() still waits (a4-close-hang) |
| `agent.close_timeout_bounds` | 1 | O6 close({ timeoutMs }) takes an integer from 0 to 2147483647 or Infinity; anything else is rejected at the call and the agent is not closed (r7) |
| `agent.close_waits` | 4 | M2 close() waits for the payments in flight, then releases the lock |
| `agent.closed_hook` | 1 | M2 agent.client used after close() reads no chain, writes nothing, and cannot erase the next agent's held reservation (close-client) |
| `agent.closed_refuses` | 1 | M2 a closed agent sends no request at all, not even the unpaid first one (the top-level refusal in fetch) |
| `agent.closed_scheme` | 1 | M2 the naive agent cannot sign or pay through agent.client after close() (close-client-naive) |
| `agent.consume_released` | 2 | T1 a success that arrives AFTER a proven release is still counted (the reservation is consumed, the ledger has it) |
| `agent.corrupt_reservations_refuse` | 1 | H2 a truncated reservations file makes the agent refuse to pay (it is never read as empty) |
| `agent.datadir_lock` | 42 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.decimals` | 1 | F11: the agent builds TransferChecked with the mint's decimals (9), not a constant 6 |
| `agent.dedupe_own_sig` | 4 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.destination_ata` | 2 | S6 even without local checks the agent signs the associated token account of payTo, not the destination the 402 names |
| `agent.destination_mismatch` | 1 | S6 a requirement whose destination is not the associated token account of payTo is refused locally (destination_mismatch) and never signed |
| `agent.dirs_realpath` | 1 | O7 two spellings of one data directory are one directory: closing one agent does not remove the agent.lock of the other |
| `agent.expiry_context` | 1 | M3 (d) an expiry answer without an integer context slot is not proof: { value: false } (no context) (i3-nocontext) |
| `agent.fsync_dir` | 1 | M8 the reservations file is fsynced, then its directory after the rename (fsync-trace) |
| `agent.grant` | 2 | refuses locally: grant revoked (grant_inactive) |
| `agent.held_any_period` | 1 | M3 (a) a payload kept in period 0 that lands at period 1 cannot take period 1 over budget (period-edge) |
| `agent.history_complete` | 3 | F7: if the ledger cannot be rebuilt completely the agent refuses to pay (history_incomplete) |
| `agent.history_min_context` | 3 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.history_to_grant` | 3 | N1 an honest agent restarted in period 1 after 150 in-scope payments in period 0 still pays |
| `agent.hold_until_proven` | 4 | B5 a payment that settled but whose response was lost still counts: the next one is refused locally |
| `agent.keep_settled` | 4 | K1 L2: B starts while A is at its lock attempt (between the create and the pid write of the old lock): exactly one agent runs |
| `agent.keyed_by_grant` | 4 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.landed_consumed` | 3 | B5 held becomes consumed (still counted) when the chain shows the lost payment landed |
| `agent.ledger` | 15 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.ledger_rebuild` | 20 | F7: a restarted agent rebuilds its ledger from chain and refuses the payment that would cross the period budget |
| `agent.legacy_import` | 1 | M3 (c) the held entries of a 142276f reservations file are imported: a payload kept before the upgrade is not forgotten (upgrade-reservations) |
| `agent.legacy_lock` | 1 | M3 (c) a live legacy agent.lock (a 142276f process on the same directory) stops a new agent; a dead one and our own pid do not |
| `agent.min_context_slot` | 1 | T1 isBlockhashValid and getBlockHeight are both asked with minContextSlot = the slot getLatestBlockhash returned |
| `agent.own_blockhash` | 1 | N12 a seller that says lastValidBlockHeight=1 cannot make the agent release the reservation: the second payment is refused and the total stays at the budget |
| `agent.period` | 35 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.persist_before_send` | 9 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.rebuild_allowance` | 1 | C1 the agent's ledger rebuild uses the same check: a restarted agent whose history misses a debit refuses to pay (history_incomplete) |
| `agent.redirect_manual` | 3 | P2 an open redirect under the allowed prefix does not take the agent, or its payment header, to a server outside the mandate (a2) |
| `agent.release_needs_height` | 2 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.release_on_expiry` | 2 | B5 held is released when the blockhash has expired and no transaction with the agent's signature is on chain |
| `agent.release_uncreated` | 1 | B5 a payment that was never created (signing failed) releases its reservation: the next payment goes through |
| `agent.requested_url` | 1 | review 1: a seller that OMITS resource.url does not stop an in-scope payment: the agent judges the URL it requested |
| `agent.requested_url_present` | 1 | review 1: a payment that was not created through agent.fetch has no requested URL and is refused (resource_mismatch) |
| `agent.reserve_atomic` | 3 | property P1: malformed amounts in a 402 never lift the period budget and are always refused as amount_over_cap (40 seeds) |
| `agent.reserve_held` | 21 | property P1: malformed amounts in a 402 never lift the period budget and are always refused as amount_over_cap (40 seeds) |
| `agent.resource_mismatch` | 1 | F8: a seller that DECLARES an allowed resource.url while the agent asked for another URL is refused as resource_mismatch |
| `agent.restore_reservations` | 8 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.retry_after` | 4 | J1 the reference agent honours Retry-After: it re-sends the same payload and the payment settles once, with one reservation |
| `agent.retry_after_header` | 1 | M8 a 503 is retried only when Retry-After is whole seconds or a future HTTP-date; otherwise the paid request is sent once (retry-after) |
| `agent.rollback_lock` | 4 | K1 the same process cannot take the lock twice, and there is no stale-lock logic (agent.lock is only the rollback guard of Addendum N: our pid, no stale files) |
| `agent.rpc_guard` | 2 | N6 an abandoned start makes no more chain calls once it is aborted (a5-abandoned-keeps-reading) |
| `agent.scope` | 8 | refuses locally: amount over per_payment_max |
| `agent.signal_start_only` | 1 | O3 aborting cfg.signal after the start does not stop the agent: it covers the START only (r1, r1b) |
| `agent.start_releases` | 4 | M2 a start that fails after the lock was taken releases it (leak-enospc: a write of the start fails with ENOSPC) |
| `agent.tmp_cleanup` | 1 | H2 a temp file left behind by a crash between write and rename: the last complete file is loaded |
| `agent.tx_durable_nonce` | 1 | P3 a durable-nonce lifetime is refused outright, and the guard says so |
| `agent.tx_guard` | 3 | payer path guard: a signer that changes the amount is rejected, ComputeBudget-only changes are not required |
| `agent.tx_lifetime` | 1 | P3 a signer that replaces the recent blockhash is refused by the guard, so the expiry proof is always about the blockhash the payload carries (a3) |
| `agent.unsigned_entries` | 1 | O7 a restart counts each settled payment once (without transaction.signatures) |
| `agent.write_needs_lock` | 1 | M2 a start the caller abandons through cfg.signal releases the lock at once and writes nothing afterwards (leak-abandoned) |
| `agent_mismatch` | 2 | scope: payer is not the agent |
| `allowance.crosscheck` | 4 | allowanceCheck: debits since the grant add up to total_cap minus what is still delegated; counts only entries up to the read slot |
| `amount_over_cap` | 16 | refuses locally: amount over per_payment_max |
| `asset_mismatch` | 3 | scope: asset differs |
| `chain.missing_balance_zero` | 3 | N5 the principal later empties and closes the account: the earlier out-of-scope payment is still pay_to_not_allowed, agent operator |
| `chain.self_transfer` | 7 | N3 after one agent self-transfer (transferChecked) an in-scope P1 and an out-of-scope P2 are still judged |
| `grant.active_amount` | 1 | grant active: delegated amount 0 |
| `grant.active_delegate` | 2 | grant active: delegate replaced after the grant |
| `grant.active_owner_mint` | 1 | grant active: account of another owner |
| `grant.approve_amount` | 1 | grant: ApproveChecked amount differs from total_cap |
| `grant.approve_count` | 2 | grant: no ApproveChecked |
| `grant.approve_delegate` | 2 | grant: ApproveChecked delegate is not the agent |
| `grant.approve_mint` | 1 | grant: ApproveChecked mint is not the asset |
| `grant.approve_owner` | 1 | grant: ApproveChecked owner is not the principal |
| `grant.approve_source` | 1 | grant: ApproveChecked source is not the principal ATA |
| `grant.bulk_reads` | 1 | O4a legitimate warm payments settle during four cold scans on accounts of the attacker's own, through ONE paced bucket (r2) |
| `grant.cache_bound` | 1 | M5 (b) the grant cache is bounded and a grant_mismatch is not cached per mandate id (r8) |
| `grant.coalesce_scans` | 1 | B2 concurrent checks of one grant share one supersession scan (five concurrent payments do not make five scans), and a later call scans again |
| `grant.extra_instruction` | 5 | grant: an extra non-ComputeBudget instruction (a system transfer) |
| `grant.fee_payer` | 1 | grant: fee payer is not the principal |
| `grant.memo_count` | 2 | grant: no Memo |
| `grant.memo_text` | 7 | refuses locally: grant transaction does not match the mandate (memo) |
| `grant.mismatch_uncached` | 2 | K1 L0 control: two processes start at once on one data directory: exactly one runs, the other is refused |
| `grant.no_lookup_tables` | 1 | grant: address lookup tables are refused |
| `grant.not_found_cached` | 1 | N5 (a) a grant the seller's node does not show yet is answered 503 + Retry-After (pending), never 403, memoised as pending, and settles once it shows (g3) |
| `grant.not_found_pending` | 4 | enforce: an unknown grant_tx is PENDING (503 + Retry-After), not a refusal: the seller's node may only lag (Addendum N, N5 a) |
| `grant.only_signer` | 1 | grant: a second signer |
| `grant.reset_keeps_found` | 2 | O1 a restart after -32020 keeps the superseders the scan had already read: a lagging node cannot turn them into "not superseded" (r5) |
| `grant.restart_cap` | 1 | O7 a node that keeps forgetting the cursor cannot make every payment re-read the whole history: restarts are capped per grant per hour and fail closed (busy) |
| `grant.scan_cap` | 2 | N3 different accounts still scan in parallel, up to the cap |
| `grant.scan_failed` | 10 | F1: if the chain cannot be scanned for a superseding instruction the grant is NOT treated as current |
| `grant.scan_first` | 2 | M5 (a) an active check stops at the first superseding signature it finds |
| `grant.scan_found_slot` | 1 | N2 core: the slot must equal the listing entry's slot when the listing has one, and a stored found list with a slot that is not a safe integer cannot reach NaN |
| `grant.scan_options` | 1 | N5 (b) maxConcurrentScans must be an integer >= 1 and maxQueuedScans an integer >= 0, in the gate and in the checker (g5) |
| `grant.scan_reset_unknown` | 4 | N5 (c) a stored since or cursor that the node no longer knows (-32020) restarts that grant's scan from the grant instead of failing for ever |
| `grant.scan_resume_top` | 6 | M1 core: a resumed scan sees the re-grant that landed after the cut-short scan began (r1) |
| `grant.scan_slot` | 1 | N2 core: the slot must equal the listing entry's slot when the listing has one, and a stored found list with a slot that is not a safe integer cannot reach NaN |
| `grant.scan_state_tolerant` | 2 | M1 (b): a scan_state row that does not parse is treated as absent: the scan restarts from the grant and the gate recovers |
| `grant.scan_store` | 2 | T2 a restarted agent reads only what is new since its checkpoint |
| `grant.scan_unreadable` | 1 | B1 an unreadable transaction in the history makes the later payment history_incomplete, never in_scope; nothing is stored |
| `grant.scan_wellformed` | 1 | M1 (a): a non-null element that is not a jsonParsed transaction is unreadable, not "does not supersede" |
| `grant.source_serial` | 1 | N3 one cold scan per source account: three grants of one account scan one after the other |
| `grant.stored_found_wellformed` | 1 | O2 a stored state whose found entry has no usable slot is treated as absent: the scan restarts from the grant and finds the real superseder (r4) |
| `grant.superseded` | 22 | review 2: a approve made by CPI (meta.innerInstructions) supersedes the grant |
| `grant.superseded_inner` | 7 | review 2: a approve made by CPI (meta.innerInstructions) supersedes the grant |
| `grant.superseded_position` | 1 | B2 the earliest superseding transaction is chosen by position, not by signature string |
| `grant.tx_err` | 1 | grant: transaction failed on chain |
| `grant.warm_lane` | 6 | F1: the supersession scan is incremental: the second check only asks for signatures newer than the first scan |
| `grant.warm_one_page` | 1 | O4b a warm scan reads one page; a full page gives the warm slot back and the rest runs in the cold lane |
| `grant.warm_probe` | 4 | F1: the supersession scan is incremental: the second check only asks for signatures newer than the first scan |
| `grant.warm_source_serial` | 1 | O4b one warm scan per source account: two questions about one grant (a gate and a resolver) scan one after the other |
| `history.min_context` | 3 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `history.reconcile` | 1 | B1 reconcile: a transaction whose balance drop no parsed instruction explains makes the history incomplete and names the signature |
| `history.reorg_evict` | 1 | O7 a transaction re-orged into another slot is read again: the cache entry whose slot disagrees with the listing is evicted |
| `history.reorg_known` | 1 | O7 a node whose transactions disagree with its own listing is read again once, not on every scan (r4b) |
| `mandate.native_mint` | 1 | S2 a mandate whose asset is the native mint is refused |
| `mandate.period_time_finite` | 1 | P8 periodIndex throws on a time that is not a finite number, so null cannot reach the arithmetic again |
| `mandate.period_unknown_time` | 4 | P8 a payment without a block time is not placed in a period of its own: history_incomplete, liable null, nothing stored as final (g5) |
| `mandate_expired` | 7 | refuses locally: mandate expired |
| `mandate_not_yet_valid` | 6 | refuses locally: mandate not yet valid |
| `network_mismatch` | 4 | scope: network differs |
| `pay_to_not_allowed` | 36 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `period_over_budget` | 16 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `receipt.shape` | 1 | receipt: mandate_id set but grant_tx null is malformed |
| `receipt.signature` | 3 | R4: a tampered receipt is rejected, liable null, nothing stored, and a corrected dispute can be resubmitted |
| `resolver.after_grant` | 5 | resolve: a payment before the grant: tx_mismatch, liable null (resubmit with the mandate that was current) |
| `resolver.agent_debit` | 7 | resolve: a payment the agent did not sign (authority is the thief) is not under this mandate: tx_mismatch, liable null (not the agent operator) |
| `resolver.allowance` | 6 | resolve: the debits found do not add up to the allowance that is gone: history_incomplete, liable null |
| `resolver.cas` | 1 | M4 (d) two services on one store: a replaced[] entry pairs a verdict with its own id, and an id a response returned is kept in the record (l2-two-instances) |
| `resolver.chain_amount` | 2 | resolve: receipt amount differs from chain (tx_mismatch) |
| `resolver.chain_asset` | 1 | resolve: receipt asset differs from chain mint |
| `resolver.chain_pay_to` | 1 | resolve: receipt pay_to differs from the chain destination owner |
| `resolver.chain_payer` | 1 | resolve: receipt payer differs from the chain authority |
| `resolver.checkpoint` | 3 | property I1: 120 random histories, every dispute gets the model's verdict on a readable chain (seeds 1..120) |
| `resolver.debit_not_x402` | 14 | resolve: two debits by the agent in one transaction cannot have gone through x402: debit_not_x402, agent operator |
| `resolver.duplicate` | 11 | a repeat dispute returns the stored verdict as duplicate_dispute and never refunds twice |
| `resolver.eq_grant_stored` | 1 | M4 (a) a second filer's grant_tx never enters the record of a receipt-equivocation verdict (l2-eq-http) |
| `resolver.equivocation` | 7 | N4 the seller files first with a second receipt it signed (an in-scope resource); the principal's genuine receipt gets receipt_equivocation, seller liable, one refund |
| `resolver.history_complete` | 6 | resolve: history not shown to be complete: history_incomplete, never in_scope |
| `resolver.history_found` | 1 | resolve: the disputed payment is not in the history: history_incomplete |
| `resolver.history_to_grant` | 5 | N1 150 in-scope payments in period 0, then an honest in-scope payment in period 1: in_scope, principal |
| `resolver.mandate_mismatch` | 2 | resolve: receipt bound to a different mandate id than the dispute carries: mandate_mismatch, liable null (the disputer does not choose the mandate) |
| `resolver.mandate_presented` | 18 | R3: out of scope with no mandate presented: agent operator liable, no refund from the seller |
| `resolver.no_receipt_judged` | 11 | resolve: no receipt and nothing out of scope on chain: invalid, principal, resource unjudged |
| `resolver.period_since_grant` | 1 | resolve: spend made before the grant (an earlier grant) is not counted against this mandate |
| `resolver.period_time_known` | 2 | P8 a payment without a block time is not placed in a period of its own: history_incomplete, liable null, nothing stored as final (g5) |
| `resolver.provisional` | 4 | B4 resource outside the prefix: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund |
| `resolver.provisional_needs_receipt` | 4 | B4 resource outside the prefix: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund |
| `resolver.receipt_tx` | 1 | resolve: receipt says another tx_sig |
| `resolver.reconcile` | 2 | resolve: the balance of the granted account fell by more than the parsed instructions explain: history_incomplete, liable null |
| `resolver.record_out` | 4 | M4 (a) a second filer's grant_tx never enters the record of a receipt-equivocation verdict (l2-eq-http) |
| `resolver.refund_claim` | 1 | P6 the claim is what keeps the second service from sending: a service that read the row BEFORE the first one claimed it still sends nothing (the race between read and claim, across processes) |
| `resolver.refund_decimals` | 1 | F11: the refund uses the decimals of the disputed payment (9), read from the chain |
| `resolver.refund_pending_guard` | 3 | F9: a refund signed but not confirmed is not resent while it can still land, and is adopted if it did land |
| `resolver.refund_retry` | 8 | F9: a refund that failed after the verdict was reserved is retried on the next dispute, once |
| `resolver.refund_seller_only` | 17 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `resolver.replace_binds_mandate` | 1 | B4 a verifying receipt that binds NO mandate cannot replace a provisional verdict (it must bind the same mandate) |
| `resolver.seller_visible` | 13 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `resolver.superseded` | 6 | resolve: mandate superseded before the payment slot: mandate_superseded, liable null |
| `resolver.verdict_id` | 9 | L2 golden vectors: a fixed record gives a fixed verdict_id (expected values computed outside this code base, sorted-key JSON + sha256) |
| `resolver.verdict_id_kept` | 7 | K1 L0 control: two processes start at once on one data directory: exactly one runs, the other is refused |
| `resource.https_only` | 3 | S8 http://example.com/ is refused |
| `resource.no_userinfo` | 1 | resource: credentials in the URL are refused even when the host matches |
| `resource.origin_exact` | 9 | resource: host-only prefix does not match api.x.com.evil.io |
| `resource.path_boundary` | 14 | refuses locally: resource outside the prefix |
| `resource.raw_path` | 4 | P5 resourceAllowed refuses any resource whose normalised form differs from its raw origin and path: .. %2e%2e %2E. backslash /./ |
| `resource_not_allowed` | 30 | refuses locally: resource outside the prefix |
| `rpc.batch` | 2 | J2 the spend history and the supersession scan use the batch call when the RPC has it |
| `rpc.batch_burst` | 3 | M6 a paced read of 60 transactions through the measured limiter is never rejected, and takes about 60 / 0.8 s |
| `rpc.batch_json_limit` | 1 | N7 a whole batch refused via json200 empties the bucket and halves the rate |
| `rpc.cache_bound` | 1 | T2 makeRpc keeps at most 5000 transactions in its cache (least recently used goes first) |
| `rpc.clock_clamp` | 1 | N7 a wall clock that steps back one hour does not stall the next call for an hour (and the default clock is monotonic) |
| `rpc.floor_cap` | 1 | N7 a configured rate below the floor is never raised by a 429 |
| `rpc.option_bounds` | 1 | N7 a bad rate or burst is refused at makeRpc: rate finite and > 0, burst finite and >= 1 |
| `rpc.pace` | 5 | J2 a long rate-limited stretch is waited out: 60 signatures through a node that answers 9 elements per 10 s window |
| `rpc.pace_fifo` | 1 | N7 (p2-starve) the bucket serves its waiters in order: a batch that needs 2 tokens is not starved by a loop of single calls |
| `rpc.pace_halve` | 5 | J2 a long rate-limited stretch is waited out: 60 signatures through a node that answers 9 elements per 10 s window |
| `rpc.pace_priority` | 2 | O4a the bucket serves normal waiters before bulk ones, and bulk ones still get one grant in four |
| `scope.amount_decimal` | 1 | P1 scopeViolations judges an amount that is not a plain decimal integer string as over the cap, for every malformed spelling |
| `seller.enforce` | 27 | enforce: amount over per_payment_max answers 403 and nothing settles |
| `seller.grant_budget` | 5 | J1 the first request on a cold grant check answers 503 with Retry-After within the budget; nothing settles |
| `seller.grant_budget_observe` | 2 | J1 an observe-mode gate never blocks on the cold check (it proceeds and records what was presented) |
| `seller.header_only_signature` | 1 | P4 readPaymentHeader reads only payment-signature, decodes it the way x402 does, and throws on a header that is present but cannot be decoded |
| `seller.header_undecodable_refused` | 1 | P4 readPaymentHeader reads only payment-signature, decodes it the way x402 does, and throws on a header that is present but cannot be decoded |
| `seller.header_x402_decoder` | 3 | P4 readPaymentHeader reads only payment-signature, decodes it the way x402 does, and throws on a header that is present but cannot be decoded |
| `seller.mandate_invalid` | 1 | enforce: an invalid mandate document is refused |
| `seller.no_receipt_on_failed_write` | 1 | H1 a failed write sends the response WITHOUT a receipt header and logs it; the payment still settled |
| `seller.observe_passes` | 5 | observe: an out-of-scope payment settles, and the receipt still records what was presented |
| `seller.off_skips` | 6 | a naive agent (localChecks off) sends the payment anyway |
| `seller.one_receipt_per_tx` | 3 | property I5: a facilitator that reports success twice for one transaction does not make an honest seller sign two receipts (20 seeds) |
| `seller.origin_required` | 1 | F5: createSellerGate refuses to start without a canonical origin |
| `seller.payment_source` | 1 | F6: a payment from another token account than the grant's source is grant_mismatch in enforce |
| `seller.payment_unreadable` | 1 | enforce: an unreadable payment transaction is refused before x402 sees it |
| `seller.pending_memo_bounded` | 1 | O5 the pending memo of an unseen grant is never longer than the Retry-After the gate sends, so the agent's retries see the grant once the node has it (r6) |
| `seller.pending_scope` | 1 | M5 (e) observe mode on a cold check still runs the scope checks and marks the check as pending (r6) |
| `seller.receipt_binds_mandate` | 3 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.receipt_issued` | 10 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.require_mandate` | 1 | enforce with requireMandate refuses an unmandated payment |
| `seller.resource_from_origin` | 1 | F5: an agent that forges Host: <allowed origin> does not get an in-scope receipt |
| `seller.settle_margin` | 2 | P7 an honest agent and an honest ENFORCE gate no longer accept a payment inside settleMarginSeconds of expires_at: 403 mandate_expired, the margin in the delta (g4) |
| `seller.store_receipts` | 5 | H1 restart the gate between two success responses for the same tx_sig: both receipts are byte-identical |

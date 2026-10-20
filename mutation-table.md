baseline: 390 tests, 390 pass, 0 fail
checks mutated: 130, survived (vacuous): 0

| check skipped | tests that fail | first failing test |
|---|---|---|
| `agent.attach_mandate` | 18 | an in-scope payment goes through, attaches extensions.iussum.info, and is recorded in the ledger |
| `agent.blockhash_valid` | 1 | T1 both answers are needed: a node that says the blockhash is still valid keeps the reservation held even when the height is past lastValidBlockHeight |
| `agent.checkpoint` | 1 | T2 a restarted agent reads only what is new since its checkpoint |
| `agent.closed_refuses` | 1 | K3 after close() the agent refuses to fetch, and nothing is written to the data directory |
| `agent.consume_released` | 1 | T1 a success that arrives AFTER a proven release is still counted (the reservation is consumed, the ledger has it) |
| `agent.corrupt_reservations_refuse` | 1 | H2 a truncated reservations file makes the agent refuse to pay (it is never read as empty) |
| `agent.datadir_lock` | 7 | H2 a second agent on the same dataDir refuses to start while the first one runs |
| `agent.decimals` | 1 | F11: the agent builds TransferChecked with the mint's decimals (9), not a constant 6 |
| `agent.destination_ata` | 1 | S6 even without local checks the agent signs the associated token account of payTo, not the destination the 402 names |
| `agent.destination_mismatch` | 1 | S6 a requirement whose destination is not the associated token account of payTo is refused locally (destination_mismatch) and never signed |
| `agent.grant` | 2 | refuses locally: grant revoked (grant_inactive) |
| `agent.history_complete` | 3 | F7: if the ledger cannot be rebuilt completely the agent refuses to pay (history_incomplete) |
| `agent.history_min_context` | 2 | I3 a history node 1 to 2 slots behind the proof does not list the landed payment: the read fails ("minimum context slot not reached") and the reservation stays held |
| `agent.history_to_grant` | 2 | N1 an honest agent restarted in period 1 after 150 in-scope payments in period 0 still pays |
| `agent.hold_until_proven` | 4 | B5 a payment that settled but whose response was lost still counts: the next one is refused locally |
| `agent.keyed_by_grant` | 4 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.landed_consumed` | 2 | B5 held becomes consumed (still counted) when the chain shows the lost payment landed |
| `agent.ledger` | 6 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.ledger_rebuild` | 8 | F7: a restarted agent rebuilds its ledger from chain and refuses the payment that would cross the period budget |
| `agent.min_context_slot` | 1 | T1 isBlockhashValid and getBlockHeight are both asked with minContextSlot = the slot getLatestBlockhash returned |
| `agent.own_blockhash` | 1 | N12 a seller that says lastValidBlockHeight=1 cannot make the agent release the reservation: the second payment is refused and the total stays at the budget |
| `agent.period` | 19 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.persist_before_send` | 5 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.rebuild_allowance` | 1 | C1 the agent's ledger rebuild uses the same check: a restarted agent whose history misses a debit refuses to pay (history_incomplete) |
| `agent.release_needs_height` | 2 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.release_on_expiry` | 2 | B5 held is released when the blockhash has expired and no transaction with the agent's signature is on chain |
| `agent.release_uncreated` | 1 | B5 a payment that was never created (signing failed) releases its reservation: the next payment goes through |
| `agent.requested_url` | 1 | review 1: a seller that OMITS resource.url does not stop an in-scope payment: the agent judges the URL it requested |
| `agent.requested_url_present` | 1 | review 1: a payment that was not created through agent.fetch has no requested URL and is refused (resource_mismatch) |
| `agent.reserve_atomic` | 2 | B5 five concurrent payments against a budget that fits three: exactly three settle, two are refused locally with period_over_budget |
| `agent.reserve_held` | 14 | B5 five concurrent payments against a budget that fits three: exactly three settle, two are refused locally with period_over_budget |
| `agent.resource_mismatch` | 1 | F8: a seller that DECLARES an allowed resource.url while the agent asked for another URL is refused as resource_mismatch |
| `agent.restore_reservations` | 3 | property I4: the agent never settles more than period_budget under concurrency, lost responses, kept payloads, seller blockhash fields, expiry, a lagging node and restarts (60 seeds) |
| `agent.retry_after` | 1 | J1 the reference agent honours Retry-After: it re-sends the same payload and the payment settles once, with one reservation |
| `agent.scope` | 7 | refuses locally: amount over per_payment_max |
| `agent.tmp_cleanup` | 1 | H2 a temp file left behind by a crash between write and rename: the last complete file is loaded |
| `agent.tx_guard` | 1 | payer path guard: a signer that changes the amount is rejected, ComputeBudget-only changes are not required |
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
| `grant.coalesce_scans` | 1 | B2 concurrent checks of one grant share one supersession scan (five concurrent payments do not make five scans), and a later call scans again |
| `grant.extra_instruction` | 5 | grant: an extra non-ComputeBudget instruction (a system transfer) |
| `grant.fee_payer` | 1 | grant: fee payer is not the principal |
| `grant.memo_count` | 2 | grant: no Memo |
| `grant.memo_text` | 6 | refuses locally: grant transaction does not match the mandate (memo) |
| `grant.no_lookup_tables` | 1 | grant: address lookup tables are refused |
| `grant.only_signer` | 1 | grant: a second signer |
| `grant.scan_failed` | 2 | F1: if the chain cannot be scanned for a superseding instruction the grant is NOT treated as current |
| `grant.scan_store` | 1 | T2 a restarted agent reads only what is new since its checkpoint |
| `grant.scan_unreadable` | 1 | B2 the grant check of a superseded M1 does not pass while G2 is unreadable, and stays failed after the RPC recovers |
| `grant.superseded` | 15 | review 2: a approve made by CPI (meta.innerInstructions) supersedes the grant |
| `grant.superseded_inner` | 7 | review 2: a approve made by CPI (meta.innerInstructions) supersedes the grant |
| `grant.superseded_position` | 1 | B2 the earliest superseding transaction is chosen by position, not by signature string |
| `grant.tx_err` | 1 | grant: transaction failed on chain |
| `history.min_context` | 2 | I3 a history node 1 to 2 slots behind the proof does not list the landed payment: the read fails ("minimum context slot not reached") and the reservation stays held |
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
| `resolver.chain_amount` | 2 | resolve: receipt amount differs from chain (tx_mismatch) |
| `resolver.chain_asset` | 1 | resolve: receipt asset differs from chain mint |
| `resolver.chain_pay_to` | 1 | resolve: receipt pay_to differs from the chain destination owner |
| `resolver.chain_payer` | 1 | resolve: receipt payer differs from the chain authority |
| `resolver.checkpoint` | 3 | property I1: 120 random histories, every dispute gets the model's verdict on a readable chain (seeds 1..120) |
| `resolver.debit_not_x402` | 14 | resolve: two debits by the agent in one transaction cannot have gone through x402: debit_not_x402, agent operator |
| `resolver.duplicate` | 5 | a repeat dispute returns the stored verdict as duplicate_dispute and never refunds twice |
| `resolver.equivocation` | 4 | N4 the seller files first with a second receipt it signed (an in-scope resource); the principal's genuine receipt gets receipt_equivocation, seller liable, one refund |
| `resolver.history_complete` | 5 | resolve: history not shown to be complete: history_incomplete, never in_scope |
| `resolver.history_found` | 1 | resolve: the disputed payment is not in the history: history_incomplete |
| `resolver.history_to_grant` | 5 | N1 150 in-scope payments in period 0, then an honest in-scope payment in period 1: in_scope, principal |
| `resolver.mandate_mismatch` | 2 | resolve: receipt bound to a different mandate id than the dispute carries: mandate_mismatch, liable null (the disputer does not choose the mandate) |
| `resolver.mandate_presented` | 18 | R3: out of scope with no mandate presented: agent operator liable, no refund from the seller |
| `resolver.no_receipt_judged` | 8 | resolve: no receipt and nothing out of scope on chain: invalid, principal, resource unjudged |
| `resolver.period_since_grant` | 1 | resolve: spend made before the grant (an earlier grant) is not counted against this mandate |
| `resolver.provisional` | 3 | B4 resource outside the prefix: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund |
| `resolver.provisional_needs_receipt` | 3 | B4 resource outside the prefix: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund |
| `resolver.receipt_tx` | 1 | resolve: receipt says another tx_sig |
| `resolver.reconcile` | 2 | resolve: the balance of the granted account fell by more than the parsed instructions explain: history_incomplete, liable null |
| `resolver.refund_decimals` | 1 | F11: the refund uses the decimals of the disputed payment (9), read from the chain |
| `resolver.refund_pending_guard` | 1 | F9: a refund signed but not confirmed is not resent while it can still land, and is adopted if it did land |
| `resolver.refund_retry` | 3 | F9: a refund that failed after the verdict was reserved is retried on the next dispute, once |
| `resolver.refund_seller_only` | 10 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `resolver.replace_binds_mandate` | 1 | B4 a verifying receipt that binds NO mandate cannot replace a provisional verdict (it must bind the same mandate) |
| `resolver.seller_visible` | 13 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `resolver.superseded` | 5 | resolve: mandate superseded before the payment slot: mandate_superseded, liable null |
| `resolver.verdict_id` | 4 | L2 golden vectors: a fixed record gives a fixed verdict_id (expected values computed outside this code base, sorted-key JSON + sha256) |
| `resolver.verdict_id_kept` | 2 | L2 a provisional verdict replaced by one with a receipt gets a new id; the record keeps the old id beside the replaced verdict |
| `resource.https_only` | 2 | S8 http://example.com/ is refused |
| `resource.no_userinfo` | 1 | resource: credentials in the URL are refused even when the host matches |
| `resource.origin_exact` | 9 | resource: host-only prefix does not match api.x.com.evil.io |
| `resource.path_boundary` | 8 | refuses locally: resource outside the prefix |
| `resource_not_allowed` | 21 | refuses locally: resource outside the prefix |
| `rpc.batch` | 2 | J2 the spend history and the supersession scan use the batch call when the RPC has it |
| `rpc.cache_bound` | 1 | T2 makeRpc keeps at most 5000 transactions in its cache (least recently used goes first) |
| `seller.enforce` | 15 | enforce: amount over per_payment_max answers 403 and nothing settles |
| `seller.grant_budget` | 2 | J1 the first request on a cold grant check answers 503 with Retry-After within the budget; nothing settles |
| `seller.grant_budget_observe` | 1 | J1 an observe-mode gate never blocks on the cold check (it proceeds and records what was presented) |
| `seller.mandate_invalid` | 1 | enforce: an invalid mandate document is refused |
| `seller.no_receipt_on_failed_write` | 1 | H1 a failed write sends the response WITHOUT a receipt header and logs it; the payment still settled |
| `seller.observe_passes` | 3 | observe: an out-of-scope payment settles, and the receipt still records what was presented |
| `seller.off_skips` | 6 | a naive agent (localChecks off) sends the payment anyway |
| `seller.one_receipt_per_tx` | 2 | property I5: a facilitator that reports success twice for one transaction does not make an honest seller sign two receipts (20 seeds) |
| `seller.origin_required` | 1 | F5: createSellerGate refuses to start without a canonical origin |
| `seller.payment_source` | 1 | F6: a payment from another token account than the grant's source is grant_mismatch in enforce |
| `seller.payment_unreadable` | 1 | enforce: an unreadable payment transaction is refused before x402 sees it |
| `seller.receipt_binds_mandate` | 2 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.receipt_issued` | 8 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.require_mandate` | 2 | enforce with requireMandate refuses an unmandated payment |
| `seller.resource_from_origin` | 1 | F5: an agent that forges Host: <allowed origin> does not get an in-scope receipt |
| `seller.store_receipts` | 4 | H1 restart the gate between two success responses for the same tx_sig: both receipts are byte-identical |

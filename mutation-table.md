baseline: 306 tests, 306 pass, 0 fail
checks mutated: 97, survived (vacuous): 0

| check skipped | tests that fail | first failing test |
|---|---|---|
| `agent.attach_mandate` | 15 | an in-scope payment goes through, attaches extensions.iussum.info, and is recorded in the ledger |
| `agent.decimals` | 1 | F11: the agent builds TransferChecked with the mint's decimals (9), not a constant 6 |
| `agent.destination_ata` | 1 | S6 even without local checks the agent signs the associated token account of payTo, not the destination the 402 names |
| `agent.destination_mismatch` | 1 | S6 a requirement whose destination is not the associated token account of payTo is refused locally (destination_mismatch) and never signed |
| `agent.grant` | 2 | refuses locally: grant revoked (grant_inactive) |
| `agent.history_complete` | 2 | F7: if the ledger cannot be rebuilt completely the agent refuses to pay (history_incomplete) |
| `agent.hold_until_proven` | 3 | B5 a payment that settled but whose response was lost still counts: the next one is refused locally |
| `agent.landed_consumed` | 1 | B5 held becomes consumed (still counted) when the chain shows the lost payment landed |
| `agent.ledger` | 4 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.ledger_rebuild` | 3 | F7: a restarted agent rebuilds its ledger from chain and refuses the payment that would cross the period budget |
| `agent.period` | 7 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.rebuild_allowance` | 1 | C1 the agent's ledger rebuild uses the same check: a restarted agent whose history misses a debit refuses to pay (history_incomplete) |
| `agent.release_on_expiry` | 1 | B5 held is released when the blockhash has expired and no transaction with the agent's signature is on chain |
| `agent.release_uncreated` | 1 | B5 a payment that was never created (signing failed) releases its reservation: the next payment goes through |
| `agent.requested_url` | 1 | review 1: a seller that OMITS resource.url does not stop an in-scope payment: the agent judges the URL it requested |
| `agent.requested_url_present` | 1 | review 1: a payment that was not created through agent.fetch has no requested URL and is refused (resource_mismatch) |
| `agent.reserve_atomic` | 1 | B5 five concurrent payments against a budget that fits three: exactly three settle, two are refused locally with period_over_budget |
| `agent.reserve_held` | 3 | B5 five concurrent payments against a budget that fits three: exactly three settle, two are refused locally with period_over_budget |
| `agent.resource_mismatch` | 1 | F8: a seller that DECLARES an allowed resource.url while the agent asked for another URL is refused as resource_mismatch |
| `agent.scope` | 7 | refuses locally: amount over per_payment_max |
| `agent.tx_guard` | 1 | payer path guard: a signer that changes the amount is rejected, ComputeBudget-only changes are not required |
| `agent_mismatch` | 2 | scope: payer is not the agent |
| `allowance.crosscheck` | 4 | allowanceCheck: debits since the grant add up to total_cap minus what is still delegated; counts only entries up to the read slot |
| `amount_over_cap` | 12 | refuses locally: amount over per_payment_max |
| `asset_mismatch` | 3 | scope: asset differs |
| `grant.active_amount` | 1 | grant active: delegated amount 0 |
| `grant.active_delegate` | 2 | grant active: delegate replaced after the grant |
| `grant.active_owner_mint` | 1 | grant active: account of another owner |
| `grant.approve_amount` | 1 | grant: ApproveChecked amount differs from total_cap |
| `grant.approve_count` | 2 | grant: no ApproveChecked |
| `grant.approve_delegate` | 1 | grant: ApproveChecked delegate is not the agent |
| `grant.approve_mint` | 1 | grant: ApproveChecked mint is not the asset |
| `grant.approve_owner` | 1 | grant: ApproveChecked owner is not the principal |
| `grant.approve_source` | 1 | grant: ApproveChecked source is not the principal ATA |
| `grant.extra_instruction` | 5 | grant: an extra non-ComputeBudget instruction (a system transfer) |
| `grant.fee_payer` | 1 | grant: fee payer is not the principal |
| `grant.memo_count` | 2 | grant: no Memo |
| `grant.memo_text` | 6 | refuses locally: grant transaction does not match the mandate (memo) |
| `grant.no_lookup_tables` | 1 | grant: address lookup tables are refused |
| `grant.only_signer` | 1 | grant: a second signer |
| `grant.scan_failed` | 2 | F1: if the chain cannot be scanned for a superseding instruction the grant is NOT treated as current |
| `grant.scan_unreadable` | 1 | B2 the grant check of a superseded M1 does not pass while G2 is unreadable, and stays failed after the RPC recovers |
| `grant.superseded` | 15 | review 2: a approve made by CPI (meta.innerInstructions) supersedes the grant |
| `grant.superseded_inner` | 7 | review 2: a approve made by CPI (meta.innerInstructions) supersedes the grant |
| `grant.superseded_position` | 1 | B2 the earliest superseding transaction is chosen by position, not by signature string |
| `grant.tx_err` | 1 | grant: transaction failed on chain |
| `history.reconcile` | 1 | B1 reconcile: a transaction whose balance drop no parsed instruction explains makes the history incomplete and names the signature |
| `mandate_expired` | 5 | refuses locally: mandate expired |
| `mandate_not_yet_valid` | 3 | refuses locally: mandate not yet valid |
| `network_mismatch` | 2 | scope: network differs |
| `pay_to_not_allowed` | 23 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `period_over_budget` | 13 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `receipt.shape` | 1 | receipt: mandate_id set but grant_tx null is malformed |
| `receipt.signature` | 3 | R4: a tampered receipt is rejected, liable null, nothing stored, and a corrected dispute can be resubmitted |
| `resolver.after_grant` | 3 | resolve: a payment before the grant: tx_mismatch, liable null (resubmit with the mandate that was current) |
| `resolver.agent_debit` | 3 | resolve: a payment the agent did not sign (authority is the thief) is not under this mandate: tx_mismatch, liable null (not the agent operator) |
| `resolver.allowance` | 3 | resolve: the debits found do not add up to the allowance that is gone: history_incomplete, liable null |
| `resolver.chain_amount` | 2 | resolve: receipt amount differs from chain (tx_mismatch) |
| `resolver.chain_asset` | 1 | resolve: receipt asset differs from chain mint |
| `resolver.chain_pay_to` | 1 | resolve: receipt pay_to differs from the chain destination owner |
| `resolver.chain_payer` | 1 | resolve: receipt payer differs from the chain authority |
| `resolver.debit_not_x402` | 10 | resolve: two debits by the agent in one transaction cannot have gone through x402: debit_not_x402, agent operator |
| `resolver.duplicate` | 4 | a repeat dispute returns the stored verdict as duplicate_dispute and never refunds twice |
| `resolver.history_complete` | 4 | resolve: history not shown to be complete: history_incomplete, never in_scope |
| `resolver.history_found` | 1 | resolve: the disputed payment is not in the history: history_incomplete |
| `resolver.mandate_mismatch` | 2 | resolve: receipt bound to a different mandate id than the dispute carries: mandate_mismatch, liable null (the disputer does not choose the mandate) |
| `resolver.mandate_presented` | 11 | R3: out of scope with no mandate presented: agent operator liable, no refund from the seller |
| `resolver.no_receipt_judged` | 4 | resolve: no receipt and nothing out of scope on chain: invalid, principal, resource unjudged |
| `resolver.period_since_grant` | 1 | resolve: spend made before the grant (an earlier grant) is not counted against this mandate |
| `resolver.provisional` | 2 | B4 resource outside the prefix: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund |
| `resolver.provisional_needs_receipt` | 2 | B4 resource outside the prefix: the seller filing first without the receipt is provisional, and the principal's later dispute with the receipt replaces it and gets the refund |
| `resolver.receipt_tx` | 1 | resolve: receipt says another tx_sig |
| `resolver.reconcile` | 2 | resolve: the balance of the granted account fell by more than the parsed instructions explain: history_incomplete, liable null |
| `resolver.refund_decimals` | 1 | F11: the refund uses the decimals of the disputed payment (9), read from the chain |
| `resolver.refund_pending_guard` | 1 | F9: a refund signed but not confirmed is not resent while it can still land, and is adopted if it did land |
| `resolver.refund_retry` | 3 | F9: a refund that failed after the verdict was reserved is retried on the next dispute, once |
| `resolver.refund_seller_only` | 9 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `resolver.replace_binds_mandate` | 1 | B4 a verifying receipt that binds NO mandate cannot replace a provisional verdict (it must bind the same mandate) |
| `resolver.seller_visible` | 11 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `resolver.single_transfer` | 1 | resolve: one agent debit plus another TransferChecked from a different account in the same transaction cannot be judged: tx_mismatch |
| `resolver.superseded` | 3 | resolve: mandate superseded before the payment slot: mandate_superseded, liable null |
| `resource.https_only` | 2 | S8 http://example.com/ is refused |
| `resource.no_userinfo` | 1 | resource: credentials in the URL are refused even when the host matches |
| `resource.origin_exact` | 9 | resource: host-only prefix does not match api.x.com.evil.io |
| `resource.path_boundary` | 8 | refuses locally: resource outside the prefix |
| `resource_not_allowed` | 14 | refuses locally: resource outside the prefix |
| `seller.enforce` | 15 | enforce: amount over per_payment_max answers 403 and nothing settles |
| `seller.mandate_invalid` | 1 | enforce: an invalid mandate document is refused |
| `seller.observe_passes` | 3 | observe: an out-of-scope payment settles, and the receipt still records what was presented |
| `seller.off_skips` | 4 | a naive agent (localChecks off) sends the payment anyway |
| `seller.origin_required` | 1 | F5: createSellerGate refuses to start without a canonical origin |
| `seller.payment_source` | 1 | F6: a payment from another token account than the grant's source is grant_mismatch in enforce |
| `seller.payment_unreadable` | 1 | enforce: an unreadable payment transaction is refused before x402 sees it |
| `seller.receipt_binds_mandate` | 2 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.receipt_issued` | 3 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.require_mandate` | 1 | enforce with requireMandate refuses an unmandated payment |
| `seller.resource_from_origin` | 1 | F5: an agent that forges Host: <allowed origin> does not get an in-scope receipt |

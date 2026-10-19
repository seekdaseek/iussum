baseline: 155 tests, 155 pass, 0 fail
checks mutated: 53, survived (vacuous): 0

| check skipped | tests that fail | first failing test |
|---|---|---|
| `agent.attach_mandate` | 14 | an in-scope payment goes through, attaches extensions.iussum.info, and is recorded in the ledger |
| `agent.grant` | 2 | refuses locally: grant revoked (grant_inactive) |
| `agent.ledger` | 1 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.period` | 1 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.scope` | 6 | refuses locally: amount over per_payment_max |
| `agent.tx_guard` | 1 | payer path guard: a signer that changes the amount is rejected, ComputeBudget-only changes are not required |
| `agent_mismatch` | 3 | scope: payer is not the agent |
| `amount_over_cap` | 7 | refuses locally: amount over per_payment_max |
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
| `grant.extra_instruction` | 4 | grant: an extra non-ComputeBudget instruction (a system transfer) |
| `grant.fee_payer` | 1 | grant: fee payer is not the principal |
| `grant.memo_count` | 2 | grant: no Memo |
| `grant.memo_text` | 6 | refuses locally: grant transaction does not match the mandate (memo) |
| `grant.no_lookup_tables` | 1 | grant: address lookup tables are refused |
| `grant.only_signer` | 1 | grant: a second signer |
| `grant.tx_err` | 1 | grant: transaction failed on chain |
| `mandate_expired` | 5 | refuses locally: mandate expired |
| `mandate_not_yet_valid` | 3 | refuses locally: mandate not yet valid |
| `network_mismatch` | 2 | scope: network differs |
| `pay_to_not_allowed` | 16 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `period_over_budget` | 3 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `receipt.shape` | 1 | receipt: mandate_id set but grant_tx null is malformed |
| `receipt.signature` | 3 | R4: a tampered receipt is rejected, liable null, nothing stored, and a corrected dispute can be resubmitted |
| `resolver.chain_amount` | 2 | resolve: receipt amount differs from chain (tx_mismatch) |
| `resolver.chain_asset` | 1 | resolve: receipt asset differs from chain mint |
| `resolver.chain_pay_to` | 1 | resolve: receipt pay_to differs from the chain destination owner |
| `resolver.chain_payer` | 1 | resolve: receipt payer differs from the chain authority |
| `resolver.duplicate` | 1 | a repeat dispute returns the stored verdict as duplicate_dispute and never refunds twice |
| `resolver.mandate_presented` | 4 | R3: out of scope with no mandate presented: agent operator liable, no refund from the seller |
| `resolver.period_since_grant` | 1 | resolve: spend made before the grant (an earlier grant) is not counted against this mandate |
| `resolver.receipt_tx` | 1 | resolve: receipt says another tx_sig |
| `resolver.refund_seller_only` | 4 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `resolver.seller_visible` | 2 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `resolver.single_transfer` | 1 | resolve: two transfers in one transaction cannot be judged |
| `resolver.source` | 1 | resolve: payment is not out of the granted account (source differs) |
| `resource_not_allowed` | 5 | refuses locally: resource outside the prefix |
| `seller.enforce` | 13 | enforce: amount over per_payment_max answers 403 and nothing settles |
| `seller.mandate_invalid` | 1 | enforce: an invalid mandate document is refused |
| `seller.observe_passes` | 2 | observe: an out-of-scope payment settles, and the receipt still records what was presented |
| `seller.off_skips` | 2 | a naive agent (localChecks off) sends the payment anyway |
| `seller.payment_unreadable` | 1 | enforce: an unreadable payment transaction is refused before x402 sees it |
| `seller.receipt_binds_mandate` | 2 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.receipt_issued` | 3 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.require_mandate` | 1 | enforce with requireMandate refuses an unmandated payment |

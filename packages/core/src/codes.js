// Reason codes (v3 section 4 plus Addendum B).
export const R = Object.freeze({
  // tier 1, pure, from the signed artifacts
  amount_over_cap: 'amount_over_cap',
  pay_to_not_allowed: 'pay_to_not_allowed',
  resource_not_allowed: 'resource_not_allowed',
  asset_mismatch: 'asset_mismatch',
  network_mismatch: 'network_mismatch',
  mandate_not_yet_valid: 'mandate_not_yet_valid',
  mandate_expired: 'mandate_expired',
  agent_mismatch: 'agent_mismatch',
  signature_invalid: 'signature_invalid',
  // grant (Addendum B)
  grant_not_found: 'grant_not_found',
  grant_mismatch: 'grant_mismatch',
  grant_inactive: 'grant_inactive',
  // period budget (Addendum B)
  period_over_budget: 'period_over_budget',
  // chain
  tx_not_found: 'tx_not_found',
  tx_mismatch: 'tx_mismatch',
  // resolver state and evidence
  duplicate_dispute: 'duplicate_dispute',
  receipt_missing: 'receipt_missing',
  mandate_missing: 'mandate_missing',
  mandate_invalid: 'mandate_invalid',
  in_scope: 'in_scope',
  // Phase 1.1 (Addendum C)
  mandate_superseded: 'mandate_superseded',
  mandate_mismatch: 'mandate_mismatch',
  history_incomplete: 'history_incomplete',
  resource_mismatch: 'resource_mismatch',
});
// Violations a seller can see before it settles. The period budget is not among them: a seller cannot see other sellers' payments.
export const SELLER_VISIBLE = new Set([R.amount_over_cap, R.pay_to_not_allowed, R.resource_not_allowed, R.asset_mismatch, R.network_mismatch, R.mandate_not_yet_valid, R.mandate_expired, R.agent_mismatch]);

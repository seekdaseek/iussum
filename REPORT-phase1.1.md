# REPORT: iussum Phase 1.1 (2026-10-19)

Commit hashes cited below come from the private working history; see [docs/COMMITS.md](docs/COMMITS.md) for the matching public commits.

Addendum C (sha256 e12857ae…): the twelve missing checks found by the gate review. **Stopped after the gate. Nothing pushed, nothing on mainnet, Phase 2 not started.** Mutation testing proves every check that exists is load-bearing; it could not find these because they did not exist, so each fix below comes with a regression test written first and a mutation row.

## Repo

- `/Volumes/D/iussum`, branch `main`, local only. Code commit **00453bf**; this report is committed on top (see `git log -1`). Base was Phase 1 `222697b` (report `d7e6016`). All commits authored `seekdaseek <ochinimus@gmail.com>`, no trailer.
- Tests: **230 pass, 0 fail, 0 skipped** (was 155). Golden vectors 139 (was 103). Mutation: **73 checks, 0 survived** (was 53; 20 new rows). Demo: **five clean devnet runs, each 46/46 checks, exit 0, ten scenarios** (was nine); 105 signatures, all finalized.

## Regression tests for findings 1 to 5: first run on 222697b, then after the fix

`test/regression/` (21 tests) was written before any fix and run against a clean worktree of commit 222697b (`git worktree add /tmp/iussum-old 222697b`, `npm ci`, the new test files copied in, nothing else changed):

```
node --test test/regression/*.test.js         # on 222697b: docs/phase11/regression-on-222697b.txt
ℹ tests 21   ℹ pass 3   ℹ fail 18
node --test test/regression/*.test.js         # on the fixed code: docs/phase11/regression-on-fixed.txt
ℹ tests 21   ℹ pass 21  ℹ fail 0
```

The 18 failing on 222697b are exactly the regression cases; the 3 that pass on both are deliberate controls ("the agent's own payments do not supersede a grant", "a payment made before the supersession is still judged", "payment 100 at exactly the budget is in scope"). What each failure looked like on 222697b (from the saved run):

| test | on 222697b |
|---|---|
| F1 superseded (8 failing) | `M1 must not stay active: actual true, expected false`: the check returns ok for the old broader mandate after a narrower re-grant; Revoke, Approve, SetAuthority, CloseAccount after the grant are not seen; a superseding instruction 230 signatures back is not seen; the resolver judges a payment after the re-grant under M1 |
| F2 history (3 failing) | payment 101 of 260 (cumulative 101000 vs budget 100000) returns `in_scope`; a payment missing from the history window returns `in_scope`; an unreadable page is not handled |
| F3 no receipt (4 failing) | `invalid`/`receipt_missing`, liable null, for a payment the chain proves went to a seller outside the mandate |
| F4 mandate choice (1 failing) | the seller's dispute with the older mandate returns `in_scope` and is STORED; the principal's own dispute would then come back as `duplicate_dispute` |
| F5 Host (2 failing) | `createSellerGate` starts without an origin; an agent sending `Host: allowed.example` gets HTTP 200 (`expected 403, actual 200`) |

## Before and after, findings 1 to 12

| # | finding | before (222697b) | after (00453bf) | tests | mutation rows (all killed) |
|---|---|---|---|---|---|
| 1 | superseded mandates stay active | `inspectGrantActive` only checked delegate = agent and amount > 0 | a grant is current only if nothing after it changed the source account's delegation: later Approve, ApproveChecked, Revoke, SetAuthority or CloseAccount gives `grant_inactive` with `superseded by <sig>`; the agent's TransferChecked do not count; the scan paginates (`before`) and is incremental per (source, grant); a scan that cannot finish fails closed. Resolver: `mandate_superseded` (liable null, resubmittable) when the superseding slot is before the payment slot | `test/regression/f1` (10), `test/phase11` scan failure and incremental scan | `grant.superseded`, `grant.scan_failed`, `resolver.superseded` |
| 2 | history truncated, fails open | one page of 50, `until: grant_tx`; payment outside the window not flagged | `agentSpendHistory` pages with `before` until the grant or the period start, returns `{entries, complete, reason}`; the resolver returns `history_incomplete` (liable null, not stored) when completeness is not shown or the disputed payment is not in the history; never `in_scope` on a partial history | `test/regression/f2` (4), `test/phase11` pagination (3), vectors | `resolver.history_complete`, `resolver.history_found`, `agent.history_complete` |
| 3 | no receipt, nobody liable | `receipt_missing`, liable null | the chain alone is judged: violation gives `valid`, `agent_operator`; clean gives `invalid`, `principal`; `unjudged: ["resource"]` (and `"time"` without a block time); `mandate_missing` stays liable null. Demo scenario 7 expectation changed accordingly | `test/regression/f3` (4), 4 vectors | `resolver.no_receipt_judged` |
| 4 | the disputer picks the mandate | judged whatever mandate the dispute carried | a receipt binding `mandate_id` fixes it: a different dispute mandate gives `mandate_mismatch`, liable null, not stored | `test/regression/f4`, vector | `resolver.mandate_mismatch` |
| 5 | resource from the Host header | `req.protocol + req.get('host') + path` | `createSellerGate` requires a canonical `origin` and refuses to start without it; the resource is `origin + path` | `test/regression/f5` (2) | `seller.origin_required`, `seller.resource_from_origin` |
| 6 | seller ignores the payment source | not checked | payment source must equal the grant's source account: `grant_mismatch` (field `source`) in enforce, settles in observe | `test/phase11` F6 (2) | `seller.payment_source` |
| 7 | agent ledger in memory | reset on restart | rebuilt at start from paginated chain history; if completeness is not shown the agent refuses (`history_incomplete`) | `test/phase11` F7 (2) | `agent.ledger_rebuild`, `agent.history_complete` |
| 8 | agent trusts the seller's URL | used `paymentRequired.resource.url` | judges the URL it actually requested (`AsyncLocalStorage`) and refuses with `resource_mismatch` when the seller's declared URL differs | `test/phase11` F8 (a lying proxy) | `agent.resource_mismatch` |
| 9 | failed refund never retried | `refund_tx` null forever | the next dispute retries it once: a signed-but-unconfirmed attempt is recorded before broadcast, adopted if it landed, not resent for 150 s, resent after; a first-time failure returns `refund_error` instead of a 502 | `test/phase11` F9 (3) | `resolver.refund_retry`, `resolver.refund_pending_guard` |
| 10 | prefix matching by `startsWith` | `https://api.x.com` matched `https://api.x.com.evil.io/...` | parsed URLs: scheme, host, port exact (default ports and host case normalised); path prefix on a `/` boundary or exact; credentials refused; dot segments (also `%2e%2e`) resolved; mandate schema refuses prefixes with a query, credentials or no scheme | 18 resource vectors, 7 scope vectors, 3 mandate vectors | `resource.origin_exact`, `resource.path_boundary`, `resource.no_userinfo` (schema validation is covered by vectors, not by a mutation row) |
| 11 | decimals hardcoded 6 | `agent.js:40`, `refund.js:71` | agent: `extra.decimals`, else the mint account; refund: the disputed payment's own transfer decimals; `mintDecimals` refuses an unreadable mint | `test/phase11` F11 (3) | `agent.decimals`, `resolver.refund_decimals` |
| 12 | `engines >=22` | wrong (a dependency needs Node 24) | `>=24`, README and JUDGE_GUIDE say Node 24 | `test/phase11` F12 | (config) |

Not code: README sentence one now quotes only what could be read, with dates and links, in a "Sources" section (details below); the Roman-law hook stays out. The Phase 2 product note (read the current delegate before granting, show "this ends your existing allowance to X", require confirmation) is recorded; no action taken.

## What the devnet demo found that the tests could not

The first Phase 1.1 demo runs failed 3 to 9 checks (the unit suite was green): **`getSignaturesForAddress` with `until` set to a signature confirmed a moment ago fails with `Transaction <sig> not found` for about a second** on the public devnet RPC (the answering node has not indexed it), so a fresh grant failed its own "is it current" check. The fix is a bounded retry of that one error in `makeRpc` (`packages/core/src/chain.js`) plus a unit test; the repro is `probes/repro-until-lag.mjs` and its output is `+0s Transaction 3uHKELQ… not found`, then `+1s ok, 0 newer` (memo transaction `3uHKELQwwdFuCByHB4v65RXxWf8vjVQmckLs5uEAuCQyHDvKiUNtPoy1d9vHSR5rABKBUa3nFoGnXgRU6kfcXHXT`, devnet). Recorded in `docs/FEEDBACK.md`. The development runs that failed are not kept; their devnet transactions exist and are not listed.

## Mutation table (73 checks, 0 survived)

| check skipped | tests that fail | first failing test |
|---|---|---|
| `agent.attach_mandate` | 15 | an in-scope payment goes through, attaches extensions.iussum.info, and is recorded in the ledger |
| `agent.decimals` | 1 | F11: the agent builds TransferChecked with the mint's decimals (9), not a constant 6 |
| `agent.grant` | 2 | refuses locally: grant revoked (grant_inactive) |
| `agent.history_complete` | 1 | F7: if the ledger cannot be rebuilt completely the agent refuses to pay (history_incomplete) |
| `agent.ledger` | 2 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.ledger_rebuild` | 2 | F7: a restarted agent rebuilds its ledger from chain and refuses the payment that would cross the period budget |
| `agent.period` | 2 | refuses locally: its own running period spend would cross period_budget (second payment) |
| `agent.resource_mismatch` | 1 | F8: a seller that DECLARES an allowed resource.url while the agent asked for another URL is refused as resource_mismatch |
| `agent.scope` | 6 | refuses locally: amount over per_payment_max |
| `agent.tx_guard` | 1 | payer path guard: a signer that changes the amount is rejected, ComputeBudget-only changes are not required |
| `agent_mismatch` | 3 | scope: payer is not the agent |
| `amount_over_cap` | 9 | refuses locally: amount over per_payment_max |
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
| `grant.scan_failed` | 1 | F1: if the chain cannot be scanned for a superseding instruction the grant is NOT treated as current |
| `grant.superseded` | 7 | F1: after M2 is granted, M1 (broader, older) fails the grant check with superseded by <sig> |
| `grant.tx_err` | 1 | grant: transaction failed on chain |
| `mandate_expired` | 5 | refuses locally: mandate expired |
| `mandate_not_yet_valid` | 3 | refuses locally: mandate not yet valid |
| `network_mismatch` | 2 | scope: network differs |
| `pay_to_not_allowed` | 23 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `period_over_budget` | 4 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `receipt.shape` | 1 | receipt: mandate_id set but grant_tx null is malformed |
| `receipt.signature` | 3 | R4: a tampered receipt is rejected, liable null, nothing stored, and a corrected dispute can be resubmitted |
| `resolver.chain_amount` | 2 | resolve: receipt amount differs from chain (tx_mismatch) |
| `resolver.chain_asset` | 1 | resolve: receipt asset differs from chain mint |
| `resolver.chain_pay_to` | 1 | resolve: receipt pay_to differs from the chain destination owner |
| `resolver.chain_payer` | 1 | resolve: receipt payer differs from the chain authority |
| `resolver.duplicate` | 4 | a repeat dispute returns the stored verdict as duplicate_dispute and never refunds twice |
| `resolver.history_complete` | 2 | resolve: history not shown to be complete: history_incomplete, never in_scope |
| `resolver.history_found` | 2 | resolve: the disputed payment is not in the history: history_incomplete |
| `resolver.mandate_mismatch` | 2 | resolve: receipt bound to a different mandate id than the dispute carries: mandate_mismatch, liable null (the disputer does not choose the mandate) |
| `resolver.mandate_presented` | 8 | R3: out of scope with no mandate presented: agent operator liable, no refund from the seller |
| `resolver.no_receipt_judged` | 3 | resolve: no receipt and nothing out of scope on chain: invalid, principal, resource unjudged |
| `resolver.period_since_grant` | 1 | resolve: spend made before the grant (an earlier grant) is not counted against this mandate |
| `resolver.receipt_tx` | 1 | resolve: receipt says another tx_sig |
| `resolver.refund_decimals` | 1 | F11: the refund uses the decimals of the disputed payment (9), read from the chain |
| `resolver.refund_pending_guard` | 1 | F9: a refund signed but not confirmed is not resent while it can still land, and is adopted if it did land |
| `resolver.refund_retry` | 3 | F9: a refund that failed after the verdict was reserved is retried on the next dispute, once |
| `resolver.refund_seller_only` | 7 | R2: out of scope with the mandate presented: seller liable, refund paid to the principal for the full amount |
| `resolver.seller_visible` | 3 | period overrun across two sellers: the crossing payment is the agent operator's, and no seller refund is paid |
| `resolver.single_transfer` | 1 | resolve: two transfers in one transaction cannot be judged |
| `resolver.source` | 1 | resolve: payment is not out of the granted account (source differs) |
| `resolver.superseded` | 2 | resolve: mandate superseded before the payment slot: mandate_superseded, liable null |
| `resource.no_userinfo` | 1 | resource: credentials in the URL are refused even when the host matches |
| `resource.origin_exact` | 9 | resource: host-only prefix does not match api.x.com.evil.io |
| `resource.path_boundary` | 7 | refuses locally: resource outside the prefix |
| `resource_not_allowed` | 12 | refuses locally: resource outside the prefix |
| `seller.enforce` | 15 | enforce: amount over per_payment_max answers 403 and nothing settles |
| `seller.mandate_invalid` | 1 | enforce: an invalid mandate document is refused |
| `seller.observe_passes` | 3 | observe: an out-of-scope payment settles, and the receipt still records what was presented |
| `seller.off_skips` | 3 | a naive agent (localChecks off) sends the payment anyway |
| `seller.origin_required` | 1 | F5: createSellerGate refuses to start without a canonical origin |
| `seller.payment_source` | 1 | F6: a payment from another token account than the grant's source is grant_mismatch in enforce |
| `seller.payment_unreadable` | 1 | enforce: an unreadable payment transaction is refused before x402 sees it |
| `seller.receipt_binds_mandate` | 2 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.receipt_issued` | 3 | enforce: an in-scope payment settles and returns a receipt bound to the mandate and the grant |
| `seller.require_mandate` | 1 | enforce with requireMandate refuses an unmandated payment |
| `seller.resource_from_origin` | 1 | F5: an agent that forges Host: <allowed origin> does not get an in-scope receipt |

## Demo and every new devnet signature

`npm run demo:devnet`, now ten scenarios. Scenario 7 (control) and the new scenario 10 changed or are new; the rest keep their Phase 1 meaning. Scenario 10: a narrower re-grant M2 supersedes the broader M1 (the second `approveChecked` replaces the first); a request carrying M1 is refused `grant_inactive: superseded by <M2 grant>`; M2 is accepted; an observe-mode seller settles a payment outside M2; a dispute carrying the older M1 is rejected `mandate_mismatch`; the principal's dispute with M2 is judged, seller liable, refunded. Five clean runs from fresh processes: `demo-runs-1.1/run-1.txt` to `run-5.txt`, each `46/46 checks passed`, exit code 0 (the Phase 1 runs stay in `demo-runs/`).

**105 signatures, all `finalized`: 55 grants, 35 payments, 10 refunds, 5 revokes** (`demo-runs-1.1/signatures.md`, checked with getSignatureStatuses). The last two grants of each run (the 10th and 11th) are scenario 10's; a payment refused (403) or failed (402) has no signature.

| run | scenario | kind | status | signature |
|---|---|---|---|---|
| 1 | 1 | grant | finalized | `5E7WnN1dGWBFXR6bzB3swC9PKPuvGbJ734kMrFhCfXNZDM1hhuJFTPFX8Z6VRonVW3VTEb2gf1uAyG4YsumpBqQG` |
| 1 | 1 | payment | finalized | `3ZN4Ptzr4LVZUhpTYaQGTZfJCwzTZHLtsQEpgHWXoS2sGsjy8XctkWFBogKXJeZq1uXKZ3kN8w3uPKjoTZxAmUQv` |
| 1 | 2 | grant | finalized | `4QBfuzwTfne9jtz9mXmX5WDSfqQjbvkUHWNsLkbLVYEcVZaKwgRaHrCbti76SNsoc166gRwG2ru4ENcAg3mYqV67` |
| 1 | 3 | grant | finalized | `JhKcDQVZhhSCY4pDed1eUFTYwv9M8g577wSZ2sF7gWAcqbEbun8UVGvPcwDn2N8Gf3r2x1qQm9RFjufwix8RGhA` |
| 1 | 3 | payment | finalized | `2dmpcixMXwU5aLurV7a1Koxi9AgieF7c3uKjQHE3R1YN324AQJbYzC1xz5XsBYexkfUbju2ggtFeG718JLWFaVfS` |
| 1 | 3 | refund | finalized | `5pV9pd2HVUgMMfcTem98n1qKw2jqMj3CTziwg5uCnKViouhoAoqhqyEcAiDrCEWacpZPcWh3HWZupUcXtcbioim8` |
| 1 | 4 | grant | finalized | `4H8eN5Jed4kvNo1XCv21yAUdCiKr5U2HMdggSeFBZrQ1RqZ6WU1umwrH6iJLGLjhVZPbrG58HejoAxwEhgCarVpN` |
| 1 | 4 | payment | finalized | `34DMcRmKXQvY4Vw5B24C5Dt35SB6UpC5rZEPqX7tuMEgzqyzRfZjbJrUKcc1hx1tWZdRQVZpzCgUQRJNEFRLxrBS` |
| 1 | 5 | grant | finalized | `4BS2ppiFUnh1FcBckqxFyNaiLbPQSdChWeTUTo6BSLk3FW9WrbmPUJj4PScBpLNPRGA3y2E8BiAGCFHJRoypAiBo` |
| 1 | 6 | grant | finalized | `Ep2NDauE55caZ3GSz1ySmpvgvZvSyomfvmSzvy7E95syZRyQ3Uo9AMyY1qr9zzo93FT92Romkz83G7tdw1dN6dW` |
| 1 | 6 | revoke | finalized | `5gEg2FVRHGxQvFbsKFwxaoA21PUu4CZU8S7JtWdyduiYKQCvhZKWHXP52o9gWHo9K4Eee3NJ7tpGVcMSprSkk7Zk` |
| 1 | 7 | grant | finalized | `xV97kFt4TxFGNqnPPVsqhUCfboVKALaa6zprsPrPGs6S6Xf3Bg9PTtfPDSEJYFhBD9P38ezsuxHYfy4pAxPCHjC` |
| 1 | 7 | payment | finalized | `4W2DYPFf14SheUBiJLEKEZ65NZYZAD7D1rVk1Mq6fLQgV944Ki6R4fTRwLvdXP5H4NdoZ6XjTS3Z72TzzpATZS17` |
| 1 | 9 | grant | finalized | `3aXhFcUGeKrLWUMi4Sn2pGCoYXivNcjKzWUJtGfwMUj3rBB5mbBoJGQ5sRxvTiiQPGR51ZKh8jLWsNb6YeuirtsH` |
| 1 | 9 | payment | finalized | `n6PW7KHKpouHjYrDd2z1SaRjPnFHEdi476f5L1mpGbZz6BQPEh38TQXDLwYcefh6oVxQvv4d7RcTsC2xx5yoXsC` |
| 1 | 9 | payment | finalized | `3z1LALyKa73nHkoZXLCXSGsXaK2nv63ARPYBEmMtevGmbNmRYNX1CmZ63Ckdrc5cnmoeGNr4t1U17xyqsGejc5iv` |
| 1 | 9 | grant | finalized | `2RYZs79XpiRo3rBH5gPG3NhHqWpfCdu3Uk3TuxHfhoM2sHQRUvKhK8KMwLtfoif5ot1pV9VYZrqsh8WpSadDSTc` |
| 1 | 10 | grant | finalized | `niQk5QwurMS4r4s3ZKLoc6yECinLbrLxgDfcXLoXPZdZe7Fdex9jcp6Gypo5k5jjrkzxvFyYdaTdmbhms42Fak5` |
| 1 | 10 | grant | finalized | `k7SGAPfE6gdjznrrBUUmtZh5S6Zh1uFDwBqx358ARDrc33B74xNySahA8tVuLZYTSX9Xwugm9N36BWLewqJxnmF` |
| 1 | 10 | payment | finalized | `4shAc2iuGnmEBYoQJKkKpeU27Gmp7TPmHXs4ZRVotXAUkF7whT867KrtUHQd6RobnXLcq27rYpDcR6k7dMc2Te4f` |
| 1 | 10 | refund | finalized | `5FVff1K2GSGvvB4pwC2qwRv4HErQqV3DSJmJSNsW7S4omfYLERxnL7qfJnNF8mJYuu1tnDmXv6FnXQK7pJ6sbSvq` |
| 2 | 1 | grant | finalized | `3hDJaCZnpfddRhNY3KKR44ZYFojnJf8eF7LEPd7KM5nwWUhvj4GoYUKr4dT4zCa396LiXp15gJrFHmaVBKJnNtRw` |
| 2 | 1 | payment | finalized | `4MXYjrf5YBEULhhGeGV2k3qEf41KQMyVMa5nLuzBtNhnG8iB26QfHtqJ98F729KHv1P22BmxjdCyyWx3qQuDms5y` |
| 2 | 2 | grant | finalized | `2B1AfMha3Pr2J3xvv33iXFRE6MiHRAx1V7hz1UQAVkH4VW9xFypP2dEfA6Rg3HBxjx7ENF5ZZ46kZ6KYB1FR8ea4` |
| 2 | 3 | grant | finalized | `2xS7neqHkCLeQTtJ611sq7h1vDG63ptwp9iTGqA6EikA1JYXNyvrbwpt3K6g7zZVDpMSfQah8PxS4qgzq1JYWuCb` |
| 2 | 3 | payment | finalized | `2BeT6fpdkEfcSMKKAsLFWzciRfZ4ani5FoPrezRT1oE8BkJhGc4MC1FCy73Bv3DUPEeDornEDBN9pupXawb7Y5PB` |
| 2 | 3 | refund | finalized | `3PK5mAQrp1g5RWe1GioYYz2JEiA4iqcqzAoAU17fkFLMtbVpTSqcLgnCqULvVG1BTSVEqMQkJHPKbmhBU4xF17Ck` |
| 2 | 4 | grant | finalized | `3Wg9VQRZFe16MsMiEaiYey8kKqduvnC8x6Y6nQ3tWt4G4dX6AdvGNv4uPcaJfoY6QSE9KkUxgVBDqSpkDJRbxasW` |
| 2 | 4 | payment | finalized | `4cd5ibR6X5BnxTb9v3Bgpbeg7vuUuYXsVQNPN3iSycy5RQCamk47B2GTZg5Ap2BrDVZEG1oxS82YdX1dbM7wPQKm` |
| 2 | 5 | grant | finalized | `5ynmcehG4ycYzZWLgCCj8qgb6QNe6D6hpWEKeKshLqT7JZdpMf11Bwaajy2veh79iCZWsaGSK4dDs2ijUyfBC3cu` |
| 2 | 6 | grant | finalized | `2Z1vRENNEmz9aGitJQzNPgYqBLhd7aDskJS5A6y6R1ALCatM1iZohsnqgJRHUFCkUAKH4TZzSjnwNMovTYkCdr6P` |
| 2 | 6 | revoke | finalized | `2qRJzb8PUeZt5Zz8GNvrdnRBwP3qTGs9JLnGZTo6Z1YaLxtEUf4oYfZ47umQzHxbNsZXLgLXBxADForc3NoD6GiM` |
| 2 | 7 | grant | finalized | `UP2yGiWtJZxWwb6HMhDFLH6KDsp3g4noMqtkUAaxXqfGSxqSb99QxB2tF7DJUwLRjpsmXub1oNPTN4BybcCBa8n` |
| 2 | 7 | payment | finalized | `nAkbJ7gpBBqMmbr8opwcpKH2z8VP8dwmeAgi9A2wMwbjq6tA3X23ah2cL1Yre5vVsoNi2ZcMxjaB8yTud8w811t` |
| 2 | 9 | grant | finalized | `5FWt7Rqeb1LCBuozFrTRpJjgRRsjDMmR7tT6S7yXmLqAFXfyPk2J9NxvdXXU4T9K4dZ8WVGUHXfdwtBGPLN4mhd` |
| 2 | 9 | payment | finalized | `2ZRJxvXxEVQuwdpWodaYSquRBVtMhTnZfypAeDMc2ZgUwismWTtzci8Sz1FP9JabGxcB2kwtXtNBuRA58FXXFRJ5` |
| 2 | 9 | payment | finalized | `4zk1iW8bgtKAmfeQF7YgfUg5WY4tVwoAQupYNCsDCSo8tAiRVQwQVXniZoVe8wzCBpuFLdSxsiFQp6Nc7djpKtyf` |
| 2 | 9 | grant | finalized | `4h57mhsHPSDbstL5ofdJ3R1noBCgWh9XArQEYS43ufEU6rAHWBdRtcHxL1hQa8QgiuxGhEStvzjjtJyYMb8aN8Hx` |
| 2 | 10 | grant | finalized | `2uXU9mXehoVHoDvrDGfzQfK3kidz2t9wrKEuNtpbFvHGnYCzdQhrAgfBQbZ4vVR52HBuE8dA7zg9Uj8Mj71zmfpU` |
| 2 | 10 | grant | finalized | `3LA2WS9zXweLZVPjdC1aSbyJNiqwPp5pxCe4sBmA3VooZ4SkfyKS24RBWjf9AJh7rjPQkikCu2e8GZ6PR8PXZm39` |
| 2 | 10 | payment | finalized | `3UNnHF1ywt1p7jNr9KyAmvaX5eyYaGdwNv4XTrksqxdywNBouFwXUMiW1iYzuBFuQ6VvkXw3C8yUDbgdrqwJTSrE` |
| 2 | 10 | refund | finalized | `471phS4MX2jkDdqkSSt7K75ePiCKDvF1BmaTCth79Ey2HjwMnwrSir7idjYpzdAPgG6jfYtTCWh2SndhFmeTckfj` |
| 3 | 1 | grant | finalized | `4RnVsfXi1wo3WMK7NDVyp2kcP1iYXueKV3ZNfUwjm4gY8Puhxmseh2VmtpKeMy1mUUWeJePDjt9gJRgjNLYoE4ET` |
| 3 | 1 | payment | finalized | `zVDmHoQSkZ2C2V4dPi6k7JviHxy4tHEVya63T63uyNsUjNHfC3QdV88jNFJL9uUEJ3TzxeRF8iDno3vYxj8jFeq` |
| 3 | 2 | grant | finalized | `4wWrLAP8CkD1v5RBDP1eo9BbFFMogAVqxtvKBWwU7CYjgmgsfcwZ3F14qB56UnzWBHaoXP3amk5qJ9JdZh2GpJ4B` |
| 3 | 3 | grant | finalized | `41C6rhMagFUBwX54zeC6fsSdAdqoKa4rQXXni8ujyfDgRR9qV3GFQrUa46NqXWz6UdTUaqH1zNyH51QpKh1TNW19` |
| 3 | 3 | payment | finalized | `3WETwpVDgQkvAMDZtmvGoV1hHgk5MZhGFHgTL82XNme88TZAkTXTYUhnB5oiq4qtGGxXbkyE8UZCWETQ8zkjqzrf` |
| 3 | 3 | refund | finalized | `4Ferg2KPSZnysZnbTsGYNsi4LStrk2pGALVMnjaHRmTFcW6xMoZtfUd42WbEksvy4guSZoqd5MB6tBSZbcqvqxSR` |
| 3 | 4 | grant | finalized | `2pJp3KHCMsbxr5omp2ioNndi1yHp5kKXXKWo6sw28m1GC24UFFuoUTzw7csWwBBhkfBt5MiBNWyUAWqhsETwchmJ` |
| 3 | 4 | payment | finalized | `28KEBoL8BqjEb85T9Uqm6aD7t8EDR5P7oaGgsMHdmzJhKR3Txo6vbgsAFeo8NqEdqzoR4528GxA31pTawPEcpvii` |
| 3 | 5 | grant | finalized | `4r7rAJk8f4PxEAvqSN7aJKBqRbPrFsCiceJoLebhgejMEoxA24Eznqt6d5xzKEHenUyPAo66dQtZYwmoZRXL5zLn` |
| 3 | 6 | grant | finalized | `5wt45kW64ZHFBdJz9B2YLUZ4UFamBZoTaZd7up6RPnVithhgz8F43Y3XZJuAZ8nojdJDGY5xTzpPBdfbrk2Q5kJs` |
| 3 | 6 | revoke | finalized | `5qzVzdEa1EBC2nYP9STUMx96auCZNqLVDKfrVKhr8phjTaLiEqD1oH4eM6StzhoMnPhJisQRNVkxNEMtQ9cXat7S` |
| 3 | 7 | grant | finalized | `2BmteA3PxUsTKoWB8kBN5M1x5Er7N1crdjCza2PtTvTC3RgQaLjSteZ2f7BQNkTMwQiuSfZaYmHafpDUdpca7hff` |
| 3 | 7 | payment | finalized | `4EXNFvPuZmA6ivYmaGNWmfyLQudGS4yjUQokhHz34GL8HCrNfPZ3UzKSohxg9R27SySwcHDCSaR3uKVaH6s1M1VJ` |
| 3 | 9 | grant | finalized | `2LuBS55obufGp4G66ZmaViLJUrBRVqyHKsTsDaZUhWeU2sLLHJaLAvoiWTEfPw3wM9XK4DeqVovSnakM5FoH5xLQ` |
| 3 | 9 | payment | finalized | `2w38C41TEQEgLJSb72AgGsPiuALkZLa1VaFtpmWPbEUpAm4AC4wxiQYg34u7jq4YATVU8J2ASWUkhEuahfjUEf1r` |
| 3 | 9 | payment | finalized | `4TA8pkTqGwQnUMd7Hfi6q7aF8z9sqJiBYsKUgD8hppE3jYwpPmfv4WQNGupEwDZYiHFzM3GGjtNyw698ez7PFFEK` |
| 3 | 9 | grant | finalized | `2Kk3dyiW8FgMFaTxrvRYwnRu7AcGn1mwc48qMYZ7X6wgsUJa91uL3h2Ne4tCdQ4dYNmJZS1nW1pW4w2Lgs8mXkvo` |
| 3 | 10 | grant | finalized | `4NS9ktyT8do9KY52gDP2hkHjf4q7eGbc1619bGmwZHDRCaL1teeyKgxKNcAvBfh81qPHDAxk2tfjSZ1tpzFhgeju` |
| 3 | 10 | grant | finalized | `VgUMHKfY4UvVvG35NCgy29D4ScNpKRKJnT9L1VMk9cADxyPtD1gJkBqLSbhqK1JHAHgU8NHVxftFsBy91MNqBrx` |
| 3 | 10 | payment | finalized | `3yrGMvRoo16R6GjZizFmxb2E7hvQKVzHbCujfnKMGrywtJuzKHHM4JWfHUjfbTZwXuSjtBQu7w7eu4SbpFvhLwE` |
| 3 | 10 | refund | finalized | `6ts3MSCpWrHquK1o3Pk9U1xbj2svBotTqRdxccfDy2A3YsBYJQms2Kfaom4Nfiyn3z4vjiTmKu2Ph8oooKnRvdc` |
| 4 | 1 | grant | finalized | `5GhjpHASoz6bWF2gvyYQsm2mQnZkg6pKqaGxLYYEirRihJ4QzkSLKXLyWiWXqpsKVBLzWHZq2hoMm6d6auG24bDZ` |
| 4 | 1 | payment | finalized | `22m9jHnyVa2osNwCeBmyonq2ijDjXARYdkYBNRyEjDBS3aBr4QvVGjMRetSBm8u4oADw3PAv2cLnDPdmzWS2hiGg` |
| 4 | 2 | grant | finalized | `5avG5uoqr22dzeMFsEkDHxiE3NFaksPyPwkQ2fY2kMYirXXqQ7GYDbgZEW3DqEoJxbweZZFMcxaZyX6bsQ1WBgwu` |
| 4 | 3 | grant | finalized | `2JLw817Wdhgsk5BoYfwhyAErmD7X3UitVGvPdvdah4ntveQRHpjNhthtAwcAEMz5qDGQ7wzRwVsMcYuFFSXfx1PM` |
| 4 | 3 | payment | finalized | `22AGAxj63gLJREYy5oUY6L4StL81cxnWp7pd4mXemjnXKiDPXvRLi1re6H2tPuLiCc2bVNARZomwdayMY9d1Bf63` |
| 4 | 3 | refund | finalized | `bZVadCVYUTHBx1m8sY7PZuWwveoBBAYL6NJddbvbnBfevKiAwbvCwxcqsqbG7VBsk16cgY72RKRLn9c24o6THBd` |
| 4 | 4 | grant | finalized | `duW6dCxAeBBZ8NTR89hD5LefCXWYBzgJDebmiTp4Gzspq2hvJQGXsAQFnHFPBUhE4yWyTpA284DPfYiaqnWWp36` |
| 4 | 4 | payment | finalized | `3wCyS6zWEKVEbn9BjPzVGBt8Xcdjqj6CWLWFs87HJhrpo1N2hsHZhEWDubumkMJ7kyjUZGb3hiJ1DjD1BbemJvj4` |
| 4 | 5 | grant | finalized | `2H7XyttdMggGSyjAuFsyM5tkd66Ee9pKGSYrvJquC1JCF3vZ3BgdmzZ1GugneTN8zy9MsAESDKy7GK7ogbq4QzFC` |
| 4 | 6 | grant | finalized | `4gAGDVepiRTtTMRRtPyKzEuvxEq2BmV5KNfVHLpxKkYPMnoadTuiLSKnkfCPj4ReBTYR4WvgqAefxiB9GDcAaeDA` |
| 4 | 6 | revoke | finalized | `5jidJo4QpNvu2WALPtrFc6tBPofNgXiRd5krnavCiGhMNUxp6oATuqqrRrhokui9My9u8samF8R5moAmsfefuHMd` |
| 4 | 7 | grant | finalized | `4b99X7twtjVP6i9LRSxe7yJQu39JCqFYW8WuWbuu18PpMr2NXxSWGNH9NygicbhRo7L8zL41J6SYBhWVS5WTAzdq` |
| 4 | 7 | payment | finalized | `2o5cBgxh6mNB55N2z1PwR8VkpsfrJcHi3rJpLXoNHz9P325Z4ChxYLjUTQ4mBLWdPKFHz7HuAydzwLCXYHje4Y1i` |
| 4 | 9 | grant | finalized | `5FE6k8bRNR1JaVN7RfiunEjA7rmFcZG3BTfQQ2g8mdZdYdBhz79gdHjjdnpQavR2xUXkWXn7B6p6esMiykv8trfy` |
| 4 | 9 | payment | finalized | `5NDFFiX29r1WUFiGvUeXQnzGZyYfhFmHisd2w4T4caUZsqHERPVeRQyEvmCh98DJmpsbbkrc7i5EQj8cP8Nzctc7` |
| 4 | 9 | payment | finalized | `HMghSUqRjGNLmPfMN1ShK7Ktwif4VL5XVjmwwDS7iET6DhRtxmst1wQt1rEh6W3DnzFuYyNoWdAGCuoEkuoTyww` |
| 4 | 9 | grant | finalized | `3yRU7YexWSkdKGi436kuS2KkpEHkxwhEXa9poCMkFRgqPwEWKXZENX62BQaNS3CsNiTzXDu9VzYF44wK7Pp1UYB` |
| 4 | 10 | grant | finalized | `2qSW4JkADxqdCyoeAZ9edLno93hqt9XZhXTQp74fo5WrLBB9oQpnWLwZ2ysY5o2yKF34e64ZR2qmJURpsL5hX6Dt` |
| 4 | 10 | grant | finalized | `LYB19C5CMytUWaCNj3u95EvqptpzGUz2xBFjfctn9MNHti5kpeiLSFAx1oW25gEu6SEbbqE6hZtHNN1D19R54Zx` |
| 4 | 10 | payment | finalized | `3qBRg4fzchvtbDAarrHNoVA1pf5ry6xES37afzHv4Fiq4JA8SFq6ndW8Ct9rBxkDSoBipoK8BMixm2893BgcuAaR` |
| 4 | 10 | refund | finalized | `5QTs8SP8pbDscLwbWS1wEVyxrYxBBmMePMs7zJ5voEgTzEZjzYCPHTCVsvwRgdPuQomZzLHopGmc7yzdTedHHktp` |
| 5 | 1 | grant | finalized | `3k1xu3zKgSTx3Wcm49WchuRQQLzhdAhuT1LH2heapoGAqBepyXympgpp1Pe2tbxsoFDZamTBkm4LeeM7Cj5EvMCh` |
| 5 | 1 | payment | finalized | `3B4D764PfzkutRAhuuqCxPxhZRraZWniM9Q35UMSTTNgaBG1PmuDG76tKxN3sio8A1E14orAPeL4MYJuNynUk3Ct` |
| 5 | 2 | grant | finalized | `3yA4wPmmKoToSjGf1TcKTQEGkhAtvZSwxEGLg7WnXL13mwnCezhHPfP9axYHPCBCwqmsnX79wgXjdWginGfx4nDL` |
| 5 | 3 | grant | finalized | `4U2dfEHv8EcgJEh2RAh9oLuMX7SHisctyJZzhFf5xxJiqn7i1WPN2t5EHHW7XiSuHap1bBMHc6hqEwoaBAvSLMnb` |
| 5 | 3 | payment | finalized | `2nc9eNJ4aZxjRAwTpEWQqHthLN44ZD5DTwUCXjD5sDBFM1kCARdy58nPWt7BGZnWHMMjgoUBpKq5WQdLJLVK1pCA` |
| 5 | 3 | refund | finalized | `5nXNaUUF8p1acR2QrkqbzzzsATu4UPxYnPZc8xAYMdWm7QA3HgLryACJpA2nDjDXekyEiEXfk3XzwPZV96Biv46V` |
| 5 | 4 | grant | finalized | `3EWtAUutdkJ8v9GzHnPjTPtmAtpePVXzc6rA7x1PnJTKu5rouzJB4Lhz4z61k8z4JrJeEcEbjekkmDbiCkEM1jxD` |
| 5 | 4 | payment | finalized | `2G1khVS5oqLALKjXsntR9umEYoPaEGA3ymPP636XAE1peK797XYue591mAte2G8Wc4JHQVUPNcTEGyHXwszKnxqX` |
| 5 | 5 | grant | finalized | `3GQHkZpS1tY5kiqwk173D3JgqfedRjBTZPBCGz16bjWWxv3t7zaXHk42KRQjsopVWgA9qoCw7x6CwfsT7Q9zY9Wv` |
| 5 | 6 | grant | finalized | `31oEEjs7ANXMj6oWEGwBjgXQ5z2g6PAEssnr9okpSNzPSkK4Sxb2LWQjKMnHmb89L9t2P9LmPh1LN576jnLUJohG` |
| 5 | 6 | revoke | finalized | `579ypPyDKDv3nmqx7KcftoQL8UPPtn5c27LYWfQdeL5b8cooUMxNofZkXZ9tTyWcWPSUUd4u7yUYQL4JmHfmGE2e` |
| 5 | 7 | grant | finalized | `2oG8HDHTnx99gb8tdjuFCEYj1mUT8655wKEz7Mm46bSdfUtVkz2FE4y3suy24PWKYkVPR2xs4zxekfsaMuXHQgvt` |
| 5 | 7 | payment | finalized | `45SHmeGACcXtyJwVfcGbFYPRN2cF2Myff3oQYQMXwhJb6UK3LdqJgycqEtE7bFxCPDwxbp1zQbpTuDhG3kJcreaW` |
| 5 | 9 | grant | finalized | `41Bhxo2ukmtRxVF7P64rAhkKbC4SgrA87Qz2HNNTeooHMEqDfK273xqLfmced35ttNCUHc1visCSqZ23mybTJk7S` |
| 5 | 9 | payment | finalized | `3iuRAtButR11tKEh19PPzokce6TUrBuWciV16MkRXCw233Ur1LGCjjdTpix3yQuWcY4HnsDzCemp3SxTyPa4TWaM` |
| 5 | 9 | payment | finalized | `5EwAxAtcG2QGdyrQd5Fbr7R6eh3XHeETTGEoKvY8yHMrRqYpiLUKiqZ98azP8mYjWVqddbUvqRwJUzHJo38sYt9x` |
| 5 | 9 | grant | finalized | `EggGYAw6F1nF956FbiG97Hjf2oJjszfRAsA71oGggJYqFqpREXMftDMficYRGB1ZSJAk2CTe9agXqAsZEJQj39P` |
| 5 | 10 | grant | finalized | `oydrNDCwFRiAdKs6TZuPnDwCAjQ1WNdE8YWYVB3zYodeJchX332ehFU422dem1fhik8ZfLsuCwtUFjQxZmMUkM1` |
| 5 | 10 | grant | finalized | `3EGXvzUbnhB1zG25WigjFyBAYADyr3C4kUB2Ur2VAwTy957aGooPtvZyaZCQe6rfyGKcvQJGNZ8UFddtMqGnkFct` |
| 5 | 10 | payment | finalized | `5KEwHsQFoEpHKT7L4V3kHCPJjpKeYynJsyjdpH1ViAfk8y8Wb5e4e2x233ZnWNJWAffvLPaWocMWBoDYS9YcHCa` |
| 5 | 10 | refund | finalized | `4TG47VrKVQDLZgzJsJqTfDFtRpM86h1iiMGYqjcG8xJYSHwmRmyDbsiwDL9xXZEhQDtB6F2TTZRv7U2WqhNjhCBs` |

## UNTESTED, with the test that would prove it

| UNTESTED | test |
|---|---|
| Live pagination: every devnet period in the demos has fewer than 100 signatures since the grant, so `getSignaturesForAddress` with `before` was exercised only against the in-memory chain, not the real RPC | send more than 100 agent payments after one grant, then dispute the 101st (needs a keyed RPC; the public one rate limits) |
| The refund retry and the pending guard live: no refund failed in the demo, so both paths are unit-tested only | make the refund executor fail once (kill the RPC mid-run) on devnet |
| Supersession by instructions this scan does not read: a delegate change via CPI from another program, Token-2022, or a multisig authority; two instructions in the same slot as the payment (a mandate superseded in the payment's own slot is judged normally: strict `<`) | read inner instructions and `getBlock` ordering |
| `extra.decimals` precedence in x402 requirements (the agent prefers it; only the mint-account path is tested) | a facilitator that returns `extra.decimals` |
| `origin` behind a reverse proxy or TLS terminator (tested directly only; the operator must configure the public origin) | deploy behind nginx and compare |
| A grant signed on the Seeker through an iussum app (the recorded video run), and Seed Vault's two appended ComputeBudget instructions on a v0.2 grant | the Phase 2 run; the grant check must accept it |
| `node scripts/demo-setup.mjs --fund`; the demo against the x402.org facilitator; mainnet; third-party sellers | as in the Phase 1 report |
| The README quotes: read through a page-summarising fetch tool, Meta's primary page only in Russian, Instinct's six-month limb only via two secondary posts | a person re-checks the quotes in a browser before the README is public |
| Everything in the Phase 1 UNTESTED table that is not listed here (clock skew, `offer_hash` check, challenge nonce, Digest text for the Roman hook) | unchanged |

## README sources, as verified (details in README "Sources")

Meta Muse, https://muse.ai/terms, "Muse Supplemental User Agreement", last updated 8 Sep 2026: "all risk of financial loss", solely responsible for limits and safeguards, irreversible transactions, and the greater of $250 or the previous twelve months' payments: confirmed on the primary page, which was only available in Russian (English wording from vr.org, 30 Sep 2026). Instinct, https://instinct.com/terms, revised 26 Aug 2026: "binding on you as if entered into directly by you" and "the greater of one hundred dollars" confirmed on the primary page; the six-month limb is from two secondary posts only, and the README says so. Meta's help page counterweight (Muse asks approval before a purchase) is noted.

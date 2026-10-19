# REPORT: iussum Phase 1 (2026-10-19)

Phase 1 per v3 section 6 as changed by Addendum B (sha256 d67c2456…). **Stopped at the Phase 1 gate. Phase 2, Phase 3 and everything on mainnet have not been started.** Devnet and localnet only; no mainnet transaction, deploy or publish.

## Repo

- path `/Volumes/D/iussum`, branch `main`, local only (no remote, nothing pushed). Code commit: **222697b**. This report is committed on top of it (its hash is in `git log -1`).
- every commit authored `seekdaseek <ochinimus@gmail.com>`, no Co-Authored-By or AI trailer (checked on each commit message).
- the packages: `packages/core`, `packages/seller`, `packages/agent`, `apps/resolver` (plus the Phase 0 `apps/seeker-probe`). Plain ESM JavaScript, not TypeScript (a deviation, chosen for speed; no type checking exists).

## Tests and the mutation table

**155 tests, 155 pass, 0 fail, 0 skipped** (`npm test`, no network, 1 second): core 112, seller 19, agent 13, resolver 11. Golden vectors: 103 (jcs 4, mandate 9, scope 14, grant 22, active 6, receipt 7, resolve 35, period 6) in `test/vectors/` (expectations written by hand; includes a recorded real devnet `getTransaction` for `tx_mismatch`).

**Mutation check: 53 checks, each skipped one at a time, 0 survived** (every one makes at least one test fail). Two survived the first run and were killed with new tests (`resolver.duplicate`, `seller.payment_unreadable`); the baseline of the final run is 155/155 green. Mechanism: `fails(name, condition)` in `packages/core/src/guard.js`; a skipped check never reports a violation. Full table (also in `TESTS.md` and `mutation-table.md`):

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

## Grant-check table (Addendum B)

One function, `inspectGrantTx` plus `inspectGrantActive` in `packages/core/src/grant.js`, used by the agent (before signing), the seller (before settling, cached by grant_tx) and the resolver (at the payment's own slot, without the live check). Live evidence: every one of the 45 grants in the five demo runs printed `PASS grant check on the real chain: true`.

| check | requires | reason code | vector | tests that fail when it is skipped |
|---|---|---|---|---|
| `grant.tx_err` | the grant transaction landed with err null | `grant_mismatch` | grant: transaction failed on chain | 1 |
| `grant.fee_payer` | the principal is the fee payer | `grant_mismatch` | grant: fee payer is not the principal | 1 |
| `grant.only_signer` | the principal is the ONLY signer | `grant_mismatch` | grant: a second signer | 1 |
| `grant.no_lookup_tables` | no address lookup tables (accounts cannot be hidden) | `grant_mismatch` | grant: address lookup tables are refused | 1 |
| `grant.extra_instruction` | every instruction is ApproveChecked, one Memo or ComputeBudget; nothing else (a system transfer, a token drain) | `grant_mismatch` | grant: an extra non-ComputeBudget instruction; extra token Transfer; v0.1 memo | 4 |
| `grant.approve_count` | exactly one ApproveChecked | `grant_mismatch` | grant: no ApproveChecked; two ApproveChecked | 2 |
| `grant.approve_owner` | ApproveChecked owner = principal | `grant_mismatch` | grant: ApproveChecked owner is not the principal | 1 |
| `grant.approve_delegate` | ApproveChecked delegate = agent | `grant_mismatch` | grant: ApproveChecked delegate is not the agent | 1 |
| `grant.approve_mint` | ApproveChecked mint = asset | `grant_mismatch` | grant: ApproveChecked mint is not the asset | 1 |
| `grant.approve_amount` | ApproveChecked amount = total_cap | `grant_mismatch` | grant: ApproveChecked amount differs from total_cap | 1 |
| `grant.approve_source` | ApproveChecked source = the principal ATA for the asset | `grant_mismatch` | grant: ApproveChecked source is not the principal ATA | 1 |
| `grant.memo_count` | exactly one Memo | `grant_mismatch` | grant: no Memo; two Memo instructions | 2 |
| `grant.memo_text` | the Memo equals the summary line rebuilt from the mandate, byte for byte, ending in the full 64-hex id | `grant_mismatch` | grant: memo one byte off; other mandate id; tampered mandate | 6 |
| `grant.active_owner_mint` | the source account is still the principal's account for the asset | `grant_inactive` | grant active: account of another owner | 1 |
| `grant.active_delegate` | the account's CURRENT delegate is still the agent | `grant_inactive` | grant active: delegate replaced after the grant; delegate cleared | 2 |
| `grant.active_amount` | the delegated amount is above 0 | `grant_inactive` | grant active: delegated amount 0 | 1 |

Also covered: `grant_not_found` (the transaction does not exist, or no grant_tx was given): vector `grant: transaction not found`, seller test `an unknown grant_tx is grant_not_found`, resolver vector `R4 grant transaction not found`.

## The five demo runs and every devnet signature

`npm run demo:devnet` (nine scenarios, real payai facilitator, real devnet USDC, the throw-away principal, no phone). Five clean runs, each a fresh process with a fresh resolver store and fresh mandates (`scripts/demo-5x.sh`): **`demo-runs/run-1.txt` to `run-5.txt`, each `39/39 checks passed`, exit code 0** (about 40 s each). Scenarios: 1 in scope (R1); 2 over the cap (agent refuses locally; seller 403 and balances unchanged on chain); 3 observe-mode seller settles out of scope (R2, seller liable, refund paid and checked on chain); 4 no mandate (R3, agent operator); 5 tampered receipt (R4, liable null); 6 revoke (403 grant_inactive; without the seller check the facilitator fails the payment; a diligent agent refuses locally); 7 CONTROL payer-side caps only (the resolver returns receipt_missing and prints the missing evidence); 8 repeat dispute (duplicate_dispute, no second refund); 9 period overrun across two sellers (period_over_budget, agent operator) plus 9b a diligent agent that refuses the crossing payment.

Not in the run outputs because they do not exist: payments the sellers refused (403) or the facilitator failed (402) have no signature. The 9b payment (0.02 USDC to seller A) is not printed by the script, so it is not listed.

Devnet housekeeping, first step of Phase 1: the throw-away principal's USDC account had the Subscriptions authority as SPL delegate (G0.4 stage b). The first `ApproveChecked` of the demo replaced it, **which ended the old Subscriptions grant** (the delegation PDA is left on chain, unusable); logged in the private working log. Final state read from devnet after the five runs: delegate = the agent `4ZUJeT13…`, delegated 980000. Setup transaction (token accounts for seller2, seller3, refund float; 0.5 USDC and 0.02 SOL to the float): `4Qsu3vCeWBSeUdwmDRAz5Edm9tfkKZMM2uDARPJfSUmoAGXeBBRnfeneEYtgcVat4b7oXRxiJmKRV9fGwBSKPhSC`.

**85 signatures, all `finalized` (checked with getSignatureStatuses): 45 grants, 30 payments, 5 refunds, 5 revokes.**

| run | scenario | kind | status | signature |
|---|---|---|---|---|
| 1 | 1 | grant | finalized | `4iBq6TpLKwGkAzTEX2iojcznJet9r1nBNJsDtojjJnfhwBQrC8JviKkgMaWHoT4GVFkaHWS7U4drQzEtSxSe5z22` |
| 1 | 1 | payment | finalized | `2AVuExNtXmgCMNqhQDtKTa7od2ksh3eLeHQdcnQRHu6S5DcAbSCMxBTiM591LmRAwGJZc3nGtcaSjr87wcrvtGFS` |
| 1 | 2 | grant | finalized | `2qPJ9aYTXCHiLq4GyyXFbRaADRdiZoZfQGNX28xqjitDPfbrysJWDFLChnWmDYMCAetbkvvym6ozi2jVaPWvbYz8` |
| 1 | 3 | grant | finalized | `5qrLdYYtXe9SnMgJRwXgTsH7RSYEm5gb2K7H7UgzfGis2c2rzxZcFWQkiMSMwUo2uCntErkYBG9vq6sCdt7eg3g2` |
| 1 | 3 | payment | finalized | `3sCQLLikWkCS1pMSTTavbHyeq2spD29M135HeHsEzeoDw2aRBbAWV3NdGookn2xLza1HC9M1FUQeiGfuEeevJgHM` |
| 1 | 3 | refund | finalized | `5Nwa4qYxQV3GuQf6RLE5kiQ9HyfJQefNAuF86r7UJZHNuii8bLLqsJAjmYNPWASsEd1fNKxsgLQsF2nwojfhKjt1` |
| 1 | 4 | grant | finalized | `3GAcSiVtyHQQQ91DkdXzBZe8uiZQPSEXLLvzXLFHGQEwXiGJqhkzAoDXLowoXLBthWbD3Zb7gT324tAuV41wyRWx` |
| 1 | 4 | payment | finalized | `2ZsRtbJAkqAVYzBcMmZPNGW91NXiVyVCqeaggbFDa4cMUTYZdeKjg5ZV9UCC3wei5ucmcMPxpksxdeSQuhwBw6Vp` |
| 1 | 5 | grant | finalized | `3h4uQM87ABKHeKH1oE8MoW5BEFByckdCX5xnB2jrq93itAKMB4PsQhsGhKQHQxUeLNzDfVzGGMQBuLddRNDPCaRW` |
| 1 | 6 | grant | finalized | `5MHVo4j8ABLaNpjEhvcxEZmPcJqKkSpEro8XkYWxffn4vK3FgG2VBPK7n86kUNcrKHhoXs5T4cJvNa7QCLCdPpMD` |
| 1 | 6 | revoke | finalized | `4DGCSnzaQKnRS6DknjhY7PSEZqTPHw3b86qSryfPcFHFuFsANN3rpJYZ4BBir9t8vQAB1o7sWq5csLuuzxCUHodH` |
| 1 | 7 | grant | finalized | `4cm9gVGRmwic5PCtrynn3apdACFSuRcrAU1oqY8bPG5eUCetUWuxEP7diVT2S1Ue9caACHfeiXBSa7PaCS21CsJ7` |
| 1 | 7 | payment | finalized | `5QYFWxwpe2DgiAjfzsD4GuTeos2Wr5QbL2XN9gVuXBPrabZjrxwk1STXwNHzELH3hzVsNXm9uFgypDmxnFgQGRsi` |
| 1 | 9 | grant | finalized | `31ddN684yN2D9UVB6wvBquTUbYwjPKWguj83MCBb4Kidsmr35j1Vy2uG7WdaGFVeh6ELGX5v6hF91WPqACTunCHM` |
| 1 | 9 | payment | finalized | `3oKZzgWzNH6EddoFjJ9TFidD3oEe3nQTPmjZ1XdZnyJien1oHH5SPoDrpLp9AzZjZx4ugkND9csTt5QBKotvF5Gq` |
| 1 | 9 | payment | finalized | `2BARdp8uwKdD2Qvsha8uTVbXNEpupeBkdfkcU8AzCkBVAjMSGkmGFt7BeW1XQBRRVhE2bQnnfbyoA5oKPDNFsR94` |
| 1 | 9 | grant | finalized | `5RW25P5ua85v8cMmHRxzpawaMHiGtZEAQj6NVGfMMDy87R7zuHk5Fm4psWGTKxM1jvTq1tDcs1p8DtsoAzkTR7d4` |
| 2 | 1 | grant | finalized | `2TRzwEBkzhGXEAgF2nR7x56i1R4x4hrkdjSk3Xm2CLdmh6fz7uuLU53GCvqbJjjdWnYFhhWmZMwoXxUyWjZ2TFXe` |
| 2 | 1 | payment | finalized | `2CgzRjPjiPaMiko66HKBczeMAWhU4SuyEVa98DnpthFkwXkawqb7ZjZq7EnEnnSJm97yWmvgti5QMCF7fSYhJS4K` |
| 2 | 2 | grant | finalized | `2nUXwkt3fyi7h8VAAgQVUTGsW7gGYFLSwzBXKbM2JGSbcgdfMxwWFJ9RBafc2jC3kHebRcaeEzFRRDUrrSBzj1JK` |
| 2 | 3 | grant | finalized | `1kYtACcgCXz85sMP2kkfAwfbDnYockhU54WM6wZnLUttTv77yotqWLwPQZw6qik1ZSpnZirCbwYK4qMzNynvmTX` |
| 2 | 3 | payment | finalized | `43U9N9j3GY5npfKk1p8TM1rWkgniv1kDiFa1teztdCQB1RUPQFRiQP8wFN4tybZg6tK4UbtjpCGwmfRGSMbYsV7y` |
| 2 | 3 | refund | finalized | `2iGv28N6LFsBTDUJTEi71kcH6Q6gX3tjN6BMWrLejsnADkRLxVLtLDEPE7T6aqsUyQrACE4W9YyU5U3dtnhajo1h` |
| 2 | 4 | grant | finalized | `5mYWvPi9EQiYAzLL2scDHmEsLhPPKrPQuf3KuiwSjPHWnYpJvNmHhAoy4qxVnDANXm8qjQt28YfZ47dYjpxfTkwo` |
| 2 | 4 | payment | finalized | `35hbUc93iwQ56z6HdZBGkvvtEBh28oV7TES77kwFLLGZpF7psdUPw7FLQYsfsvVFh6hVAMxUK5BZHR2W8BYgTtzD` |
| 2 | 5 | grant | finalized | `5osuuk4hZyJxDW7pyjsN3WxwD7Mbu8dS3ekHgUhJtHe9R6cS3JEyfaAVV692FFRbmtTXfqm5heikEaLX6ugjemaM` |
| 2 | 6 | grant | finalized | `5fATUH6u6HVGZmFjLCfqqbQkuNWciz7PNJx2NQdFuJKcKwZj9jDFnfnzPbcJQJb4Lj7tn1ynB3gNyb81Lr2M61Rm` |
| 2 | 6 | revoke | finalized | `2gbFyWFu6uT7gzFcDuKubyA6pU9H7aV8DDxrxn6RScJP9Ete7huD9bs8D4abhFbj5AxBY1QWzFbdf8eEHKJYgdHu` |
| 2 | 7 | grant | finalized | `4tDpVfViVxtAffKWETsANptDVpw1jtamGb8bsUvTDWZjUBkkxRmStRuZYHY1dZcyqBojCXmfn5UnrD7ocwvWHuUe` |
| 2 | 7 | payment | finalized | `4pqmJpW9Q5TyZmuTrcjzBtE4UjV7LCX1i3JQ47fZeYfEoHRnh19Qk1FpXuNhVeyQ2LjZXC7X6gE1cAXnnfRMSRiy` |
| 2 | 9 | grant | finalized | `5Py1TBobx4165rU5DFqbh2ibCJHpB754S5cveZMTHz3i9zs3UDW3i25EA7RKLsEtCaNa5d58nSzAKxpxwib3TPUi` |
| 2 | 9 | payment | finalized | `2PbVfnNSpb556VGzC1ugBS7GKP7vhehoFVyYRUGdwV8cGfcFcMJBDWv9LGxFRsUfLw339VefU3EAA3kbBDXPDsTa` |
| 2 | 9 | payment | finalized | `4HFUBWGTFAmM1gi3nW4uW4NGM2QtDj3bHBnquCRqUR3c4UC2pD8tMRdcBn3U1oV7utB5sDWRbySjWvaVKcxjhrrF` |
| 2 | 9 | grant | finalized | `2J4puzC5KUBxhsnU4LeEtW1QHV2N8JD41syr1rcCFwYkiRL7rSjneUowrbVAefLuw37URnNstX7wpu9MfAcPw1cp` |
| 3 | 1 | grant | finalized | `RQy7uuAfz5C8JeaVhN1iDt7PLr3ZsB1b8zFwbkCUHoDVtMrpYZAogBFRjui172uM9d1KRWgEf9Ju4rXQqpcoSnD` |
| 3 | 1 | payment | finalized | `3xveCWW3YEDjQ54PMG1pG6HCaNmdSyFDqTmhcrka28hLDP2YMWTeicQbQkRYCLdK1EwfnFCe7n4NeyvuDFyjT7TW` |
| 3 | 2 | grant | finalized | `5S28cNbzsJVAzRw8DJUSvciQaGJ3RsPtvjL9DMi2JgFzbuT4KcdqmbPWcf88jAg8AZS5wy65hFpNrEFrKqHJeRX6` |
| 3 | 3 | grant | finalized | `3ho17pgFWMeG46vPUXtAb3FACG3QK1oix7LukecautfFnCZpdk5CKgzCUeCripizRR2zhVN26ohnNk3PDQ3nedi` |
| 3 | 3 | payment | finalized | `5sKQrdQPJb7fxnDNm7kumHPE6SJy9geXT93noRMhojPFQbk4jzX1mYJLS8fjtvHJX5CxDFcrMHrY9N5znm6YkGWP` |
| 3 | 3 | refund | finalized | `4vBHTSrg1aszYNsq8vmPiX6hnu4TKxpNg3AbFUVa3ThvktHe8yizBzBTmB45Qpj9hYrcqfxvJSwFDj2TMok8nega` |
| 3 | 4 | grant | finalized | `3JLRKjusaf9HGEwkQWqv6LiaLdXUaUgX6dr51rwkK4vbSFFEMFcJ1w3LGhmtiAebyBuKtiX24FKoMGw44v5rPhS4` |
| 3 | 4 | payment | finalized | `tpgR6iHwG29GYH2T8aVp37c1uZMAruX4HbdbN6wAeF4hUUwYG1aFjYGScXui5Dmg3odRVwgLCfSh3E5GH81Ht7a` |
| 3 | 5 | grant | finalized | `4kd2pPfuuU2dDFSuZ14bn4Wb8ZRDVxRj2CuVzHScEdqtA17yJJ3UnAojyZnEUoq2bzA8NaKjkrTFbXkYqsovkqs` |
| 3 | 6 | grant | finalized | `3gUSZeKktT2w7bASUSf42d2wEtFoZzLaCwcxrYVcHtf21hEmwX6srzyJdqrY2VbMQGrHTvFSvznKeGWFXKrmUYaL` |
| 3 | 6 | revoke | finalized | `5RagPSwkBYUvPnLqb74hjEMNQCg7fkAB6dkQUpQKnRikoGrJRbvKhXUdRkdB8S2DnnFzkHwWUie4Y9M63ubth8s1` |
| 3 | 7 | grant | finalized | `2kb5ZiS71jvVqXLeAyYo8vR6BC2bZxkcSgh4qzFYWT3rDcJEFDrqCEmktjonNVx3tKZewndy27F2eZvrpBr5YgkV` |
| 3 | 7 | payment | finalized | `3MeeY8k6av6MAhXEu5DdqpBFgZgzzj747Mk883GgHHSNhomgvWY8CwshzE1zYDLEvDyGWuW1D13W56rjF7gDFwRq` |
| 3 | 9 | grant | finalized | `J7Cs77fxgUAjswhozEiWKPXcyx2KbbARyqEX9i9NRqFnN3vQ5FeK6kz4rJGK27rqtw5eRENzMgSy84C2hhbVi2F` |
| 3 | 9 | payment | finalized | `3erRGjBpFtgDEVcR4aaocpTU4J5NeHEc6Con8UCpG12HziPmWxjRqKowRoCJBRPgsnkVaT5xzRcLPTGtzcXB3vMc` |
| 3 | 9 | payment | finalized | `2iwj3a2umeDY1bqzdAqfDGwmgzYsaCYhZs562qp5ATSVYKL6hPjBesAqU6jWDMQqCfQx1hjcJvEQTAFB6QHdLeL7` |
| 3 | 9 | grant | finalized | `4NojAzf96iurR27Aw9LJysuc4PevFJfrjKMGYUibPVAWmur2ZFydm3xNgnYtJ3zLQ8JCGBR4z1wzaaMSQ1QKF8J7` |
| 4 | 1 | grant | finalized | `kNt4ki3qUhcFusraR3khUibmv9QAeVKPnWzKCyQbhrG3xppzHyMnKmvrtTt1uAqSvvH2Y2znCdUKQcRyau9uT9o` |
| 4 | 1 | payment | finalized | `RYL4vHnPv4SG9w6174iaAMQVVBgp5JWa2uqRL24spP1ze7akRWno4c2MxvsNjyUEEgC8Aiw5AX6NeKX7coEBNmz` |
| 4 | 2 | grant | finalized | `2Pb5gTrkRszirPDCgkAK8kFLyZkYVB2FPz71ZoQ9BWKK6JWbcJqMcbcCVRvMv6PESqXKhkwdHxWknAP9dhoQi4Z` |
| 4 | 3 | grant | finalized | `4rciSiTRUVJbJpcFius8iPyf7QTC4A9awtaQ9FA9D5b34JGqnbF8g97C43QSPpQ5BQnLZZRZo54HMd5a33GQ5u8k` |
| 4 | 3 | payment | finalized | `3zZZ1LeqDFzc5decuycmfcSe1L4uCGDBbdqYsD5yjExhPrZ9z38aavQkQXErUTsyzYHiFEN8U4FWtRV79qopocAv` |
| 4 | 3 | refund | finalized | `FNBBLNAXUhjwpe6X3kVNDrMm6T4Wek6hWNbsXzxoWZpceosZb1hQPSWYHqNnqHxyvhHHTxM4DD8jbW6xnUNZZac` |
| 4 | 4 | grant | finalized | `5jBMY3iWgi9vFw3pJkseFJMUjN4d7kpSSVXNuHbHvWNTbbh1gVjUGwDyTYD6GQYt95s9qRrpWqhtJdu2BLB9heci` |
| 4 | 4 | payment | finalized | `BtsUxYFskXrKk9Qi6rgU2DB7jhYMNVmqWK8hCdV8fcb8s34h7fZ89qm6pnWd81PsDe3QkTK4yeFQa163drzgV8y` |
| 4 | 5 | grant | finalized | `5B7DQiTH51K6yz7MVzViyvFv2fhWy2twUgsU7KbA2MewL2bx1EWe4xonFtRLQHTV9cxFX4yCLTAk6CXQ8WSHh26T` |
| 4 | 6 | grant | finalized | `3cV6ExbiL4W7fXSQmVjWhRsdomxcprXUvmo3SLipAatsV2i3cHGLzGJFPaskCFR2E6hebcq62jXS6XDALYYVMaNU` |
| 4 | 6 | revoke | finalized | `364oTsECmizaH9j5LiRtuWQ3vkCPJLAzp4kZ142HnQygioNSMcT1eDJHq5veUYVJyKNhPwXpaCk1c7SqCPttkRg9` |
| 4 | 7 | grant | finalized | `2qtaHKVVsyKYrEs6F17H6ynaRUyjjifJiPnrs88KksSUq3hZ5w2XV45rv7SxARcXxxFwJcZKDgHkasdJtdnZdRZZ` |
| 4 | 7 | payment | finalized | `z2crhABW8FtHQoujDt3tpFbjMgCbE3A9tSij2vnq35igPbGHwQqum2oe74DF2G5gU2m8kuLNN7kRfAmYgRtSWjW` |
| 4 | 9 | grant | finalized | `4hMDuEpVprmte7r2jSdLKwBVxfhgSAy5RKuHvP3KY1BfH6ZxhyKcV1K2YeNavfRKSqTMDX18AC6FRPmVztnj7bhy` |
| 4 | 9 | payment | finalized | `43ytWQg89cw9MG1RohhP2Z4VWJdpdZMN4wUpfyQAdSYDySHb3c7F7G8559Nudsog1FVT3fVLy1DDKJcK6bgXM3s5` |
| 4 | 9 | payment | finalized | `3ZUbYoqri1VXniSffsrFznmzsmzjW8XQn8ZjjGRrHbZpgkZ9fpbYkKjwQr99irX2DcuZX5C2EFDykYjKqurUJKjB` |
| 4 | 9 | grant | finalized | `KMChxSthvCmuPJEp1EgnG9JDBva6XfHxFYQkrLANSgDG3JSqsuqnGdvCHWbXKEKegeRJ7rtV26ehfVLGD4ztKW7` |
| 5 | 1 | grant | finalized | `61h7Fk4gUPVkH3GRuDAzewZUJByLbCMGwFMSC7JbKKJKgt3vDrEkEGPELZQJRCAUpMu47JTrZqsgfJrbz97uk9ti` |
| 5 | 1 | payment | finalized | `5TXZRi6KsMDcvCH2ou4j575NQoTifpRRdAq7mtMnV7ESKhytP26fadtihaXuuNkV6z9cNA3RNQW3Y8cff7nmcjdV` |
| 5 | 2 | grant | finalized | `2ZW328ZSXJHvC9oYxAQmFzVGg8Gc35Sv44vnAL3HhjJDPu7qbRLvarVG12KZNqUptssbSoi6sNVtJvHLq5YnhXVC` |
| 5 | 3 | grant | finalized | `4cJmrw6e45eAdbk5r9sogF5Cftg6GDnj8V8vMWLWGqEonWMig5Px7H3swggS9dRokPnzEUkHfPb9F5d5aWcaAJ3X` |
| 5 | 3 | payment | finalized | `41NLg4F5PE7VaQTgLwRB7ED6uvSQxBNZ4urQdEXTt1GSwe7YPfFNh95RwDCxCzFBKBMDsDtbzNpFBxQZnJsx3vNQ` |
| 5 | 3 | refund | finalized | `296n7N8ZhfifCHuwAqUjyLdkyHLLT7Hs2bbfg7Z5cZ5uMksVxQJ9rZxJbDJfPR3PKPHETGyuisDz2RUF3XabgjX1` |
| 5 | 4 | grant | finalized | `4JzZEEHhSL1pwrhhNeqhwsB2hNGVkjhsbc9pZYDmpbF5aBGt7rKfyMKecnU5wEabxbeutQfY37TeMcyDPvnGkKC2` |
| 5 | 4 | payment | finalized | `2QYFCwKoteZXyKv89ZS3T1LoQoSUCubAFXZZLyBJ7h1432oxpEZqBcmcCbsXw9BKaAP46aAQoy6PKXWPEGrNSBRS` |
| 5 | 5 | grant | finalized | `3vuzmVvPSaDrRvUpRh6r5uAfe9EqwSQEAbhD35vHbPZxGzEh66xuoC86y6efmEozr2DZYSiwF7za6aDz86uc4Q4x` |
| 5 | 6 | grant | finalized | `JKsiFm8zPrbDJ3dfQbxfMVkjKbiwi5Pb7tPqmVnn9xX4TPxu5uKScPsnVJ87kK8zzbvoQx7FaBBwtKzmY4UT6gW` |
| 5 | 6 | revoke | finalized | `2JJqmm7oqgdYy3tkwQvRYgiGEMPS1cPiaLu5TSjaiDy9iBQVumofeQFQ5oSwKUozfXL53rXoy1P2GAd4QPNgUfgQ` |
| 5 | 7 | grant | finalized | `4R7Pb8XJt4mzMkNaMu9H6FLVjjow72e1CQ9sgNGcarHHT7YEdCott6NAdTuE8m5zEBJpaoTVQ158CFhB8ZRMW4ZT` |
| 5 | 7 | payment | finalized | `42cMNr5FpDHaXRxSzpMBCDNGbGpqVys1S73iuQWxNLGAAKDCBSvL4oNTFkg7VWKiqgDTrQ23UmpBszEAi4ZLVRXD` |
| 5 | 9 | grant | finalized | `2Fop2dAC1HkniHMqmYhzjonJYviTZ46kCh4Dz5RoeXpEZVUEhYcX2XS1LVstV3yHbRJASpa8yhzsBzonbfbZ67fL` |
| 5 | 9 | payment | finalized | `ak8akDMUbsvaBygr4yu5TJzigb26GwE9d4zoL4waL2Xtdq29A8mWptnnKrRCenDmMKpsSCA7iNLX899dtCKs3dC` |
| 5 | 9 | payment | finalized | `3nBwuMQqFnTdxvLwFULxLyEYiqYpKE7qTVdiT2k5EVTAMGhNKQTszjkUwR3yEFVv3c1zskJZ2URhBQK8dyjYRDsQ` |
| 5 | 9 | grant | finalized | `4XEayLieivmQ4itUp8MvCavvH3L5GZN2KtVeZbzsJt1dD9DPaqhrx182ycQByytGKzAVmGUiwJVdL3oXbz7tZJsc` |

## G0.5 verdict line (from Phase 0, unchanged)

VERDICT: Don't build the merchant track now - the identification signal does not exist in Shopify's docs, the only built-for-agent-orders app (FLINT Sentry, free tier) already occupies it with zero reviews so demand is unproven, Shopify's liability stance is silent (generic: merchant pays), the core "high-risk flag" premise is unverified; revisit if Shopify ships a documented agent marker on orders or FLINT Sentry reaches real review volume.

## Changes from the brief, and judgement calls

- **Carriage** `extensions.iussum = { info: { mandate, grant_tx } }`, as decided. **The 403** comes from `packages/seller` mounted ahead of `paymentMiddleware`.
- **Scenario 6** is split: the seller answers 403 `grant_inactive` (enforce), and with the iussum check off the facilitator fails the same payment (402, `invalid_exact_svm_transaction_simulation_failed`). **Scenario 7 control** uses an agent with an amount cap and a period budget but no allow-lists, no grant check and no mandate attached, against a seller with the check off: fair, not a strawman. **9b** was added.
- **Resolver semantics I had to choose** (v3 left them open): verdict `valid` means the dispute is upheld, `invalid` with liable `principal` means in scope; liable null covers artifacts that do not verify AND missing evidence (`receipt_missing`, `mandate_missing`); a rejected dispute is not stored and may be resubmitted, a decided one is stored and repeats return `duplicate_dispute`; period spend counts only the agent's payments after the grant transaction (found when scenario 9 flagged payment 1 in the first full run: earlier grants' payments were counted; fixed and covered by a vector and a mutation check); periods are anchored at `not_before`; the resolver pins each seller's receipt key from its `/.well-known/iussum.json` at start (trust on first use for the demo).
- **Refund** is paid by the resolver from a refund-float wallet on a seller-liable verdict, a demo stand-in for the seller's own refund key.
- **Storage** uses `node:sqlite` (experimental in Node 24), only hashes and verdicts.
- **README** states the Muse and Instinct terms as cited in the brief and says it did not re-read them; it does **not** include the Roman-law hook, because the Digest text (D.15.4.1.1 and whether the same fragment keeps restrictions in force) was not checked, as v3 requires before it goes in.
- **Change 3** is followed: the README says the wallet showed the token and the cap and that every other limit must be shown by the app, and says in bold not to read it as the wallet displaying the limits.
- **The first full demo run** failed 2 of 39 checks (the resolver walked the whole history of the account and hit public-devnet rate limits; period spend counted payments from earlier grants). Both were fixed in code before the five clean runs; those two runs are not kept.

## UNTESTED, with the test that would prove it

| UNTESTED | test |
|---|---|
| A grant signed on the Seeker by natX through an iussum app (the recorded video run); Seed Vault's two appended ComputeBudget instructions on a v0.2 grant | run the grant flow on the Seeker; the grant check must accept it (a vector with synthetic ComputeBudget instructions passes, the real T1 only fails on the old memo) |
| `node scripts/demo-setup.mjs --fund` (key creation was tested in a temp directory; the funding transaction was not, the author's keys were funded by earlier scripts) | run it with fresh keys and faucet funds |
| The full demo against the x402.org facilitator | `FACILITATOR=https://x402.org/facilitator npm run demo:devnet` |
| Period spend with more than 50 payments since the grant (history is capped at 50 signatures, no pagination); two payments in one slot (ordered by signature, not by true position) | a run with >50 payments; a same-slot test via getBlock |
| Clock skew between seller, agent and chain (the window uses the seller clock at settle time and the block time in disputes) | a test with skewed clocks |
| Reorg or non-finalized grants (the checks read at `confirmed`) | repeat at `finalized` and compare |
| Mainnet, any real money, third-party sellers adopting the middleware, a seller key registry other than the demo's trust on first use | out of Phase 1 |
| `offer_hash` is signed into receipts but not verified by the resolver | add a resolver check against the facilitator's accepted requirements |
| Replay of a mandate plus grant_tx to other resources of an allowed seller is allowed by design; there is no server challenge nonce (x402 PR #3376 has one) | decide in Phase 2 whether a challenge is wanted |
| Whether a release-signed app with a Digital Asset Links file removes Seed Vault's domain warning and the "I trust this site" toggle | Phase 2 |
| The Digest text for the README hook | read D.15.4.1.1 |
| Concurrency beyond two simultaneous disputes; RPC failure paths other than retry on 429 and 5xx | load and fault tests |

Docs written or updated in Phase 1: `README.md`, `JUDGE_GUIDE.md`, `TESTS.md`, `docs/FEEDBACK.md` (new). Phase 0 docs kept: `TWINS.md`, `docs/X402-SURFACE.md`, `docs/SEED-VAULT.md`, `docs/ALLOWANCE.md`.

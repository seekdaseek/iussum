# ALLOWANCE — gate G0.4 (2026-10-19, narrowed by Addendum A)

Question: can an x402 payment settle through a facilitator when the payer authority is a delegate (agent), not the token owner? Addendum A: do not re-prove grant / pull / over-cap / revoke on the Subscriptions program (nuntius did, on mainnet); settle ONE x402 payment with the Subscriptions delegatee as payer authority, reading the facilitator SVM verify source first; run ApproveChecked on a token account that has no Subscriptions authority and record the one-delegate conflict.

## Result in four lines

1. **SPL ApproveChecked delegate as x402 payer authority: passes** the real `@x402/svm` 2.28.0 facilitator `verify` and `settle` (localnet), AND settled on devnet through both live facilitators (payai and x402.org, 2026-10-19, signatures in the Live section). Over-cap and post-revoke payments fail at verify (localnet).
2. **Subscriptions delegatee as payer authority: cannot pass a default facilitator.** `verify` returns `invalid_exact_svm_payload_no_transfer_instruction`, and with the smart-wallet path on, `..._smart_wallet_program_not_allowed: De1egAFM…`. It passes and settles only if the facilitator OPERATOR adds `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44` to `smartWalletAllowedPrograms` (localnet proof). Live, both payai and x402.org refused it with `invalid_exact_svm_smart_wallet_program_not_allowed: De1egAFM…` (Live section).
3. **The payer the facilitator reports is neither the principal nor the agent for the Subscriptions path**: it is the Subscription Authority PDA (the inner `TransferChecked` authority). For the SPL-delegate path it is the agent.
4. **One delegate per token account.** Subscriptions grant displaces an agent's SPL delegate; an SPL `ApproveChecked` to the agent displaces the Subscriptions authority. The design picks one path per token account.

## Facilitator source, read first (file:line in `/tmp/x402-probe/node_modules/@x402/svm/dist/cjs/exact/facilitator/index.js`, v2.28.0)

- Static path `verifyStaticPath` `:1364`. Needs 3 to 7 instructions (`:1366`), compute limit at index 0 and price at index 1, and the pay instruction at index 2 to be a Token or Token-2022 program instruction (`:1393-1398`) with data[0] = 12 (TransferChecked) (`:1402-1405`). Anything else returns `ErrNoTransferInstruction` (`invalid_exact_svm_payload_no_transfer_instruction`).
- It checks the transfer's authority only against the facilitator's own signer addresses (`:1423-1428`). It never compares the authority with the owner of the source token account, so a delegate signing a TransferChecked passes statically; the chain decides at simulation. That is why path (a) works.
- Fallback: `LAYOUT_RECOVERABLE_REASONS` `:799` includes `ErrNoTransferInstruction`. `:1305` enters the smart-wallet path only if `options.enableSmartWalletVerification`. The allowed top-level programs default to `DEFAULT_SMART_WALLET_ALLOWED_PROGRAMS` (`:782-796`: Squads v4, Squads Smart Account, Swig x2, SPL Governance, Metaplex Core, Lighthouse), unless the operator passes `smartWalletAllowedPrograms`. A top-level program outside the list returns `ErrSmartWalletProgramNotAllowed` (`:1323`). `De1egAFM…` is not in the default list.
- The smart-wallet path simulates the transaction and takes the payer from the inner `TransferChecked` authority (`:440-486` extraction, `:639-644` result). For a Subscriptions pull that authority is the Subscription Authority PDA, not the delegatee.
- Live capability flags (fetched 2026-10-19): `https://x402.org/facilitator/supported` shows `extra.features.smartWalletSupported: true` on the devnet kind, so that operator turned the smart-wallet path ON; its allow-list is not visible. `https://facilitator.payai.network/supported` shows no such flag. Neither state is evidence about `De1egAFM…`.

## Localnet run through the real facilitator code

`/Volumes/D/iussum/probes/g04-local-facilitator.mjs` (full output in `probes/g04-local-results.json`). Setup: `solana-test-validator` with the program built at nuntius's pinned commit (`~/.cache/nuntius-localnet/subscriptions-364a419.so`, sha256 `a709955eb76e810b…`), a fresh 6-decimals mint, owner / agent / seller / facilitator keys, `ExactSvmScheme` from `@x402/svm@2.28.0` calling `verify` and `settle` against the local RPC. These are LOCALNET results and signatures: they are not on any explorer.

| step | observed |
|---|---|
| a1 `ApproveChecked` 1.000000 USDC to agent | landed; account `delegate = agent`, `delegatedAmount = 1000000` |
| a2 `verify`: agent-signed TransferChecked from the owner's account, 0.01 | `isValid true`, `payer = agent` |
| a3 `settle` | `success true`, seller balance +10000 |
| a4 `verify` over cap (2.0 vs 0.99 left) | `isValid false`, `invalid_exact_svm_transaction_simulation_failed` |
| a5 `Revoke`, a6 `verify` again | `isValid false`, `..._simulation_failed` |
| c1 Subscriptions grant (init authority + recurring delegation, one signer: owner) | landed |
| c2 account delegate after the grant | **authority PDA, `delegatedAmount = 12000000`** (nuntius lowers it to the lifetime cap); agent's SPL delegation is gone |
| c3 `verify` of the agent's SPL-delegate transfer | `isValid false`, `..._simulation_failed` |
| b1 `verify` of a Subscriptions pull, default options | `isValid false`, `invalid_exact_svm_payload_no_transfer_instruction` |
| b2 same, `enableSmartWalletVerification` | `isValid false`, `invalid_exact_svm_smart_wallet_program_not_allowed: De1egAFM…` |
| b3 same, `smartWalletAllowedPrograms: [De1egAFM…]` | `isValid true`, `payer = Subscription Authority PDA` (equals the PDA from c2), not the agent |
| b4 `settle`, same options | `success true`, seller balance +10000 |
| d1 `ApproveChecked` to the agent after the Subscriptions grant | landed; delegate = agent again |
| d3 `verify` of a Subscriptions pull after d1 | `isValid false`, `smart_wallet_simulation_failed … Custom 4` (SPL `OwnerMismatch`): the authority PDA is no longer the delegate |

Details that cost a rerun: the pull needs `unitLimit` above the static 20,000 (it used `ProgramFailedToComplete` at 20,000, passed at 100,000; the smart-wallet cap is 400,000 by default); the pay transaction has to include the memo like the stock client does.

## Consequences for the design

- **Pick one path per token account.** A user who holds an agent SPL delegation and a Subscriptions mandate on the same USDC account cannot have both (rows c2, d2).
- **Path A (SPL delegate) works with today's stock facilitators on the evidence so far but has no on-chain period budget or per-payment cap**: only `delegatedAmount`. `per_payment_max` and `period_budget` from the mandate would be enforced by the seller check and the agent wrapper, with the on-chain amount as the loss ceiling. Revocation = SPL `Revoke`.
- **Path B (Subscriptions) gives period budget, expiry and revoke on chain, but needs the facilitator operator to allow-list the program**, and the receipt `payer` is the Subscription Authority PDA. `agent_mismatch` (payer vs `mandate.agent`) must be redefined for this path: compare against the delegatee of the pull instruction (readable from the settled transaction), or map PDA to principal via the PDA seeds `["SubscriptionAuthority", user, mint]`. This is a Phase 1 decision.
- iussum could run its own facilitator for the demo and allow-list `De1egAFM…`; that proves nothing about third-party sellers.

## Prior evidence (nuntius, mainnet, Subscriptions program `De1egAFM…avR44`; NOT re-run here)

From `/Volumes/D/nuntius/JUDGE_GUIDE.md` §1 (2026-09-22, real USDC, signed by Seed Vault on a Seeker; cap 10,000 base units per 60 s period). Read, not verified on chain by me. Each link and the one thing it proves:

| step | explorer | proves |
|---|---|---|
| `initSubscriptionAuthority` | https://explorer.solana.com/tx/bBNbUgwhwFAmb8GM7L9AwJJjcn8UFCymrHaajLXS9R4uTTxvNUwKGVSNkj5A8EAmVuRW2PJBzjrBCuZUqGS2Sks | user is the only signer |
| `createRecurringDelegation` | https://explorer.solana.com/tx/5r7YnGrbRCPb74W1t1p1xDzMtaTPL47orLsbGmpiMgAkmwbEfU9MKW7hGpZP4mcwv1cFLAXTq8pGWNsFUGinugMw | per-period amount and period are in the instruction data |
| pull of 2x the cap | https://explorer.solana.com/tx/3RpcCkkLmwq5wT4moE1TQrXpnjRn36kWgmtRah9Y6kZuo3n5bVYdWTvnov4zQMXEr3vcS15pbE7jJENPmaZpWyR7 | failed `0x190`, refusal on the ledger |
| one base unit after the cap was used | https://explorer.solana.com/tx/5ryxPMPjNXzYCGtA9yQ6ZGG2enVmXjyN9PnotF9x1h7N9MqZjS5Kk9K1YQsh4661Hn7xNPhn1N6pcoQ1TKAjsDpd | failed `0x190` |
| `revokeDelegation` | https://explorer.solana.com/tx/Vh2yr9VTe8YeqcGqffuVZEa26ZicoJP3FV5k8y4FYNXtECCEXu6bvbWZ6u8XuRXWP6XSp5hxUpq1X97TYmsb1wT | delegation account closes |
| `revokeSubscriptionAuthority` | https://explorer.solana.com/tx/2doDFNXUxvBcstNJJDwjWCyrEGMLEugQAUeXTth4eCJnsXHb3S89s17Jtr34Raxg25vwQF1MGTC5cMFjgVsij9Y8 | token account delegate cleared |
| pull after revocation | https://explorer.solana.com/tx/cfESoUjxbXF341RwzBtqyuBMAZ7rwA6mhbJCqQ1fqs91Gc48eFd5yzqLfT2vnazxJwB2JL7WcuSqzEzTtM5GPzm | failed, delegation gone |

`/Volumes/D/nuntius/evidence/proof-run.json` (2026-10-06, mainnet): grant `RZb3AT53P7i6GKvQNR4BDN3eeSYPUCpGTnRDU9PRoK3zmeBipg2uXUS5Xsu6a5GyEwnAXBVzudD3jscWcs5T5tN` and revoke `2VxWUMjd5Q6oiky6roRK8X6a5X8oVT3papuWEhycficLNBKaovmE6kAmhLUByDfooGq7tqFGWaFKMcmr9Lp6Bz5b` signed by `ASCQRp616JVQKMpynYfcPVdKPext719WUf7CuFcnnatX` on the Seeker; a pull signed by the executor (`AiFrumeV4r81DmnsjRRrAsMy3cJKGkc15pYmMRvgAc3ibDQcS1wvY5FidL3y6LP66RyD1Ao2ugN3TXx1npzHsUk`, programs ComputeBudget + De1egAFM + the DAMM v2 program, a swap, not an x402 payment); the pull after revoke `GarcPW1DtMLRCcvC6CyevphBn21MXdRrqqbQ7QgRkC91e6yk6nnoVsn6U9jN4nSkydRQnhppNhxSj9GRQVq4v9G` failed with `InvalidAccountOwner`.

## Copy of nuntius `mandate-chain.ts` and its localnet test

`/Volumes/D/iussum/vendor/nuntius-mandate/` holds `src/mandate-chain.ts`, `mandate-chain.localnet.test.ts`, and the closure it imports (`allowance.ts`, `tx.ts`, `program-accounts.ts`, `test/localnet.ts`); `cmp` shows each byte-identical to `/Volumes/D/nuntius/server/src/…`; sha256 list in `COPIED-SHA256.txt`. Command: `npm run test:localnet` in that folder, against an isolated validator (`solana-test-validator --reset --ledger /tmp/iussum-ledger --bpf-program De1eg… subscriptions-364a419.so`; the shared nuntius ledger was not touched). Result 2026-10-19: `tests 7, pass 7, fail 0, skipped 0`, including `over-cap pull: the chain refuses with 0x190` (`{"InstructionError":[0,{"Custom":400}]}`). A first run reported `skipped 1` because the env var was not exported; that is not a pass and is recorded in the private working log.

## Live on devnet (2026-10-19, after funding)

Principal `BSC8EyZJr19cqzYw3e7UnoDjsNJS4RGiE8rdoo4pJgiU` (throw-away key, approved as the live G0.4 principal; 1 SOL, 20 devnet USDC in `6yhmERramYBiynohezgqDbGMHAf9peDDSDoykiu1wzLe`, balances confirmed by `getBalance` / `getTokenAccountsByOwner` before the run). Agent `4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi` has no SOL and signs only the payment authority; the facilitator pays the fee. Seller `5hQASoTWuCSjSz3GfUmrVDfUKEvRMDLpqUK1wuUi5Gk7`, USDC ATA `GvDNmYMmCvnzhgZVZ1XGxWznCgL3BvpEJBPfTvjL1yps`. Mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Script `probes/g04-live.mjs`; every step is in `docs/ALLOWANCE-live.jsonl`. The client carried `extensions.iussum.info`; the seller's `onBeforeVerify` hook saw it on every attempt.

STAGE=a, SPL ApproveChecked delegate (agent) on the principal's account, one 0.01 USDC payment each:

| facilitator | x402 result | settle tx |
|---|---|---|
| payai | HTTP 200, `settle.success true`, `payer` = agent | `5KsYz26TFRGqzk7KdjUg8z2tGL6neRed37Cj211kYFgTX8ATNDKwXfqwuRnLzC8zTMDf2Z4QS7SweCd41Lrd2Hur` |
| x402.org | HTTP 200, `settle.success true`, `payer` = agent | `3m4mkzxRs3KahW37osbWCmCKxn5FsNru18kpt8LnL9NDPhfdQxkayMszHJgZjhTbnWiJnSQftmGUaMwTiqY8iDjR` |

Read back from devnet with `getTransaction` (jsonParsed): both `err null`; one `transferChecked` of `10000` base units, `source = 6yhmERra…wzLe` (principal's account), `destination = GvDNmYMm…jL1yps` (seller's), `authority = 4ZUJeT13…avTPmSi` (agent); signers = facilitator fee payer (`2wKupLR9…DBg4` for payai, `CKPKJWNd…qWYp5` for x402.org) and the agent. So the principal's funds moved on the agent's signature alone, through both live facilitators.

STAGE=b, Subscriptions delegatee (agent) pulling via TransferRecurring (nuntius `pullInstruction`), grant signed by the principal on the devnet program:

| facilitator | compute-unit limit | refusal (decoded `payment-required` header) |
|---|---|---|
| payai | 100,000 | `invalid_exact_svm_payload_transaction_instructions_compute_limit_instruction` |
| payai | 40,000 and 30,000 | `invalid_exact_svm_smart_wallet_program_not_allowed: De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44` |
| x402.org | 40,000 and 100,000 | `invalid_exact_svm_smart_wallet_program_not_allowed: De1egAFM…` |

No Subscriptions pull settled. Both live operators run the smart-wallet path (the refusal text is the smart-wallet one) with `De1egAFM…` outside their allow-list. payai's deployed code also rejected a 100,000 compute-unit limit that the 2.28.0 library accepted locally, so its deployed version or config differs from the installed package (UNTESTED which). The 40,000 attempts are not proof the transaction would run on chain: a pull needs more than the 20,000 limit the static path allows (localnet: `ProgramFailedToComplete` at 20,000); 30,000 and 40,000 were never simulated to success, since the facilitators refused on the program first.

Devnet signatures of the setup steps (all `err null`): create seller ATA `55j3ncDMVZSmj7ftFgAUAfV356eThXAbcwoLssdAUs3HCPigh9JkGUW52fZ6cNX2FwX4uUFtBqxLX9ZHtr1a53dm`; ApproveChecked `3MP4XyfwRUSLXAAb4Pz4wLsskw29cYnWYqRsQx3k7YTpCRb97obkJidDUvXtv8i6WK62rLnp6P2CJ6NkDCebVVjz` (first run, the client then failed on spend controls, fixed with `setSpendControls(false)`), `3hugqcBaqBSp27GpeYyg4Jnove7hXHZctE6hcizK7cXKpuamgf8uR6hD2KPtDoCHAHXqNAnUuGtzAWXzpRmh2vJG` (payai run), `2kzB7vkcNGn5hcLT1kfquv9UsPWsd3LkzRf2zoBPyoqftNemvgFEzhFZPMhwzaYAk6H92TotoYqhzDH1HTsUWMFD` (x402.org run); Revoke `5swrFe1qBvvfV5f43MQXP59ZiUzUZ2KSRrV4YbNHJWBWTADPptKSchujbfAHXizf7LP8UvFLjwHwgEnASAauaNFW` and `iLWpnZxeH2c3WcVBJTWkKpg4QaJk6LYZ8jvuTiEnsswaiRtsK7wM2ahoCHGERAqhXFGScwP76x52RZfk3qQMdsT`; Subscriptions grant (init authority + recurring delegation, cap 500,000 per 3600 s, 24 h) `5tH65bogQDomdxtTt9jdPoZXsPGHwVSeUraMemZR9Ci8iXHka6HCAjX8CSfxiv3us9xxVwnLKBCn3fteNePikfXc`. The grant worked with the nuntius client against the deployed devnet program, which is evidence the deployed program is compatible with the `@solana/subscriptions` 0.5.0 account layout (its build hash was not compared). The Subscriptions authority is still live on the principal's account (delegate = authority PDA); it was left in place.

## Blockers and UNTESTED

- Rule 6 asks for a Seed Vault principal; the live G0.4 run used the approved throw-away key `BSC8Ey…JgiU`. The on-chain steps from natX would need one Seeker approval each.
- Whether a facilitator operator would allow-list `De1egAFM…` on request: not asked.
- Why payai refused a 100,000 CU limit that the installed 2.28.0 package accepts (version or config drift on their side).
- A Subscriptions pull through an allow-listed facilitator on devnet: only proven on localnet.
- The program deployed on devnet vs build `364a419`: compatible by the successful grant, bytes not compared.

# JUDGE_GUIDE: verify the claims in five minutes

Everything runs on **devnet** (no mainnet transaction was made). Node 22 or newer.

## 1. The tests (30 seconds, no network)

```bash
npm ci
npm test            # expect: ℹ tests 155  ℹ pass 155  ℹ fail 0  ℹ skipped 0
```

`skipped 0` matters: a suite that skips its real tests also prints no failures.

## 2. Every check is load-bearing (1 minute)

```bash
npm run mutation    # expect: baseline: 155 tests, 155 pass, 0 fail ... checks mutated: 53, survived: 0   (exit code 0)
```

It skips one check at a time and requires some test to fail. A line starting `SURVIVED` would be a vacuous check. The table is in `TESTS.md`.

## 3. The devnet transactions (3 minutes, browser only)

The five clean demo runs are in `demo-runs/run-1.txt` to `run-5.txt` (each ends `39/39 checks passed`, exit code 0). `demo-runs/signatures.md` lists all 85 signatures the runs printed, each checked with `getSignatureStatuses` (all finalized). Run 1, one link per claim:

| claim | what to look at | link |
|---|---|---|
| **the grant** (scenario 1) | fee payer and only signer is `BSC8Ey…JgiU` (the principal); one `approveChecked` (delegate `4ZUJeT13…`, amount 1000000); one Memo whose text ends in the 64-hex mandate id; nothing else | https://explorer.solana.com/tx/4iBq6TpLKwGkAzTEX2iojcznJet9r1nBNJsDtojjJnfhwBQrC8JviKkgMaWHoT4GVFkaHWS7U4drQzEtSxSe5z22?cluster=devnet |
| **an in-scope payment** (scenario 1) | `transferChecked` 10000 from the principal's USDC account to seller A's, authority = the agent `4ZUJeT13…` (a delegate, not the owner); the facilitator is the fee payer | https://explorer.solana.com/tx/2AVuExNtXmgCMNqhQDtKTa7od2ksh3eLeHQdcnQRHu6S5DcAbSCMxBTiM591LmRAwGJZc3nGtcaSjr87wcrvtGFS?cluster=devnet |
| **an out-of-scope payment an observe-mode seller took** (scenario 3) | the same shape, but to seller C `Bpuns…Whji`, which is not on the mandate's list | https://explorer.solana.com/tx/3sCQLLikWkCS1pMSTTavbHyeq2spD29M135HeHsEzeoDw2aRBbAWV3NdGookn2xLza1HC9M1FUQeiGfuEeevJgHM?cluster=devnet |
| **the refund that followed** (scenario 3) | `transferChecked` 10000 from the refund-float wallet to the principal | https://explorer.solana.com/tx/5Nwa4qYxQV3GuQf6RLE5kiQ9HyfJQefNAuF86r7UJZHNuii8bLLqsJAjmYNPWASsEd1fNKxsgLQsF2nwojfhKjt1?cluster=devnet |
| **the revoke** (scenario 6) | `revoke` on the principal's USDC account; afterwards the seller answers 403 `grant_inactive` and the facilitator fails a payment (printed in the run) | https://explorer.solana.com/tx/4DGCSnzaQKnRS6DknjhY7PSEZqTPHw3b86qSryfPcFHFuFsANN3rpJYZ4BBir9t8vQAB1o7sWq5csLuuzxCUHodH?cluster=devnet |
| **a period overrun across two sellers** (scenario 9) | two payments of 0.02 USDC, one to seller A, one to seller B, each alone inside every per-payment limit; together above the 0.03 period budget | https://explorer.solana.com/tx/3oKZzgWzNH6EddoFjJ9TFidD3oEe3nQTPmjZ1XdZnyJien1oHH5SPoDrpLp9AzZjZx4ugkND9csTt5QBKotvF5Gq?cluster=devnet and https://explorer.solana.com/tx/2BARdp8uwKdD2Qvsha8uTVbXNEpupeBkdfkcU8AzCkBVAjMSGkmGFt7BeW1XQBRRVhE2bQnnfbyoA5oKPDNFsR94?cluster=devnet |

Scenarios 2 (seller 403, balances unchanged), 4 (no mandate), 5 (tampered receipt), 7 (the payer-caps-only control) and 8 (duplicate dispute, no second refund) are read in the run output: each prints the verdict JSON fields and PASS/FAIL against a stated expectation.

## 4. Run the demo yourself (10 minutes, needs faucets)

```bash
node scripts/demo-setup.mjs          # creates throw-away keys in .secrets/, prints the principal address
# fund the principal on devnet: SOL at https://faucet.solana.com (>= 0.1), USDC at https://faucet.circle.com (>= 3, mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)
node scripts/demo-setup.mjs --fund   # token accounts + the refund float (UNTESTED: the author's keys were funded by earlier scripts)
npm run demo:devnet                  # about 40 seconds
```

`demo:devnet` uses the real payai facilitator (`FACILITATOR=https://x402.org/facilitator` settled the same SPL-delegate payment in Phase 0; the full demo has not been run against it) and the public devnet RPC; set `DEVNET_RPC` if it rate-limits.

## 5. What not to conclude

- The Seeker showed the token and the amount for the grant, **not** the delegate and **not** the memo, and no message text at all (`docs/SEED-VAULT.md`). The five runs use a throw-away key, so no phone signed them. A separate run with the Seed Vault account on the Seeker is for the video and is **UNTESTED** until it is run.
- Seller-side checking works only for sellers that mount the middleware. The control (scenario 7) shows what a payer-side cap alone leaves undecidable.
- A Subscriptions-program delegate cannot pay through the live facilitators (`docs/ALLOWANCE.md`), so path B is parked.

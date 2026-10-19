# JUDGE_GUIDE: verify the claims in five minutes

Everything runs on **devnet** (no mainnet transaction was made). Node 24 or newer.

## 1. The tests (30 seconds, no network)

```bash
npm ci
npm test            # expect: ℹ tests 241  ℹ pass 241  ℹ fail 0  ℹ skipped 0
```

`skipped 0` matters: a suite that skips its real tests also prints no failures.

## 2. Every check is load-bearing (1 minute)

```bash
npm run mutation    # expect: baseline: 241 tests, 241 pass, 0 fail ... checks mutated: 76, survived: 0   (exit code 0)
```

It skips one check at a time and requires some test to fail. A line starting `SURVIVED` would be a vacuous check. The table is in `TESTS.md`.

## 3. The devnet transactions (3 minutes, browser only)

The five clean Phase 1.1 demo runs are in `demo-runs-1.1/run-1.txt` to `run-5.txt` (each ends `46/46 checks passed`, exit code 0; the Phase 1 runs before the review fixes are kept in `demo-runs/`). `demo-runs-1.1/signatures.md` lists all 105 signatures the runs printed, each checked with `getSignatureStatuses` (all finalized). Run 1, one link per claim:

| claim | what to look at | link |
|---|---|---|
| **the grant** (scenario 1) | fee payer and only signer is `BSC8Ey…JgiU` (the principal); one `approveChecked` (delegate `4ZUJeT13…`, amount 1000000); one Memo whose text ends in the 64-hex mandate id; nothing else | https://explorer.solana.com/tx/5E7WnN1dGWBFXR6bzB3swC9PKPuvGbJ734kMrFhCfXNZDM1hhuJFTPFX8Z6VRonVW3VTEb2gf1uAyG4YsumpBqQG?cluster=devnet |
| **an in-scope payment** (scenario 1) | `transferChecked` 10000 from the principal's USDC account to seller A's, authority = the agent (a delegate, not the owner); the facilitator is the fee payer | https://explorer.solana.com/tx/3ZN4Ptzr4LVZUhpTYaQGTZfJCwzTZHLtsQEpgHWXoS2sGsjy8XctkWFBogKXJeZq1uXKZ3kN8w3uPKjoTZxAmUQv?cluster=devnet |
| **an out-of-scope payment an observe-mode seller took** (scenario 3) | the same shape, to seller C `Bpuns…Whji`, which is not on the mandate's list | https://explorer.solana.com/tx/2dmpcixMXwU5aLurV7a1Koxi9AgieF7c3uKjQHE3R1YN324AQJbYzC1xz5XsBYexkfUbju2ggtFeG718JLWFaVfS?cluster=devnet |
| **the refund that followed** (scenario 3) | `transferChecked` 10000 from the refund-float wallet to the principal | https://explorer.solana.com/tx/5pV9pd2HVUgMMfcTem98n1qKw2jqMj3CTziwg5uCnKViouhoAoqhqyEcAiDrCEWacpZPcWh3HWZupUcXtcbioim8?cluster=devnet |
| **the revoke** (scenario 6) | `revoke` on the principal's USDC account; afterwards the seller answers 403 `grant_inactive` | https://explorer.solana.com/tx/5gEg2FVRHGxQvFbsKFwxaoA21PUu4CZU8S7JtWdyduiYKQCvhZKWHXP52o9gWHo9K4Eee3NJ7tpGVcMSprSkk7Zk?cluster=devnet |
| **a period overrun across two sellers** (scenario 9) | two payments of 0.02 USDC to sellers A and B, together above the 0.03 period budget | https://explorer.solana.com/tx/n6PW7KHKpouHjYrDd2z1SaRjPnFHEdi476f5L1mpGbZz6BQPEh38TQXDLwYcefh6oVxQvv4d7RcTsC2xx5yoXsC?cluster=devnet and https://explorer.solana.com/tx/3z1LALyKa73nHkoZXLCXSGsXaK2nv63ARPYBEmMtevGmbNmRYNX1CmZ63Ckdrc5cnmoeGNr4t1U17xyqsGejc5iv?cluster=devnet |
| **a narrower re-grant superseding the old mandate** (scenario 10) | M1 grant, then M2 grant on the same account (the second `approveChecked` replaces the first); afterwards a request carrying M1 is refused `grant_inactive: superseded by <the M2 grant>` | M1 https://explorer.solana.com/tx/niQk5QwurMS4r4s3ZKLoc6yECinLbrLxgDfcXLoXPZdZe7Fdex9jcp6Gypo5k5jjrkzxvFyYdaTdmbhms42Fak5?cluster=devnet ; M2 https://explorer.solana.com/tx/k7SGAPfE6gdjznrrBUUmtZh5S6Zh1uFDwBqx358ARDrc33B74xNySahA8tVuLZYTSX9Xwugm9N36BWLewqJxnmF?cluster=devnet |

Scenarios 2 (seller 403, balances unchanged), 4 (no mandate), 5 (tampered receipt), 7 (the payer-caps-only control: the chain alone makes the agent operator liable, the resource stays unjudged), 8 (duplicate dispute, no second refund) and the dispute half of 10 (a dispute carrying the older mandate is rejected as `mandate_mismatch`) are read in the run output: each prints the verdict fields and PASS/FAIL against a stated expectation.

## 4. Run the demo yourself (10 minutes, needs faucets)

```bash
node scripts/demo-setup.mjs          # creates throw-away keys in .secrets/, prints the principal address
# fund the principal on devnet: SOL at https://faucet.solana.com (>= 0.1), USDC at https://faucet.circle.com (>= 3, mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)
node scripts/demo-setup.mjs --fund   # token accounts + the refund float (UNTESTED: the author's keys were funded by earlier scripts)
npm run demo:devnet                  # about 90 seconds (ten scenarios)
```

`demo:devnet` uses the real payai facilitator (`FACILITATOR=https://x402.org/facilitator` settled the same SPL-delegate payment in Phase 0; the full demo has not been run against it) and the public devnet RPC; set `DEVNET_RPC` if it rate-limits.

## 5. What not to conclude

- The Seeker showed the token and the amount for the grant, **not** the delegate and **not** the memo, and no message text at all (`docs/SEED-VAULT.md`). The five runs use a throw-away key, so no phone signed them. A separate run with the Seed Vault account on the Seeker is for the video and is **UNTESTED** until it is run.
- Seller-side checking works only for sellers that mount the middleware. The control (scenario 7) shows what a payer-side cap alone leaves undecidable.
- A Subscriptions-program delegate cannot pay through the live facilitators (`docs/ALLOWANCE.md`), so path B is parked.

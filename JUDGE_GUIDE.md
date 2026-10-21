# JUDGE_GUIDE: verify the claims in five minutes

Everything runs on **devnet** (no mainnet transaction was made). Node 24 or newer.

## 1. The tests (about a minute, no network)

```bash
npm ci
npm test            # expect: ℹ tests 490  ℹ pass 490  ℹ fail 0  ℹ skipped 0
```

`skipped 0` matters: a suite that skips its real tests also prints no failures.

## 2. Every check is load-bearing (about 2 hours: the suite runs once per check)

```bash
npm run mutation    # expect: baseline: 490 tests, 490 pass, 0 fail ... checks mutated: 190, survived: 0   (exit code 0)
```

It skips one check at a time and requires some test to fail. A line starting `SURVIVED` would be a vacuous check. The table is in `TESTS.md`.

## 3. The devnet transactions (3 minutes, browser only)

The five clean Phase 1.9 demo runs (scenarios 1 to 16 and 16b, 98, 97, 98, 97 and 97 checks, 205 signatures, all checked with `getSignatureStatuses`) are in `demo-runs-1.9/`. The five clean Phase 1.8 demo runs (scenarios 1 to 16 and 16b, 97, 97, 97, 98 and 97 checks, 205 signatures, all checked) are in `demo-runs-1.8/`. The five clean Phase 1.7 demo runs (scenarios 1 to 16 and 16b, 97, 98, 97, 97 and 97 checks, 205 signatures all checked with `getSignatureStatuses`) are in `demo-runs-1.7/` (`signatures.md`; the five scenario 16b transactions are there as "failed-on-chain (expected)"). The five clean Phase 1.2 demo runs are in `demo-runs-1.2/run-1.txt` to `run-5.txt` (each ends `61/61 checks passed`, exit code 0). `demo-runs-1.2/signatures.md` lists all 160 signatures the runs printed, each checked with `getSignatureStatuses` (all finalized). The runs before the review fixes are kept: `demo-runs/` (Phase 1) and `demo-runs-1.1/` (Phase 1.1); the two Phase 1.2 attempts that were not clean are kept in `demo-runs-1.2-attempt1/` and `demo-runs-1.2-attempt2/` (see `REPORT-phase1.2.md` for why). The newest five clean runs (Phase 1.4, 63/63 checks each, 160 signatures, all finalized) are in `demo-runs-1.4/`. The links below are from the Phase 1.1 run 1 (scenarios 1 to 10) and Phase 1.2 run 1 (scenarios 11 to 13), one link per claim:

| claim | what to look at | link |
|---|---|---|
| **the grant** (scenario 1) | fee payer and only signer is `BSC8Ey…JgiU` (the principal); one `approveChecked` (delegate `4ZUJeT13…`, amount 1000000); one Memo whose text ends in the 64-hex mandate id; nothing else | https://explorer.solana.com/tx/5E7WnN1dGWBFXR6bzB3swC9PKPuvGbJ734kMrFhCfXNZDM1hhuJFTPFX8Z6VRonVW3VTEb2gf1uAyG4YsumpBqQG?cluster=devnet |
| **an in-scope payment** (scenario 1) | `transferChecked` 10000 from the principal's USDC account to seller A's, authority = the agent (a delegate, not the owner); the facilitator is the fee payer | https://explorer.solana.com/tx/3ZN4Ptzr4LVZUhpTYaQGTZfJCwzTZHLtsQEpgHWXoS2sGsjy8XctkWFBogKXJeZq1uXKZ3kN8w3uPKjoTZxAmUQv?cluster=devnet |
| **an out-of-scope payment an observe-mode seller took** (scenario 3) | the same shape, to seller C `Bpuns…Whji`, which is not on the mandate's list | https://explorer.solana.com/tx/2dmpcixMXwU5aLurV7a1Koxi9AgieF7c3uKjQHE3R1YN324AQJbYzC1xz5XsBYexkfUbju2ggtFeG718JLWFaVfS?cluster=devnet |
| **the refund that followed** (scenario 3) | `transferChecked` 10000 from the refund-float wallet to the principal | https://explorer.solana.com/tx/5pV9pd2HVUgMMfcTem98n1qKw2jqMj3CTziwg5uCnKViouhoAoqhqyEcAiDrCEWacpZPcWh3HWZupUcXtcbioim8?cluster=devnet |
| **the revoke** (scenario 6) | `revoke` on the principal's USDC account; afterwards the seller answers 403 `grant_inactive` | https://explorer.solana.com/tx/5gEg2FVRHGxQvFbsKFwxaoA21PUu4CZU8S7JtWdyduiYKQCvhZKWHXP52o9gWHo9K4Eee3NJ7tpGVcMSprSkk7Zk?cluster=devnet |
| **a payment above the remaining allowance, refused by the chain** (scenario 16b) | the same 0.06 USDC `transferChecked` signed by the agent as delegate, with the agent as fee payer and no preflight, after 0.02 of a 0.06 allowance had been spent: the transaction is on chain and FAILED, `InstructionError [0, Custom 1]`, log `Error: insufficient funds`; the principal's and seller C's balances and the delegated amount (0.04 left) are the same before and after | https://explorer.solana.com/tx/4Tht3vcbpUSbz1THmS3iKmxHqAP4VuMEumFSqvU5RJubUy5SFaKT1Y5fzwCP1JyL41fzaQiE8qKVKY3VFYMwogb5?cluster=devnet |
| **a period overrun across two sellers** (scenario 9) | two payments of 0.02 USDC to sellers A and B, together above the 0.03 period budget | https://explorer.solana.com/tx/n6PW7KHKpouHjYrDd2z1SaRjPnFHEdi476f5L1mpGbZz6BQPEh38TQXDLwYcefh6oVxQvv4d7RcTsC2xx5yoXsC?cluster=devnet and https://explorer.solana.com/tx/3z1LALyKa73nHkoZXLCXSGsXaK2nv63ARPYBEmMtevGmbNmRYNX1CmZ63Ckdrc5cnmoeGNr4t1U17xyqsGejc5iv?cluster=devnet |
| **a narrower re-grant superseding the old mandate** (scenario 10) | M1 grant, then M2 grant on the same account (the second `approveChecked` replaces the first); afterwards a request carrying M1 is refused `grant_inactive: superseded by <the M2 grant>` | M1 https://explorer.solana.com/tx/niQk5QwurMS4r4s3ZKLoc6yECinLbrLxgDfcXLoXPZdZe7Fdex9jcp6Gypo5k5jjrkzxvFyYdaTdmbhms42Fak5?cluster=devnet ; M2 https://explorer.solana.com/tx/k7SGAPfE6gdjznrrBUUmtZh5S6Zh1uFDwBqx358ARDrc33B74xNySahA8tVuLZYTSX9Xwugm9N36BWLewqJxnmF?cluster=devnet |
| **a hidden debit** (scenario 11, Phase 1.2 run 1) | a plain SPL `transfer` of 0.02 USDC signed by the agent as delegate out of the principal's account, with no x402 and no seller; the resolver calls it `debit_not_x402`, agent operator, and counts it, so the second 0.01 x402 payment crosses the 0.03 budget | https://explorer.solana.com/tx/3mUzc4Rsanr6CbZ364gJV5BhnfWky6cGyS9832QHQdGnkyYVVbsykwS6TtYVDEqELHPqXeKBbP4oiFZFiVN4324V?cluster=devnet ; the crossing payment https://explorer.solana.com/tx/2iWADx3kiWPdUF4qqkkkBeHURj5Jpcaf528YYCovSot91yaVPMCBpkD4Di6krLycxTCzgaQXvC7LCmm1d7cehPP8?cluster=devnet |
| **five concurrent payments, three settled** (scenario 12) | the first settled payment of the three; the agent reserved its budget before signing and refused the other two locally | https://explorer.solana.com/tx/4jJa81ZBSdCwmbRi7PADvAtdVn1nB1UGmkkPvYNo37hVHs3w2wpkzk48u3SACt2sPDHijRCN8kcVw933TRdVEqus?cluster=devnet |
| **a provisional verdict replaced, and the refund** (scenario 13) | the out-of-scope payment seller C took, and the refund the replaced verdict paid | payment https://explorer.solana.com/tx/2bR9a4c22utYLDyRFrsfHPJj84yY2Qzz5KGb7UDSHArYViupfYSqNtmUBo6SUvAYtg3W8drYBqHG4tYsrHd2kuNh?cluster=devnet ; refund https://explorer.solana.com/tx/Euxn2w6D8ifqDcotQPZ2Q1zZoWkT1DpAhSEgWQR8s5tAVXhx9Grj2XwjyvuEYLakskcDguMd87fWYixp9heQGC6?cluster=devnet |

Scenarios 2 (seller 403, balances unchanged), 4 (no mandate), 5 (tampered receipt), 7 (the payer-caps-only control: the chain alone makes the agent operator liable, the resource stays unjudged), 8 (duplicate dispute, no second refund) and the dispute half of 10 (a dispute carrying the older mandate is rejected as `mandate_mismatch`) are read in the run output: each prints the verdict fields and PASS/FAIL against a stated expectation.

## 4. Run the demo yourself (10 minutes, needs faucets)

```bash
node scripts/demo-setup.mjs          # creates throw-away keys in .secrets/, prints the principal address
# fund the principal on devnet: SOL at https://faucet.solana.com (>= 0.1), USDC at https://faucet.circle.com (>= 3, mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU)
node scripts/demo-setup.mjs --fund   # token accounts + the refund float (UNTESTED: the author's keys were funded by earlier scripts)
npm run demo:devnet                  # about 10 minutes (sixteen scenarios plus 16b)
```

`demo:devnet` uses the real payai facilitator (`FACILITATOR=https://x402.org/facilitator` settled the same SPL-delegate payment in Phase 0; the full demo has not been run against it) and the public devnet RPC; set `DEVNET_RPC` if it rate-limits.

## 5. What not to conclude

- The Seeker showed the token and the amount for the grant, **not** the delegate and **not** the memo, and no message text at all (`docs/SEED-VAULT.md`). The five runs use a throw-away key, so no phone signed them. A separate run with the Seed Vault account on the Seeker is for the video and is **UNTESTED** until it is run.
- Seller-side checking works only for sellers that mount the middleware. The control (scenario 7) shows what a payer-side cap alone leaves undecidable.
- A Subscriptions-program delegate cannot pay through the live facilitators (`docs/ALLOWANCE.md`), so path B is parked.

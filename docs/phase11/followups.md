# Phase 1.1 review follow-ups (2026-10-19)

Two findings from the review of Phase 1.1, fixed after it.

## (1) The agent judged the seller-declared URL

`packages/agent/src/agent.js:85` was `const url = fails(true) ? asked : declared;`. `fails(name, condition)` returns `condition && !mutated(name)`; with one argument the condition is undefined, so it was always false and `url` was always the seller's `resource.url`. **Cause:** when I dropped the redundant mutation row `agent.requested_url` in Phase 1.1, a string replace removed that name from the registration list and, unintentionally, from this line too. The Phase 1.1 report says the row was dropped as redundant; that was wrong, the check was not redundant, and the line was broken. The `resource_mismatch` check (declared differs from asked) hid it whenever the seller declared a different URL.

Fix: the scope check uses the URL the agent requested; the line is a named check (`agent.requested_url`: mutated, it falls back to the declared URL); a missing requested URL (a payment not created through `agent.fetch`) is refused as `resource_mismatch` under its own named check (`agent.requested_url_present`). A scan of the repo finds no other single-argument `fails()` call.

Tests (`test/phase11/followups.test.js`): a rewriting proxy that DELETES `resource.url` from the 402 challenge; (a) an in-prefix request still pays (HTTP 200, settled once): this is the test that fails on the unfixed line, because the declared URL is then missing and the payment is refused; (b) an out-of-prefix request is still refused (`resource_not_allowed`); (c) `agent.client.createPaymentPayload` called without `agent.fetch` is refused. Mutation rows `agent.requested_url` (killed by test a) and `agent.requested_url_present` (killed by test c).

## (2) `supersedes()` ignored CPI

`packages/core/src/grant.js` scanned only top-level instructions. It now also scans `meta.innerInstructions` (jsonParsed) for `approve`, `approveChecked`, `revoke`, `setAuthority` and `closeAccount` on the source account, including nested inner instructions. A failed transaction, an inner `transferChecked`, and an inner approve on another account still do not supersede. Mutation row `grant.superseded_inner` (7 tests fail when it is skipped). The resolver uses the same function, so a mandate superseded by CPI before the payment slot is `mandate_superseded` (tested).

Tests: 5 instruction types by CPI, a nested CPI, the three negative cases, and the resolver case. The CPI shape is built by hand in the test (a top-level call to another program with the token instruction in `meta.innerInstructions`); a real on-chain CPI delegate change was not made, so that is still **UNTESTED** against a live transaction.

## Evidence

Before the fix (the two source files stashed, new tests run): 11 tests, **9 fail**, 2 pass (the two controls: an out-of-prefix request is refused either way, and the negative CPI cases). After: 11 pass.

- `npm test`: 241 tests, 241 pass, 0 fail, 0 skipped (was 230).
- `npm run mutation`: baseline 241/241, **76 checks mutated, 0 survived** (was 73; rows added: `agent.requested_url`, `agent.requested_url_present`, `grant.superseded_inner`).
- One devnet demo run after the fixes: `demo-runs-followup/run-1.txt`, ten scenarios, **46/46 checks passed, exit code 0**. 21 signatures, all finalized (`demo-runs-followup/signatures.md`):

| scenario | kind | status | signature |
|---|---|---|---|
| 1 | grant | finalized | `4giN2WN9qmUHEix9zyuUMhwr4A13cr5CsgkBJvt6QyH4VeHvtQcn9eeR3nR9zR9zE3QvTbTz1ZUSXjjvkNd6mGG` |
| 1 | payment | finalized | `4vVSK6Ddi9FnKfUYcksxZBkwG55fg2MswdEnMNDnnUWDMFg9JBggvc65LrQmUwEzTZU7ZRoQy3HGFdDg3b4Q5TJN` |
| 2 | grant | finalized | `2Tqa9WuafNzNBxerePLBAwtaFH3Wi2P16vokXRj2sb269b3L93NTtNdUUwLTzFVmAE5NCHbFQ37KhTERDrXckN6E` |
| 3 | grant | finalized | `47Lqt2PiiX3fATbmU5RNLXzXUiNVfAso5PsC5njD3DzGVUbtRhZkUhM5ULSacN6cqhSe3qVw15dtbh3JsdLv25PW` |
| 3 | payment | finalized | `33yoC52xiVhmA57Ma6CyBJCPEidZV1WZacdv5Sqzk1AuC6gBAVecdE9uBtqUqKGgfRdhHfpydw5G92EZeCH1Yyzg` |
| 3 | refund | finalized | `Ksq5KammisputmU4kCXaYc4VadFhgSY25TtA8dC3Qd9jD4rmWpK24SGe9NtbYS5r47DpUBzs84CkSK2QKcyKP8k` |
| 4 | grant | finalized | `4V3SEcfqKekdPkNB34mcTm2BbnMe5wJRuumj2Rd1Gb3984R9Gt3o8qRREhiAbk3zZn6h6riYnMmQdYLiqYxLsVXm` |
| 4 | payment | finalized | `2w7fvBAQhYCveHQFomBXRs5YfsKbMTvDjkgxHA9PbUtwd3iuUzREfpSC2nPxzYACaUL4CPGAe6zrtVndpinZXnrB` |
| 5 | grant | finalized | `4x3yFze8VaUJRm6MCWfK5k8TPEobQaQAHJJA3cVHW5qkSbPkpiMfbc6gCoksbm6tHxGSS4uXjixuPKz6r5nDGafJ` |
| 6 | grant | finalized | `vKxAUoUcdmh6x911gTPVMccEGYXAmF3Gs8VjQTrPSokbNzJ53GTJ1wypCnjoCTB8kTxyuJmXK5EgeA7a31NDQGr` |
| 6 | revoke | finalized | `51vKMRACTBNK7D3Cr8Kr5Gr5FRfuofSEWLGUrtVVkzq3mKC7bQBaSLAQbcmcFn8wpqdoZ4318RrVxsKFrntUeCVC` |
| 7 | grant | finalized | `2koKdU4s5o8bMpfNf2mGaJRyKtWpfxKNTzUBtS1YiyLA6sgnb8jrRgtHp2GyKtuDqEX5dko4bqm8nxoFnP1pheae` |
| 7 | payment | finalized | `4JkV6BNh6KzhNLzSFk9WaMoHF4EuQBowFyGR2mcZyRsQ2XXuCnqL1aaiWVRh2JwcCNC5jdkBbjx8AtvcMq3Qw3MH` |
| 9 | grant | finalized | `3QvtCHeWVJfDhwnC35V6cp6vuvtFLwaVZDMrK8HJMCB8Urnf3YPHQBjNrVLYHDYe9ULjZ7GZ5iV11UgS3EZEFuZu` |
| 9 | payment | finalized | `4yQ3SJxttGKZt5aGUat1Sqjz9SJAsCjRchgqcUpLtneknVpuNAhanuBRjKPK4VSkRw4JmEfRqc9mB7pbzVG6bRAW` |
| 9 | payment | finalized | `NUUJg7LmVLrVMGLTta9TZnyzxPWjZtNLYCm7T2zTTNUQRxeu4xk2odixux1S3aA9oHypeWTRTN1zHckGSXXJvMB` |
| 9 | grant | finalized | `rLbUZMYeK8joEsKwkef2QgGD82A2aZv751aPFamKnvFAckYAzukMjiXb7zn99vdxZWySpCAX1XxeoqeZDHNKfoX` |
| 10 | grant | finalized | `2dD2rRCoP4SnhUWQ4isYjCwWMFqkKoAxME6oQwxB2XvXm1oWzduDiFExWwnnhT5R49y7B3AkH9yASEVWNuscQ4A8` |
| 10 | grant | finalized | `2ApQPrYK29d1z8RpvzmUfKT8wo6ngS7uRbAs9DuabbRkj18cyT3MiYcxrjVh5h8JcqVZxyWgmVCqD1127SpgATkq` |
| 10 | payment | finalized | `4bSQmzgBrB7Nn6jPCdaQuq9xacCm8Fq94KpiEWx1fQKeg96QFCuvt4Tue591XTsiaSQSUKQQnxgr6UqLZXTt6CD8` |
| 10 | refund | finalized | `MmMU3prppBqrSnPeBjMgviBAgEES5yfk8MDWzX387Qoyj4AWtwVBz5TdUHkWqoCKtH3SCipfBS3pK8NVVs328GZ` |

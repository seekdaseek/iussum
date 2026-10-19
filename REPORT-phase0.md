# REPORT — iussum Phase 0 (2026-10-19, updated after the decisions and the live runs)

Scope: Phase 0 only (G0.1 to G0.5), with Addendum A (sha256 `ff7bbbf4…`) applied to G0.3 and G0.4. Brief sha256 `0130e234…`. Phase 1 NOT started. Stopped here as instructed; the brief's "continue to Phase 1" was overridden.

## Decisions applied (from your reply)

1. G0.1 continue: aether `mandate.go` / `receipt.go` read, "receipt not bound" settled, fields mapped (TWINS.md section 7).
2. Throw-away `.secrets` keys used for the live G0.4 run; natX used only for G0.3.
3. Carriage = `extensions.iussum = { info: { mandate, principal_sig } }` (confirmed live on payai and x402.org).
4. Phase 0 committed locally as seekdaseek, no push, no remote (see Repo state).

## Gate table

| gate | result | one line |
|---|---|---|
| G0.1 Twins | **PARTIAL, continued by your decision** | seller-side mandate checking exists (aether, PR #3376); no receipt bound to a mandate anywhere found; aether's receipt confirmed unbound by reading the code. |
| G0.2 x402 surface | **GREEN** | extension reaches client, hook, handler, facilitator; funded devnet settles on payai and x402.org carried `extensions.iussum.info`. |
| G0.3 Seed Vault signMessages | **PARTIAL** | accepted and the signature verifies against natX (detached 64 bytes); WHAT THE SHEET DISPLAYS IS NOT CAPTURED (only a loading skeleton). |
| G0.4 Delegation through a facilitator | **GREEN for path A, path B refused** | SPL delegate settled on devnet through both facilitators; Subscriptions delegatee refused by both (program not allow-listed). |
| G0.5 Merchant track | **DONE** | don't build now. |

Not all gates are fully green, so Phase 1 stays unstarted. G0.3's display question needs one more tap (below).

## Needs from you

1. **Re-tap for the display question.** Tap MULTILINE and LONG on the Seeker while I record the screen with `adb screenrecord`; the single-frame capture caught only the sheet's loading skeleton. One tap and approve each, I do the rest.
2. Nothing else is blocked.

## G0.1 Twins — `TWINS.md`

Research agent (about 40 queries, all listed), then my own read of aether (section 7 of the file). Stop condition PARTIAL, continued by your decision. None of the five named twins checks a principal-signed mandate at the seller.
- **Settled by reading `paywall/mandate.go` (326 lines) and `paywall/receipt.go` (Receipt struct, signing message) at aether 06799db:** aether's receipt is NOT bound to the mandate. `Receipt` has 17 fields (`receipt.go:44-69`), none a mandate; `ReceiptSigningMessage` signs 13 lines without a mandate id (`receipt.go:90-93`); `grep -ic mandate receipt.go` = 0 (control: `grep -in receipt mandate.go` returns lines 51, 201, 206, all about the amount format). The checked mandate's owner goes to the upstream in a header only (`mandate.go:312`).
- aether checks the payer AFTER payment (`MandatePayerCheck`, 403 once the money moved, no refund rule) and says "A mandate is a statement, not a lock". No period budget, no resource scope, no revoke.
- Field map iussum v0.1 to aether to PR #3376 is in TWINS.md 7.2. Overlap: per-payment cap, pay_to list, network, window, agent, principal. iussum alone: asset field, period budget, resource prefix, delegation reference, content-hash id, receipt bound to the mandate id, liability rule. #3376 has what iussum lacks: a server-minted single-use challenge nonce echoed in `info` (replay protection), and the same `info` wrapper.
- x402Resolve is at `x402kamiyo/x402resolve` (stale since 2025-11-09). ratum.dev is a Danish desktop agent-chat prototype, not payments.
UNTESTED: nothing in TWINS.md was executed; aether's tests not run; the list of unread items (x402#3220 comments, #3693, etc.) is in TWINS.md section 6.

## G0.2 x402 surface — `docs/X402-SURFACE.md`

- Packages at agentfeed's exact versions: `@x402/core|express|fetch|svm|extensions` 2.28.0, express 4.22.3.
- Local mock facilitator: the extension appears at `/verify`, `/settle`, the seller `onBeforeVerify` hook and the handler (counts `1 1 1 1`).
- Live `/supported` (2026-10-19) lists devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` on both payai and x402.org. payai rejects a flat extension (`Extension 'iussum' missing required 'info' property`) and passes `{info:{…}}`; x402.org passed all variants.
- **Funded devnet runs (G0.4 stage a) with `extensions.iussum.info` attached: HTTP 200, settle success on both, the seller hook saw the extension.** Carriage format = `extensions.iussum = { info: { mandate, principal_sig } }`.
- Devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` from `@x402/svm` source and Circle's docs.
- UNTESTED: extension size limits (the live `info` was a few bytes); whether the settle response echoes the extension (the decoded `PAYMENT-RESPONSE` showed none); a 403 refusal at the seller (the `onBeforeVerify` abort yields a 402 payment-error, `express/dist/cjs/index.js:236-247`).

## G0.3 Seed Vault — `docs/SEED-VAULT.md`

Probe `apps/seeker-probe/` (Expo 55, RN 0.83.6, nuntius's `transact()` wiring and polyfills copied, fresh `authorize` per session), release APK `apps/seeker-probe/iussum-probe-release.apk` (30,700,943 B, sha256 `a8a9f6299103ed26975741651ad0b258c30ff2d00813a20b88371eb20bbd52b8`), installed on the Seeker `the Seeker` (Android 16) with `adb install -r` → `Success`. SHORT (162 B) tapped and approved with natX at 16:27-16:28.
- Observed: `signMessages` accepted a free-text payload; returned **64 bytes = a detached ed25519 signature**; the returned account's base64 address decodes to base58 `ASCQRp616JVQKMpynYfcPVdKPext719WUf7CuFcnnatX` (label `DAPP`).
- **Verified in Node** (`probes/verify-seedvault.mjs`): `{"ok":true,"layout":"signature only"}` on the exact message; control with the message plus one byte: `{"ok":false}`.
- Seed Vault flow: a "Connect / Select a wallet" sheet, then a "Verify" sheet with a labelled **"Message ⓘ" box**, `Wallet DAPP`, `Application ochinimus.app`, Approve, then a biometric double-tap. Screenshots: `docs/seedvault/frames/`.
- **NOT captured: the text inside the Message box.** The only pre-approval frame (`004.png`) shows it as a loading skeleton; the next frame is already the biometric step. Whether the summary line is shown in full, truncated or as hex is UNKNOWN, and so is MULTILINE/LONG behaviour. Test: one tap each on MULTILINE and LONG while `adb shell screenrecord` runs, then read the frames.

## G0.4 Delegation — `docs/ALLOWANCE.md`

Per Addendum A the Subscriptions grant / pull / over-cap / revoke steps were not re-proven; the nuntius mainnet links and `evidence/proof-run.json` are cited with what each proves.
- Copied `mandate-chain.ts` + localnet test + closure to `vendor/nuntius-mandate/` (`cmp` identical). `npm run test:localnet`: **tests 7, pass 7, fail 0, skipped 0**. (A first run showed `skipped 1`, vacuous because the env var was not exported; fixed, rerun.)
- Facilitator SVM verify read first (`@x402/svm` 2.28.0 `exact/facilitator/index.js`, file:line in ALLOWANCE.md): static path wants a Token `TransferChecked` at index 2 and never checks the authority owns the source; the smart-wallet fallback is off by default and its default allow-list excludes `De1egAFM…`.
- Localnet through the real facilitator class: SPL delegate verify + settle pass, over-cap and post-revoke fail; Subscriptions delegatee passes only with `De1egAFM…` allow-listed, and the payer it reports is the Subscription Authority PDA, not the agent. One-delegate conflict shown both ways (Subscriptions grant displaces the agent's SPL delegate; ApproveChecked afterwards breaks the pull).
- **Devnet, live facilitators:** STAGE=a (SPL ApproveChecked delegate = agent) settled one 0.01 USDC payment through **payai** and through **x402.org**, `payer` = agent; on-chain read-back (`getTransaction`): source = principal's USDC account, authority = agent, funds went to the seller's account. STAGE=b (Subscriptions delegatee) was **refused by both**: `invalid_exact_svm_smart_wallet_program_not_allowed: De1egAFM…`. payai additionally rejected a 100,000 compute-unit limit that the installed 2.28.0 accepts locally (`..._compute_limit_instruction`): its deployed version or config differs.
- Design consequences: path A works with stock live facilitators today but has no on-chain period or per-payment cap; path B has them but needs the facilitator operator to allow-list the program, and its receipt `payer` is the authority PDA. One path per token account.

### Every devnet signature (all from `docs/ALLOWANCE-live.jsonl`; setup steps `err null`)

| step | signature |
|---|---|
| create seller USDC account | `55j3ncDMVZSmj7ftFgAUAfV356eThXAbcwoLssdAUs3HCPigh9JkGUW52fZ6cNX2FwX4uUFtBqxLX9ZHtr1a53dm` |
| ApproveChecked, first attempt (client then failed on spend controls, fixed) | `3MP4XyfwRUSLXAAb4Pz4wLsskw29cYnWYqRsQx3k7YTpCRb97obkJidDUvXtv8i6WK62rLnp6P2CJ6NkDCebVVjz` |
| ApproveChecked, payai run | `3hugqcBaqBSp27GpeYyg4Jnove7hXHZctE6hcizK7cXKpuamgf8uR6hD2KPtDoCHAHXqNAnUuGtzAWXzpRmh2vJG` |
| **x402 payment settled via payai, authority = SPL delegate** | `5KsYz26TFRGqzk7KdjUg8z2tGL6neRed37Cj211kYFgTX8ATNDKwXfqwuRnLzC8zTMDf2Z4QS7SweCd41Lrd2Hur` |
| Revoke (payai run) | `5swrFe1qBvvfV5f43MQXP59ZiUzUZ2KSRrV4YbNHJWBWTADPptKSchujbfAHXizf7LP8UvFLjwHwgEnASAauaNFW` |
| ApproveChecked, x402.org run | `2kzB7vkcNGn5hcLT1kfquv9UsPWsd3LkzRf2zoBPyoqftNemvgFEzhFZPMhwzaYAk6H92TotoYqhzDH1HTsUWMFD` |
| **x402 payment settled via x402.org, authority = SPL delegate** | `3m4mkzxRs3KahW37osbWCmCKxn5FsNru18kpt8LnL9NDPhfdQxkayMszHJgZjhTbnWiJnSQftmGUaMwTiqY8iDjR` |
| Revoke (x402.org run) | `iLWpnZxeH2c3WcVBJTWkKpg4QaJk6LYZ8jvuTiEnsswaiRtsK7wM2ahoCHGERAqhXFGScwP76x52RZfk3qQMdsT` |
| Subscriptions grant (init authority + recurring delegation) | `5tH65bogQDomdxtTt9jdPoZXsPGHwVSeUraMemZR9Ci8iXHka6HCAjX8CSfxiv3us9xxVwnLKBCn3fteNePikfXc` |
| stage b x402 attempts (5 runs, 2 facilitators) | no transaction: refused before settlement |

The funding airdrop (read-only check done) `5UDJon9x7Fzb6GpJX1fBad2JsrvxPUGU9ZzxNfz35cikQjYrzU2fFJDjE7evhDxEQgeza18FyFXpngr84UFfer5S` is yours. The Seed Vault `signMessages` produced no transaction. Localnet signatures (not on any explorer; ledger in `/tmp`) are in `probes/g04-local-results.json` and ALLOWANCE.md.

## G0.5 Merchant track — `docs/MERCHANT-TRACK.md`

Research agent, read through a fetch summariser, every claim with a URL. `VERDICT: Don't build the merchant track now`: Shopify documents no agent marker on orders (`Order.attribution` is a per-app definition, WebMCP `update_checkout` ignores it); the only app built for agent orders (FLINT Sentry, free, Pro $29/mo, launched 2026-07-17) has 0 reviews; Shopify is silent on who bears agent-order disputes (generic Shopify Payments rule: merchant); "legitimate agent orders get flagged high-risk" NOT FOUND; Moldova Partner payout via Hyperwallet NOT FOUND (only a Partner Dashboard check settles it). Premises CONFIRMED: Muse/Shop Pay (announced 2026-09-21, secondary source), WebMCP checkout 2026-09-28, no merchant configuration required. UNREAD: AgentBlock listing (404), Shopify's own X post on Instinct, Hyperwallet country list (404).

## Everything UNTESTED, with the test that would prove it

| UNTESTED | test |
|---|---|
| What Seed Vault's Message box shows (full / truncated / hex), for SHORT, MULTILINE, LONG | tap each while `adb shell screenrecord` runs; read frames |
| A Subscriptions pull through an allow-listed facilitator on devnet (only localnet) | needs an operator to allow-list `De1egAFM…`, or run our own facilitator on devnet |
| Why payai's deployed verify rejected a 100,000 CU limit that 2.28.0 accepts | ask payai or diff behaviour with controlled CU values |
| Extension size limits at the facilitators; extension echo in the settle response | send a ~1 KB `info`; inspect `PAYMENT-RESPONSE` |
| 403 refusal at the seller (the hook abort path gives 402) | Phase 1 middleware ahead of `paymentMiddleware` |
| Devnet program bytes equal build `364a419` | compare program data hash (the grant did succeed with the nuntius client) |
| Live runs with natX as principal (decision 2 limits natX to G0.3) | not planned |
| aether's tests; everything under "could not read" in TWINS.md section 6 | read/run |
| That Shopify agent-order markers do not exist in practice | a dev store (out of scope by rule) |

## Repo state

- Path `/Volumes/D/iussum`, branch `main`, local only: no push, no remote, no GitHub repo. Phase 0 committed as `seekdaseek <ochinimus@gmail.com>` (repo-local config); the commit hash and `git log -1 --format='%an <%ae>'` are in the closing message after the commit.
- Keys: `.secrets/{principal,agent,seller}.json`, mode 600, gitignored (`git check-ignore` confirmed; the commit contains no `.secrets/` path). Throw-away devnet keys; none is a Seed Vault key, none is a treasury key. No key value printed.
- Not committed (gitignored): `node_modules`, `dist`, `android/build`, `*.apk`, `.secrets/`. The probe APK is therefore only on disk at `apps/seeker-probe/iussum-probe-release.apk`.
- Touched outside the repo: nothing in `/Volumes/D/nuntius` (read with cat/cp only, no git, no writes); nothing on the VPS; no mainnet transaction; no deploy or publish. `~/.cache/nuntius-localnet` read only. The localnet validator is stopped. The probe is installed on the Seeker as `app.ochinimus.iussumprobe`.
- Devnet state left behind: the principal's USDC account still has the Subscriptions authority as delegate (grant from stage b); the agent's SPL delegation was revoked.
- `LOG.md` has a dated line for each step.

## Files

`REPORT-phase0.md`, `LOG.md`, `TWINS.md`, `docs/{X402-SURFACE,ALLOWANCE,SEED-VAULT,MERCHANT-TRACK}.md`, `probes/{g02-local,g02-real,g04-local-facilitator,g04-live,verify-seedvault}.mjs`, `probes/g04-local-results.json`, `vendor/nuntius-mandate/`, `apps/seeker-probe/`, `apps/seeker-probe-native/`.

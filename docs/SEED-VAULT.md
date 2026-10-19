# SEED-VAULT — gate G0.3 (2026-10-19)

Question: does Seed Vault `signMessages` over an iussum summary line work, and what does the user see?

## Status: all three samples run on the Seeker 2026-10-19 (SHORT 16:27, MULTILINE 16:33:12, LONG 16:33:36; device `the Seeker`, model "Seeker", Android 16). Signatures verified. **Finding: Seed Vault does not show the message text.**

Release APK: `apps/seeker-probe/iussum-probe-release.apk` (30,700,943 bytes, sha256 `a8a9f6299103ed26975741651ad0b258c30ff2d00813a20b88371eb20bbd52b8`, package `app.ochinimus.iussumprobe`, arm64-v8a, signed with the Android debug certificate: a probe, never for a store). Installed with `adb install -r`, `Success`.

## Result (SHORT 162 B first; MULTILINE and LONG below)

From `adb logcat -s ReactNativeJS` (tag `IUSSUM_PROBE`):

```
OK SHORT  sent_len=162  returned_len=64  returned_starts_with_message=false
account_label=DAPP  address_b64=jC2Y1rBAjZ4iTYMWndnrYIgCjyEnQdGPkj7yMPZQV4g=
returned_b64=XUTKq1QBSgPqKZEhhBhRmprnlfdE2NhZ+HV2LEfG95VxwTYFmSCRtMLEmVVXANxrDXaNu2u24/ih8KKPicvnDg==
```

- Accepted: Seed Vault `signMessages` took a free-text, non-SIWS payload, for all three samples.
- MULTILINE (150 B) and LONG (741 B), same account and layout (`probe log: OK MULTILINE`, `OK LONG`, `returned_len=64` each); both signatures verified in Node (`{"ok":true,"layout":"signature only"}`), and each control (same inputs, message plus one byte) gave `{"ok":false}`. The exact message texts are rebuilt from the probe's constants (the logcat line for LONG is truncated at 200 characters by the probe), lengths checked: 150 and 741 bytes.
- **Returned layout: a 64-byte detached ed25519 signature**, not message||signature (the probe's "starts with message" flag is therefore false by design of the check, not a failure).
- Account: base64 address decodes to base58 `ASCQRp616JVQKMpynYfcPVdKPext719WUf7CuFcnnatX` (checked in Node, `true`), i.e. natX, label `DAPP`.
- Verified in Node: `node probes/verify-seedvault.mjs <address_b64> <returned_b64> <message-file>` on the exact 162-byte message printed `{"ok":true,"layout":"signature only"}`. Negative control (same inputs, message plus one byte): `{"ok":false,...}`. Verifier self-test earlier: good true, tampered false.
- The probe's `transact()` flow showed two sheets: a "Connect / Select a wallet" sheet (cards dapp2, DAPP, ochinimus.skr; DAPP was the one used, which is natX) for `authorize`, then a "Verify" sheet for the message.

## What Seed Vault showed: the message text is never displayed

Evidence: a 67.9 s screen recording of MULTILINE then LONG (`docs/seedvault/sv-multiline-long.mp4`, compressed; one frame per second in `recording-contact-sheet-1fps.png`), plus the earlier one-frame-per-second captures of SHORT in `docs/seedvault/frames/` (`004.png`, `005.png`).

For each of the three messages the "Verify" sheet went through the same two states:
1. About one second: title "Verify", a **"Message ⓘ" box that is a grey loading skeleton (three bars)**, `Wallet DAPP`, `Application ochinimus.app`, Approve DISABLED (`multiline-1-message-skeleton.png`, `long-1-message-skeleton.png`).
2. Then, until you approve (the recording holds this state for about five seconds each time): the Message box is gone and the sheet reads **"Confirm that you are authorized to sign transactions with this wallet."**, `Wallet DAPP`, `Application ochinimus.app`, Approve ENABLED (`multiline-2-approve-ready.png`, `long-2-approve-ready.png`). No message text, no hash, no length.
3. Approve, then a biometric double-tap ("Touch the fingerprint sensor" / "Approved"), then the app receives the signature.

Sampling limit: stills are one per second, so a sub-second state between 1 and 2 is not excluded by the contact sheet; but the Approve button is disabled in state 1 and enabled only in state 2, so the person can only approve from a sheet that shows no message text. The probe also shows no Message content for SHORT (`frames/004.png` skeleton, `frames/005.png` generic text).

Also seen: a first "Connect / Select a wallet" sheet (cards dapp2, DAPP, ochinimus.skr; DAPP is natX) then a "Continue with: DAPP" card with a Connect button; `Application` on every sheet is `ochinimus.app`, the identity URI the app passes.

Consequence for iussum: **what-you-see-is-what-you-sign does not hold for `signMessages` on this Seeker.** The principal signs a 64-byte-detached signature over text the wallet never showed. Whatever the user reads must come from the iussum app itself (as nuntius does with `describeMandate`), and the signed bytes would have to be a transaction Seed Vault renders itself, or a message format Seed Vault does display. Which formats it renders is UNTESTED (below).

## What was built

`/Volumes/D/iussum/apps/seeker-probe/` (Expo 55 / RN 0.83.6, same stack as nuntius). Per Addendum A it starts from nuntius's MWA wiring, copied not edited:

- `transact()` from `@wallet-ui/react-native-kit@4.3.0`, exactly as `/Volumes/D/nuntius/features/wallet/sign-and-send.ts` and `features/account/use-nuntius-auth.ts` import it.
- A FRESH `wallet.authorize({ chain, identity })` inside every `transact()` session, no stored `auth_token`, no reauthorize (the project MWA rule, same comment as `use-nuntius-auth.ts:43-49`).
- `polyfill.js` / `polyfill.native.js` copied from nuntius (`react-native-quick-crypto` install).
- Then, new here: `wallet.signMessages({ addresses: [account.address], payloads: [bytes] })`. The call shape is read from the installed `@wallet-ui/react-native-kit/dist/index.native.mjs` (`signMessages` implementation, lines ~444-457: `addresses` are base64 account addresses, `payloads` are `Uint8Array`).

Three buttons sign one sample each (all generated by the probe, none a real mandate):

| button | content | bytes |
|---|---|---|
| SHORT | `iussum v0.1 \| agent 4ZUJeT13…avTPmSi \| max 2.5 USDC per payment \| 10 USDC per day \| sellers 2 \| until 2026-12-31 \| id 0123456789abcdef` (the brief's summary-line shape, one line) | 162 |
| MULTILINE | the same fields split on `\n` | 150 |
| LONG | SHORT plus 12 padding segments, to find where Seed Vault truncates or scrolls | 741 |

The app prints, per button: lengths, whether the returned bytes start with the message, the account's label, the address, and the returned bytes in base64, and logs the same under tag `IUSSUM_PROBE` (`console.log`).

A first, from-scratch native Kotlin probe (MWA ktx 2.1.1) was built before Addendum A arrived and is kept as a fallback at `apps/seeker-probe-native/` (debug APK builds; never installed).

## Verifier

`probes/verify-seedvault.mjs <address_b64> <returned_b64> <message-file>` checks the ed25519 signature in Node against the account public key, accepting `message||signature` and signature-only layouts. Self-test (known positive, tampered signature, wrong message): `node verify-seedvault.mjs --selftest` printed `good ok:true`, `tamperedSig ok:false`, `wrongMessage ok:false` (2026-10-19).

## Display tests T1, T1b, T2, T3 on devnet (2026-10-19, 16:44 to 17:04)

Probe rebuilt (readable UI, one button per test; APK sha256 `3434e1ed0dd5b9cc0961a08e4bf81f61a4715bdc11f196aa171f7676171dd85d`), natX on devnet (chain `solana:devnet`, devnet RPC only; nothing was sent to mainnet). natX was funded from the throw-away principal with 0.02 SOL and 1 devnet USDC: `probes/fund-natx.mjs`, tx `2BwbGSpyVWiQjHkHXTaqYdyf7FG4id372vn9sk4RM9HSa91eLvrAoZfQo2zF7cNir8scsuAVNgr6rTqxmnW45m8M` (finalized; natX USDC account `D8xY1bx5JwQWdCxPWkXB4R18ieCQQZ58BMzBxBdrHaBP`). The exact T1/T1b transactions were simulated on devnet first (`err` none, memo logged).

**Seed Vault and devnet.** The first T1 press ended with `SolanaMobileWalletAdapterError: java.util.concurrent.CancellationException` and nothing landed (no recording of that press). The Seeker wallet's Network setting was on Mainnet; in the second recording (`t1/t1-recording.mp4`) Settings > Network shows Mainnet checked, a "You're switching to Devnet" confirmation with Continue, then a "Connected to Devnet" toast, and only then did T1 get a sheet and land. That the first failure was caused by the Mainnet setting is inferred, not tested. The wallet's Network setting is therefore still on Devnet (changed by you in the wallet app); switch it back to Mainnet.

### T1: `ApproveChecked` (delegate `4ZUJeT13…avTPmSi`, 2.5 devnet USDC) + Memo (SHORT line), `signAndSendTransactions`
- Landed: **`5gUy9revfEvxKpsnjJ2rR2WnrL13LMrHPaeMweQBU1kxn1m2WQAFRvmZ4CPY2ExJsGuTBVEEG4HkrBCwzE61PF8i`** (devnet, finalized, `err null`, block time 2026-10-19T13:51:52Z, fee payer natX, fee 45,000 lamports). Read back with `getTransaction`: instruction 1 `approveChecked` (delegate `4ZUJeT13…`, amount 2,500,000, owner natX, source `D8xY1bx5…`), instruction 2 the SHORT line as a Memo, and two ComputeBudget instructions that Seed Vault appended (the wallet mutates the transaction, as the x402-wallet README warns).
- **What the "Transaction" sheet showed** (`t1/t1-sheet-*.png`, `t1/t1-recording.mp4`): title Transaction; a token row **`4zMM…ncDU`** (the mint, abbreviated, a "?" icon with a warning badge) with a red-marked **`2.5`**; **Network fee 0.000045 SOL**; a warning "Approving this transaction will allow a third party to spend your asset in the future."; a warning "We don't recognize this domain and don't know if it's safe. Only sign transactions on sites you trust."; Wallet DAPP; Application ochinimus.app; an **"I trust this site" toggle that must be switched on before Approve is enabled**; then Approve, the biometric double tap, a Processing screen, a Success screen.
- **Not shown: the delegate address, and the memo text.** The amount is shown (2.5), as an unlabelled number beside the abbreviated mint, with no "approve" or "spender" wording beyond the generic warning. I looked at the frames of the loaded sheet; I did not scroll it (the recording shows no scroll), so content below the visible area is UNTESTED.
- Sampling note: the recording is full video; the stills are single frames.

### T1b: `Revoke` (natX's USDC account)
- Landed: **`3ivagr9f368SGgGL9mMh6qaofvZFh59vGmLRGcYvMKyqKm7vAEASysptTsDNVBXUfintGie1Vxrg2UZyLgF89C92`** (devnet, finalized, `err null`, fee 25,000 lamports, instruction `revoke`, owner natX, source `D8xY1bx5…`). After it, `getAccountInfo` of natX's USDC account: delegate none.
- Sheet (`t1b/t1b-sheet-trust-off.png`, `t1b/t1b-recording.mp4`): token row `4zMM…ncDU` with a grey **"No change"** badge, Network fee 0.000025 SOL, only the domain warning, Wallet DAPP, Application ochinimus.app, the same "I trust this site" toggle gating Approve. It does not say that a delegation is being removed, and not whose.

### T2: Sign In With Solana, `authorize` with `sign_in_payload`, statement = the SHORT line
- Signed. `sign_in_result.signed_message` decoded (399 bytes) is the standard SIWS text: `ochinimus.app wants you to sign in with your Solana account:` / `ASCQRp61…natX` / blank line / **the SHORT line as the statement** / `URI: https://ochinimus.app` / `Nonce: 90a20b2885c43b33` / `Issued At: 2026-10-19T13:56:03.307Z` / `Expiration Time: 2026-10-19T14:06:03.307Z`. The signature (64 bytes) **verifies in Node against natX over exactly those 399 bytes** (`{"ok":true,"layout":"signature only"}`), and with one byte appended it fails (`ok false`). No transaction, no devnet signature.
- **The "Sign in" sheet did not show the statement.** It showed: title "Sign in", "Continue with:" with the DAPP wallet card (and the ochinimus.skr card below), `Application ochinimus.app`, a Sign in button, then the biometric double tap (`t2/t2-sheet-*.png`, `t2/t2-recording.mp4`). No statement, no nonce, no expiry, no URI.

### T3: tap the info icon next to "Message" on a signMessages sheet: **NOT OBTAINED**
- The "Message ⓘ" label and icon exist only in the loading-skeleton phase of the Verify sheet. At 12 frames per second the skeleton is on screen for about 3 to 4 frames, roughly **0.3 s** (`t3/t3-skeleton-duration-12fps.png`), then the sheet re-lays out to the generic text and the Message box is gone. A person cannot tap the icon in that time.
- I tried three times and all three failed for reasons of my own tooling, not Seed Vault: (1) a timed tap loop started when the wallet window got focus and tapped at the icon's screen position while the sheet was still sliding up; the tap hit the dimmed area and **dismissed the sheet** (`CancellationException`); (2) a poller that detects the skeleton by a pixel and then taps did detect it (16:59:55) but the tap arrived after the 0.3 s was over, and the signature was produced normally (SHORT again, identical bytes to the first run; `t3/recording.mp4`); (3) a rapid tap storm started at the "Continue with" stage toggled the wallet picker between "Select a wallet" and "Continue with" and the sheet was dismissed again (`t3b/recording.mp4`, `t3b/t3b-wallet-picker-flipflop-contact.png`). **The info icon's text is UNKNOWN.**
- A static look for the text in the wallet APKs (`com.solanamobile.wallet`, `/system/app/SeedVault/SeedVault.apk`, pulled read-only) found nothing, but its positive control ("I trust this site" in the same APK) also found nothing, so that search proves nothing.

### What these tests say for iussum
- **Message signing (`signMessages`) and SIWS (`signIn`) show the person nothing of the text.** The SIWS statement and the plain message are both signed blind.
- **A transaction is rendered by the wallet itself, but only as token, amount, fee and generic warnings.** For an ApproveChecked it does not name the delegate (the agent) and does not show a memo. So a mandate summary placed in a Memo is also not read by the person; the amount is the only mandate field visible.
- The only text the person reads is what the iussum app shows before handing off (nuntius's `describeMandate` pattern). The signed bytes should be something the app can bind to that text (for example the app's hash of what it displayed inside the signed payload), and the on-chain amount in an ApproveChecked is the one value Seed Vault does show, so cap values should be built to match it.
- Seed Vault asked for "I trust this site" on every transaction from an unrecognised domain (ochinimus.app); a recognised-domain flow is UNTESTED.

## UNTESTED, with the test

- The info icon's text (T3). Needs a screen recording at a frame rate and a tap method that cannot race the 0.3 s skeleton: for example hold the wallet's loading state longer, or drive the tap from an accessibility service that waits for the node, or find the string in the wallet's resources with a validated search.
- Whether the Transaction sheet scrolls to reveal more (delegate, memo, program) than the visible area.
- What Seed Vault shows for a recognised domain, or after "I trust this site" is on (the toggle was turned on, the visible fields did not change in the recording).
- Whether a SIWS message in a different shape, or `signMessages` of a hash, renders anything. Not tested.
- Whether the first T1 failure was caused by the wallet's Network setting (inferred only).

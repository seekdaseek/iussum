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

## UNTESTED, with the test

- WHY the Message box does not fill: a skeleton that resolves to a generic line suggests the wallet failed to render or chose not to render the payload. Hypotheses, none tested: it renders only SIWS-formatted messages (test: sign a message built by `createSignInMessage` / the SIWS template for `ochinimus.app`); it renders only below some length (SHORT was 162 B, so not a pure length cap); it needs `signIn` rather than `signMessages` (test: `wallet.authorize({ sign_in_payload })`). The ⓘ next to "Message" was not tapped; its text may explain (test: tap it while the skeleton shows, or after).
- Whether `signAndSendTransactions` / `signTransactions` of a memo-style transaction carrying the summary line is rendered by Seed Vault (nuntius shows a finite amount for its grant, per its JUDGE_GUIDE); test: sign a transaction containing the summary line as a Memo instruction and read the sheet.
- Whether the sheet's "Application ochinimus.app" can say iussum: it is the identity URI the app passes.

# TWINS (gate G0.1) — as of 2026-10-19

Method: read-only. Repos shallow-cloned to /tmp/twins-ro/ (only). Every claim below has a URL or repo path+commit that I read; things I did not read are in the last section.

Test applied to each twin, against iussum's 5 properties:
(a) principal-signed mandate (cap, period budget, pay_to / resource scope, asset, network, window)
(b) agent carries it with each x402 payment
(c) SELLER verifies it BEFORE settling
(d) seller-signed receipt bound to the mandate hash
(e) mechanical liability from the signed artifacts (in scope = principal; out of scope + seller saw mandate = seller; out of scope + none presented = agent operator)

---

## 1. Closest twins (not in the original task list, found by search)

### 1.1 whoyoujoshin/aether — `paywall` spending mandates (SELLER-SIDE GATE EXISTS, own chain)
- Repo https://github.com/whoyoujoshin/aether, HEAD 06799db (2026-10-19). Mandate commit bdc2bf2 "Spending mandates: an owner's signed scope for an agent's payments", 2026-10-19T00:57Z (first commit touching paywall/mandate.go: today).
- Read: docs/MANDATES.md, README lines 262-266/325-336, paywall/mandate.go func list, paywall/paywall.go.
- Does: owner signs (ML-DSA-44) {maxPerPayment, maxTotal, payTo[], notBefore, expires, agent, network, purpose}. Agent sends it base64 in header `X-AETHER-MANDATE` on every paid request. Seller runs `paywall --mandates checked|required`; BEFORE payment it checks signature, network, window, price <= maxPerPayment, own payee in payTo; refuses 403 `MANDATE_REQUIRED`/`MANDATE_REFUSED`. AFTER payment checks payer == mandate.agent; passes owner to upstream in `X-Aether-Mandate-Owner`.
- Chain: Aether (own Cosmos SDK PoW chain, testnet `aether-testnet-1`); also offers x402 v2 `exact` on `cosmos:aether-testnet-1`. Not Solana/EVM/Base.
- Liability: none. MANDATES.md says "A statement, not a lock"; maxTotal "stated for the record" (a single seller cannot sum other sellers' payments); no revocation in v1.
- Receipts: paywall has `Receipts` signing (paywall/receipt.go). SETTLED 2026-10-19 by reading mandate.go and receipt.go in full (see section 7): the receipt is NOT bound to the mandate.
- Properties: a partial (no resource prefixes, no period budget enforced, no asset field beyond price denom), b yes, c YES, d NO, e NO.
- iussum differs: x402-native chains (Solana/EVM), resource-prefix scope, period budget, receipt bound to mandate hash, mechanical liability. Risk: same idea, 1 day old, one dev; trivially extendable by them.

### 1.2 x402-foundation/x402 PR #3376 — `authorization-evidence` extension (SELLER-SIDE GATE, code, unmerged)
- https://github.com/x402-foundation/x402/pull/3376 by saneGuy (Bolyra), opened 2026-09-05, last update 2026-09-08, OPEN, 0 reviews, bot says commits unverified (signing required). Spec read at head 2649525 (saneGuy/x402): specs/extensions/authorization_evidence.md. Related issue https://github.com/x402-foundation/x402/issues/3230 and https://github.com/x402-foundation/wg-identity/issues/29 (updated 2026-10-15).
- Does: server advertises HMAC-signed challenge in `PaymentRequired.extensions.authorization-evidence`; client echoes it plus opaque `evidence` (operator-signed spend mandate, Bolyra format) in `PaymentPayload.extensions`; server in `onBeforeVerify` checks challenge, payee coverage (audience covers payTo), replay, then spawns an External Verifier Contract (EVC) verifier -> allow/deny; fails closed. "The facilitator is not involved." Tests claimed 28/28 (PR body, not run by me).
- Mandate is opaque to x402: operator signs {agent_name, project_key(audience=payee), program, model, capabilities, expiry} per wg-identity#29 body; no cap/period/resource fields in the x402 profile as described. EVC spec itself: https://github.com/bolyra/bolyra/blob/main/spec/external-verifier-contract-v1.md (clone HEAD 5085bc7, 2026-10-18). grep of README/spec/docs found no liability/dispute allocation (only an operator-liability mention in docs/mpp-authorization-companion.md:26).
- Properties: a partial (operator-signed, scope per verifier), b YES (PaymentPayload.extensions), c YES (code), d NO (receipt not bound; Bolyra markets "signed action receipts" for MCP tool calls, not read for x402), e NO.
- iussum differs: explicit open mandate schema with cap/period/pay_to/resource-prefix, receipt-to-mandate hash binding, deterministic liability. Not merged, no maintainer review.

### 1.3 x402-foundation/x402 PR #3220 — `authority` extension (spec + vectors, no x402 wire binding yet)
- https://github.com/x402-foundation/x402/pull/3220 by whawk46, opened 2026-08-20, updated 2026-10-06, OPEN, 0 reviews. Spec read at head 72c3704 (whawk46/x402): specs/extensions/authority.md (646 lines).
- Does: Ed25519-signed Mandate {issuer, subject, asset, cap, perPayment?, recipients[] or "*", accountant, purpose, notAfter, nonce, parent?}; digest bound into the EIP-3009/Permit2 nonce (§7); verifier decodes amount/recipient/asset from the SETTLED artifact and compares to the mandate (§6); append-only spend log with committed head (accountant) or payee attestations for cumulative cap (§8-11); delegation chain (§12). "Counterparty" = any party accepting a payment. Offline verifiable.
- §19 states the x402 binding (advertisement, carriage in PaymentPayload, facilitator vs counterparty verify, refusal signalling) is DEFERRED. grep: no liability/refund/dispute in spec; "receipt" only in motivation.
- Implementations of it: Fizzl13/presign-guard (BUYER-side pre-sign check of §6-7 single payment, per PR comment 2026-10-06; repo HEAD 0ccd1e6 2026-10-19; I read its README only, not src/mandate.js); whawk46/beeai-ashlar-bridge (not read beyond listing). Independent verifiers reported in PR thread (saneGuy, stillmarcus24) — not run by me.
- Properties: a YES (cap, perPayment, recipients, asset, window; no resource-prefix), b deferred, c deferred ("counterparty"), d NO, e NO.
- iussum differs: seller gate + seller-signed receipt + liability rule; no resource-prefix scope here either.

### 1.4 x402-foundation/x402 issue #3693 — `delegation` extension (ak68a; proposal only)
- https://github.com/x402-foundation/x402/issues/3693, opened 2026-10-04, updated 2026-10-15, OPEN, 16 comments (read body + last 6).
- Does: principal-issued JWS grant (principal, agent, audience[], maxAmount, asset/network CAIP, allowedNetworks, allowedRecipients, expiry, id) in `PaymentPayload.extensions.delegation`; FACILITATOR verifies on /verify (not seller); disclosure modes full / attestation / none.
- Liability: not defined, but see §2 comment of 2026-10-15 (ak68a): in full mode the seller "was on notice"; in attestation/none mode a scope dispute is "between the principal and the agent, not the server". This is iussum's liability rule stated in prose, NOT implemented.
- Properties: a YES (spec), b YES (spec), c facilitator, d NO, e prose only. No implementation found.

### 1.5 AP2 (google-agentic-commerce/AP2) — conceptual precedent for (c)+(d)+dispute evidence
- Cloned HEAD e1ea56d (2026-04-29). docs/ap2/specification.md: Merchant verifies Checkout Mandate; Payment/Checkout Receipt `reference` MUST match hash of the closed mandate (lines ~344-365, receipts bound to mandate hash = property d). "Dispute Evidence" section (line 262) says mandates+receipts give "a non-repudiable picture" but "specific details of how this is used for dispute resolution ... are outside the scope". docs/overview.md:39-64 frames liability as the problem, no allocation rule.
- x402 only as samples (code/samples/python/scenarios/a2a/human-not-present/x402/README.md), A2A task metadata, not HTTP 402 PaymentPayload. Card/credential-provider oriented.
- Properties: a yes, b yes, c YES (merchant), d YES, e NO (explicitly out of scope).

### 1.6 Others read, rejected as twins
- CAI mandates (dev.to post "Jul 29", year not stated on page): platform-held mandate {merchant_domain, max_amount_per_payment_usd, daily_cap_usd, allowed_resource_patterns, expires_in_hours}; checked by CAI's prepare endpoint, not by the seller; no liability. https://dev.to/cailab/how-ai-agents-pay-for-apis-x402-payment-mandates-and-the-agent-operating-account-168b (read via fetch summariser). NOTE: has resource-pattern + daily cap fields like iussum, but custodial/platform-side.
- Ramprasad4121/varanasi (HEAD 3912f43, 2026-09-21): EIP-712 mandate + on-chain TaskEscrow on Sepolia, validator-scored release; single merchant; docs/MANDATE.md says dispute arbitration beyond refund-after-expiry NOT modeled. Not seller-gating x402.
- IETF draft-vauban-x402-delegation-binding-01 (2026-05-25, expires 2026-11-26): facilitator/MCP server verify DelegationGrants; seller not named as verifier; no liability. https://datatracker.ietf.org/doc/html/draft-vauban-x402-delegation-binding-01 (via fetch summariser).
- USBVadik/OLP (.kiro spec, pushed 2026-07-15): on-chain payer mandate gateway, custom non-canonical scheme.
- x402 PR #2175 `mandate-bound` scheme (hilarl), CLOSED 2026-08-05. PR #2792 Payment Preflight Record (client-side, open). Both read only as PR body heads.
- SAMMETAMEGHASHYAM/mandateguard (2026-10-19): PayPal buyer-side policy engine. Not x402 seller side.

---

## 2. Twins named in the task

### 2.1 kamiyo-ai x402Resolve
- Repo found at https://github.com/x402kamiyo/x402resolve (the README text itself says `github.com/kamiyo-ai/x402resolve`, which returns 404 via gh API). HEAD 91a8100, 2025-11-09 — stale ~11 months. README read in full.
- Does: Solana (Anchor program, devnet ID E5Eia…) PDA escrow for HTTP-402 APIs; agent locks SOL in escrow, calls API with `X-Payment-Proof: <escrow address>`, oracle (Ed25519-signed or Switchboard) scores response quality 0-100, sliding-scale refund 0-100% from escrow. MCP server with 8 tools.
- Who pays on dispute: the escrow splits per oracle quality score (provider's escrowed funds are refunded pro rata); no principal/agent distinction.
- Seller checks a principal-signed mandate before settling? NO. Middleware checks for an escrow account/payment proof, quality threshold; grep for mandate/principal/delegat in repo = 0 hits.
- iussum differs: scope-liability (authority) vs quality-liability (delivery); no escrow.

### 2.2 x402r (BackTrackCo)
- Docs https://docs.x402r.org (index + llms.txt read via fetch summariser; source mirrored at https://github.com/BackTrackCo/docs, clone HEAD pushed 2026-06-01, local reads of sdk/delivery-protection.mdx, sdk/merchant/refund-handling.mdx, contracts/hooks/refund-request.mdx, contracts/conditions/static-address.mdx, contracts/conditions/custom.mdx, contracts/payment-operator.mdx, x402-integration/overview.mdx).
- Does: `auth-capture` scheme; EVM only (Base, Base Sepolia; more EVM planned); funds in AuthCaptureEscrow, PaymentOperator contract with 10 pluggable condition/hook slots (Static address condition for arbiter, EscrowPeriod, Freeze, custom ICondition). Marketplace model: merchant releases, payer files refund request, arbiter approves/denies, arbiter calls `operator.void()`/`refund()`. Delivery-protection model: arbiter evaluates every transaction, FAIL verdict -> immediate refund, else payer funds return at escrow expiry.
- Arbiter pluggable: yes, by designated address / custom conditions (docs: StaticAddressCondition "Deploy with arbiter address").
- Who pays on dispute: refund comes out of escrow (merchant's pending funds); ReceiverRefundCollector pulls from receiver after capture. No liability rule keyed to a mandate; grep for mandate/principal/delegation in docs repo: only an unrelated "delegation call" gas note.
- Seller checks principal-signed mandate? NO.
- iussum differs: iussum prevents/allocates scope disputes without escrow; x402r handles delivery disputes via escrow+arbiter. Complementary.

### 2.3 nirholas/x402-disputes
- https://github.com/nirholas/x402-disputes, HEAD 104032f (2026-10-11). README read in full; grep mandate/principal/delegat = 0 files.
- Does: paid API ($0.01 open case, $0.001 poll) that hashes evidence, issues HMAC-SHA256 signed case record, signed ruling (free route gated by `X-Arbiter-Key`, default `dev-arbiter-key`) with a "refund instruction naming the payee wallet". Base + Solana rails. Signing is symmetric HMAC (`SIGNING_SECRET`, dev default public) so not third-party verifiable.
- Who pays: ruling names a refund instruction; no enforcement, no liability rule.
- Seller checks mandate? NO. Facilitators: EVM x402.org/facilitator; Solana facilitator.payai.network.

### 2.4 nirholas/x402-refund-hold
- https://github.com/nirholas/x402-refund-hold, HEAD 47da6a2 (2026-10-11). README read in full; grep mandate/principal/delegat = 0 files.
- Does: Express middleware; seller charges, then `hold.capture()` or `hold.refund()` and returns signed (HMAC) record in the 200 body; auto-refund sweep for captured-but-unsettled holds; on-chain refunds if refund keys set, else signed "claims".
- Who pays: the SELLER refunds from its own refund key on failed delivery.
- Facilitator named for solana-devnet / Solana: `https://facilitator.payai.network` (EVM: `https://x402.org/facilitator`). README table lines 101-104.
- Seller checks mandate? NO.

### 2.5 ratum.dev
- Landing page read (fetch summariser). "Ratum" = Danish-based (WieseAI) macOS prototype, not publicly released, desktop app showing AI agents as chat contacts; approval gate; cost tracking of estimated token spend with 70%/90% budget warnings. Page does NOT mention Sikker IT, x402, payments processing, or seller-side checks. Verdict: does not touch payments or seller checks; not a twin. Could not confirm the "Sikker IT" link at all.

---

## 3. x402 issue #3500 (dispute-evidence extension) — read in full
- https://github.com/x402-foundation/x402/issues/3500 by ak68a. Opened 2026-09-16, OPEN, updated 2026-10-15T03:40:27Z. 19 comments read (newest first). Latest activity: 2026-10-15T03:40:27Z, ak68a replying to StratedgeWorkflowSystems (comment 6183861874).
- Shape: "evidence triple" = authorization scope + action (signed receipt) + delta; resolver verifies mechanically; reason codes (scope-exceeded, budget-exceeded, unauthorized resource); Tier 1 mechanical / Tier 2 attested / Tier 3 aggregate (deferred); JCS RFC 8785 + SHA-256; it explicitly does NOT define resolution outcomes or fund reversal ("whether a dispute leads to a refund is a business decision above the protocol").
- Prerequisite 1 (principal-signed authorisation-scope artifact in PaymentPayload.extensions): NOT implemented in merged x402. Proposals/code: #3693 (spec idea only, ak68a), #3220 (object model + vectors, wire binding deferred §19), #3376 (TypeScript code for an opaque operator-signed mandate; unmerged, no review), #3170/#3086 (discussion/proposal). Outside x402 repo: aether paywall (1.1).
- Prerequisite 2 (receipt-to-authorisation hash binding): NOT found implemented anywhere for x402. #3500 body itself says "I have detailed proposals for both ... happy to file them separately"; I found #3693 for prerequisite 1 but did not find a filed issue/PR for prerequisite 2. #3500 comment thread: lobsterbar2027-boop is writing "§5.6" field set into a PR on ak68a/agent-payments-research (a research repo, not x402). magentixai (2026-10-04) mentions a correlation hash committing to the mandate via nonce under #3220. AP2 (1.5) has the receipt-to-mandate hash binding in its own spec only.
- Notable for iussum: StratedgeWorkflowSystems (2026-10-14) proposes the same pivot as iussum's liability rule ("was scope presented before settlement" separates the dispute postures; cites Reg E 12 CFR 1005.2(m)); ak68a accepts the mapping (2026-10-15). Idea is in discussion, no artifact/implementation.
- Related open governance thread: https://github.com/x402-foundation/tsc/issues/4 (post-settlement accountability scope; evidence-record working group; 198 comments, updated 2026-10-19T00:09Z). I only scanned it for "mandate"/"delegation": 28 matching comments, nearly all AI-agent signature boilerplate ("operating under a revocable mandate") — no mandate-extension implementation in them.

---

## 4. Searches run

GitHub CLI (`gh search`; multi-word = AND). Date bound: "after 2026-10-01" means created/updated filters where stated.

Repos:
- "x402 mandate" -> Satianurag/mandate (ETHOnline Ledger-gated BUYER agent; policy in operator, not seller-side), codespar/awesome-agentic-commerce-latam (index).
- "x402 extensions mandate", "x402 agent mandate seller verify", "x402 delegation", "x402 grant principal", "x402 authorization scope", "x402 spending mandate", "x402 principal signed", "AP2 mandate x402", "iussum", "x402 intent mandate", "x402 per-payment cap allowed pay_to", "agent mandate payment", "x402 budget agent", "mandate receipt dispute agent", "x402 agent spending limit", "x402 guardrails", "x402 allowlist payTo", "x402 liability" -> EMPTY.
- "x402 spend policy" -> anilandcode/AgentPayOps (buyer-side finance controls).
- "x402 AP2" -> asm-spec, agentpay, Pink agentic-ai-payments, paypack, countersign-network/packages (control plane; hosted core paused 2026-09-18), Agentic-Proxy-Settlement, algovoi-jcs-conformance-vectors, nullstate etc. (none seller-side mandate).
- "x402 mandate" --created >=2026-10-01 -> EMPTY.
- "x402 mandate" --match readme -> Fizzl13/presign-guard, Ramprasad4121/varanasi, Conxian, etc.; "x402 delegation" --match readme -> vauban x402-stark-receipts-conformance, SoroMandate/Mandate (Soroban), Samdevrel/x402-delegation-audit; "spending mandate" --match readme -> mandateguard, everlist-open-core, mandat-alexa, whoyoujoshin/aether (HIT), JacobEGarcia/allowance.
Issues/PRs:
- "x402 mandate" -> tsc#4, x402#3170, plus unrelated; "x402 delegation" -> only Haven-AI/* (a wallet product's issue tracker; not read beyond titles; budgets enforced by on-chain delegation, buyer side).
- "AP2 mandate x402" -> AP2#265 (open_mandate_hash vectors), others; titles only.
- "x402 mandate extension", "x402 principal grant", "x402 seller verify mandate", "iussum" -> EMPTY (iussum hit only an unrelated Latin-text blog issue).
- "x402 mandate" --updated >=2026-10-01 -> x402#3170, tsc#4 only. "mandate seller x402" --updated >=2026-10-01 -> EMPTY.
- x402-foundation/x402 PR search for mandate / delegation / authority / spending / dispute / authorization: surfaced #3220, #3376, #2175, #2792, #3681 (refund extension), #3604, #3291, #3186, #3682, #3683, #3140, #2666 (titles only for the last several).
Code:
- "x402-mandate" -> USBVadik/OLP, whoyoujoshin/aether docs/MANDATES.md, seancrecord/scvd, NBellic10010/iSub etc.; "iussum" -> unrelated Latin text; "x402 mandate perPayment recipients", "PaymentPayload extensions mandate", "x402 \"mandate\" signature seller", "x402 intent mandate verify" -> EMPTY. (one early run hit the GitHub search rate limit; I re-ran those queries after a pause.)
Web (WebSearch, US-only):
- "iussum mandate x402" -> irrelevant (BMW X4 etc.); no iussum page exists in the index.
- "x402 principal-signed mandate seller verifies before settlement receipt liability" -> wg-identity#29 (EVC), blog comparisons; summariser said no source states who bears liability.
- "AP2 intent mandate x402 extension merchant verifies mandate signature October 2026" -> explainers; sources conflict on who verifies; AP2-native x402 extension reported "pending" (secondary sources, not verified by me).
- "x402 mandate agent spending cap signed by principal resource server rejects out-of-scope payment" -> tx402 (client-side), CAI mandates, Veto post (client-side).
- "agent payment mandate merchant verifies signed receipt dispute mechanical liability ... x402 2026" -> irrelevant legal/card-network pages.
- "x402 extension mandate principal signs agent carries ... pay_to allowlist expiry" -> draft-vauban-x402-delegation-binding-01, Brickken RAMS (vendor).
- "x402r docs escrow refunds arbiter" -> x402r pages.

## 5. Stop condition verdict

PARTIAL: seller-side principal-signed-mandate checking exists (whoyoujoshin/aether paywall, own chain, 2026-10-19; x402 PR #3376 code, unmerged), and mandate-hash-bound receipts + dispute evidence exist in AP2 (liability explicitly out of scope), but NO implementation combines seller gating with mechanical liability allocation, so the stop condition (the conjunction) is NOT met; the liability rule exists only as discussion in x402#3500 (2026-10-14/15).

## 6. UNTESTED / could not read

- Nothing was executed or run by me: no test suites, no verifiers, no conformance vectors. Test counts (28/28, 571/571, 39/39) are claims from PR text.
- aether paywall mandate code: SUPERSEDED, mandate.go (326 lines) and receipt.go (head, 140 of 415 lines, plus repo-wide grep) were read in full on 2026-10-19, see section 7. Still not run: aether's tests. Repo is 1 day old in this feature.
- x402r: docs.x402r.org read through a fetch summariser plus the mirrored docs repo; Solidity contracts not read; BackTrackCo/arbiter-examples#15 not read.
- ratum.dev: landing page only, via summariser; "Sikker IT" connection unverified.
- kamiyo-ai/x402resolve: org path 404; read x402kamiyo/x402resolve README only (not program source or middleware).
- nirholas repos: READMEs only (+ grep for mandate terms); src not read.
- x402#3500: full body and all 19 comments read. x402#3693: body + last 6 of 16 comments only. x402#3220: spec read, only last 5 of 63 comments; the other 58 not read. tsc#4: keyword scan only. x402#3376: spec+body, not source. #3230 body only. Bolyra x402-evc profile doc, EVC spec beyond grep: not read.
- ak68a/agent-payments-research (dispute-resolution, active/delegation.md): not read; ACK #217/#179 and MPP #359/#366: not read.
- PRs known only by title/search snippet: #2666, #3140, #3186, #3682, #3683, #3681 (body head only), #3604/#3291/#2792 (body head only). Any of them might bind receipts to an authorization; I did not verify they do not.
- presign-guard src/mandate.js, beeai-ashlar-bridge, Haven-AI, countersign-network, Pink agentic-ai-payments: README/title level only.
- AP2: read local clone at e1ea56d (2026-04-29); repo API showed pushed_at 2026-06-17, so a newer revision may exist and was not read. AP2-native x402 extension status taken from secondary web results only.
- draft-vauban-x402-delegation-binding-01 and the CAI dev.to post read via a fetch summariser, not raw.
- WebSearch is US-only and returned noisy results; absence in search is weak evidence. GitHub code search for "iussum" returns no project hit, but private repos and non-indexed sources are invisible.

---

## 7. G0.1 follow-up (2026-10-19, after the decision to continue): aether and PR #3376 read, fields mapped

Read by me, not by the research agent: `/tmp/twins-ro/aether` at 06799db (`git fetch` shows origin/HEAD still 06799db, 2026-10-19), files `paywall/mandate.go` (all 326 lines), `paywall/receipt.go` (lines 1-140 in full: the Receipt struct, `ReceiptSigningMessage`, delegation), repo-wide grep; and `/tmp/twins-ro/ae-3376.md` (the PR #3376 spec as saved by the agent, first 200 lines). Nothing was run.

### 7.1 "Receipt not bound to the mandate": SETTLED, it is not

- `Receipt` has 17 fields (`receipt.go:44-69`): x402Version, network, payTo, payer, scheme, payment, amount, method, host, path, requestHash, status, responseHash, at, signer, delegation, signature. None names a mandate or its id.
- `ReceiptSigningMessage` signs 13 lines: network, payTo, payer, scheme, payment, amount, method, host, path, requestHash, status, responseHash, at (`receipt.go:90-93`). The mandate id is not among them.
- `grep -i mandate paywall/receipt.go` returns 0 lines. Repo-wide, the lines of `mandate.go` containing "receipt" are `:51`, `:201` and `:206`; in all three the word names the amount format ("as receipts state an amount", `ReceiptAmount`, "a receipt-style amount"), not a link between a receipt and a mandate. `paywall.go` mentions mandates once, as the `Mandates *MandateConfig` config field (`:56-58`).
- Grep control (G1): `grep -i receipt paywall/mandate.go` does return those three lines, so the pattern works on a known positive.
- What the seller does with a checked mandate: `MandatePayerCheck` sets an upstream header `X-Aether-Mandate-Owner` (`mandate.go:312`). It is not written into the signed receipt.

Two further facts from `mandate.go` that matter to iussum:

- **Payer is checked after payment.** `MandateGate` runs before payment with `Payer = ""` (agent unknown) and checks signature, network, window, payTo, owner allow-list, denom and per-payment cap. `MandatePayerCheck` runs after settlement and returns 403 `MANDATE_REFUSED` if `m.Agent != payer` (`CheckMandate`: "for agent X, but Y paid"). By then the money has moved, and aether has no refund rule for it. That is the R2/R3 gap iussum's liability rule fills.
- **Not a lock.** The file header says "A mandate is a statement, not a lock: the chain doesn't enforce it." `MaxTotal` is "stated for the record", a seller cannot sum other sellers' payments. No period budget, no resource scope, no revoke.

### 7.2 Field mapping (iussum v0.1 §4 to aether `Mandate` to PR #3376 `authorization-evidence`)

PR #3376 treats the mandate as opaque (`evidence` is an EVC bundle owned by an external verifier; the extension never inspects it), so its column is what the extension itself carries or checks.

| iussum v0.1 | aether `Mandate` (mandate.go) | PR #3376 |
|---|---|---|
| `v: "iussum/0.1"` | `v` int, `MandateVersion = 1` | `info.profile: "authorization-evidence/0"` |
| `principal` | `owner` (address) + `ownerPubKey` (ML-DSA-44) | operator, inside the opaque bundle |
| `agent` | `agent` (account address); checked AFTER payment | inside the bundle (the agent identity is the verifier's concern) |
| `network` | `network` (chain ID), checked pre-payment | x402 context in the EVC envelope (`x402_evc`), network of the selected requirement |
| `asset` | none as a field; the denom rides inside the `maxPerPayment` string (`50000ibc/…`), `denom` mismatch refused | asset in the `x402_evc` context |
| `per_payment_max` | `maxPerPayment` | not defined by the extension; verifier decides |
| `period_budget`, `period_seconds` | none (`maxTotal`: stated, unenforced) | none |
| `allow.pay_to[]` | `payTo[]` exact match, empty = any payee | server `audience` must cover the requirement's `payTo` (byte-literal by default) |
| `allow.resource_prefix[]` | none | none |
| `not_before`, `expires_at` | `notBefore`, `expires` (unix s) | expiry inside the bundle; challenge `expiresAt` is separate |
| `delegation` (allowance PDA) | none (on-chain grant is outside the mandate) | none |
| `nonce` (mandate identity) | `id` (16 random bytes, hex): identity, not a replay nonce | `info.nonce` is a different thing: a server-minted, HMAC-signed, single-use challenge, reserved before act |
| `id = sha256(JCS(mandate))` | none: `id` is random, content not hashed | none |
| signature over the summary line | ML-DSA-44 over newline-joined fields with a domain prefix (`aether-x402-mandate/v1\n`) | verifier-specific |
| carriage | header `X-AETHER-MANDATE` (base64 JSON) | `PaymentPayload.extensions["authorization-evidence"].info.evidence` |
| receipt binding | none (7.1) | none (`offer-receipt` is a separate extension) |

Overlap that iussum should keep compatible: per-payment cap, pay_to allow-list, network, window, agent, owner/principal. Where iussum adds something neither has: asset as its own field, period budget, resource prefix, on-chain delegation reference, content-hash id, receipt bound to the mandate id, liability rule. Where #3376 has something iussum lacks: a server-minted single-use challenge echoed in `info` (replay protection and binding to one `payTo` and route), and the same `{ info }` wrapper payai requires; both are worth copying (Phase 1 decision, not made here).

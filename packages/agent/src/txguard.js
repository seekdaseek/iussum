// COPIED from /Volumes/D/skrproject/x402-wallet/x402-wallet/src/svm/verify.js (x402-wallet commit 42bdcb7), logic unchanged, header added.
// Throws WalletMutationError if a signer changed anything except ComputeBudget instructions (compute-unit price/limit). iussum uses it on the
// agent payer path: whatever signs the payment transaction may add ComputeBudget instructions and nothing else.
// svm/verify.js — the runtime guard behind the ModifyingSigner.
//
// An MWA / Seed Vault wallet is ALLOWED to modify a transaction before signing —
// but only in ways that cannot move value. The mutation we observe on device is the
// compute-unit price (and a wallet may also touch the compute-unit LIMIT). Both live
// in the ComputeBudget program, which can only change fee / priority: it cannot
// transfer tokens, change a recipient, swap a mint, or add an instruction that does.
//
// This guard decodes the transaction we SENT to the wallet and the one it RETURNED,
// removes every ComputeBudget instruction from both, and asserts the remainder is
// identical: same fee payer, and the same non-ComputeBudget instructions (program +
// accounts + data) in the same order. Accounts are resolved to real pubkeys per
// message, so a wallet ADDING a ComputeBudget instruction (which appends the program
// key and shifts every account index) does not cause a false reject. Anything else —
// a changed transfer amount, a swapped recipient, an added drain instruction, a
// removed instruction — makes the two remainders differ and is rejected.
//
// Address-lookup-table transactions are refused, not passed: their account pubkeys
// cannot be resolved from the message alone, so they cannot be compared safely here.
// x402 micropayments do not use lookup tables.
//
// iussum addition (Addendum P, P3): the lifetime is part of what the signer may not change. The agent records ITS blockhash and last valid block height for the
// reservation and proves expiry about that blockhash; a signer that swapped it would make the proof about a blockhash the payload does not carry. So the recent blockhash
// (`lifetimeToken`) of both messages must be equal, and a durable-nonce lifetime (a first AdvanceNonceAccount instruction) is refused outright: it never expires.

import {
  getTransactionDecoder,
  getCompiledTransactionMessageDecoder,
} from '@solana/kit'

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'

const txDecoder = getTransactionDecoder()
const msgDecoder = getCompiledTransactionMessageDecoder()

export class WalletMutationError extends Error {
  constructor(message, detail) {
    super(message)
    this.name = 'WalletMutationError'
    this.detail = detail
  }
}

const toHex = (u8) => Buffer.from(u8 ?? []).toString('hex')

/**
 * Reduce a base64 wire transaction to the parts a value-moving mutation would touch:
 * its fee payer and its non-ComputeBudget instructions (program + accounts + data),
 * with accounts resolved to base58 pubkeys.
 */
function canonicalize(b64, label) {
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'))
  const { messageBytes } = txDecoder.decode(bytes)
  const msg = msgDecoder.decode(messageBytes)

  if (
    Array.isArray(msg.addressTableLookups) &&
    msg.addressTableLookups.length > 0
  ) {
    throw new WalletMutationError(
      `refusing to verify a transaction that uses address lookup tables (${label})`,
      { label, reason: 'address-table-lookups' },
    )
  }

  const accounts = msg.staticAccounts.map(String)
  const feePayer = accounts[0]
  const first = msg.instructions[0]
  const durable = Boolean(first) && accounts[first.programAddressIndex] === SYSTEM_PROGRAM && first.data?.length >= 4 && Buffer.from(first.data).readUInt32LE(0) === 4 // AdvanceNonceAccount
  const instructions = []
  for (const ix of msg.instructions) {
    const program = accounts[ix.programAddressIndex]
    if (program === COMPUTE_BUDGET) continue // fee / priority only — cannot move value
    instructions.push({
      program,
      accounts: (ix.accountIndices ?? []).map((i) => accounts[i]),
      data: toHex(ix.data),
    })
  }
  return { feePayer, instructions, lifetime: String(msg.lifetimeToken), durable }
}

/**
 * Throw WalletMutationError if the wallet changed anything other than the transaction's
 * ComputeBudget (compute-unit price / limit) instructions. Call it for its throw; it
 * returns nothing.
 *
 * @param {string} sentB64     base64 wire transaction handed to the wallet
 * @param {string} returnedB64 base64 wire transaction the wallet signed and returned
 */
export function assertOnlyComputeBudgetChanged(sentB64, returnedB64, { lifetime = true, durableNonce = true } = {}) {
  const sent = canonicalize(sentB64, 'sent')
  const got = canonicalize(returnedB64, 'returned')

  if (durableNonce && (sent.durable || got.durable)) {
    throw new WalletMutationError('wallet used a durable-nonce lifetime (AdvanceNonceAccount): the payload would never expire, so no expiry can be proven for it', {
      sentDurable: sent.durable,
      returnedDurable: got.durable,
    })
  }
  if (lifetime && sent.lifetime !== got.lifetime) {
    throw new WalletMutationError('wallet changed the transaction lifetime (the recent blockhash)', {
      sent: sent.lifetime,
      returned: got.lifetime,
    })
  }

  if (sent.feePayer !== got.feePayer) {
    throw new WalletMutationError('wallet changed the fee payer', {
      sent: sent.feePayer,
      returned: got.feePayer,
    })
  }

  const sentIx = JSON.stringify(sent.instructions)
  const gotIx = JSON.stringify(got.instructions)
  if (sentIx !== gotIx) {
    throw new WalletMutationError(
      'wallet changed a non-ComputeBudget instruction (amount, recipient, mint, or instruction set)',
      { sent: sent.instructions, returned: got.instructions },
    )
  }
}

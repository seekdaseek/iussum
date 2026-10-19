import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getBase58Decoder,
  getBase64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from '@solana/kit'
import { transact } from '@wallet-ui/react-native-kit'

// Seed Vault display tests (G0.3 follow-up). DEVNET only (chain solana:devnet, devnet RPC).
// nuntius wiring copied: transact(), a FRESH wallet.authorize inside every session, no stored auth_token.
const identity = { name: 'iussum probe', uri: 'https://ochinimus.app', icon: 'favicon.ico' } as const
const chain = 'solana:devnet'
const RPC = 'https://api.devnet.solana.com'

const NATX = 'ASCQRp616JVQKMpynYfcPVdKPext719WUf7CuFcnnatX' as Address
const NATX_USDC_ATA = 'D8xY1bx5JwQWdCxPWkXB4R18ieCQQZ58BMzBxBdrHaBP' as Address
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as Address // Circle devnet USDC
const DELEGATE = '4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi' as Address
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address
const SHORT =
  'iussum v0.1 | agent 4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi | max 2.5 USDC per payment | 10 USDC per day | sellers 2 | until 2026-12-31 | id 0123456789abcdef'

const memoIx = (text: string): Instruction => ({ programAddress: MEMO_PROGRAM, accounts: [], data: new TextEncoder().encode(text) })
const approveCheckedIx = (amount: bigint): Instruction => {
  const data = new Uint8Array(10)
  data[0] = 13 // TokenInstruction::ApproveChecked
  new DataView(data.buffer).setBigUint64(1, amount, true)
  data[9] = 6 // decimals
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [
      { address: NATX_USDC_ATA, role: AccountRole.WRITABLE },
      { address: MINT, role: AccountRole.READONLY },
      { address: DELEGATE, role: AccountRole.READONLY },
      { address: NATX, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  }
}
const revokeIx = (): Instruction => ({
  programAddress: TOKEN_PROGRAM,
  accounts: [
    { address: NATX_USDC_ATA, role: AccountRole.WRITABLE },
    { address: NATX, role: AccountRole.READONLY_SIGNER },
  ],
  data: new Uint8Array([5]), // TokenInstruction::Revoke
})

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const j = (await r.json()) as { result?: T; error?: { message: string } }
  if (j.error || j.result === undefined) throw new Error(`${method}: ${j.error?.message ?? 'no result'}`)
  return j.result
}
const b64ToAddress = (b64: string) => getAddressDecoder().decode(getBase64Encoder().encode(b64) as Uint8Array)

async function signAndSendTx(instructions: Instruction[]) {
  return await transact(async (wallet) => {
    const auth = await wallet.authorize({ chain, identity })
    const account = b64ToAddress(auth.accounts[0]!.address)
    if (account !== NATX) throw new Error(`Seed Vault account is ${account}, not natX`)
    const { value } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }])
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(NATX, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: value.blockhash as never, lastValidBlockHeight: BigInt(value.lastValidBlockHeight) }, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    )
    const tx = compileTransaction(message)
    const sigs = await wallet.signAndSendTransactions({ transactions: [tx as never] })
    return { account, signature: getBase58Decoder().decode(sigs[0] as Uint8Array) }
  })
}

async function siwsAuthorize() {
  return await transact(async (wallet) => {
    const now = Date.now()
    const payload = {
      domain: 'ochinimus.app',
      uri: 'https://ochinimus.app',
      statement: SHORT,
      nonce: Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => b.toString(16).padStart(2, '0')).join(''),
      issuedAt: new Date(now).toISOString(),
      expirationTime: new Date(now + 10 * 60_000).toISOString(),
    }
    const auth = await wallet.authorize({ chain, identity, sign_in_payload: payload })
    const si = auth.sign_in_result
    return { account: b64ToAddress(auth.accounts[0]!.address), signIn: si ? { address: si.address, signed_message: si.signed_message, signature: si.signature } : null }
  })
}

async function signMessageShort() {
  return await transact(async (wallet) => {
    const auth = await wallet.authorize({ chain, identity })
    const bytes = new TextEncoder().encode(SHORT)
    const signed = await wallet.signMessages({ addresses: [auth.accounts[0]!.address], payloads: [bytes] })
    return { account: b64ToAddress(auth.accounts[0]!.address), returnedLen: signed[0]!.length, returnedHex: Array.from(signed[0]!).map((b) => b.toString(16).padStart(2, '0')).join('') }
  })
}

export default function App() {
  const [out, setOut] = useState('devnet only. tap a test.')
  const run = async (label: string, fn: () => Promise<unknown>) => {
    setOut(`${label}\nwaiting for Seed Vault...`)
    try {
      const res = await fn()
      const text = `${label}\nOK\n${JSON.stringify(res, null, 2)}`
      console.log('IUSSUM_PROBE ' + text)
      setOut(text)
    } catch (e) {
      const text = `${label}\nFAILED\n${String(e)}`
      console.log('IUSSUM_PROBE ' + text)
      setOut(text)
    }
  }
  const Btn = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={{ backgroundColor: '#1f6feb', borderRadius: 8, paddingVertical: 14, paddingHorizontal: 12, marginBottom: 8 }}>
      <Text style={{ color: '#ffffff', fontSize: 15, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  )
  return (
    <View style={{ flex: 1, backgroundColor: '#0b0f14', paddingTop: 56, paddingHorizontal: 16 }}>
      <Text style={{ color: '#ffffff', fontSize: 13, marginBottom: 12 }}>iussum probe, devnet, natX</Text>
      <Btn title="T1  ApproveChecked 2.5 USDC + Memo" onPress={() => run('T1 ApproveChecked + Memo', () => signAndSendTx([approveCheckedIx(2_500_000n), memoIx(SHORT)]))} />
      <Btn title="T1b  Revoke" onPress={() => run('T1b Revoke', () => signAndSendTx([revokeIx()]))} />
      <Btn title="T2  Sign In With Solana (statement = SHORT)" onPress={() => run('T2 SIWS', siwsAuthorize)} />
      <Btn title="T3  signMessages SHORT (tap the info icon)" onPress={() => run('T3 signMessages SHORT', signMessageShort)} />
      <ScrollView style={{ marginTop: 8, backgroundColor: '#161b22', borderRadius: 8, padding: 12, flex: 1 }}>
        <Text selectable style={{ color: '#ffffff', fontFamily: 'monospace', fontSize: 11 }}>{out}</Text>
      </ScrollView>
    </View>
  )
}

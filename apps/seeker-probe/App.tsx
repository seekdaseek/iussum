import { useState } from 'react'
import { Button, ScrollView, Text, View } from 'react-native'
import { transact } from '@wallet-ui/react-native-kit'

// G0.3 probe. Copies the nuntius wiring (features/wallet/sign-and-send.ts): transact() from
// @wallet-ui/react-native-kit, a FRESH wallet.authorize inside every session, no stored auth_token.
// It asks Seed Vault to signMessages over a sample iussum summary line and prints what comes back.
// Nothing is sent to any network.
const identity = { name: 'iussum probe', uri: 'https://ochinimus.app', icon: 'favicon.ico' } as const
const SHORT =
  'iussum v0.1 | agent 4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi | max 2.5 USDC per payment | 10 USDC per day | sellers 2 | until 2026-12-31 | id 0123456789abcdef'
const MULTI =
  'iussum v0.1\nagent 4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi\nmax 2.5 USDC per payment\n10 USDC per day\nsellers 2\nuntil 2026-12-31\nid 0123456789abcdef'
const LONG = SHORT + ' | ' + Array.from({ length: 12 }, (_, i) => `pad${i + 1} ${'x'.repeat(40)}`).join(' | ')

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const toB64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0)
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < b.length ? B64[n & 63]! : '=')
  }
  return s
}

export default function App() {
  const [out, setOut] = useState('tap a button')
  const run = async (label: string, text: string) => {
    setOut(`${label}: waiting for Seed Vault...`)
    try {
      const bytes = new TextEncoder().encode(text)
      const res = await transact(async (wallet) => {
        const auth = await wallet.authorize({ chain: 'solana:devnet', identity })
        const account = auth.accounts[0]!
        const signed = await wallet.signMessages({ addresses: [account.address], payloads: [bytes] })
        return { addressB64: account.address, label: account.label ?? null, signed }
      })
      const s = res.signed[0]!
      const prefixIsMessage = s.length >= bytes.length && bytes.every((b, i) => s[i] === b)
      const lines = [
        `OK ${label}`,
        `sent_len=${bytes.length}`,
        `returned_len=${s.length}`,
        `returned_starts_with_message=${prefixIsMessage}`,
        `extra_bytes=${s.length - bytes.length}`,
        `account_label=${res.label}`,
        `address_b64=${res.addressB64}`,
        `message_utf8=${text.length > 200 ? text.slice(0, 200) + '...' : text}`,
        `returned_b64=${toB64(s)}`,
      ].join('\n')
      console.log('IUSSUM_PROBE ' + lines)
      setOut(lines)
    } catch (e) {
      const msg = `FAILED ${label}: ${String(e)}`
      console.log('IUSSUM_PROBE ' + msg)
      setOut(msg)
    }
  }
  return (
    <View style={{ flex: 1, paddingTop: 64, paddingHorizontal: 16 }}>
      <Button title={`sign SHORT (${SHORT.length} B)`} onPress={() => run('SHORT', SHORT)} />
      <Button title={`sign MULTILINE (${MULTI.length} B)`} onPress={() => run('MULTILINE', MULTI)} />
      <Button title={`sign LONG (${LONG.length} B)`} onPress={() => run('LONG', LONG)} />
      <ScrollView style={{ marginTop: 16 }}>
        <Text selectable style={{ fontSize: 11 }}>{out}</Text>
      </ScrollView>
    </View>
  )
}

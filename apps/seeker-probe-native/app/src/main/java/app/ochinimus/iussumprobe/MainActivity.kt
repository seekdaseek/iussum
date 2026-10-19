package app.ochinimus.iussumprobe

import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import com.solana.mobilewalletadapter.clientlib.ActivityResultSender
import com.solana.mobilewalletadapter.clientlib.ConnectionIdentity
import com.solana.mobilewalletadapter.clientlib.MobileWalletAdapter
import com.solana.mobilewalletadapter.clientlib.Solana
import com.solana.mobilewalletadapter.clientlib.TransactionResult
import kotlinx.coroutines.launch

// G0.3 probe: ask Seed Vault to signMessages over a sample iussum summary line, show what comes back.
// Nothing is sent to any network. A fresh MobileWalletAdapter per click (no stored auth token, no reauthorize).
class MainActivity : ComponentActivity() {
    private lateinit var out: TextView
    private lateinit var sender: ActivityResultSender

    private val SHORT = "iussum v0.1 | agent 4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi | max 2.5 USDC per payment | 10 USDC per day | sellers 2 | until 2026-12-31 | id 0123456789abcdef"
    private val LONG = SHORT + " | " + (1..12).joinToString(" | ") { "pad$it " + "x".repeat(40) }
    private val MULTI = "iussum v0.1\nagent 4ZUJeT13Kqtv9H6G64QLe5a5EUar2L927nBcYavTPmSi\nmax 2.5 USDC per payment\n10 USDC per day\nsellers 2\nuntil 2026-12-31\nid 0123456789abcdef"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        sender = ActivityResultSender(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 64, 32, 32) }
        out = TextView(this).apply { textSize = 11f; setTextIsSelectable(true) }
        for ((label, msg) in listOf("sign SHORT (1 line, ${SHORT.length} B)" to SHORT, "sign MULTILINE (${MULTI.length} B)" to MULTI, "sign LONG (${LONG.length} B)" to LONG)) {
            root.addView(Button(this).apply { text = label; setOnClickListener { run(msg) } })
        }
        root.addView(ScrollView(this).apply { addView(out) })
        setContentView(root)
    }

    private fun run(msg: String) {
        out.text = "waiting for Seed Vault...\n"
        lifecycleScope.launch {
            val mwa = MobileWalletAdapter(ConnectionIdentity(Uri.parse("https://ochinimus.app"), Uri.parse("favicon.ico"), "iussum probe"))
            mwa.blockchain = Solana.Devnet
            val bytes = msg.toByteArray(Charsets.UTF_8)
            val res = mwa.transact(sender) { auth ->
                val addr = auth.accounts[0].publicKey
                val r = signMessagesDetached(arrayOf(bytes), arrayOf(addr))
                Triple(addr, bytes, r.messages[0])
            }
            val text = when (res) {
                is TransactionResult.Success -> {
                    val (addr, sent, signed) = res.payload
                    val b64 = { b: ByteArray -> Base64.encodeToString(b, Base64.NO_WRAP) }
                    "OK\naddress_b64=${b64(addr)}\nsent_len=${sent.size}\nreturned_message_len=${signed.message.size}\nreturned_message_equals_sent=${signed.message.contentEquals(sent)}\nsig_count=${signed.signatures.size}\nsig_len=${signed.signatures[0].size}\nsig_b64=${b64(signed.signatures[0])}\nsigned_addr_b64=${b64(signed.addresses[0])}\nmessage_b64=${b64(signed.message)}"
                }
                is TransactionResult.Failure -> "FAILURE ${res.message} :: ${res.e}"
                is TransactionResult.NoWalletFound -> "NO_WALLET ${res.message}"
            }
            Log.i("IUSSUM_PROBE", text)
            out.text = text
        }
    }
}

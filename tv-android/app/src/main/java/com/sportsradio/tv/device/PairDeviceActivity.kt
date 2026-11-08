package com.sportsradio.tv.device

import android.app.AlertDialog
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.*
import androidx.activity.ComponentActivity

class PairDeviceActivity: ComponentActivity() {
    private val handler=Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private val refresh=object: Runnable {
        override fun run() {
            val value=DevicePairingRuntime.current()
            val text="${value.status}\n${value.code}\n${DevicePairingRuntime.PAIR_URL}\n${value.message}"
            if(status.text.toString()!=text) status.text=text
            handler.postDelayed(this,500)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState); DevicePairingRuntime.ensure(this)
        val column=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL; setPadding(48,32,48,32) }
        status=TextView(this).apply { textSize=28f; column.addView(this) }
        fun button(text: String, action: () -> Unit)=Button(this).apply { this.text=text; setOnClickListener { action() }; column.addView(this) }
        button("Request New Pairing Code") { DevicePairingRuntime.pair() }.requestFocus()
        button("Rotate Device Credential") { DevicePairingRuntime.rotate() }
        button("Register New Device Identity") {
            AlertDialog.Builder(this).setTitle("Register a new identity?")
                .setMessage("Use only if credentials are lost/rejected. The old account device remains; this does not transfer ownership or change your broadcasting room.")
                .setNegativeButton("Cancel",null).setPositiveButton("Register New") { _,_ -> DevicePairingRuntime.replace() }.show()
        }
        button("Back to Broadcaster") { finish() }
        column.addView(TextView(this).apply { text="Sign in on your phone at the URL above, open My Devices and enter the TV code. Pairing does not start audio or grant capture permission."; textSize=20f })
        setContentView(ScrollView(this).apply { addView(column) })
    }
    override fun onStart() { super.onStart(); handler.post(refresh) }
    override fun onStop() { handler.removeCallbacks(refresh); super.onStop() }
}

package com.sportsradio.tv

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.media.projection.MediaProjectionConfig
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.EditText
import androidx.activity.OnBackPressedCallback
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.sportsradio.tv.capture.*
import java.util.Locale

class MainActivity : ComponentActivity() {
    private lateinit var status: TextView
    private lateinit var levels: TextView
    private lateinit var meter: ProgressBar
    private lateinit var start: Button
    private lateinit var room: TextView
    private lateinit var peers: TextView
    private var pending = false
    private var cancelled = false
    private val handler = Handler(Looper.getMainLooper())
    private val refresh = object : Runnable {
        override fun run() { render(); handler.postDelayed(this, 200) }
    }
    private val navigation = BroadcastActivityLifecycle(
        ensureRoom = { BroadcastRuntime.ensureSession(this) },
        resumeUi = { handler.removeCallbacks(refresh); handler.post(refresh) },
        pauseUi = { handler.removeCallbacks(refresh) },
        backgroundTask = { moveTaskToBack(true) },
        stopBroadcast = {
            cancelled = true
            BroadcastRuntime.captureMetrics.stop(false)
            stopService(Intent(this, CaptureService::class.java))
            BroadcastRuntime.stopMedia()
            CaptureStatus.publish(CaptureSnapshot(message = "Capture stopped. Dismiss any permission prompt before starting again."))
            render()
        }
    )
    private val recordPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (cancelled) { pending = false; render() }
        else if (allowed) requestProjection()
        else fail(CaptureState.DENIED, "Playback recording permission denied. Android requires RECORD_AUDIO for playback capture; no microphone is used.")
    }
    private val projectionConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        pending = false
        if (cancelled) { render(); return@registerForActivityResult }
        if (result.resultCode != RESULT_OK || result.data == null) {
            fail(CaptureState.DENIED, "Projection consent denied. Nothing is being captured.")
        } else try {
            startForegroundService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_START)
                .putExtra(CaptureService.EXTRA_RESULT, result.resultCode).putExtra(CaptureService.EXTRA_DATA, result.data))
            CaptureStatus.publish(CaptureSnapshot(CaptureState.STARTING, message = "Starting playback capture service…"))
        } catch (error: Exception) { fail(CaptureState.ERROR, "Cannot start capture service: ${error.javaClass.simpleName}. Return to this app and retry.") }
        render()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = navigation.onBack()
        })
        window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
        pending = savedInstanceState?.getBoolean("pending") ?: false
        cancelled = savedInstanceState?.getBoolean("cancelled") ?: false
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(48, 32, 48, 32) }
        fun label(text: String, size: Float = 20f) = TextView(this).apply { this.text = text; textSize = size; setPadding(0, 8, 0, 8); column.addView(this) }
        label("SportsRadio TV • Broadcaster 0.3.1", 28f)
        label("Broadcast eligible TV playback to phones. No microphone. Stop/Start requires fresh Android capture consent.")
        label("Android requires recording permission (it may be labelled Microphone) and projection consent for playback capture. Only eligible apps can be captured; this does not bypass their policy.")
        val name = EditText(this).apply { setSingleLine(); setText("Android TV playback"); hint = "Room name"; column.addView(this) }
        val connect = Button(this).apply { text = "Connect / Recover Saved Room"; setOnClickListener { BroadcastRuntime.connect(this@MainActivity) }; column.addView(this) }
        Button(this).apply { text = "Create New Room"; setOnClickListener { BroadcastRuntime.create(name.text.toString()) }; column.addView(this) }
        Button(this).apply { text = "End Room"; setOnClickListener { BroadcastRuntime.end() }; column.addView(this) }
        room = label("")
        start = Button(this).apply {
            text = "Start Broadcasting"; isFocusable = true
            setOnClickListener { begin() }; column.addView(this)
        }
        Button(this).apply {
            text = "Stop Broadcasting"; isFocusable = true
            setOnClickListener { navigation.stop() }
            column.addView(this)
        }
        status = label("")
        meter = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; column.addView(this) }
        levels = label("")
        peers = label("")
        label("Press Home after starting, then play audio in another app. Return here to inspect levels. Five seconds of zero PCM shows a silence warning; silence cannot distinguish paused audio from blocked content.")
        setContentView(ScrollView(this).apply { addView(column) })
        connect.requestFocus(); render()
    }

    private fun begin() {
        if (pending || !BroadcastRuntime.state.ready) return
        pending = true; cancelled = false; render()
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) requestProjection()
        else recordPermission.launch(Manifest.permission.RECORD_AUDIO)
    }
    private fun requestProjection() {
        try {
            val manager = getSystemService(MediaProjectionManager::class.java)
            val intent = if (android.os.Build.VERSION.SDK_INT >= 34)
                manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                else manager.createScreenCaptureIntent()
            projectionConsent.launch(intent)
        } catch (_: Exception) { fail(CaptureState.UNSUPPORTED, "This TV cannot open projection consent. No capture was started.") }
    }
    private fun fail(state: CaptureState, message: String) {
        pending = false; CaptureStatus.publish(CaptureSnapshot(state, message = message)); render()
    }
    private fun render() {
        fun TextView.show(value: CharSequence) { if (text.toString() != value.toString()) text = value }
        val value = CaptureStatus.snapshot
        val active = value.state in setOf(CaptureState.STARTING, CaptureState.CAPTURING, CaptureState.SILENT)
        val connection = BroadcastRuntime.state
        start.isEnabled = !pending && !active && connection.ready && !connection.busy
        room.show("Room: ${connection.code.ifBlank { "—" }} • ${connection.name}\nListeners: ${connection.members.size} • ${if (connection.broadcasting) "Broadcast active" else "Stopped"}\n${connection.message}\nPhone: ${BroadcastRuntime.LISTENER}")
        val metrics = BroadcastRuntime.captureMetrics.snapshot()
        peers.show("${metrics.status}\nSession PCM windows: ${metrics.windows} | above-threshold windows: ${metrics.nonzero}" +
            "\nRolling 5s: ${metrics.rollingWindows} windows | ${metrics.rollingNonzero} nonzero | RMS %.6f | peak %.6f".format(Locale.US, metrics.rms, metrics.peak) +
            "\nLast signal: ${metrics.sinceSignalMs?.let { "$it ms ago" } ?: "never this session"} | restarts: ${metrics.restarts} | interruptions: ${metrics.interruptions}" +
            "\n" + BroadcastRuntime.diagnostics())
        status.show(if (pending) "Waiting for Android permission / projection consent…" else "${metrics.status}\n${value.state}\n${value.message}")
        val db = value.levels.dbfs
        meter.progress = if (db == null) 0 else (db + 100).toInt().coerceIn(0, 100)
        val dbText = db?.let { String.format(Locale.US, "%.1f dBFS", it) } ?: "−∞ dBFS"
        levels.show(String.format(Locale.US, "RMS: %.6f (%s)    Peak: %.6f\nMeasured PCM windows: %d • PCM16 mono, 48 kHz requested", value.levels.rms, dbText, value.levels.peak, value.frames))
    }
    override fun onStart() { super.onStart(); navigation.onStart() }
    override fun onStop() { navigation.onStop(); super.onStop() } // Home must not stop capture.
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("pending", pending); outState.putBoolean("cancelled", cancelled)
        super.onSaveInstanceState(outState)
    }
    override fun onDestroy() {
        navigation.onDestroy() // Activity finish/recreation never owns the broadcast session.
        super.onDestroy()
    }
}

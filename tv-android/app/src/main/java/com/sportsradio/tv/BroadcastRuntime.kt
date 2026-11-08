package com.sportsradio.tv

import android.content.Context
import android.os.Handler
import android.os.Looper
import com.sportsradio.tv.capture.PcmFrame
import com.sportsradio.tv.room.*
import com.sportsradio.tv.transport.WebRtcAudioTransport

/** Application-owned coordination; no activity, projection Intent or ownership secret in UI state. */
object BroadcastRuntime {
    @Volatile var recordingStatus = "not started"
    val captureMetrics = com.sportsradio.tv.capture.CaptureDiagnostics(android.os.SystemClock::elapsedRealtime)
    val BACKEND = BuildConfig.BACKEND_URL
    val LISTENER = BuildConfig.LISTENER_URL
    private val main = Handler(Looper.getMainLooper())
    private var room: RoomSession? = null
    @Volatile private var transport: WebRtcAudioTransport? = null
    var state = RoomState(); private set
    var peerMessage = "No active audio peers."; private set
    var stopCapture: (() -> Unit)? = null
    private val verificationWorker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val connection = VerifiedConnection(
        verify = { DeploymentGuard.verify() },
        work = { task -> verificationWorker.execute(task) },
        deliver = { task -> main.post(task) },
        waiting = { state = state.copy(busy = true, message = "Verifying backend identity securely…") },
        failed = { message -> state = state.copy(busy = false, message = message) }
    )
    /** Reopening the activity must not replace an existing or reconnecting room session. */
    fun ensureSession(context: Context) { if (room == null) connect(context) }
    fun connect(context: Context) {
        if (room != null && state.connected) { if (!state.ready) room?.recover(); return }
        val application = context.applicationContext
        connection.connect {
            // The old Socket.IO session may have recovered while its independent probe ran.
            if (room != null && state.connected) {
                state = state.copy(busy = false)
                if (!state.ready) room?.recover()
            } else openSession(application)
        }
    }
    private fun openSession(context: Context) {
        state = state.copy(busy = false)
        room?.close()
        room = RoomSession(SocketIoPort(BACKEND, main), EncryptedOwnershipStore(context.applicationContext), BACKEND, { value ->
            val lostReady = state.ready && !value.ready
            state = value
            if (!value.ready) {
                closeTransport()
                if (lostReady) stopCapture?.invoke()
            } else if (value.broadcasting) {
                transport?.peers?.retain(value.members)
                value.members.forEach { transport?.peers?.offer(it) }
            } else transport?.peers?.retain(value.members)
        }, { event, data ->
            if (state.broadcasting) {
                if (event in setOf("listener-joined", "stream-requested"))
                    transport?.peers?.offer(data.optString("listenerSocketId"), event == "stream-requested")
                else transport?.peers?.receive(event, data)
            }
        }, RecoveryScheduler { ms, task ->
            val action = Runnable(task); main.postDelayed(action, ms); { main.removeCallbacks(action) }
        })
        room?.connect()
    }
    fun create(name: String) { room?.register(name) }
    fun end() { connection.cancel(); state = state.copy(busy = false); captureMetrics.stop(false); stopCapture?.invoke(); stopMedia(); room?.end() }
    fun prepare(context: Context) {
        check(state.ready && state.connected) { "Create or recover a room before broadcasting." }
        closeTransport()
        transport = WebRtcAudioTransport(context.applicationContext, main,
            { event, target, payload -> room?.send(event, target, payload) },
            { peerMessage = it }, { stopCapture?.invoke() })
    }
    /** Called on the AudioPlaybackCapture worker for EVERY PCM frame, before UI sampling. */
    fun push(frame: PcmFrame) { captureMetrics.frame(frame.samples); transport?.pcm?.push(frame.samples, frame.sampleRate, frame.channels) }
    fun announce() { check(transport != null && state.ready); room?.broadcast(true) }
    private fun closeTransport() { val previous = transport; transport = null; previous?.close() }
    fun stopMedia() { closeTransport(); room?.broadcast(false); peerMessage = "Broadcast stopped. Playback PCM released." }
    fun pollDiagnostics() { transport?.sample() }
    fun diagnostics(): String {
        val active = transport ?: return peerMessage

        return "${active.diagnosticSummary()}\n$peerMessage\nPeers: ${active.peers.count()} • RTP packets: ${active.packetsSent} • bytes: ${active.bytesSent}" +
            "\nNative input callbacks: ${active.nativeBlocks} • input energy: ${"%.6f".format(java.util.Locale.US, active.nativeEnergy)}" +
            "\nCaptured PCM blocks pulled: ${active.pcm.delivered}" +
            "\nQueue drops: ${active.pcm.dropped} • underruns: ${active.pcm.underruns}"
    }
    fun shutdown() { connection.cancel(); stopMedia(); room?.close(); room = null; state = RoomState() }
}

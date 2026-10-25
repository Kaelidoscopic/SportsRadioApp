package com.sportsradio.tv.capture

enum class CaptureState { STOPPED, STARTING, CAPTURING, SILENT, ERROR, DENIED, UNSUPPORTED }
data class CaptureSnapshot(
    val state: CaptureState = CaptureState.STOPPED,
    val levels: AudioLevels = AudioLevels(), val frames: Long = 0,
    val message: String = "Ready for playback capture. Create a room to broadcast."
)

/** Lifecycle methods and callbacks are serialized by the owner (service main thread). */
class CaptureController(private val nowMillis: () -> Long, private val changed: (CaptureSnapshot) -> Unit) {
    var snapshot = CaptureSnapshot(); private set
    private var adapter: CaptureAdapter? = null
    private var generation = 0L
    private var lastSignal = 0L
    private fun publish(value: CaptureSnapshot) { snapshot = value; changed(value) }

    fun start(source: CaptureAdapter) {
        if (adapter != null) { if (source !== adapter) source.stop(); return }
        val current = ++generation
        adapter = source; lastSignal = nowMillis()
        publish(CaptureSnapshot(CaptureState.STARTING, message = "Opening playback capture…"))
        try {
            source.start({ frame ->
                if (generation == current) {
                    val levels = AudioLevels.measure(frame.samples)
                    if (levels.rms >= 0.0001) lastSignal = nowMillis()
                    val silent = nowMillis() - lastSignal >= 5000
                    publish(CaptureSnapshot(if (silent) CaptureState.SILENT else CaptureState.CAPTURING,
                        levels, snapshot.frames + 1, if (silent)
                            "No playback signal for 5 seconds. Play an eligible app; it may block capture. Silence alone cannot identify the cause."
                        else "Reading playback PCM. Use Home to open a separate player. Check sender/phone diagnostics separately."))
                }
            }, { error -> if (generation == current) stop(CaptureState.ERROR, error) })
        } catch (error: Exception) { if (generation == current) stop(CaptureState.ERROR, error.message ?: "Capture failed.") }
    }

    fun stop(state: CaptureState = CaptureState.STOPPED, message: String = "Capture stopped. Start again for fresh projection consent.") {
        generation++
        val previous = adapter; adapter = null
        try { previous?.stop() } finally { publish(CaptureSnapshot(state, message = message)) }
    }
}

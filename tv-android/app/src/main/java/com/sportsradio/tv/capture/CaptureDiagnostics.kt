package com.sportsradio.tv.capture

import kotlin.math.sqrt

/** Aggregate metrics only: no audio, source identifiers, room IDs or credentials retained. */
class CaptureDiagnostics(private val now: () -> Long) {
    private data class Window(val at: Long, val count: Int, val energy: Double, val peak: Double, val signal: Boolean)
    private val windows = java.util.ArrayDeque<Window>()
    private var active = false
    private var startedAt = 0L
    private var lastFrame: Long? = null
    private var lastSignal: Long? = null
    private var received = 0L
    private var nonzero = 0L
    private var starts = 0L
    private var interruptions = 0L
    private var interrupted = false
    @Synchronized fun start() {
        if (active) return
        active = true; interrupted = false; starts++; startedAt = now()
        windows.clear(); received = 0; nonzero = 0; lastFrame = null; lastSignal = null
    }
    @Synchronized fun frame(samples: ShortArray) {
        if (!active || samples.isEmpty()) return
        val levels = AudioLevels.measure(samples)
        val at = now(); val signal = levels.rms >= 0.0001
        received++; if (signal) { nonzero++; lastSignal = at }
        lastFrame = at
        windows.addLast(Window(at, samples.size, levels.rms * levels.rms * samples.size, levels.peak, signal))
        prune(at)
        // Bound memory even if a faulty clock or source floods callbacks.
        while (windows.size > 2000) windows.removeFirst()
    }
    private fun prune(at: Long) { while (windows.isNotEmpty() && at - windows.first.at >= 5000) windows.removeFirst() }
    @Synchronized fun stop(unexpected: Boolean) {
        if (!active) return
        active = false; interrupted = unexpected
        if (unexpected) interruptions++
    }
    @Synchronized fun snapshot(): CaptureMetrics {
        val at = now(); prune(at)
        val count = windows.sumOf { it.count.toLong() }
        val state = when {
            !active -> if (interrupted) "Capture interrupted" else "Capture stopped"
            at - (lastFrame ?: startedAt) >= 5000 -> "Capture interrupted: no PCM buffers"
            at - (lastSignal ?: startedAt) >= 5000 -> "Capturing silence: source may be paused, ineligible or restricted"
            lastSignal == null -> "Waiting for audio signal"
            else -> "Capturing audio"
        }
        return CaptureMetrics(state, received, nonzero, windows.size, windows.count { it.signal },
            if (count == 0L) 0.0 else sqrt(windows.sumOf { it.energy } / count),
            windows.maxOfOrNull { it.peak } ?: 0.0, lastSignal?.let { at - it },
            lastFrame?.let { at - it }, starts, (starts - 1).coerceAtLeast(0), interruptions)
    }
}
data class CaptureMetrics(val status: String, val windows: Long, val nonzero: Long,
    val rollingWindows: Int, val rollingNonzero: Int, val rms: Double, val peak: Double,
    val sinceSignalMs: Long?, val sinceFrameMs: Long?, val starts: Long, val restarts: Long, val interruptions: Long)

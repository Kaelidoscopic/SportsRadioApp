package com.sportsradio.tv

/** Activity visibility owns UI work only; the foreground service owns capture/media. */
class BroadcastActivityLifecycle(
    private val ensureRoom: () -> Unit,
    private val resumeUi: () -> Unit,
    private val pauseUi: () -> Unit,
    private val backgroundTask: () -> Unit,
    private val stopBroadcast: () -> Unit
) {
    fun onStart() { ensureRoom(); resumeUi() }
    fun onStop() = pauseUi()
    fun onDestroy() = pauseUi()
    fun onBack() = backgroundTask()
    fun stop() = stopBroadcast()
}

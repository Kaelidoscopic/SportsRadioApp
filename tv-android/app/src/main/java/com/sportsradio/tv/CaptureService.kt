package com.sportsradio.tv

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import com.sportsradio.tv.capture.*

class CaptureService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var projection: MediaProjection? = null
    private var projectionCallback: MediaProjection.Callback? = null
    private var foreground = false
    private lateinit var controller: CaptureController
    private var closing = false

    override fun onCreate() {
        super.onCreate()
        controller = CaptureController(SystemClock::elapsedRealtime) { value ->
            CaptureStatus.publish(value)
            if (value.state == CaptureState.ERROR) finishSession()
        }
        BroadcastRuntime.stopCapture = {
            controller.stop(CaptureState.STOPPED, "Broadcast interrupted/stopped. Recover the room if needed, then Start Broadcasting for fresh consent.")
            finishSession()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (closing) { stopSelf(); return START_NOT_STICKY }
        if (intent?.action == ACTION_STOP) {
            controller.stop(); finishSession(); return START_NOT_STICKY
        }
        if (intent?.action != ACTION_START || projection != null) {
            if (projection == null) stopSelf()
            return START_NOT_STICKY
        }
        try {
            val data = if (android.os.Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_DATA, Intent::class.java)
                else @Suppress("DEPRECATION") (intent.getParcelableExtra(EXTRA_DATA) as? Intent)
            requireNotNull(data) { "Projection consent is missing. Start capture again." }
            require(intent.getIntExtra(EXTRA_RESULT, 0) == android.app.Activity.RESULT_OK) { "Projection consent was denied." }
            // Android 14+: consent first, then foreground service, then getMediaProjection.
            beginForeground()
            val active = requireNotNull(getSystemService(MediaProjectionManager::class.java)
                .getMediaProjection(android.app.Activity.RESULT_OK, data)) { "Projection consent did not produce a capture session." }
            projection = active
            val callback = object : MediaProjection.Callback() {
                override fun onStop() {
                    if (projection !== active) return
                    controller.stop(CaptureState.STOPPED, "Android revoked projection. Start again to request fresh consent.")
                    finishSession()
                }
            }
            projectionCallback = callback
            active.registerCallback(callback, handler)
            BroadcastRuntime.prepare(this)
            val native = AndroidPlaybackCaptureAdapter(this, active)
            // Keep control/state callbacks on main. Level UI is sampled at 10 Hz; no frame queue.
            val dispatched = object : CaptureAdapter {
                override fun start(onFrame: (PcmFrame) -> Unit, onFailure: (String) -> Unit) {
                    var last = 0L
                    val pendingFrame = java.util.concurrent.atomic.AtomicBoolean(false)
                    native.start({ frame ->
                        BroadcastRuntime.push(frame) // Full-rate PCM, never the 10 Hz meter sample.
                        val time = SystemClock.elapsedRealtime()
                        if (time - last >= 100 && pendingFrame.compareAndSet(false, true)) {
                            last = time
                            handler.post { pendingFrame.set(false); onFrame(frame) }
                        }
                    }, { error -> handler.post { onFailure(error) } })
                }
                override fun stop() = native.stop()
            }
            controller.start(dispatched)
            if (CaptureStatus.snapshot.state != CaptureState.ERROR) BroadcastRuntime.announce()
        } catch (error: Exception) {
            controller.stop(CaptureState.ERROR, "Cannot capture playback: ${error.javaClass.simpleName}. ${error.message ?: "Try fresh consent or another supported TV."}")
            finishSession()
        } catch (_: LinkageError) {
            controller.stop(CaptureState.ERROR, "Native WebRTC library could not load on this TV. Capture stopped; report device ABI and app version.")
            finishSession()
        }
        return START_NOT_STICKY // Never replay a one-use consent intent after process death.
    }

    private fun beginForeground() {
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel(CHANNEL, "Playback capture", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(this, 1, Intent(this, CaptureService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notice = Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentTitle("SportsRadio TV broadcasting").setContentText("Eligible TV playback audio to room listeners. No microphone.")
            .setContentIntent(open).setOngoing(true)
            .addAction(Notification.Action.Builder(null, "Stop capture", stop).build()).build()
        startForeground(1, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        foreground = true
    }

    private fun finishSession() {
        if (closing) return
        closing = true
        BroadcastRuntime.stopMedia()
        val active = projection; projection = null
        projectionCallback?.let { active?.unregisterCallback(it) }; projectionCallback = null
        active?.stop()
        if (foreground) { stopForeground(STOP_FOREGROUND_REMOVE); foreground = false }
        stopSelf()
    }

    override fun onDestroy() {
        controller.stop(CaptureStatus.snapshot.state.takeIf { it == CaptureState.ERROR } ?: CaptureState.STOPPED,
            CaptureStatus.snapshot.message)
        finishSession(); handler.removeCallbacksAndMessages(null)
        BroadcastRuntime.stopCapture = null
        super.onDestroy()
    }
    override fun onTaskRemoved(rootIntent: Intent?) { controller.stop(); finishSession() }
    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val ACTION_START = "com.sportsradio.tv.START_CAPTURE"
        const val ACTION_STOP = "com.sportsradio.tv.STOP_CAPTURE"
        const val EXTRA_DATA = "projectionConsent"
        const val EXTRA_RESULT = "projectionResult"
        private const val CHANNEL = "playback_capture"
    }
}

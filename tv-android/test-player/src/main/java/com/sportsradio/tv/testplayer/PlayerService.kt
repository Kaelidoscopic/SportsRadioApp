package com.sportsradio.tv.testplayer

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.*
import android.os.IBinder
import kotlin.math.sin

/** A distinct app/UID with explicit positive and negative playback-capture controls. */
class PlayerService : Service() {
    private var track: AudioTrack? = null
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private val diagnostics = object : Runnable {
        override fun run() {
            track?.let {
                android.util.Log.i("SportsRadioPlayer", "playing=${it.playState == AudioTrack.PLAYSTATE_PLAYING} head=${it.playbackHeadPosition} eligible=$eligible")
                handler.postDelayed(this, 2000)
            }
        }
    }
    private var eligible = false
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action !in listOf("allowed", "blocked")) { stopSelf(); return START_NOT_STICKY }
        val blocked = intent?.action == "blocked"
        val notifications = getSystemService(NotificationManager::class.java)
        notifications.createNotificationChannel(NotificationChannel("test_playback", "Test playback", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 1, Intent(this, PlayerActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 2, Intent(this, PlayerService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE)
        startForeground(2, Notification.Builder(this, "test_playback").setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(if (blocked) "Capture-blocked test tone" else "Eligible test tone")
            .setContentText("Separate test app. Stop playback after testing.").setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build()).build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        try {
            release()
            val samples = ShortArray(48000) { (sin(2 * Math.PI * 440 * it / 48000) * 0.08 * Short.MAX_VALUE).toInt().toShort() }
            val audio = AudioTrack.Builder()
                .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setAllowedCapturePolicy(if (blocked) AudioAttributes.ALLOW_CAPTURE_BY_NONE else AudioAttributes.ALLOW_CAPTURE_BY_ALL).build())
                .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(48000).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                .setTransferMode(AudioTrack.MODE_STATIC).setBufferSizeInBytes(samples.size * 2).build()
            track = audio
            check(audio.write(samples, 0, samples.size) == samples.size)
            check(audio.setLoopPoints(0, samples.size, -1) == AudioTrack.SUCCESS)
            eligible = !blocked
            audio.play()
            handler.post(diagnostics)
        } catch (_: Exception) { release(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf() }
        return START_NOT_STICKY
    }
    private fun release() { handler.removeCallbacks(diagnostics); track?.let { try { it.stop() } finally { it.release() } }; track = null }
    override fun onDestroy() { release(); stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}

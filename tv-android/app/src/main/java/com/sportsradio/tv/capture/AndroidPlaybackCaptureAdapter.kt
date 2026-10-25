package com.sportsradio.tv.capture

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Process
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicBoolean

/** The only AudioRecord construction path uses playback configuration, never an audio source. */
class AndroidPlaybackCaptureAdapter(private val context: Context, private val projection: MediaProjection) : CaptureAdapter {
    private val running = AtomicBoolean(false)
    private var worker: Thread? = null

    @SuppressLint("MissingPermission") // Explicit check below; configuration is playback-only.
    override fun start(onFrame: (PcmFrame) -> Unit, onFailure: (String) -> Unit) {
        check(worker == null) { "Capture adapter cannot reuse a projection session." }
        check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            "Android's playback recording permission was not granted."
        }
        val config = AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .excludeUid(Process.myUid()).build()
        val rate = 48000
        val minimum = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        check(minimum > 0) { "This device does not support the requested 48 kHz PCM16 input format." }
        val record = AudioRecord.Builder().setAudioPlaybackCaptureConfig(config)
            .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
            .setBufferSizeInBytes(maxOf(minimum * 2, 480 * 2 * 4)).build()
        try {
            check(record.state == AudioRecord.STATE_INITIALIZED) { "Playback AudioRecord could not initialize." }
            record.startRecording()
            check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Playback recording did not start." }
        } catch (error: Exception) { record.release(); throw error }
        running.set(true)
        worker = Thread({
            val buffer = ShortArray(480)
            var lastRead = SystemClock.elapsedRealtime()
            try {
                Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
                while (running.get()) {
                    val count = record.read(buffer, 0, buffer.size, AudioRecord.READ_NON_BLOCKING)
                    if (!running.get()) break
                    if (count < 0) error("Playback read failed ($count). Stop and request capture again.")
                    if (count > 0) {
                        lastRead = SystemClock.elapsedRealtime()
                        onFrame(PcmFrame(buffer.copyOf(count), record.sampleRate, 1, SystemClock.elapsedRealtimeNanos()))
                    } else {
                        check(SystemClock.elapsedRealtime() - lastRead < 5000) { "No PCM buffers received. Projection may have stopped or this TV may not support playback capture." }
                        Thread.sleep(5)
                    }
                }
            } catch (_: InterruptedException) {
                // Stop interrupts the short idle wait; no blocking read can trap cleanup.
            } catch (error: Exception) {
                if (running.getAndSet(false)) onFailure(error.message ?: "Playback capture failed.")
            } finally {
                running.set(false)
                try { record.stop() } catch (_: IllegalStateException) { /* Projection may already be revoked. */ }
                record.release()
            }
        }, "SportsRadioPlaybackCapture").also {
            try { it.start() } catch (error: Exception) {
                running.set(false)
                try { record.stop() } finally { record.release() }
                throw error
            }
        }
    }

    override fun stop() {
        running.set(false)
        worker?.let {
            it.interrupt()
            if (it !== Thread.currentThread()) it.join()
        }
    }
}

/* SportsRadio playback-only replacement for GetStream WebRTC 1.3.10's Java recording
 * endpoint. JNI signatures match that pinned SDK. This class never opens AudioRecord.
 * All actual capture remains in AndroidPlaybackCaptureAdapter. See WEBRTC-NOTICE.md. */
package org.webrtc.audio;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.SystemClock;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.locks.LockSupport;
import org.webrtc.CalledByNative;
import com.sportsradio.tv.transport.PcmQueue;

/** Internal WebRTC Java/native ABI endpoint. Do not upgrade AAR without ABI checks. */
public final class WebRtcAudioRecord {
  public static final int DEFAULT_AUDIO_SOURCE = 0; // Unused ABI constant, never passed to Android.
  public static final int DEFAULT_AUDIO_FORMAT = 2;
  private long nativeAudioRecord;
  private ByteBuffer buffer;
  private volatile boolean running;
  private volatile boolean muted;
  private volatile PcmQueue pcm;
  private Thread thread;
  private volatile long nativeBlocks;
  private volatile double nativeEnergy;
  private final JavaAudioDeviceModule.AudioRecordErrorCallback errors;
  private final JavaAudioDeviceModule.AudioRecordStateCallback state;

  @CalledByNative WebRtcAudioRecord(Context context, AudioManager manager) {
    this(context, null, manager, 0, 2, null, null, null, false, false);
  }
  public WebRtcAudioRecord(Context context, ScheduledExecutorService scheduler, AudioManager manager,
      int source, int format, JavaAudioDeviceModule.AudioRecordErrorCallback errors,
      JavaAudioDeviceModule.AudioRecordStateCallback state,
      JavaAudioDeviceModule.SamplesReadyCallback samples, boolean aec, boolean ns) {
    this.errors = errors; this.state = state;
  }
  public void setPcmQueue(PcmQueue queue) { pcm = queue; }
  @CalledByNative public void setNativeAudioRecord(long value) { nativeAudioRecord = value; }
  @CalledByNative boolean isAcousticEchoCancelerSupported() { return false; }
  @CalledByNative boolean isNoiseSuppressorSupported() { return false; }
  @CalledByNative boolean isAudioConfigVerified() { return pcm != null; }
  @CalledByNative boolean isAudioSourceMatchingRecordingSession() { return pcm != null; }
  @CalledByNative private boolean enableBuiltInAEC(boolean enable) { return !enable; }
  @CalledByNative private boolean enableBuiltInNS(boolean enable) { return !enable; }
  @CalledByNative private int initRecording(int rate, int channels) {
    if (rate != 48000 || channels != 1 || pcm == null || running) {
      if (errors != null) errors.onWebRtcAudioRecordInitError("Playback PCM input requires mono 48 kHz.");
      return -1;
    }
    buffer = ByteBuffer.allocateDirect(960).order(ByteOrder.nativeOrder());
    nativeCacheDirectBufferAddress(nativeAudioRecord, buffer);
    return 480;
  }
  @CalledByNative private boolean startRecording() {
    if (buffer == null || pcm == null || running) return false;
    running = true;
    thread = new Thread(() -> {
      try {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
        if (state != null) state.onWebRtcAudioRecordStart();
        long next = System.nanoTime();
        while (running) {
          short[] frame = pcm.pull();
          buffer.clear();
          for (short value : frame) buffer.putShort(muted ? (short) 0 : value);
          if (!running) break;
          // Actual PCM enters the SDK's native AudioDeviceBuffer -> encoder here.
          nativeDataIsRecorded(nativeAudioRecord, 960, SystemClock.elapsedRealtimeNanos());
          nativeBlocks++;
          if (!muted) for (short value : frame) { double sample = value / 32768.0; nativeEnergy += sample * sample / 48000.0; }
          next += 10_000_000L;
          long delay = next - System.nanoTime();
          if (delay > 0) LockSupport.parkNanos(delay);
          else if (delay < -50_000_000L) { pcm.clear(); next = System.nanoTime(); }
        }
      } catch (Exception error) {
        if (running && errors != null) errors.onWebRtcAudioRecordError("Playback PCM bridge failed.");
      } finally {
        running = false;
        if (state != null) state.onWebRtcAudioRecordStop();
      }
    }, "SportsRadioWebRtcPcm");
    try { thread.start(); return true; }
    catch (RuntimeException error) {
      running = false; thread = null;
      if (errors != null) errors.onWebRtcAudioRecordStartError(JavaAudioDeviceModule.AudioRecordStartErrorCode.AUDIO_RECORD_START_EXCEPTION, "Playback PCM thread could not start.");
      return false;
    }
  }
  @CalledByNative private boolean stopRecording() {
    running = false;
    Thread previous = thread; thread = null;
    if (previous != null && previous != Thread.currentThread()) {
      previous.interrupt();
      boolean interrupted = false;
      while (previous.isAlive()) try { previous.join(); } catch (InterruptedException e) { interrupted = true; }
      if (interrupted) Thread.currentThread().interrupt();
    }
    buffer = null; if (pcm != null) pcm.clear(); return true;
  }
  void setPreferredDevice(AudioDeviceInfo ignored) { /* Never select a microphone. */ }
  public void setMicrophoneMute(boolean value) { muted = value; } // SDK ABI; zeros PCM only.
  public boolean setNoiseSuppressorEnabled(boolean enabled) { return !enabled; }
  public long getNativeBlocks() { return nativeBlocks; }
  public double getNativeEnergy() { return nativeEnergy; }
  static ScheduledExecutorService newDefaultScheduler() { return Executors.newSingleThreadScheduledExecutor(); }
  private native void nativeCacheDirectBufferAddress(long pointer, ByteBuffer data);
  private native void nativeDataIsRecorded(long pointer, int bytes, long captureTimestampNs);
}

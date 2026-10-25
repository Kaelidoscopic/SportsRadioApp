package com.sportsradio.tv.transport;

import java.util.ArrayDeque;
import java.util.Arrays;

/** Bounded PCM16 mono 48 kHz queue. Reframes partial native reads into 10 ms blocks. */
public final class PcmQueue {
  private final ArrayDeque<short[]> frames = new ArrayDeque<>();
  private short[] partial = new short[480];
  private int used;
  private boolean closed;
  private long dropped, delivered, underruns;
  private double deliveredEnergy;

  public synchronized void push(short[] samples, int rate, int channels) {
    if (closed) return;
    if (rate != 48000 || channels != 1) throw new IllegalArgumentException("Expected PCM16 mono 48 kHz.");
    for (short value : samples) {
      partial[used++] = value;
      if (used == 480) {
        if (frames.size() == 5) { frames.removeFirst(); dropped++; }
        frames.addLast(partial); partial = new short[480]; used = 0;
      }
    }
  }
  public synchronized short[] pull() {
    short[] data = closed ? null : frames.pollFirst();
    if (data == null) { underruns++; return new short[480]; }
    delivered++;
    for (short value : data) { double sample = value / 32768.0; deliveredEnergy += sample * sample / 48000.0; }
    return data;
  }
  public synchronized void clear() { frames.clear(); Arrays.fill(partial, (short) 0); used = 0; }
  public synchronized void close() { clear(); closed = true; }
  public synchronized long getDelivered() { return delivered; }
  public synchronized long getDropped() { return dropped; }
  public synchronized long getUnderruns() { return underruns; }
  public synchronized double getDeliveredEnergy() { return deliveredEnergy; }
}

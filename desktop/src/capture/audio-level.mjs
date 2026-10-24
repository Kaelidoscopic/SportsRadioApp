// Observe the original capture tracks, without replacing or processing sender audio.
export function pcmLevel(channels) {
  let squares = 0, count = 0, peak = 0;
  for (const samples of channels) for (const value of samples) {
    if (!Number.isFinite(value)) continue;
    squares += value * value; count++; peak = Math.max(peak, Math.abs(value));
  }
  const rms = count ? Math.sqrt(squares / count) : 0;
  return { rms, peak, dbfs: rms > 0 ? 20 * Math.log10(rms) : null };
}

export class AudioLevelMonitor {
  constructor({ createContext = () => new AudioContext(), now = () => performance.now() } = {}) {
    this.createContext = createContext; this.now = now; this.context = null;
  }
  start(stream) {
    this.stop(); this.started = this.lastSignal = this.now(); this.lastClock = -1; this.clockUpdated = this.started;
    this.error = null;
    try {
      const context = this.context = this.createContext();
      this.source = context.createMediaStreamSource(stream);
      const count = Math.max(1, Math.min(8, stream.getAudioTracks()[0]?.getSettings?.().channelCount || 2));
      this.splitter = context.createChannelSplitter(count);
      this.sink = context.createGain(); this.sink.gain.value = 0;
      this.source.connect(this.splitter);
      this.analysers = Array.from({ length: count }, (_, channel) => {
        const node = context.createAnalyser(); node.fftSize = 2048;
        this.splitter.connect(node, channel); node.connect(this.sink);
        return { node, samples: new Float32Array(node.fftSize) };
      });
      this.sink.connect(context.destination);
      // Build the consuming graph before resuming; never feed captured audio to speakers.
      context.resume().catch(() => { if (this.context === context) this.error = 'Audio meter could not resume. Stop and start broadcasting.'; });
    } catch { this.stop(); this.error = 'Audio meter unavailable. Capture energy cannot be verified.'; }
  }
  sample() {
    if (!this.context) return { status: this.error ? 'unavailable' : 'stopped', message: this.error || 'Capture stopped.' };
    const now = this.now(), context = this.context;
    if (context.currentTime !== this.lastClock) { this.lastClock = context.currentTime; this.clockUpdated = now; }
    if (this.error || context.state !== 'running' || now - this.clockUpdated > 1500) {
      // A suspended/frozen graph cannot establish that capture is silent.
      this.lastSignal = now;
      return { status: 'unavailable', contextState: context.state, message: this.error || 'Audio meter is paused. Stop and start broadcasting to retry.' };
    }
    const level = pcmLevel(this.analysers.map(({ node, samples }) => { node.getFloatTimeDomainData(samples); return samples; }));
    const audible = level.rms >= 0.0001; // -80 dBFS: signal detection, not a loudness guarantee.
    if (audible) this.lastSignal = now;
    const silent = now - this.lastSignal >= 5000;
    return { ...level, status: audible ? 'signal' : silent ? 'silent' : 'quiet', contextState: context.state,
      message: audible ? 'Playback samples detected.' : silent
        ? 'No playback signal for 5 seconds. Play audio, unmute its application, and route it to the Windows default output in Volume Mixer. After changing outputs, stop and start broadcasting.'
        : 'Waiting for playback audio…' };
  }
  stop() {
    const context = this.context; this.context = null;
    this.source?.disconnect(); this.splitter?.disconnect();
    this.analysers?.forEach(({ node }) => node.disconnect()); this.sink?.disconnect();
    context?.close().catch(() => {}); this.error = null;
  }
}

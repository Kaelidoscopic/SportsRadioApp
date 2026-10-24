export class WindowsLoopbackCapture {
  constructor({ bridge, mediaDevices = navigator.mediaDevices, makeStream = (tracks) => new MediaStream(tracks) }) {
    this.bridge = bridge; this.mediaDevices = mediaDevices; this.makeStream = makeStream;
    this.raw = null; this.generation = 0; this.pending = null; this.onended = () => {};
  }
  start() {
    if (this.pending) return this.pending;
    const generation = ++this.generation;
    const operation = this.acquire(generation);
    this.pending = operation;
    operation.finally(() => { if (this.pending === operation) this.pending = null; }).catch(() => {});
    return operation;
  }
  async acquire(generation) {
    await this.bridge.armCapture();
    if (generation !== this.generation) throw new Error('Capture cancelled.');
    // Electron grants Windows system loopback in main; no microphone or tab picker.
    const raw = await this.mediaDevices.getDisplayMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: { width: 1, height: 1, frameRate: 1 }
    });
    if (generation !== this.generation) { raw.getTracks().forEach((track) => track.stop()); throw new Error('Capture cancelled.'); }
    const audio = raw.getAudioTracks();
    if (!audio.length || audio.some((track) => track.readyState === 'ended')) {
      raw.getTracks().forEach((track) => track.stop()); throw new Error('Windows loopback returned no live audio track. Check your playback output device.');
    }
    this.raw = raw;
    audio.forEach((track) => track.addEventListener('ended', () => {
      if (this.raw !== raw) return;
      this.stop(); this.onended();
    }, { once: true }));
    // Keep the API's video track alive internally for capture compatibility, but never send it.
    return this.makeStream(audio);
  }
  stop() {
    this.generation++; this.pending = null;
    const raw = this.raw; this.raw = null;
    raw?.getTracks().forEach((track) => track.stop());
    this.bridge.disarmCapture().catch(() => {});
  }
}

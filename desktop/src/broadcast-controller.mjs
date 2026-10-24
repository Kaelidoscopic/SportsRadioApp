export class BroadcastController {
  constructor({ capture, transport, bridge, report = () => {} }) {
    this.capture = capture; this.transport = transport; this.bridge = bridge; this.report = report;
    this.wantLive = false; this.ready = false; this.live = false; this.generation = 0; this.pending = null; this.members = [];
    capture.onended = () => { this.stop(); this.report('Playback capture ended. Select Start Broadcasting to retry.'); };
  }
  update(state) {
    const wasReady = this.ready;
    this.ready = state.connected && state.ready;
    this.members = state.members || [];
    this.transport.retain(this.members);
    if (!this.ready) {
      if (wasReady || this.pending || this.live) this.suspend();
      // Keep intent only for transient network loss; explicit room closure cancels it.
      if (state.connected && !state.recovering) this.wantLive = false;
    } else if (!wasReady && this.wantLive) this.start().catch((error) => this.report(error.message));
  }
  start() {
    this.wantLive = true;
    if (!this.ready) { this.wantLive = false; return Promise.reject(new Error('Create or recover a room first.')); }
    if (this.live) return Promise.resolve();
    if (this.pending) return this.pending;
    const generation = ++this.generation;
    const operation = this.begin(generation);
    this.pending = operation;
    operation.finally(() => { if (this.pending === operation) this.pending = null; }).catch(() => {});
    return operation;
  }
  async begin(generation) {
    this.report('Starting Windows playback capture…');
    try {
      const stream = await this.capture.start();
      if (generation !== this.generation) return;
      await this.bridge.broadcast(true);
      if (generation !== this.generation) return;
      this.live = true; this.transport.setStream(stream);
      this.report('Broadcasting Windows playback audio.');
      await Promise.all(this.members.map((id) => this.transport.offer(id)));
    } catch (error) {
      if (generation === this.generation) { this.stop(); throw error; }
    }
  }
  suspend() {
    this.generation++; this.pending = null; this.live = false;
    this.capture.stop(); this.transport.close();
    this.bridge.broadcast(false).catch(() => {});
  }
  stop() { this.wantLive = false; this.suspend(); this.report('Broadcast stopped. Playback capture released.'); }
  signal(message) {
    if (!this.live) return;
    if (['listener-joined', 'stream-requested'].includes(message.event)) {
      if (this.members.includes(message.listenerSocketId)) return this.transport.offer(message.listenerSocketId, message.event === 'stream-requested');
    } else return this.transport.receive(message);
  }
}

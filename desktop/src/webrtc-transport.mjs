import { audioCounters } from './peer-diagnostics.mjs';

export class WebRTCTransport {
  constructor({ signal, report = () => {}, createPeer = () => new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }),
    onDiagnostics = () => {}, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id), answerTimeoutMs = 12000 }) {
    this.signal = signal; this.report = report; this.createPeer = createPeer;
    Object.assign(this, { onDiagnostics, schedule, cancel, answerTimeoutMs });
    this.peers = new Map(); this.stream = null;
  }
  setStream(stream) { this.close(); this.stream = stream; }
  async offer(id, force = false) {
    if (!this.stream || (!force && this.peers.has(id))) return;
    // Requests while a negotiation is pending are coalesced rather than overlapping.
    const old = this.peers.get(id);
    if (old?.negotiating || old?.pc.signalingState === 'have-local-offer') {
      if (force) old.retryRequested = true;
      return;
    }
    this.remove(id);
    const pc = this.createPeer();
    const entry = { pc, incoming: [], outgoing: [], offered: false, negotiating: true, queue: Promise.resolve(),
      diagnostic: { offer: 'pending', answer: 'pending', localIceSent: 0, remoteIceReceived: 0, remoteIceApplied: 0 } };
    this.peers.set(id, entry);
    const current = () => this.peers.get(id) === entry;
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || !current()) return;
      const value = candidate.toJSON ? candidate.toJSON() : candidate;
      if (!entry.offered) entry.outgoing.push(value);
      else { entry.diagnostic.localIceSent++; this.send({ event: 'webrtc-ice-candidate', target: id, candidate: value }); }
    };
    pc.onconnectionstatechange = () => {
      if (!current()) return;
      this.report(`Listener ${id.slice(0, 6)}: ${pc.connectionState}`);
      if (['failed', 'closed'].includes(pc.connectionState)) this.remove(id);
      this.onDiagnostics(this.snapshot());
    };
    pc.oniceconnectionstatechange = () => { if (current()) this.onDiagnostics(this.snapshot()); };
    try {
      for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
      const offer = await pc.createOffer();
      if (!current()) return;
      await pc.setLocalDescription(offer);
      if (!current()) return;
      await this.signal({ event: 'webrtc-offer', target: id, offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      if (!current()) return;
      entry.offered = true;
      entry.diagnostic.offer = 'sent';
      for (const candidate of entry.outgoing.splice(0)) {
        entry.diagnostic.localIceSent++; this.send({ event: 'webrtc-ice-candidate', target: id, candidate });
      }
      if (entry.diagnostic.answer !== 'applied') {
        entry.answerTimer = this.schedule(() => {
          if (!current()) return;
          const retry = entry.retryRequested; this.remove(id);
          this.report('No SDP answer received. Retry audio connection on the listener.');
          if (retry && this.stream) void this.offer(id, true);
        }, this.answerTimeoutMs);
        entry.answerTimer?.unref?.();
      }
      this.onDiagnostics(this.snapshot());
    } catch (error) {
      if (current()) { this.remove(id); this.report(`Could not offer audio (${error?.name || 'Error'}).`); }
    } finally { entry.negotiating = false; }
  }
  send(payload) { Promise.resolve(this.signal(payload)).catch((error) => this.report(`Signaling failed (${error?.name || 'Error'}).`)); }
  receive(message) {
    const entry = this.peers.get(message.sender);
    if (!entry) return Promise.resolve();
    const current = () => this.peers.get(message.sender) === entry;
    entry.queue = entry.queue.then(async () => {
      if (!current()) return;
      if (message.event === 'webrtc-answer') {
        if (entry.pc.signalingState !== 'have-local-offer') return;
        await entry.pc.setRemoteDescription(message.answer);
        if (!current()) return;
        this.cancel(entry.answerTimer);
        entry.diagnostic.answer = 'applied';
        for (const candidate of entry.incoming.splice(0)) {
          if (!current()) return;
          await entry.pc.addIceCandidate(candidate);
          entry.diagnostic.remoteIceApplied++;
        }
        if (entry.retryRequested) { entry.retryRequested = false; queueMicrotask(() => { if (current()) void this.offer(message.sender, true); }); }
      } else if (message.candidate) {
        entry.diagnostic.remoteIceReceived++;
        if (!entry.pc.remoteDescription) entry.incoming.push(message.candidate);
        else { await entry.pc.addIceCandidate(message.candidate); entry.diagnostic.remoteIceApplied++; }
      }
      if (current()) this.onDiagnostics(this.snapshot());
    }).catch((error) => { if (current()) { entry.diagnostic.error = error?.name || 'Error'; this.report(`Peer negotiation failed (${entry.diagnostic.error}).`); } });
    return entry.queue;
  }
  retain(ids) { for (const id of this.peers.keys()) if (!ids.includes(id)) this.remove(id); }
  snapshot() {
    return [...this.peers.values()].map(({ pc, diagnostic }, index) => ({ listener: index + 1, ...diagnostic,
      connection: pc.connectionState || 'new', ice: pc.iceConnectionState || 'new', signaling: pc.signalingState,
      tracks: pc.getSenders?.().filter(({ track }) => track).map(({ track }) => ({ kind: track.kind, enabled: track.enabled, muted: track.muted, state: track.readyState })) || [] }));
  }
  async sample() {
    await Promise.all([...this.peers.entries()].map(async ([id, entry]) => {
      if (!entry.pc.getStats) return;
      try {
        const stats = await entry.pc.getStats();
        if (this.peers.get(id) === entry) Object.assign(entry.diagnostic, audioCounters(stats));
      } catch { /* Peer may have been closed during the sample. */ }
    }));
    this.onDiagnostics(this.snapshot());
  }
  remove(id) {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.peers.delete(id);
    this.cancel(entry.answerTimer);
    entry.pc.onicecandidate = null; entry.pc.onconnectionstatechange = null; entry.pc.oniceconnectionstatechange = null; entry.pc.close();
  }
  close() { for (const id of this.peers.keys()) this.remove(id); this.stream = null; }
}

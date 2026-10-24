export class WebRTCTransport {
  constructor({ signal, report = () => {}, createPeer = () => new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }) }) {
    this.signal = signal; this.report = report; this.createPeer = createPeer;
    this.peers = new Map(); this.stream = null;
  }
  setStream(stream) { this.close(); this.stream = stream; }
  async offer(id, force = false) {
    if (!this.stream || (!force && this.peers.has(id))) return;
    // Requests while a negotiation is pending are coalesced rather than overlapping.
    const old = this.peers.get(id);
    if (old?.negotiating || old?.pc.signalingState === 'have-local-offer') return;
    this.remove(id);
    const pc = this.createPeer();
    const entry = { pc, incoming: [], outgoing: [], offered: false, negotiating: true, queue: Promise.resolve() };
    this.peers.set(id, entry);
    const current = () => this.peers.get(id) === entry;
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || !current()) return;
      const value = candidate.toJSON ? candidate.toJSON() : candidate;
      if (!entry.offered) entry.outgoing.push(value);
      else this.send({ event: 'webrtc-ice-candidate', target: id, candidate: value });
    };
    pc.onconnectionstatechange = () => {
      if (!current()) return;
      this.report(`Listener ${id.slice(0, 6)}: ${pc.connectionState}`);
      if (['failed', 'closed'].includes(pc.connectionState)) this.remove(id);
    };
    try {
      for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);
      const offer = await pc.createOffer();
      if (!current()) return;
      await pc.setLocalDescription(offer);
      if (!current()) return;
      await this.signal({ event: 'webrtc-offer', target: id, offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } });
      if (!current()) return;
      entry.offered = true;
      for (const candidate of entry.outgoing.splice(0)) this.send({ event: 'webrtc-ice-candidate', target: id, candidate });
    } catch (error) {
      if (current()) { this.remove(id); this.report(`Could not offer audio: ${error.message}`); }
    } finally { entry.negotiating = false; }
  }
  send(payload) { Promise.resolve(this.signal(payload)).catch((error) => this.report(`Signaling failed: ${error.message}`)); }
  receive(message) {
    const entry = this.peers.get(message.sender);
    if (!entry) return Promise.resolve();
    const current = () => this.peers.get(message.sender) === entry;
    entry.queue = entry.queue.then(async () => {
      if (!current()) return;
      if (message.event === 'webrtc-answer') {
        if (entry.pc.signalingState !== 'have-local-offer') return;
        await entry.pc.setRemoteDescription(message.answer);
        for (const candidate of entry.incoming.splice(0)) {
          if (!current()) return;
          await entry.pc.addIceCandidate(candidate);
        }
      } else if (message.candidate) {
        if (!entry.pc.remoteDescription) entry.incoming.push(message.candidate);
        else await entry.pc.addIceCandidate(message.candidate);
      }
    }).catch((error) => { if (current()) this.report(`Peer negotiation failed: ${error.message}`); });
    return entry.queue;
  }
  retain(ids) { for (const id of this.peers.keys()) if (!ids.includes(id)) this.remove(id); }
  remove(id) {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.peers.delete(id);
    entry.pc.onicecandidate = null; entry.pc.onconnectionstatechange = null; entry.pc.close();
  }
  close() { for (const id of this.peers.keys()) this.remove(id); this.stream = null; }
}

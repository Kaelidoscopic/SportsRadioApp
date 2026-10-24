// No SDP, candidate addresses, or raw browser error messages leave this boundary.
export const errorName = (error) => error?.name || 'Error';

export async function playListenerAudio(audio) {
  if (!audio?.srcObject) return { playing: false, needsGesture: false, error: 'NoStream' };
  audio.muted = false;
  audio.volume = 1;
  try {
    await audio.play();
    return { playing: true, needsGesture: false, error: null };
  } catch (error) {
    return { playing: false, needsGesture: error?.name === 'NotAllowedError', error: errorName(error) };
  }
}

export function summarizeAudioStats(stats, direction = 'inbound') {
  const result = { bytes: 0, packets: 0, audioEnergy: 0, sampleDuration: 0 };
  stats.forEach((stat) => {
    if (stat.type === `${direction}-rtp` && (stat.kind || stat.mediaType) === 'audio' && !stat.isRemote) {
      result.bytes += stat[direction === 'inbound' ? 'bytesReceived' : 'bytesSent'] || 0;
      result.packets += stat[direction === 'inbound' ? 'packetsReceived' : 'packetsSent'] || 0;
      if (direction === 'inbound') {
        result.audioEnergy += stat.totalAudioEnergy || 0;
        result.sampleDuration += stat.totalSamplesDuration || 0;
      }
    }
    if (direction === 'outbound' && stat.type === 'media-source' && stat.kind === 'audio') {
      result.audioEnergy += stat.totalAudioEnergy || 0;
      result.sampleDuration += stat.totalSamplesDuration || 0;
      result.audioLevel = stat.audioLevel || 0;
    }
    if (stat.type === 'transport' && stat.selectedCandidatePairId) {
      const pair = stats.get(stat.selectedCandidatePairId);
      if (pair) {
        result.localCandidateType = stats.get(pair.localCandidateId)?.candidateType || 'unknown';
        result.remoteCandidateType = stats.get(pair.remoteCandidateId)?.candidateType || 'unknown';
      }
    }
  });
  return result;
}

export class ListenerWebRTC {
  constructor({ createPeer, send, onPeer = () => {}, onStream = () => {}, onDiagnostic = () => {},
    makeStream = (track) => new MediaStream([track]), schedule = (fn, ms) => setInterval(fn, ms), cancel = (id) => clearInterval(id) }) {
    Object.assign(this, { createPeer, send, onPeer, onStream, onDiagnostic, makeStream, schedule, cancel });
    this.peer = null; this.host = null; this.pendingIce = []; this.timer = null; this.version = 0;
    this.stream = null;
    this.last = {};
  }
  publish(changes = {}) {
    this.last = { ...this.last, ...changes, connection: this.peer?.connectionState || 'closed',
      ice: this.peer?.iceConnectionState || 'closed', signaling: this.peer?.signalingState || 'closed' };
    this.onDiagnostic(this.last);
  }
  // Start Listening must not close a peer which is still processing an offer.
  get negotiating() { return Boolean(this.peer && !['closed', 'failed'].includes(this.peer.connectionState)); }
  async offer(sender, offer) {
    const earlyIce = this.host === sender ? this.pendingIce : [];
    this.close();
    const version = this.version, pc = this.createPeer();
    this.peer = pc; this.host = sender; this.pendingIce = earlyIce; this.last = { offer: 'received', answer: 'pending', remoteTracks: 0 };
    this.onPeer(pc);
    const current = () => this.peer === pc && this.version === version;
    const localIce = []; let answerSent = false;
    pc.onicecandidate = ({ candidate }) => {
      if (!current() || !candidate) return;
      const value = candidate.toJSON ? candidate.toJSON() : candidate;
      if (!answerSent) localIce.push(value);
      else this.send('webrtc-ice-candidate', { target: sender, candidate: value });
    };
    pc.ontrack = (event) => {
      if (!current() || event.track.kind !== 'audio') return;
      this.publish({ remoteTracks: 1, trackState: event.track.readyState, trackMuted: event.track.muted });
      this.stream = event.streams?.[0] || this.makeStream(event.track);
      this.onStream(this.stream);
      event.track.onmute = () => { if (current()) this.publish({ trackMuted: true }); };
      event.track.onunmute = () => { if (current()) this.publish({ trackMuted: false }); };
    };
    pc.onconnectionstatechange = pc.oniceconnectionstatechange = () => { if (current()) this.publish(); };
    this.publish();
    this.timer = this.schedule(() => this.sample(pc), 2000);
    this.timer?.unref?.();
    try {
      await pc.setRemoteDescription(offer);
      if (!current()) return;
      for (const candidate of this.pendingIce.splice(0)) {
        if (!current()) return;
        await pc.addIceCandidate(candidate);
      }
      const answer = await pc.createAnswer();
      if (!current()) return;
      await pc.setLocalDescription(answer);
      if (!current()) return;
      this.send('webrtc-answer', { target: sender, answer: { type: answer.type, sdp: answer.sdp } });
      answerSent = true;
      for (const candidate of localIce) this.send('webrtc-ice-candidate', { target: sender, candidate });
      this.publish({ answer: 'sent' });
    } catch (error) { if (current()) this.publish({ error: errorName(error), answer: 'failed' }); }
  }
  async ice(sender, candidate) {
    if (!candidate || (this.host && sender !== this.host)) return;
    if (!this.host) this.host = sender;
    if (!this.peer?.remoteDescription) {
      if (this.pendingIce.length < 128) this.pendingIce.push(candidate);
      return;
    }
    const pc = this.peer;
    try { await pc.addIceCandidate(candidate); }
    catch (error) { if (this.peer === pc) this.publish({ error: errorName(error) }); }
  }
  async sample(pc = this.peer) {
    if (!pc || pc !== this.peer) return;
    try {
      const stats = await pc.getStats();
      if (this.peer === pc) this.publish(summarizeAudioStats(stats));
    } catch (error) { if (this.peer === pc) this.publish({ statsError: errorName(error) }); }
  }
  close() {
    this.version++; if (this.timer !== null) this.cancel(this.timer); this.timer = null;
    const pc = this.peer; this.peer = null; this.host = null; this.pendingIce = []; this.stream = null;
    if (pc) {
      pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = pc.oniceconnectionstatechange = null;
      pc.getReceivers?.().forEach(({ track }) => { if (track) track.onmute = track.onunmute = null; });
      pc.close();
    }
    this.onPeer(null);
  }
}

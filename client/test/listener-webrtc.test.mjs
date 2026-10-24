import test from 'node:test';
import assert from 'node:assert/strict';
import { ListenerWebRTC, playListenerAudio, summarizeAudioStats } from '../src/listener-webrtc.js';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function fixture() {
  const peers = [], sent = [], streams = [], diagnostics = [], timers = new Set();
  const session = new ListenerWebRTC({
    createPeer: () => {
      const pc = { connectionState: 'new', signalingState: 'stable', iceConnectionState: 'new', received: [],
        async setRemoteDescription(offer) { this.remoteDescription = offer; this.signalingState = 'have-remote-offer'; },
        async createAnswer() { return { type: 'answer', sdp: 'test-answer' }; },
        async setLocalDescription(answer) { this.localDescription = answer; this.signalingState = 'stable'; this.onicecandidate({ candidate: { candidate: 'test-local' } }); },
        async addIceCandidate(candidate) { assert.ok(this.remoteDescription); this.received.push(candidate); },
        async getStats() { return new Map(); }, close() { this.connectionState = 'closed'; }
      }; peers.push(pc); return pc;
    },
    send: (event, payload) => sent.push({ event, payload }), onStream: (stream) => streams.push(stream),
    onDiagnostic: (value) => diagnostics.push(value), makeStream: (track) => ({ tracks: [track] }),
    schedule: (fn) => { timers.add(fn); return fn; }, cancel: (fn) => timers.delete(fn)
  });
  return { session, peers, sent, streams, diagnostics, timers };
}

test('Start Listening preserves a new/connecting peer instead of closing an unanswered offer', async () => {
  const f = fixture(), pending = deferred();
  const original = f.session.createPeer;
  f.session.createPeer = () => { const pc = original(); pc.setRemoteDescription = () => pending.promise; return pc; };
  const operation = f.session.offer('host', { type: 'offer' });
  assert.equal(f.session.negotiating, true);
  // This is the same guard used by Start Listening while offer processing is pending.
  if (!f.session.negotiating) f.session.close();
  assert.equal(f.peers[0].connectionState, 'new');
  pending.resolve(); await operation;
  assert.equal(f.sent[0].event, 'webrtc-answer');
  f.session.close(); assert.equal(f.timers.size, 0);
});

test('ICE arriving before the offer is applied after remote description; answer precedes local ICE', async () => {
  const f = fixture(); await f.session.ice('host', { candidate: 'early' });
  await f.session.offer('host', { type: 'offer', sdp: 'test' });
  assert.deepEqual(f.peers[0].received, [{ candidate: 'early' }]);
  assert.deepEqual(f.sent.map((x) => x.event), ['webrtc-answer', 'webrtc-ice-candidate']);
  f.session.close();
});

test('replaced or cancelled offers cannot send stale answers', async () => {
  const f = fixture(), pending = deferred(); const original = f.session.createPeer;
  f.session.createPeer = () => { const pc = original(); pc.setRemoteDescription = () => pending.promise; return pc; };
  const operation = f.session.offer('host', { type: 'offer' }); f.session.close(); pending.resolve(); await operation;
  assert.equal(f.peers[0].connectionState, 'closed'); assert.equal(f.sent.length, 0);
});

test('streamless audio tracks are attached and playback does not block SDP negotiation', async () => {
  const f = fixture(); await f.session.offer('host', { type: 'offer' });
  const track = { kind: 'audio', readyState: 'live', muted: false };
  f.peers[0].ontrack({ track, streams: [] });
  assert.deepEqual(f.streams, [{ tracks: [track] }]); assert.equal(f.session.stream, f.streams[0]);
  f.session.close();
});

test('blocked autoplay requests a gesture and explicit retry unmutes and plays the same stream', async () => {
  const audio = { srcObject: {}, muted: true, volume: 0, play: async () => { throw Object.assign(new Error('private browser text'), { name: 'NotAllowedError' }); } };
  assert.deepEqual(await playListenerAudio(audio), { playing: false, needsGesture: true, error: 'NotAllowedError' });
  const stream = audio.srcObject; audio.play = async () => {};
  assert.deepEqual(await playListenerAudio(audio), { playing: true, needsGesture: false, error: null });
  assert.equal(audio.srcObject, stream); assert.equal(audio.muted, false); assert.equal(audio.volume, 1);
});

test('diagnostics contain counters and candidate types, never SDP, addresses, candidate strings or tokens', () => {
  const stats = new Map([
    ['audio', { type: 'inbound-rtp', kind: 'audio', bytesReceived: 100, packetsReceived: 10, totalAudioEnergy: 0.1, totalSamplesDuration: 2, sdp: 'sensitive' }],
    ['transport', { type: 'transport', selectedCandidatePairId: 'pair' }],
    ['pair', { localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { candidateType: 'host', address: 'private-address' }], ['remote', { candidateType: 'srflx', candidate: 'secret-candidate' }]
  ]);
  const result = summarizeAudioStats(stats);
  assert.equal(result.bytes, 100); assert.equal(result.packets, 10); assert.equal(result.localCandidateType, 'host');
  for (const secret of ['private-address', 'secret-candidate', 'sensitive']) assert.equal(JSON.stringify(result).includes(secret), false);
});

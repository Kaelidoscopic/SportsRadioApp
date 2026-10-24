import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRTCTransport } from '../src/webrtc-transport.mjs';

function fixture() {
  const peers = [], sent = [];
  const transport = new WebRTCTransport({ signal: async (payload) => { sent.push(payload); }, createPeer: () => {
    const pc = { tracks: [], candidates: [], closed: false, signalingState: 'stable',
      addTrack(track, stream) { this.tracks.push({ track, stream }); },
      async createOffer() { return { type: 'offer', sdp: 'audio' }; },
      async setLocalDescription(value) { this.localDescription = value; this.signalingState = 'have-local-offer'; this.onicecandidate({ candidate: { candidate: 'local' } }); },
      async setRemoteDescription(value) { this.remoteDescription = value; this.signalingState = 'stable'; },
      async addIceCandidate(value) { this.candidates.push(value); }, close() { this.closed = true; }
    }; peers.push(pc); return pc;
  } });
  const audio = { kind: 'audio' };
  transport.setStream({ getAudioTracks: () => [audio], getTracks: () => [audio, { kind: 'video' }] });
  return { transport, peers, sent };
}
test('audio-only WebRTC, per-listener peers, and offer precedes local ICE', async () => {
  const { transport, peers, sent } = fixture();
  await transport.offer('a'); await transport.offer('b');
  assert.equal(peers.length, 2); assert.equal(peers[0].tracks.length, 1); assert.equal(peers[0].tracks[0].track.kind, 'audio');
  assert.deepEqual(sent.map((x) => x.event), ['webrtc-offer', 'webrtc-ice-candidate', 'webrtc-offer', 'webrtc-ice-candidate']);
  transport.retain(['b']); assert.equal(peers[0].closed, true); assert.equal(peers[1].closed, false);
  transport.close(); assert.equal(peers[1].closed, true);
});
test('early remote ICE is queued until answer; unknown peers ignored', async () => {
  const { transport, peers } = fixture(); await transport.offer('a');
  await transport.receive({ event: 'webrtc-ice-candidate', sender: 'a', candidate: { candidate: 'early' } });
  assert.equal(peers[0].candidates.length, 0);
  await transport.receive({ event: 'webrtc-answer', sender: 'a', answer: { type: 'answer', sdp: 'answer' } });
  assert.equal(peers[0].candidates.length, 1);
  await transport.receive({ event: 'webrtc-answer', sender: 'outsider', answer: {} });
});
test('closing during asynchronous offer prevents stale signaling', async () => {
  const { transport, peers, sent } = fixture(); let finish;
  transport.createPeer = () => {
    const pc = { addTrack() {}, createOffer: () => new Promise((resolve) => { finish = resolve; }), close() { this.closed = true; } };
    peers.push(pc); return pc;
  };
  const operation = transport.offer('a'); transport.close(); finish({ type: 'offer', sdp: 'late' }); await operation;
  assert.equal(peers[0].closed, true); assert.deepEqual(sent, []);
});
test('failed peers are removed and stream request can create a replacement', async () => {
  const { transport, peers } = fixture(); await transport.offer('a');
  peers[0].connectionState = 'failed'; peers[0].onconnectionstatechange();
  assert.equal(peers[0].closed, true); await transport.offer('a', true); assert.equal(peers.length, 2);
});

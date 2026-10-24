const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { RoomSession } = require('../src/room-session.cjs');
const { serviceUrl, roomInput, signalPayload } = require('../src/validation.cjs');

function fixture() {
  const socket = new EventEmitter(), outgoing = [], states = [], incoming = [];
  socket.id = 'host'; socket.connected = false;
  socket.connect = () => { socket.connected = true; EventEmitter.prototype.emit.call(socket, 'connect'); };
  socket.disconnect = () => { socket.connected = false; EventEmitter.prototype.emit.call(socket, 'disconnect'); };
  const registration = { ok: true, roomId: 'DESK', roomName: 'TV', credential: 'a'.repeat(64), expiresAt: Date.now() + 10000, members: ['host', 'listener'] };
  socket.response = registration;
  socket.timeout = () => ({ emit(event, payload, callback) { outgoing.push({ event, payload }); callback(null, socket.response); } });
  socket.emit = (event, payload) => { outgoing.push({ event, payload }); return true; };
  socket.receive = (event, payload) => EventEmitter.prototype.emit.call(socket, event, payload);
  const store = { record: null, load() { return this.record; }, save(value) { this.record = value; }, clear() { this.record = null; } };
  const rooms = new RoomSession({ io: () => socket, store });
  rooms.on('state', (state) => states.push(state)); rooms.on('signal', (value) => incoming.push(value));
  return { rooms, socket, outgoing, store, states, incoming, registration };
}
test('ownership stays in main and encrypted-store boundary; renderer snapshots omit credential', async () => {
  const f = fixture(); f.rooms.connect('http://localhost:5000');
  await f.rooms.register({ roomCode: 'DESK', roomName: 'TV' });
  assert.equal(f.store.record.credential, f.registration.credential);
  assert.equal(JSON.stringify(f.states).includes(f.registration.credential), false);
  assert.deepEqual(f.rooms.snapshot().members, ['listener']);
  f.rooms.broadcast(true);
  f.rooms.signal({ event: 'webrtc-offer', target: 'listener', offer: { type: 'offer', sdp: 'audio' } });
  assert.throws(() => f.rooms.signal({ event: 'webrtc-offer', target: 'outsider', offer: { type: 'offer', sdp: 'audio' } }), /Invalid listener/);
  f.socket.receive('webrtc-answer', { sender: 'outsider', answer: {} }); assert.deepEqual(f.incoming, []);
});
test('reconnect uses ownership credential and never silently registers after denied recovery', async () => {
  const f = fixture(); f.rooms.connect('http://localhost:5000'); await f.rooms.register({ roomCode: '', roomName: 'TV' });
  f.socket.disconnect(); assert.equal(f.rooms.state.ready, false);
  f.socket.response = { ok: false, error: 'RECOVERY_DENIED' };
  f.socket.connect(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.rooms.state.ready, false); assert.equal(f.rooms.state.recovering, false);
  assert.equal(f.outgoing.filter((x) => x.event === 'desktop:register').length, 1);
  assert.equal(f.outgoing.at(-1).payload.credential, f.registration.credential);
});
test('changing backend never forwards credentials saved for another server', async () => {
  const f = fixture(); f.store.record = { backendUrl: 'https://one.example', roomCode: 'DESK', credential: 'a'.repeat(64) };
  f.rooms.connect('https://two.example'); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.rooms.snapshot().canRecover, false); assert.equal(f.outgoing.length, 0);
});
test('failed secure persistence ends newly created room; explicit end clears ownership', async () => {
  const f = fixture(); f.rooms.connect('http://localhost:5000'); f.store.save = () => { throw new Error('disk failure'); };
  await assert.rejects(f.rooms.register({ roomCode: '', roomName: '' }), /securely save/);
  assert.equal(f.rooms.state.ready, false); assert.equal(f.outgoing.at(-1).event, 'end-room');
  f.rooms.end(); assert.equal(f.store.record, null);
});
test('main bridge input validation restricts URLs and signaling event types', () => {
  assert.equal(serviceUrl('http://localhost:5000/'), 'http://localhost:5000');
  for (const url of ['file:///test', 'http://remote.example', 'https://user:pass@example.com', 'https://example.com/?token=x']) assert.throws(() => serviceUrl(url));
  assert.equal(serviceUrl('http://192.168.1.2:5000', true), 'http://192.168.1.2:5000');
  assert.throws(() => roomInput({ roomCode: 'bad-code', roomName: '' }));
  assert.throws(() => signalPayload({ event: 'desktop:recover', target: 'listener' }, ['listener']));
  assert.throws(() => signalPayload({ event: 'webrtc-answer', target: 'listener' }, ['listener']));
});

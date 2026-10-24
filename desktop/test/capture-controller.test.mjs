import test from 'node:test';
import assert from 'node:assert/strict';
import { WindowsLoopbackCapture } from '../src/capture/windows-loopback.mjs';
import { BroadcastController } from '../src/broadcast-controller.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function streamFixture() {
  const track = (kind) => ({ kind, readyState: 'live', stopped: 0, stop() { this.stopped++; this.readyState = 'ended'; }, addEventListener(_event, fn) { this.ended = fn; } });
  const audio = track('audio'), video = track('video');
  return { audio, video, getTracks: () => [audio, video], getAudioTracks: () => [audio] };
}
const bridge = () => ({ armCapture: async () => {}, disarmCapture: async () => {}, broadcast: async () => {} });

test('loopback forwards only audio, keeps internal video, and stops all raw tracks', async () => {
  const raw = streamFixture(); let requested;
  let observed, released = 0;
  const capture = new WindowsLoopbackCapture({ bridge: bridge(), monitor: { start(stream) { observed = stream; }, stop() { released++; } }, mediaDevices: { getDisplayMedia: async (options) => { requested = options; return raw; } }, makeStream: (tracks) => ({ getAudioTracks: () => tracks }) });
  const stream = await capture.start();
  assert.equal(observed, stream); assert.equal(observed.getAudioTracks()[0], raw.audio);
  assert.equal(requested.audio.echoCancellation, false);
  assert.deepEqual(stream.getAudioTracks(), [raw.audio]); assert.equal(raw.video.stopped, 0);
  capture.stop(); assert.equal(raw.audio.stopped, 1); assert.equal(raw.video.stopped, 1);
  assert.equal(released, 1);
});

test('Stop during pending native capture disposes the late stream', async () => {
  const pending = deferred(), raw = streamFixture();
  const capture = new WindowsLoopbackCapture({ bridge: bridge(), mediaDevices: { getDisplayMedia: () => pending.promise }, makeStream: (tracks) => tracks });
  const operation = capture.start(); await Promise.resolve(); capture.stop(); pending.resolve(raw);
  await assert.rejects(operation, /cancelled/); assert.equal(raw.audio.stopped, 1); assert.equal(raw.video.stopped, 1);
});

test('missing audio rejects capture and closes video; native denial propagates', async () => {
  const raw = streamFixture(); raw.getAudioTracks = () => [];
  const capture = new WindowsLoopbackCapture({ bridge: bridge(), mediaDevices: { getDisplayMedia: async () => raw }, makeStream: (tracks) => tracks });
  await assert.rejects(capture.start(), /no live audio/); assert.equal(raw.video.stopped, 1);
  capture.mediaDevices.getDisplayMedia = async () => { throw new Error('denied'); };
  await assert.rejects(capture.start(), /denied/);
});

test('ended capture releases resources and notifies controller', async () => {
  const raw = streamFixture(); let ended = 0;
  const capture = new WindowsLoopbackCapture({ bridge: bridge(), mediaDevices: { getDisplayMedia: async () => raw }, makeStream: (tracks) => tracks });
  capture.onended = () => { ended++; };
  await capture.start(); raw.audio.ended(); assert.equal(ended, 1); assert.equal(raw.video.stopped, 1);
});

function controllerFixture(start = async () => streamFixture()) {
  const calls = { start: 0, stop: 0, closed: 0, offers: [], broadcasts: [] };
  const capture = { start: () => { calls.start++; return start(); }, stop: () => { calls.stop++; } };
  const transport = { close: () => { calls.closed++; }, setStream() {}, retain() {}, offer: async (id) => { calls.offers.push(id); }, receive() {} };
  const controller = new BroadcastController({ capture, transport, bridge: { broadcast: async (value) => { calls.broadcasts.push(value); } } });
  return { controller, calls };
}
const ready = { connected: true, ready: true, members: ['a', 'b'] };
test('duplicate Start is coalesced; multiple listeners receive audio; Stop cleans up', async () => {
  const { controller, calls } = controllerFixture(); controller.update(ready);
  await Promise.all([controller.start(), controller.start()]);
  assert.equal(calls.start, 1); assert.deepEqual(calls.offers, ['a', 'b']);
  controller.stop(); assert.equal(controller.live, false); assert.equal(controller.wantLive, false); assert.equal(calls.stop, 1);
});
test('Stop cancels late capture and prevents announcing a live broadcast', async () => {
  const pending = deferred(), { controller, calls } = controllerFixture(() => pending.promise); controller.update(ready);
  const operation = controller.start(); controller.stop(); pending.resolve(streamFixture()); await operation;
  assert.equal(controller.live, false); assert.deepEqual(calls.broadcasts, [false]); assert.deepEqual(calls.offers, []);
});
test('network interruption retains intent and resumes only after room recovery', async () => {
  const { controller, calls } = controllerFixture(); controller.update(ready); await controller.start();
  controller.update({ connected: false, ready: false, members: [] });
  assert.equal(controller.live, false); assert.equal(controller.wantLive, true);
  controller.update({ connected: true, ready: false, recovering: true, members: [] });
  assert.equal(controller.wantLive, true); assert.equal(calls.start, 1);
  controller.update(ready); await controller.pending;
  assert.equal(calls.start, 2); assert.equal(controller.live, true);
});
test('room closure and denied capture cancel restart intent', async () => {
  const { controller } = controllerFixture(); controller.update(ready); await controller.start();
  controller.update({ connected: true, ready: false, members: [] }); assert.equal(controller.wantLive, false);
  const denied = controllerFixture(async () => { throw new Error('denied'); }); denied.controller.update(ready);
  await assert.rejects(denied.controller.start(), /denied/); assert.equal(denied.controller.wantLive, false); assert.equal(denied.calls.stop, 1);
});

test('repeated Stop/Start reacquires capture and offers to every current listener', async () => {
  const { controller, calls } = controllerFixture(); controller.update(ready);
  for (let cycle = 0; cycle < 3; cycle++) {
    await controller.start(); assert.equal(controller.live, true);
    controller.stop(); assert.equal(controller.live, false);
  }
  assert.equal(calls.start, 3); assert.equal(calls.stop, 3); assert.equal(calls.closed, 3);
  assert.deepEqual(calls.offers, ['a', 'b', 'a', 'b', 'a', 'b']);
  assert.deepEqual(calls.broadcasts, [true, false, true, false, true, false]);
});

test('explicit restart after output change uses fresh tracks and releases both captures', async () => {
  const oldOutput = streamFixture(), newOutput = streamFixture(); let acquisitions = 0, monitored;
  const capture = new WindowsLoopbackCapture({ bridge: bridge(),
    monitor: { start(stream) { monitored = stream; }, stop() {} },
    mediaDevices: { getDisplayMedia: async () => acquisitions++ ? newOutput : oldOutput },
    makeStream: (tracks) => ({ getAudioTracks: () => tracks }) });
  const first = await capture.start(); capture.stop(); const second = await capture.start();
  assert.notEqual(second.getAudioTracks()[0], first.getAudioTracks()[0]);
  assert.equal(second.getAudioTracks()[0], newOutput.audio); assert.equal(monitored, second);
  assert.equal(oldOutput.audio.stopped, 1); assert.equal(oldOutput.video.stopped, 1);
  assert.equal(newOutput.audio.stopped, 0); capture.stop();
  assert.equal(newOutput.audio.stopped, 1); assert.equal(newOutput.video.stopped, 1);
});

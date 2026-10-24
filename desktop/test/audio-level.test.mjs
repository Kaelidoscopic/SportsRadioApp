import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioLevelMonitor, pcmLevel } from '../src/capture/audio-level.mjs';
import { audioCounters } from '../src/peer-diagnostics.mjs';

test('PCM energy detects signal without cancelling opposite stereo channels', () => {
  assert.deepEqual(pcmLevel([[0, 0]]), { rms: 0, peak: 0, dbfs: null });
  const level = pcmLevel([[0.25, -0.25], [-0.25, 0.25]]);
  assert.equal(level.rms, 0.25); assert.equal(level.peak, 0.25);
  assert.ok(Math.abs(level.dbfs + 12.0412) < 0.001);
});

function fixture() {
  let now = 0, amplitude = 0, disconnected = 0, closed = 0;
  const node = () => ({ connect() {}, disconnect() { disconnected++; } });
  const context = { state: 'running', currentTime: 0, destination: {},
    createMediaStreamSource: node, createChannelSplitter: node,
    createGain: () => ({ ...node(), gain: { value: 1 } }),
    createAnalyser: () => ({ ...node(), getFloatTimeDomainData(samples) { samples.fill(amplitude); } }),
    resume: async () => {}, close: async () => { closed++; } };
  const monitor = new AudioLevelMonitor({ createContext: () => context, now: () => now });
  monitor.start({ getAudioTracks: () => [{ getSettings: () => ({ channelCount: 2 }) }] });
  return { monitor, context, sample(time, value = 0) { now = time; amplitude = value; context.currentTime = time / 1000; return monitor.sample(); },
    cleanup: () => ({ disconnected, closed }) };
}

test('capture silence warning, signal recovery, stop and restart', () => {
  const f = fixture();
  assert.equal(f.sample(100).status, 'quiet');
  assert.equal(f.sample(5100).status, 'silent');
  assert.match(f.monitor.sample().message, /Volume Mixer/);
  assert.equal(f.sample(5200, 0.02).status, 'signal');
  assert.equal(f.sample(5500).status, 'quiet');
  assert.equal(f.sample(10300).status, 'silent');
  f.monitor.stop(); assert.equal(f.monitor.sample().status, 'stopped');
  assert.equal(f.cleanup().closed, 1); assert.equal(f.cleanup().disconnected, 5);
});

test('suspended or frozen measurement is unavailable, not measured silence', () => {
  const f = fixture(); f.sample(100);
  f.context.state = 'suspended'; assert.equal(f.sample(6000).status, 'unavailable');
  f.context.state = 'running'; assert.equal(f.sample(6100).status, 'quiet');
  f.monitor.now = () => 9000; assert.equal(f.monitor.sample().status, 'unavailable');
  f.monitor.stop();
});

test('unsupported RTC source fields remain unknown; measured zero remains zero', () => {
  assert.equal(audioCounters(new Map()).sourceEnergy, null);
  const stats = new Map([['source', { type: 'media-source', kind: 'audio', totalAudioEnergy: 0 }]]);
  assert.equal(audioCounters(stats).sourceEnergy, 0);
  assert.equal(audioCounters(stats).audioLevel, null);
});

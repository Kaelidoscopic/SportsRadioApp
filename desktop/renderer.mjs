import { WindowsLoopbackCapture } from './src/capture/windows-loopback.mjs';
import { WebRTCTransport } from './src/webrtc-transport.mjs';
import { BroadcastController } from './src/broadcast-controller.mjs';
import { AudioLevelMonitor } from './src/capture/audio-level.mjs';

const bridge = window.broadcaster;
const $ = (id) => document.getElementById(id);
const report = (message) => { $('message').textContent = message; };
const transport = new WebRTCTransport({ signal: (payload) => bridge.signal(payload), report: (message) => { $('peer').textContent = message; } });
const monitor = new AudioLevelMonitor();
const capture = new WindowsLoopbackCapture({ bridge, monitor });
let level = { status: 'stopped' };
function renderLevel() {
  level = monitor.sample();
  $('audio-level').value = level.dbfs === null || level.dbfs === undefined ? -100 : Math.max(-100, Math.min(0, level.dbfs));
  $('level-text').textContent = level.dbfs == null ? level.status : `${level.dbfs.toFixed(1)} dBFS · ${level.status}`;
  $('capture-warning').textContent = level.message;
  $('broadcast').textContent = state.broadcasting
    ? level.status === 'silent' ? 'Live · capture silent' : level.status === 'unavailable' ? 'Live · audio unverified' : level.status === 'signal' ? 'Live · signal detected' : 'Live · waiting for audio'
    : 'Stopped';
}
const levelTimer = setInterval(renderLevel, 100);
const diagnosticTimer = setInterval(async () => {
  await transport.sample();
  $('diagnostics').textContent = JSON.stringify({
    capture: capture.raw ? capture.raw.getAudioTracks().map((track) => ({ source: 'Windows loopback', state: track.readyState, enabled: track.enabled, muted: track.muted })) : 'stopped',
    capturedPcm: level,
    peers: transport.snapshot()
  }, null, 2);
}, 2000);
const controller = new BroadcastController({ capture, transport, bridge, report });
let state = { members: [] }, busy = false, lastQrCode;
function controls() {
  $('connect').disabled = busy || state.ready;
  $('create').disabled = busy || !state.connected || state.ready;
  $('recover').disabled = busy || !state.connected || state.ready || !state.canRecover;
  $('end').disabled = busy || !state.ready;
  $('start').disabled = busy || !state.ready || state.broadcasting;
  $('stop').disabled = !controller.wantLive && !controller.live;
  $('copy').disabled = !state.roomCode;
  $('qr-button').disabled = !state.ready;
}
async function qr() {
  const result = await bridge.qr($('listener-url').value.trim());
  $('qr').src = result.image; $('qr').hidden = false; $('join-url').textContent = result.url;
}
function update(value) {
  state = value; controller.update(value);
  $('connection').textContent = state.connected ? (state.ready ? 'Connected · Room ready' : 'Connected') : 'Disconnected';
  $('room-name').textContent = state.roomName || '—'; $('room-code').textContent = state.roomCode || '—';
  $('listeners').textContent = state.members.length; $('broadcast').textContent = state.broadcasting ? 'Live' : 'Stopped';
  report(state.message);
  if (state.ready && lastQrCode !== state.roomCode) { lastQrCode = state.roomCode; qr().catch((error) => report(error.message)); }
  if (!state.ready) { $('qr').hidden = true; $('join-url').textContent = ''; lastQrCode = null; }
  controls();
}
function action(id, fn) {
  $(id).addEventListener('click', async () => {
    busy = true; controls();
    try { const operation = fn(); controls(); await operation; } catch (error) { report(error.message); }
    finally { busy = false; controls(); }
  });
}
bridge.onState(update);
bridge.onSignal((message) => Promise.resolve(controller.signal(message)).catch((error) => report(error.message)));
action('connect', () => bridge.connect($('backend').value.trim()));
action('create', () => bridge.register({ roomCode: $('code').value.trim(), roomName: $('name').value.trim() }));
action('recover', () => bridge.recover());
action('end', async () => { controller.stop(); await bridge.end(); });
action('start', () => controller.start());
// Stop remains usable during asynchronous capture startup.
$('stop').addEventListener('click', () => { controller.stop(); controls(); });
action('copy', () => bridge.copyCode());
action('qr-button', qr);
window.addEventListener('beforeunload', () => { clearInterval(levelTimer); clearInterval(diagnosticTimer); controller.stop(); });
const initial = await bridge.initial();
$('backend').value = initial.backendUrl; $('listener-url').value = initial.listenerUrl;
$('version').textContent = `Broadcaster ${initial.appVersion} · Electron ${initial.electron} · Windows loopback · Audio only`;
update(initial.state);
try { await bridge.connect(initial.backendUrl); } catch (error) { report(error.message); }

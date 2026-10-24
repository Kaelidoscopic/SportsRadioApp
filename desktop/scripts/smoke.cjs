// Local runtime check, intentionally separate from production entry and unit tests.
// Requires a running Stage 1 backend. Does not verify a phone or audible playback.
const { app } = require('electron');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const fs = require('node:fs');
const path = require('node:path');
const { io } = require('socket.io-client');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..', '.smoke');
fs.mkdirSync(root, { recursive: true });
process.env.SPORTSRADIO_USER_DATA = path.join(root, `user-data-${Date.now()}`);
const results = { platform: process.platform, electron: process.versions.electron, phoneVerified: false };
let listener, window, playback;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const result = await fn(); if (result) return result; await pause(100); }
  throw new Error('Runtime check timed out.');
}
async function evaluate(source) { return window.webContents.executeJavaScript(source, true); }
function finish(error) {
  if (error) results.error = error.message;
  results.passed = !error;
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  listener?.disconnect();
  playback?.kill();
  window?.destroy();
  app.exit(error ? 1 : 0);
}
const deadline = setTimeout(() => finish(new Error('Runtime check exceeded 45 seconds.')), 45000);
app.on('browser-window-created', (_event, created) => {
  window = created; window.hide();
  created.webContents.once('did-finish-load', async () => {
    try {
      await waitFor(() => evaluate("document.getElementById('connection').textContent.includes('Connected')"));
      await evaluate("document.getElementById('name').value='Runtime smoke'; document.getElementById('code').value=''; document.getElementById('create').click()");
      await waitFor(() => evaluate("document.getElementById('connection').textContent.includes('Room ready')"));
      results.roomCode = await evaluate("document.getElementById('room-code').textContent");
      results.encryptedStorePresent = fs.existsSync(path.join(process.env.SPORTSRADIO_USER_DATA, 'room.dpapi'));
      const { CredentialStore } = require('../src/credential-store.cjs');
      const persisted = new CredentialStore(path.join(process.env.SPORTSRADIO_USER_DATA, 'room.dpapi'), require('electron').safeStorage);
      await persisted.initialize();
      results.encryptedStoreReloadPassed = persisted.load().roomCode === results.roomCode;
      results.bridgeContainsCredentialApi = await evaluate("Object.keys(window.broadcaster).some(key => /credential|decrypt|storage|socket/i.test(key))");
      await evaluate(`globalThis.smoke = { candidates: [], audioTracks: 0, videoTracks: 0, maxRms: 0 };
        globalThis.smoke.pc = new RTCPeerConnection({iceServers: []});
        smoke.pc.onicecandidate = ({candidate}) => { if(candidate) smoke.candidates.push(candidate.toJSON()); };
        smoke.pc.ontrack = async ({track, streams}) => {
          if(track.kind === 'video') smoke.videoTracks++;
          if(track.kind === 'audio') {
            smoke.audioTracks++;
            smoke.context = new AudioContext(); smoke.context.resume().catch(error => { smoke.audioError=error.message; });
            smoke.source = smoke.context.createMediaStreamSource(streams[0]);
            smoke.analyser = smoke.context.createAnalyser(); smoke.source.connect(smoke.analyser);
            smoke.silentSink = smoke.context.createGain(); smoke.silentSink.gain.value = 0;
            smoke.analyser.connect(smoke.silentSink); smoke.silentSink.connect(smoke.context.destination);
            smoke.audio = new Audio(); smoke.audio.muted = true; smoke.audio.srcObject = streams[0];
            smoke.audio.play().catch(error => { smoke.audioError=error.message; });
          }
        }; void 0;`);
      await evaluate(`globalThis.smoke.hostPeers = [];
        globalThis.NativePeer = RTCPeerConnection;
        globalThis.RTCPeerConnection = class extends NativePeer { constructor(...args) { super(...args); smoke.hostPeers.push(this); } }; void 0;`);
      listener = io(process.env.SPORTSRADIO_BACKEND_URL || 'http://localhost:5000', { autoConnect: false, reconnection: false });
      listener.on('webrtc-offer', async ({ sender, offer }) => {
        try {
          const answer = await evaluate(`(async () => { await smoke.pc.setRemoteDescription(${JSON.stringify(offer)}); const answer=await smoke.pc.createAnswer(); await smoke.pc.setLocalDescription(answer); return {type:answer.type,sdp:answer.sdp}; })()`);
          listener.emit('webrtc-answer', { target: sender, answer });
          results.hostSocketId = sender;
        } catch (error) { finish(error); }
      });
      listener.on('webrtc-ice-candidate', ({ candidate }) => evaluate(`smoke.pc.addIceCandidate(${JSON.stringify(candidate)})`).catch(() => {}));
      await new Promise((resolve, reject) => { listener.once('connect', resolve); listener.once('connect_error', reject); listener.connect(); });
      const joined = new Promise((resolve) => listener.once('joined-room', resolve)); listener.emit('join-room', results.roomCode); await joined;
      await evaluate("document.getElementById('start').click()");
      await waitFor(async () => {
        const state = await evaluate("({ live:document.getElementById('broadcast').textContent, message:document.getElementById('message').textContent })");
        if (/Error|failed|denied|no live|Could not|NotReadable|NotAllowed|Could not start/i.test(state.message)) throw new Error(state.message);
        return state.live === 'Live';
      });
      results.captureStarted = true;
      await waitFor(async () => {
        const candidates = await evaluate('smoke.candidates.splice(0)');
        if (results.hostSocketId) for (const candidate of candidates) listener.emit('webrtc-ice-candidate', { target: results.hostSocketId, candidate });
        return evaluate("smoke.pc.connectionState === 'connected'");
      });
      await pause(1500);
      if (process.env.SPORTSRADIO_SMOKE_TONE === '1') {
        // A quiet WAV rendered by a separate PowerShell/SoundPlayer process.
        const rate = 48000, seconds = 5, samples = rate * seconds;
        const wav = Buffer.alloc(44 + samples * 2);
        wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
        wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
        for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(0.04 * 32767 * Math.sin(2 * Math.PI * 440 * i / rate)), 44 + i * 2);
        const tonePath = path.join(root, 'quiet-test-tone.wav'); fs.writeFileSync(tonePath, wav);
        playback = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$smokeAudioPlayer = New-Object System.Media.SoundPlayer -ArgumentList '${tonePath.replace(/'/g, "''")}'; $smokeAudioPlayer.PlaySync()`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let playbackError = ''; playback.stderr.on('data', (data) => { playbackError += data; });
        let peakRms = 0;
        for (let i = 0; i < 60; i++) {
          peakRms = Math.max(peakRms, await evaluate(`(() => { if(!smoke.analyser) return 0; const a=new Float32Array(smoke.analyser.fftSize); smoke.analyser.getFloatTimeDomainData(a); return Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length); })()`));
          await pause(100);
        }
        results.externalPlayback = { process: 'PowerShell System.Media.SoundPlayer', peakReceivedRms: peakRms, exitCode: playback.exitCode, error: playbackError || null };
      }
      results.transport = await evaluate(`(async () => {
        const stats=await smoke.pc.getStats(); const inbound=[];
        stats.forEach(x => { if(x.type==='inbound-rtp') inbound.push({kind:x.kind,bytesReceived:x.bytesReceived,packetsReceived:x.packetsReceived,totalAudioEnergy:x.totalAudioEnergy,totalSamplesDuration:x.totalSamplesDuration}); });
        let rms=0;
        if(smoke.analyser) { const values=new Float32Array(smoke.analyser.fftSize); smoke.analyser.getFloatTimeDomainData(values); rms=Math.sqrt(values.reduce((s,x)=>s+x*x,0)/values.length); }
        return {state:smoke.pc.connectionState,contextState:smoke.context?.state,contextTime:smoke.context?.currentTime,analyserPresent:!!smoke.analyser,audioError:smoke.audioError,audioTracks:smoke.audioTracks,videoTracks:smoke.videoTracks,inbound,rms};
      })()`);
      results.captureDiagnostics = await evaluate(`(async () => {
        const pc=smoke.hostPeers[0]; if(!pc) return null;
        const tracks=pc.getSenders().filter(s=>s.track).map(s=>({kind:s.track.kind,enabled:s.track.enabled,muted:s.track.muted,readyState:s.track.readyState,settings:s.track.getSettings()}));
        const stats=await pc.getStats(); const sources=[];
        stats.forEach(x=>{ if(x.type==='media-source' && x.kind==='audio') sources.push({audioLevel:x.audioLevel,totalAudioEnergy:x.totalAudioEnergy,totalSamplesDuration:x.totalSamplesDuration}); });
        return {tracks,sources};
      })()`);
      await evaluate("document.getElementById('stop').click()");
      await waitFor(() => evaluate("document.getElementById('broadcast').textContent === 'Stopped'"));
      results.stopPassed = true;
      await evaluate("document.getElementById('end').click()");
      await waitFor(() => evaluate("document.getElementById('connection').textContent === 'Connected'"));
      await evaluate('smoke.pc.close(); void smoke.context?.close()');
      await pause(150);
      if (results.externalPlayback) {
        results.playbackSignalDetected = results.externalPlayback.peakReceivedRms > 0.00001;
        if (!results.playbackSignalDetected) throw new Error('Native capture and WebRTC connected, but external playback measured silence. Real playback is not verified.');
      }
      clearTimeout(deadline); finish();
    } catch (error) {
      results.ui = await evaluate("({ message:document.getElementById('message').textContent,peer:document.getElementById('peer').textContent })").catch(() => null);
      clearTimeout(deadline); finish(error);
    }
  });
});
require('../main.cjs');

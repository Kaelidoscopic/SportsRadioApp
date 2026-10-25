// Development receiver only. Uses desktop Electron/Socket.IO dependencies, never a phone verdict.
const { app, BrowserWindow } = require('electron');
const { io } = require('../../desktop/node_modules/socket.io-client');
const fs = require('node:fs');
const path = require('node:path');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const code = process.env.SPORTSRADIO_TV_ROOM;
if (!/^[A-Z0-9]{1,32}$/.test(code || '')) throw new Error('Set SPORTSRADIO_TV_ROOM to the TV room code.');
const reportName = process.env.SPORTSRADIO_TV_REPORT_NAME || 'receiver';
if (!/^[a-z0-9-]{1,40}$/.test(reportName)) throw new Error('Invalid report name.');
const output = path.resolve(__dirname, `../.runtime/${reportName}.json`);
const profiles = path.resolve(__dirname, '../.runtime/profiles');
fs.mkdirSync(profiles, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(profiles, `${reportName}-`)));
let window, socket, target, answerSent = false, finishing = false;
const report = { phoneVerified: false, source: 'physical TV via native WebRTC', peakDecodedRms: 0, maxListeners: 0 };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (js) => window.webContents.executeJavaScript(js, true);
function finish(error) {
  if (finishing) return; finishing = true;
  if (error) report.error = error.message;
  report.passed = !error;
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report)); socket?.disconnect(); window?.destroy(); app.exit(error ? 1 : 0);
}
setTimeout(() => finish(new Error('Receiver deadline exceeded.')), 35000);
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    await window.loadURL('data:text/html,<title>TV receiver diagnostics</title>');
    await evaluate(`globalThis.receiver = { local: [], remote: [], tracks: 0, video: 0, errors: [] };
      receiver.pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});
      receiver.pc.onicecandidate = ({candidate}) => { if(candidate) receiver.local.push(candidate.toJSON()); };
      receiver.pc.ontrack = ({track}) => {
        if(track.kind === 'video') { receiver.video++; return; }
        receiver.tracks++;
        receiver.context = new AudioContext(); receiver.context.resume().catch(()=>receiver.errors.push('context-resume'));
        receiver.source = receiver.context.createMediaStreamSource(new MediaStream([track]));
        receiver.analyser = receiver.context.createAnalyser(); receiver.source.connect(receiver.analyser);
        receiver.sink = receiver.context.createGain(); receiver.sink.gain.value=0;
        receiver.analyser.connect(receiver.sink); receiver.sink.connect(receiver.context.destination);
        receiver.audio = new Audio(); receiver.audio.muted = true; receiver.audio.srcObject = new MediaStream([track]);
        receiver.audio.play().catch(()=>receiver.errors.push('audio-play'));
      }; void 0;`);
    socket = io('https://sportsradioapp.onrender.com', { autoConnect: false, reconnection: false, timeout: 10000 });
    socket.on('room-updated', ({ members }) => { if (Array.isArray(members)) report.maxListeners = Math.max(report.maxListeners, members.length - 1); });
    socket.on('webrtc-offer', async ({ sender, offer }) => {
      try {
        target = sender; answerSent = false;
        const answer = await evaluate(`(async()=>{
          await receiver.pc.setRemoteDescription(${JSON.stringify(offer)});
          for(const candidate of receiver.remote.splice(0)) await receiver.pc.addIceCandidate(candidate);
          const answer=await receiver.pc.createAnswer(); await receiver.pc.setLocalDescription(answer);
          return {type:answer.type,sdp:answer.sdp}; })()`);
        socket.emit('webrtc-answer', { target, answer }); answerSent = true;
      } catch { finish(new Error('Receiver offer/answer failed.')); }
    });
    socket.on('webrtc-ice-candidate', ({ candidate }) => evaluate(`(async()=>{
      if(receiver.pc.remoteDescription) await receiver.pc.addIceCandidate(${JSON.stringify(candidate)});
      else receiver.remote.push(${JSON.stringify(candidate)}); })()`).catch(() => finish(new Error('Receiver ICE failed.'))));
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', () => reject(new Error('Signaling unavailable.'))); socket.connect(); });
    await new Promise((resolve, reject) => { socket.once('joined-room', resolve); socket.once('error-message', () => reject(new Error('Room join rejected.'))); socket.emit('join-room', code); });
    for (let i = 0; i < 180; i++) {
      if (target && answerSent) for (const candidate of await evaluate('receiver.local.splice(0)')) socket.emit('webrtc-ice-candidate', { target, candidate });
      const sample = await evaluate(`(async()=>{
        let rms=0; if(receiver.analyser){ const a=new Float32Array(receiver.analyser.fftSize); receiver.analyser.getFloatTimeDomainData(a); rms=Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length); }
        let bytes=0,packets=0,decodedSamples=0,energy=null; const stats=await receiver.pc.getStats(); stats.forEach(s=>{if(s.type==='inbound-rtp'&&s.kind==='audio'){bytes+=s.bytesReceived||0;packets+=s.packetsReceived||0;decodedSamples+=s.totalSamplesReceived||0;energy=s.totalAudioEnergy??null;}});
        return {state:receiver.pc.connectionState,ice:receiver.pc.iceConnectionState,rms,bytes,packets,decodedSamples,energy,context:receiver.context?.state,contextTime:receiver.context?.currentTime,errors:receiver.errors,audioTracks:receiver.tracks,videoTracks:receiver.video}; })()`);
      report.peakDecodedRms = Math.max(report.peakDecodedRms, sample.rms); report.receiver = sample;
      await pause(100);
    }
    if (report.receiver.state !== 'connected' || report.receiver.audioTracks !== 1 || report.receiver.videoTracks || report.peakDecodedRms <= 0.0001 || report.receiver.packets <= 0) throw new Error('Connected nonzero decoded TV audio was not verified.');
    finish();
  } catch (error) { finish(error); }
});

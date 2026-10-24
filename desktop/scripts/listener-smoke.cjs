// Exercises the real React listener, not the synthetic receiver in smoke.cjs.
const { app, BrowserWindow } = require('electron');
// Dedicated userData and no singleton interaction with a user's running broadcaster.
app.requestSingleInstanceLock = () => true;
const fs = require('node:fs');
const path = require('node:path');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const root = path.resolve(__dirname, '..', '.smoke');
fs.mkdirSync(root, { recursive: true });
process.env.SPORTSRADIO_USER_DATA = path.join(root, `listener-${Date.now()}`);
let host, receiver, finished = false;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const output = { realPhoneVerified: false, receiver: 'React listener in Electron' };
const evaluate = (window, script) => window.webContents.executeJavaScript(script, true);
async function until(fn, duration = 20000) {
  const end = Date.now() + duration;
  while (Date.now() < end) { if (await fn()) return; await pause(100); }
  throw new Error('React listener test timed out.');
}
async function finish(error) {
  if (finished) return; finished = true;
  if (error) output.error = error.message;
  output.passed = !error;
  fs.writeFileSync(path.join(root, 'listener-result.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output));
  await evaluate(host, "document.getElementById('stop').click(); document.getElementById('end').click()").catch(() => {});
  await pause(200); receiver?.destroy(); host?.destroy(); app.exit(error ? 1 : 0);
}
setTimeout(() => finish(new Error('React listener test exceeded 60 seconds.')), 60000).unref();
app.on('browser-window-created', (_event, window) => {
  if (host) return;
  host = window; host.hide();
  output.phase = 'host-created';
  host.webContents.once('did-finish-load', async () => {
    try {
      output.phase = 'host-loaded';
      await until(() => evaluate(host, "document.getElementById('connection').textContent.includes('Connected')"));
      await evaluate(host, "document.getElementById('name').value='Listener diagnostic'; document.getElementById('create').click()");
      await until(() => evaluate(host, "document.getElementById('connection').textContent.includes('Room ready')"));
      const code = await evaluate(host, "document.getElementById('room-code').textContent");
      output.phase = 'room-created';
      await evaluate(host, "document.getElementById('start').click()");
      await until(() => evaluate(host, "document.getElementById('broadcast').textContent === 'Live'"));
      output.phase = 'capture-live';
      receiver = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      receiver.webContents.setAudioMuted(true);
      const instrumentation = `
        globalThis.probe={peers:[],events:[]}; const Native=RTCPeerConnection;
        globalThis.RTCPeerConnection=class extends Native {
          constructor(...args){super(...args);probe.peers.push(this);this.addEventListener('connectionstatechange',()=>probe.events.push({event:'connection',state:this.connectionState}));}
          close(){probe.events.push({event:'close',connection:this.connectionState,signaling:this.signalingState});super.close();}
          async setRemoteDescription(value){try{
            const result=await super.setRemoteDescription(value);
            if(value.type==='offer' && ${process.env.SPORTSRADIO_TEST_START_DURING_OFFER === '1'}) {
              probe.events.push({event:'start-during-negotiation'});
              document.querySelector('button.primary-button')?.click();
              await new Promise(resolve=>setTimeout(resolve,100));
            }
            return result;
          }catch(error){probe.events.push({event:'remote-description-failed',name:error.name,categories:['parse','state','fingerprint','m-line','DTLS','codec','permission'].filter(word=>error.message.toLowerCase().includes(word.toLowerCase()))});throw error;}}
          async addIceCandidate(candidate){if(!this.remoteDescription)probe.events.push({event:'ice-before-description'});return super.addIceCandidate(candidate);}
        }; void 0;`;
      const base = process.env.SPORTSRADIO_TEST_LISTENER_URL || 'https://sports-radio-app.vercel.app';
      await new Promise((resolve, reject) => {
        receiver.webContents.once('dom-ready', resolve);
        receiver.loadURL(`${base}/?room=${encodeURIComponent(code)}`).catch(reject);
      });
      await evaluate(receiver, instrumentation);
      output.phase = 'listener-loaded';
      await pause(12000);
      output.listener = await evaluate(receiver, `(async()=>{
        const peers=[];for(const pc of probe.peers){let bytes=0;try{const stats=await pc.getStats();stats.forEach(s=>{if(s.type==='inbound-rtp'&&s.kind==='audio')bytes+=s.bytesReceived||0;});}catch{}peers.push({connection:pc.connectionState,ice:pc.iceConnectionState,signaling:pc.signalingState,bytes});}
        const audio=document.querySelector('audio');return {events:probe.events,peers,diagnostics:document.querySelector('details pre')?.textContent,audio:audio?{paused:audio.paused,muted:audio.muted,readyState:audio.readyState,hasStream:!!audio.srcObject}:null};
      })()`);
      output.desktop = await evaluate(host, "({peer:document.getElementById('peer').textContent,listeners:document.getElementById('listeners').textContent,diagnostics:document.getElementById('diagnostics')?.textContent})");
      if (!output.listener.peers.some((p) => p.connection === 'connected' && p.bytes > 0)) throw new Error('React listener did not establish incoming audio RTP.');
      await finish();
    } catch (error) { await finish(error); }
  });
});
require('../main.cjs');

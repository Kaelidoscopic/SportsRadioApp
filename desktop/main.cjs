const { app, BrowserWindow, session, ipcMain, desktopCapturer, safeStorage, clipboard, dialog } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { io } = require('socket.io-client');
const QRCode = require('qrcode');
const { CredentialStore } = require('./src/credential-store.cjs');
const { RoomSession } = require('./src/room-session.cjs');
const { serviceUrl } = require('./src/validation.cjs');

app.setName('SportsRadio Broadcaster');
app.setPath('userData', process.env.SPORTSRADIO_USER_DATA ? path.resolve(process.env.SPORTSRADIO_USER_DATA) : path.join(app.getPath('appData'), 'SportsRadio Broadcaster'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window, rooms;
  let armedUntil = 0;
  let captureEpoch = 0;
  const entry = pathToFileURL(path.join(__dirname, 'index.html')).href;
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    if (process.platform !== 'win32') throw new Error('This broadcaster currently supports Windows system playback only.');
    const store = new CredentialStore(path.join(app.getPath('userData'), 'room.dpapi'), safeStorage);
    const allowLan = process.env.SPORTSRADIO_ALLOW_INSECURE_LAN === '1';
    rooms = new RoomSession({ io, store, allowLan });
    // Fail closed instead of silently falling back to plaintext storage.
    await store.initialize();
    window = new BrowserWindow({ width: 780, height: 860, minWidth: 560, minHeight: 650,
      title: 'SportsRadio Broadcaster', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
    });
    const trusted = (frame) => Boolean(!window.isDestroyed() && frame && !frame.isDestroyed() && frame === window.webContents.mainFrame && frame.url === entry);
    session.defaultSession.setPermissionCheckHandler((contents, permission) => contents === window.webContents && permission === 'display-capture' && Date.now() < armedUntil);
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(contents === window.webContents && permission === 'display-capture' && Date.now() < armedUntil));
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!trusted(request.frame) || !request.audioRequested || !rooms.state.ready || Date.now() >= armedUntil) return callback(null);
      armedUntil = 0; // One-shot grant to the local top-level frame.
      const epoch = captureEpoch;
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        if (!sources.length || epoch !== captureEpoch || !trusted(request.frame) || !rooms.state.ready) return callback(null);
        callback({ video: sources[0], audio: 'loopback' });
      } catch { callback(null); }
    }, { useSystemPicker: false });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    window.webContents.on('render-process-gone', () => { armedUntil = 0; rooms.shutdown(true); });
    const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
      if (!trusted(event.senderFrame)) throw new Error('Untrusted IPC sender.');
      return fn(...args);
    });
    handle('app:initial', () => ({ state: rooms.snapshot(), backendUrl: process.env.SPORTSRADIO_BACKEND_URL || 'http://localhost:5000',
      listenerUrl: process.env.SPORTSRADIO_LISTENER_URL || 'https://sports-radio-app.vercel.app', platform: process.platform, electron: process.versions.electron, appVersion: app.getVersion() }));
    handle('room:connect', (url) => rooms.connect(url));
    handle('room:register', (input) => rooms.register(input));
    handle('room:recover', () => rooms.recover());
    handle('room:end', () => { armedUntil = 0; captureEpoch++; rooms.end(); });
    handle('room:broadcast', (value) => rooms.broadcast(value));
    handle('room:signal', (value) => rooms.signal(value));
    handle('capture:arm', () => {
      if (!rooms.state.ready || !rooms.state.connected) throw new Error('Create or recover a connected room before capture.');
      armedUntil = Date.now() + 5000;
      captureEpoch++;
    });
    handle('capture:disarm', () => { armedUntil = 0; captureEpoch++; });
    handle('room:copy', () => { if (rooms.state.roomCode) clipboard.writeText(rooms.state.roomCode); });
    handle('room:qr', async (base) => {
      if (!rooms.state.ready) throw new Error('Create a room first.');
      const url = new URL(serviceUrl(base, true));
      url.searchParams.set('room', rooms.state.roomCode);
      return { url: url.href, image: await QRCode.toDataURL(url.href, { width: 220, margin: 2 }) };
    });
    rooms.on('state', (state) => { if (!window.isDestroyed()) window.webContents.send('room:state', state); });
    rooms.on('signal', (value) => { if (!window.isDestroyed()) window.webContents.send('room:signal-in', value); });
    window.on('close', () => { armedUntil = 0; rooms.shutdown(true); });
    window.loadFile(path.join(__dirname, 'index.html'));
  }).catch((error) => { dialog.showErrorBox('Broadcaster startup failed', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { armedUntil = 0; rooms?.shutdown(true); });
}

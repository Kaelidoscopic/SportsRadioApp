const { contextBridge, ipcRenderer } = require('electron');
const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new Error('Expected callback');
  const handler = (_event, value) => callback(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
contextBridge.exposeInMainWorld('broadcaster', Object.freeze({
  initial: () => ipcRenderer.invoke('app:initial'),
  connect: (url) => ipcRenderer.invoke('room:connect', url),
  register: (input) => ipcRenderer.invoke('room:register', input),
  recover: () => ipcRenderer.invoke('room:recover'),
  end: () => ipcRenderer.invoke('room:end'),
  broadcast: (value) => ipcRenderer.invoke('room:broadcast', value),
  signal: (value) => ipcRenderer.invoke('room:signal', value),
  armCapture: () => ipcRenderer.invoke('capture:arm'),
  disarmCapture: () => ipcRenderer.invoke('capture:disarm'),
  copyCode: () => ipcRenderer.invoke('room:copy'),
  qr: (url) => ipcRenderer.invoke('room:qr', url),
  onState: (callback) => subscribe('room:state', callback),
  onSignal: (callback) => subscribe('room:signal-in', callback)
}));

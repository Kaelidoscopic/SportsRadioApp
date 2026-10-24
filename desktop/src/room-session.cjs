const { EventEmitter } = require('node:events');
const { serviceUrl, roomInput, signalPayload } = require('./validation.cjs');

// Runs only in main. Neither socket acknowledgements nor credentials cross IPC.
class RoomSession extends EventEmitter {
  constructor({ io, store, allowLan = false }) {
    super(); this.io = io; this.store = store; this.allowLan = allowLan;
    this.socket = null; this.record = null; this.generation = 0; this.busy = false;
    this.state = { connected: false, ready: false, recovering: false, broadcasting: false, members: [], roomCode: '', roomName: '', message: 'Connect to the backend to create a room.' };
  }
  publish(changes = {}) { Object.assign(this.state, changes); this.emit('state', this.snapshot()); }
  snapshot() { return { ...this.state, members: [...this.state.members], canRecover: Boolean(this.record), backendUrl: this.backendUrl || '', expiresAt: this.record?.expiresAt || null }; }
  connect(url) {
    const backendUrl = serviceUrl(url, this.allowLan);
    if (this.socket && this.backendUrl === backendUrl) { if (!this.socket.connected) this.socket.connect(); return this.snapshot(); }
    this.shutdown(false);
    this.backendUrl = backendUrl;
    const stored = this.store.load();
    this.record = stored?.backendUrl === backendUrl ? stored : null;
    this.publish({ roomCode: this.record?.roomCode || '', roomName: this.record?.roomName || '', message: 'Connecting…' });
    const socket = this.socket = this.io(backendUrl, { autoConnect: false, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000, timeout: 8000 });
    socket.on('connect', () => {
      if (socket !== this.socket) return;
      this.publish({ connected: true, recovering: Boolean(this.record), message: this.record ? 'Recovering saved ownership…' : 'Connected. Create a room or recover the saved room.' });
      if (this.record) this.recover().catch((error) => this.publish({ message: error.message }));
    });
    socket.on('disconnect', () => {
      if (socket !== this.socket) return;
      this.generation++; this.busy = false;
      this.publish({ connected: false, ready: false, broadcasting: false, members: [], message: 'Disconnected. Capture stopped; reconnecting…' });
    });
    socket.on('connect_error', () => this.publish({ message: 'Cannot reach backend. Check its URL, network and firewall.' }));
    socket.on('room-updated', ({ roomId, members } = {}) => {
      if (this.state.ready && roomId === this.state.roomCode && Array.isArray(members)) this.publish({ members: members.filter((id) => id !== socket.id) });
    });
    socket.on('room-closed', () => {
      this.generation++; this.busy = false; this.record = null;
      try { this.store.clear(); } catch { /* Closed ownership cannot recover, even if disk cleanup failed. */ }
      this.publish({ ready: false, broadcasting: false, members: [], message: 'Room closed. Create a new room to continue.' });
    });
    socket.on('error-message', () => this.publish({ message: 'Backend rejected a room or signaling operation. Stop and retry, or recover the room.' }));
    for (const event of ['listener-joined', 'stream-requested']) socket.on(event, ({ listenerSocketId } = {}) => {
      if (this.state.ready && this.state.members.includes(listenerSocketId)) this.emit('signal', { event, listenerSocketId });
    });
    for (const event of ['webrtc-answer', 'webrtc-ice-candidate']) socket.on(event, (payload) => {
      if (this.state.ready && payload && this.state.members.includes(payload.sender)) this.emit('signal', { event, ...payload });
    });
    socket.connect(); return this.snapshot();
  }
  async request(event, payload) {
    if (!this.socket?.connected) throw new Error('Backend is disconnected.');
    if (this.busy) throw new Error('A room operation is already in progress.');
    this.busy = true;
    const generation = this.generation;
    try {
      const result = await new Promise((resolve, reject) => this.socket.timeout(5000).emit(event, payload, (error, result) => {
        if (error) reject(new Error('Room request timed out. Reconnect before retrying; registration may have reached the server.'));
        else resolve(result);
      }));
      if (generation !== this.generation) throw new Error('Room operation interrupted by disconnection.');
      if (!result?.ok) throw new Error(`Room operation failed: ${result?.error || 'INVALID_RESPONSE'}. Use Create New Room explicitly if saved ownership is no longer valid.`);
      return result;
    } catch (error) {
      // Timeout leaves ownership uncertain. Disconnect so the server starts grace cleanup.
      if (/timed out/.test(error.message)) this.socket.disconnect();
      throw error;
    } finally { if (generation === this.generation) this.busy = false; }
  }
  accept(result) {
    this.publish({ ready: true, recovering: false, roomCode: result.roomId, roomName: result.roomName, members: result.members.filter((id) => id !== this.socket.id), message: 'Room ready. Start Broadcasting to capture Windows playback.' });
  }
  async register(input) {
    if (this.state.ready) throw new Error('End the current room before creating another.');
    const result = await this.request('desktop:register', roomInput(input));
    this.record = { backendUrl: this.backendUrl, roomCode: result.roomId, roomName: result.roomName, credential: result.credential, expiresAt: result.expiresAt };
    const generation = this.generation;
    try { await this.store.save(this.record); } catch {
      if (generation !== this.generation) return this.snapshot();
      this.socket.emit('end-room'); this.record = null;
      throw new Error('Could not securely save ownership. Room creation was cancelled.');
    }
    if (generation !== this.generation) return this.snapshot();
    this.accept(result); return this.snapshot();
  }
  async recover() {
    if (this.state.ready) return this.snapshot();
    if (!this.record) throw new Error('No saved ownership for this backend. Create a new room.');
    this.publish({ recovering: true });
    try {
      const result = await this.request('desktop:recover', { roomCode: this.record.roomCode, credential: this.record.credential });
      this.accept(result); return this.snapshot();
    } catch (error) { this.publish({ recovering: false, message: error.message }); throw error; }
  }
  broadcast(value) {
    if (typeof value !== 'boolean') throw new Error('Invalid broadcast state.');
    if (value && (!this.state.ready || !this.socket?.connected)) throw new Error('Recover or create a room first.');
    if (this.state.ready && this.socket?.connected) this.socket.emit(value ? 'broadcast-started' : 'broadcast-stopped');
    this.publish({ broadcasting: value });
  }
  signal(value) {
    if (!this.state.ready || !this.socket?.connected || !this.state.broadcasting) throw new Error('Broadcast is not active.');
    const { event, payload } = signalPayload(value, this.state.members); this.socket.emit(event, payload);
  }
  end() {
    this.generation++; this.busy = false;
    if (this.state.ready) this.socket?.emit('end-room');
    this.record = null; this.store.clear();
    this.publish({ ready: false, recovering: false, broadcasting: false, members: [], message: 'Room ended. Its code can be reused by creating a new room.' });
  }
  shutdown(intentional = true) {
    this.generation++; this.busy = false;
    if (this.socket) {
      if (intentional && this.state.ready) this.socket.emit('end-room');
      this.socket.removeAllListeners(); this.socket.disconnect(); this.socket = null;
    }
    this.publish({ connected: false, ready: false, broadcasting: false, members: [] });
  }
}
module.exports = { RoomSession };

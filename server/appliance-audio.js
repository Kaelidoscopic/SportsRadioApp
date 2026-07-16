const DEFAULT_MAX_AUDIO_CHUNK_BYTES = 64 * 1024;
const DEFAULT_MAX_BUFFERED_AUDIO_BYTES = 64 * 1024;
const AUDIO_EVENT = "appliance:audio-chunk";
const LISTENER_AUDIO_EVENT = "appliance-audio-chunk";

const getPacketBytes = (value) => {
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === "string") return Buffer.byteLength(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (value?.data !== undefined) return getPacketBytes(value.data);
  return 0;
};

const getSocketBufferedBytes = (socket) => {
  const writeBuffer = socket?.io?.engine?.writeBuffer;
  if (!Array.isArray(writeBuffer)) return 0;
  return writeBuffer.reduce((total, packet) => total + getPacketBytes(packet), 0);
};

const validateAudioChunk = (
  chunk,
  maxChunkBytes = DEFAULT_MAX_AUDIO_CHUNK_BYTES
) => {
  if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
    return { ok: false, reason: "invalid-chunk" };
  }
  if (chunk.length > maxChunkBytes) {
    return { ok: false, reason: "oversized-chunk" };
  }
  return { ok: true };
};

const createLiveAudioSender = ({
  getSocket,
  getMetadata,
  maxChunkBytes = DEFAULT_MAX_AUDIO_CHUNK_BYTES,
  maxBufferedBytes = DEFAULT_MAX_BUFFERED_AUDIO_BYTES,
  logger = console,
  now = Date.now,
  logIntervalMs = 5000
}) => {
  const stats = { sent: 0, dropped: 0, lastDropReason: null };
  let lastDropLogAt = 0;

  const drop = (reason) => {
    stats.dropped += 1;
    stats.lastDropReason = reason;
    const timestamp = now();
    if (timestamp - lastDropLogAt >= logIntervalMs) {
      logger.warn?.(
        `Live audio chunk dropped (${reason}); total dropped=${stats.dropped}.`
      );
      lastDropLogAt = timestamp;
    }
    return false;
  };

  const send = (chunk) => {
    const validation = validateAudioChunk(chunk, maxChunkBytes);
    if (!validation.ok) return drop(validation.reason);

    const socket = getSocket();
    if (!socket?.connected) return drop("socket-unavailable");

    const engine = socket.io?.engine;
    if (engine?.transport && engine.transport.writable === false) {
      return drop("transport-backpressure");
    }

    const bufferedBytes = getSocketBufferedBytes(socket);
    if (bufferedBytes + chunk.length > maxBufferedBytes) {
      return drop("buffer-limit");
    }

    try {
      socket.volatile.emit(AUDIO_EVENT, {
        ...getMetadata(),
        chunk
      });
      stats.sent += 1;
      return true;
    } catch (error) {
      logger.error?.(`Live audio emit failed: ${error.message}`);
      return drop("emit-error");
    }
  };

  return {
    send,
    getStats: () => ({ ...stats })
  };
};

const createCaptureChunkHandler = ({
  stream,
  isCurrentStream,
  isShuttingDown,
  isRoomRegistered,
  sendChunk,
  scheduleRetry,
  setAudioUploading
}) => (chunk) => {
  if (
    isShuttingDown() ||
    !isCurrentStream() ||
    !stream ||
    stream.destroyed
  ) {
    return false;
  }

  if (!isRoomRegistered()) {
    setAudioUploading(false);
    scheduleRetry();
    return false;
  }

  const sent = sendChunk(chunk);
  if (sent) {
    setAudioUploading(true);
  }
  return sent;
};

const createApplianceAudioHandler = ({
  rooms,
  appliances,
  applianceSockets,
  isAuthorized,
  sanitizeRoomCode,
  maxChunkBytes = DEFAULT_MAX_AUDIO_CHUNK_BYTES,
  logger = console,
  now = Date.now,
  logIntervalMs = 5000
}) => {
  const lastDiagnosticAt = new Map();

  const reject = (socket, reason, details = "") => {
    const key = `${socket?.id || "unknown"}:${reason}`;
    const timestamp = now();
    const previous = lastDiagnosticAt.get(key) || 0;
    if (timestamp - previous >= logIntervalMs) {
      logger.warn?.(
        `Appliance audio rejected: socket=${socket?.id || "unknown"} reason=${reason}${
          details ? ` ${details}` : ""
        }`
      );
      lastDiagnosticAt.set(key, timestamp);
    }
    return { ok: false, reason };
  };

  return (socket, payload = {}) => {
    if (!isAuthorized(socket)) {
      return reject(socket, "unauthorized");
    }

    const applianceId = socket.data?.applianceId;
    const appliance = applianceId ? appliances[applianceId] : null;
    if (
      !applianceId ||
      !appliance ||
      applianceSockets[applianceId] !== socket.id
    ) {
      return reject(socket, "unregistered-appliance");
    }

    const validation = validateAudioChunk(payload?.chunk, maxChunkBytes);
    if (!validation.ok) {
      return reject(
        socket,
        validation.reason,
        `bytes=${Buffer.isBuffer(payload?.chunk) ? payload.chunk.length : 0}`
      );
    }

    const roomId = sanitizeRoomCode(payload.roomCode || appliance.roomCode || "");
    const room = rooms[roomId];
    if (
      !roomId ||
      appliance.roomCode !== roomId ||
      !room ||
      room.hostType !== "appliance" ||
      !room.hostSocketId ||
      room.appliance?.applianceId !== applianceId
    ) {
      return reject(socket, "room-unavailable", `room=${roomId || "none"}`);
    }

    const timestamp = now();
    room.appliance.lastSeen = timestamp;
    appliance.lastHeartbeat = new Date(timestamp).toISOString();
    appliance.isOnline = true;

    try {
      socket.to(roomId).emit(LISTENER_AUDIO_EVENT, {
        roomId,
        sampleRate: Number(payload.sampleRate) || room.appliance.sampleRate || 44100,
        channels: Number(payload.channels) || room.appliance.channels || 2,
        encoding: payload.encoding || room.appliance.encoding || "pcm_s16le",
        chunk: payload.chunk
      });
    } catch (error) {
      logger.error?.(
        `Appliance audio forwarding failed: socket=${socket.id} room=${roomId} error=${error.message}`
      );
      return { ok: false, reason: "forward-error" };
    }

    return { ok: true, roomId, bytes: payload.chunk.length };
  };
};

module.exports = {
  AUDIO_EVENT,
  DEFAULT_MAX_AUDIO_CHUNK_BYTES,
  DEFAULT_MAX_BUFFERED_AUDIO_BYTES,
  LISTENER_AUDIO_EVENT,
  createApplianceAudioHandler,
  createCaptureChunkHandler,
  createLiveAudioSender,
  getSocketBufferedBytes,
  validateAudioChunk
};

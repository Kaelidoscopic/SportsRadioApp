const express = require("express");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};
const APPLIANCE_HOST_PREFIX = "appliance:";
const APPLIANCE_OFFLINE_AFTER_MS = 10000;
const appliances = {};
const applianceSockets = {};
const adminSockets = new Set();

const DB_PATH =
  process.env.SPORTSYNC_DB_PATH ||
  path.join(__dirname, "data", "sports-sync.sqlite");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appliances (
    appliance_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    room_code TEXT NOT NULL,
    room_name TEXT NOT NULL,
    is_public INTEGER NOT NULL DEFAULT 1,
    is_online INTEGER NOT NULL DEFAULT 0,
    is_audio_enabled INTEGER NOT NULL DEFAULT 0,
    is_room_active INTEGER NOT NULL DEFAULT 0,
    last_heartbeat TEXT,
    listener_count INTEGER NOT NULL DEFAULT 0,
    audio_status TEXT NOT NULL DEFAULT 'unknown',
    uptime INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ownerships (
    user_id TEXT NOT NULL,
    appliance_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, appliance_id),
    UNIQUE (appliance_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (appliance_id) REFERENCES appliances(appliance_id)
  );

  CREATE TABLE IF NOT EXISTS pairing_codes (
    pairing_code TEXT PRIMARY KEY,
    appliance_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (appliance_id) REFERENCES appliances(appliance_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id)
  );
`);

const nowIso = () => new Date().toISOString();

const boolToInt = (value) => (value ? 1 : 0);

const rowToUser = (row) =>
  row
    ? {
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        password: {
          salt: row.password_salt,
          hash: row.password_hash
        },
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }
    : null;

const getOwnerUserId = (applianceId) => {
  const row = db
    .prepare("SELECT user_id FROM ownerships WHERE appliance_id = ?")
    .get(applianceId);

  return row?.user_id || null;
};

const rowToAppliance = (row) =>
  row
    ? {
        applianceId: row.appliance_id,
        ownerUserId: getOwnerUserId(row.appliance_id),
        pairingCode:
          db
            .prepare("SELECT pairing_code FROM pairing_codes WHERE appliance_id = ?")
            .get(row.appliance_id)?.pairing_code || String(row.appliance_id).toUpperCase(),
        displayName: row.display_name,
        roomCode: row.room_code,
        roomName: row.room_name,
        isPublic: Boolean(row.is_public),
        isOnline: Boolean(row.is_online),
        isAudioEnabled: Boolean(row.is_audio_enabled),
        isRoomActive: Boolean(row.is_room_active),
        lastHeartbeat: row.last_heartbeat,
        listenerCount: Number(row.listener_count) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        audioStatus: row.audio_status || "unknown",
        uptime: Number(row.uptime) || 0,
        socketId: null
      }
    : null;

const saveApplianceRecord = (appliance) => {
  db.prepare(
    `
      INSERT INTO appliances (
        appliance_id,
        display_name,
        room_code,
        room_name,
        is_public,
        is_online,
        is_audio_enabled,
        is_room_active,
        last_heartbeat,
        listener_count,
        audio_status,
        uptime,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(appliance_id) DO UPDATE SET
        display_name = excluded.display_name,
        room_code = excluded.room_code,
        room_name = excluded.room_name,
        is_public = excluded.is_public,
        is_online = excluded.is_online,
        is_audio_enabled = excluded.is_audio_enabled,
        is_room_active = excluded.is_room_active,
        last_heartbeat = excluded.last_heartbeat,
        listener_count = excluded.listener_count,
        audio_status = excluded.audio_status,
        uptime = excluded.uptime,
        updated_at = excluded.updated_at
    `
  ).run(
    appliance.applianceId,
    appliance.displayName,
    appliance.roomCode,
    appliance.roomName,
    boolToInt(appliance.isPublic !== false),
    boolToInt(appliance.isOnline),
    boolToInt(appliance.isAudioEnabled),
    boolToInt(appliance.isRoomActive),
    appliance.lastHeartbeat || null,
    Number(appliance.listenerCount) || 0,
    appliance.audioStatus || "unknown",
    Number(appliance.uptime) || 0,
    appliance.createdAt,
    appliance.updatedAt
  );

  const pairingCode = String(
    appliance.pairingCode || appliance.applianceId
  ).trim().toUpperCase();

  db.prepare(
    `
      INSERT INTO pairing_codes (pairing_code, appliance_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(appliance_id) DO UPDATE SET
        pairing_code = excluded.pairing_code,
        updated_at = excluded.updated_at
    `
  ).run(pairingCode, appliance.applianceId, appliance.createdAt, appliance.updatedAt);
};

const loadApplianceRegistry = () => {
  const rows = db.prepare("SELECT * FROM appliances").all();

  rows.forEach((row) => {
    const appliance = rowToAppliance(row);

    if (appliance) {
      appliances[appliance.applianceId] = appliance;
    }
  });
};

loadApplianceRegistry();

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const hashPassword = (password, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto
    .pbkdf2Sync(String(password || ""), salt, 100000, 64, "sha512")
    .toString("hex");

  return { salt, hash };
};

const verifyPassword = (password, passwordRecord) => {
  if (!passwordRecord?.salt || !passwordRecord?.hash) return false;

  const next = hashPassword(password, passwordRecord.salt);
  return crypto.timingSafeEqual(
    Buffer.from(next.hash, "hex"),
    Buffer.from(passwordRecord.hash, "hex")
  );
};

const toUserDto = (user) => ({
  userId: user.userId,
  email: user.email,
  displayName: user.displayName,
  createdAt: user.createdAt
});

const createSession = (userId) => {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)"
  ).run(token, userId, nowIso());
  return token;
};

const getAuthUser = (req) => {
  const authHeader = String(req.get("authorization") || "");

  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;

  const token = authHeader.slice(7).trim();
  const session = db
    .prepare("SELECT user_id FROM sessions WHERE token = ?")
    .get(token);

  if (!session) return null;

  return rowToUser(
    db.prepare("SELECT * FROM users WHERE user_id = ?").get(session.user_id)
  );
};

const requireAuthUser = (req, res) => {
  const user = getAuthUser(req);

  if (!user) {
    res.status(401).json({ error: "Login is required." });
    return null;
  }

  return user;
};

const getAdminPin = () => process.env.ADMIN_PIN || process.env.SPORTSYNC_ADMIN_PIN || "";

const readAdminPin = (req) => {
  const authHeader = String(req.get("authorization") || "");

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }

  return String(req.get("x-admin-pin") || req.body?.adminPin || "").trim();
};

const requireAdminPin = (req, res) => {
  const adminPin = getAdminPin();

  if (!adminPin) {
    res.status(503).json({
      error: "Admin PIN is not configured. Set ADMIN_PIN on the backend."
    });
    return false;
  }

  if (readAdminPin(req) !== adminPin) {
    res.status(401).json({ error: "Invalid admin PIN." });
    return false;
  }

  return true;
};

const getManagedAppliance = (applianceId) => appliances[applianceId] || null;

const createOrUpdateManagedAppliance = (payload = {}, socketId = null) => {
  const applianceId = String(payload.applianceId || "").trim();

  if (!applianceId) return null;

  const existing = appliances[applianceId] || {};
  const roomCode = sanitizeRoomCode(payload.roomCode || existing.roomCode || "HOME");
  const room = rooms[roomCode];
  const isAudioEnabled =
    typeof payload.isAudioEnabled === "boolean"
      ? payload.isAudioEnabled
      : typeof payload.audioEnabled === "boolean"
        ? payload.audioEnabled
      : payload.audioStatus
        ? payload.audioStatus === "running"
        : Boolean(existing.isAudioEnabled);
  const isRoomActive =
    typeof payload.isRoomActive === "boolean"
      ? payload.isRoomActive
      : typeof payload.roomActive === "boolean"
        ? payload.roomActive
      : Boolean(existing.isRoomActive || room?.hostSocketId);
  const timestamp = nowIso();

  appliances[applianceId] = {
    applianceId,
    ownerUserId: existing.ownerUserId || payload.ownerUserId || getOwnerUserId(applianceId),
    pairingCode:
      payload.pairingCode || existing.pairingCode || String(applianceId).toUpperCase(),
    displayName: payload.displayName || payload.name || existing.displayName || applianceId,
    roomCode,
    roomName: payload.roomName || existing.roomName || roomCode,
    isPublic:
      typeof payload.isPublic === "boolean"
        ? payload.isPublic
        : existing.isPublic !== false,
    isOnline: payload.online !== false,
    isAudioEnabled,
    isRoomActive,
    lastHeartbeat: payload.lastHeartbeat || timestamp,
    listenerCount: room?.listeners.length || existing.listenerCount || 0,
    createdAt: existing.createdAt || timestamp,
    updatedAt: timestamp,
    audioStatus: payload.audioStatus || existing.audioStatus || "unknown",
    uptime: Number(payload.uptime) || existing.uptime || 0,
    socketId: socketId || existing.socketId || null
  };

  if (socketId) {
    applianceSockets[applianceId] = socketId;
  }

  saveApplianceRecord(appliances[applianceId]);
  return appliances[applianceId];
};

const toApplianceDto = (appliance) => {
  const room = rooms[appliance.roomCode];

  return {
    applianceId: appliance.applianceId,
    ownerUserId: appliance.ownerUserId || null,
    displayName: appliance.displayName,
    roomCode: appliance.roomCode,
    roomName: appliance.roomName,
    isPublic: appliance.isPublic !== false,
    isOnline: Boolean(appliance.isOnline),
    isAudioEnabled: Boolean(appliance.isAudioEnabled),
    isRoomActive: Boolean(appliance.isRoomActive || room?.hostSocketId),
    lastHeartbeat: appliance.lastHeartbeat,
    listenerCount: room?.listeners.length || appliance.listenerCount || 0,
    createdAt: appliance.createdAt,
    updatedAt: appliance.updatedAt
  };
};

const getPublicRooms = () =>
  Object.entries(rooms)
    .filter(([, room]) => room.hostSocketId && room.appliance?.isPublic !== false)
    .map(([roomId, room]) => ({
      roomId,
      roomName: room.appliance?.roomName || roomId,
      isBroadcasting: room.isBroadcasting,
      listenerCount: room.listeners.length,
      hostType: room.hostType || "browser"
    }));

const emitRoomsList = () => {
  io.emit("rooms-list", getPublicRooms());
};

const getApplianceCards = () =>
  Object.values(appliances).map((appliance) => {
    const room = rooms[appliance.roomCode];

    return {
      ...appliance,
      online: Boolean(appliance.isOnline),
      broadcasting: Boolean(room?.isBroadcasting),
      listenerCount: room?.listeners.length || 0
    };
  });

const emitApplianceList = () => {
  const list = getApplianceCards();

  adminSockets.forEach((socketId) => {
    io.to(socketId).emit("admin:appliances", list);
  });
};

const updateApplianceStatus = (payload = {}, socketId = null) => {
  const appliance = createOrUpdateManagedAppliance(payload, socketId);

  if (appliance) {
    const room = rooms[appliance.roomCode];

    if (room?.hostType === "appliance") {
      room.isBroadcasting = Boolean(appliance.isAudioEnabled);
      room.appliance = {
        ...(room.appliance || {}),
        roomName: appliance.roomName,
        isPublic: appliance.isPublic !== false,
        lastSeen: Date.now()
      };

      io.to(appliance.roomCode).emit("broadcast-status", {
        isBroadcasting: room.isBroadcasting,
        hostType: "appliance",
        appliance: room.appliance
      });
      emitRoomsList();
    }
  }

  emitApplianceList();
  return appliance;
};

const sendApplianceCommand = (socket, applianceId, eventName, payload = {}) => {
  if (!adminSockets.has(socket.id)) {
    socket.emit("admin:error", "Admin authentication required.");
    return;
  }

  const targetSocketId = applianceSockets[applianceId];

  if (!targetSocketId) {
    socket.emit("admin:error", "Appliance is offline.");
    return;
  }

  io.to(targetSocketId).emit(eventName, payload);
};

const sendCommandToAppliance = (applianceId, eventName, payload = {}) => {
  const targetSocketId = applianceSockets[applianceId];

  if (!targetSocketId) return false;

  io.to(targetSocketId).emit(eventName, payload);
  return true;
};

const isAuthorizedApplianceSocket = (socket) => {
  if (!process.env.PI_HOST_TOKEN) return true;

  return socket.handshake.auth?.token === process.env.PI_HOST_TOKEN;
};

const closeRoom = (roomId, reason) => {
  const room = rooms[roomId];
  if (!room) return;

  if (room.hostDisconnectTimer) {
    clearTimeout(room.hostDisconnectTimer);
  }

  io.to(roomId).emit("room-closed", reason);
  delete rooms[roomId];

  emitRoomsList();
  console.log(`Room ${roomId} closed: ${reason}`);
};

const findRoomForSocket = (socketId) => {
  for (const roomId in rooms) {
    const room = rooms[roomId];

    if (room.hostSocketId === socketId) {
      return { roomId, room, role: "host" };
    }

    if (room.listeners.includes(socketId)) {
      return { roomId, room, role: "listener" };
    }
  }

  return null;
};

const sanitizeRoomCode = (code) => {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
};

const createRoomState = ({
  hostSocketId,
  hostType = "browser",
  isBroadcasting = false,
  appliance = null
}) => ({
  hostSocketId,
  hostType,
  listeners: [],
  isBroadcasting,
  hostDisconnectTimer: null,
  appliance
});

const updateApplianceRoom = (roomId, appliance = {}) => {
  const existingRoom = rooms[roomId];
  const nextApplianceState = {
    applianceId: appliance.applianceId || null,
    sampleRate: Number(appliance.sampleRate) || 44100,
    channels: Number(appliance.channels) || 2,
    encoding: appliance.encoding || "pcm_s16le",
    label: appliance.label || "Pi audio appliance",
    roomName: appliance.roomName || appliance.displayName || roomId,
    isPublic: appliance.isPublic !== false,
    lastSeen: Date.now()
  };

  if (existingRoom) {
    if (
      existingRoom.hostSocketId &&
      existingRoom.hostType !== "appliance"
    ) {
      return {
        error: "Room already exists with a browser host."
      };
    }

    existingRoom.hostSocketId = `${APPLIANCE_HOST_PREFIX}${roomId}`;
    existingRoom.hostType = "appliance";
    existingRoom.isBroadcasting = true;
    existingRoom.appliance = {
      ...existingRoom.appliance,
      ...nextApplianceState
    };

    if (existingRoom.hostDisconnectTimer) {
      clearTimeout(existingRoom.hostDisconnectTimer);
      existingRoom.hostDisconnectTimer = null;
    }
  } else {
    rooms[roomId] = createRoomState({
      hostSocketId: `${APPLIANCE_HOST_PREFIX}${roomId}`,
      hostType: "appliance",
      isBroadcasting: true,
      appliance: nextApplianceState
    });
  }

  const room = rooms[roomId];
  const members = [room.hostSocketId, ...room.listeners];

  io.to(roomId).emit("room-updated", { roomId, members });
  io.to(roomId).emit("broadcast-status", {
    isBroadcasting: true,
    hostType: "appliance",
    appliance: room.appliance
  });

  emitRoomsList();
  updateApplianceStatus({
    applianceId: room.appliance?.applianceId,
    roomCode: roomId,
    online: true,
    isRoomActive: true,
    isAudioEnabled: true,
    roomName: room.appliance?.roomName,
    audioStatus: "running",
    lastHeartbeat: nowIso()
  });

  return { room };
};

const markApplianceOffline = (roomId, reason = "Pi host is offline.") => {
  const room = rooms[roomId];

  if (!room || room.hostType !== "appliance") return;
  const applianceId = room.appliance?.applianceId;

  room.hostSocketId = null;
  room.isBroadcasting = false;

  if (applianceId && appliances[applianceId]) {
    appliances[applianceId].isRoomActive = false;
    appliances[applianceId].isAudioEnabled = false;
    appliances[applianceId].listenerCount = room.listeners.length;
    appliances[applianceId].updatedAt = nowIso();
    saveApplianceRecord(appliances[applianceId]);
  }

  io.to(roomId).emit("broadcast-status", {
    isBroadcasting: false,
    hostType: "appliance"
  });

  console.log(`${roomId}: ${reason}`);
  emitRoomsList();
  emitApplianceList();
};

setInterval(() => {
  const now = Date.now();

  for (const roomId in rooms) {
    const room = rooms[roomId];

    if (
      room.hostType === "appliance" &&
      room.hostSocketId &&
      room.appliance?.lastSeen &&
      now - room.appliance.lastSeen > APPLIANCE_OFFLINE_AFTER_MS
    ) {
      markApplianceOffline(roomId, "Pi host heartbeat expired.");
    }
  }
}, 5000);

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("create-room", (customCode) => {
    let roomId = customCode
      ? sanitizeRoomCode(customCode)
      : Math.random().toString(36).substring(2, 8).toUpperCase();

    if (!roomId) {
      socket.emit("error-message", "Invalid room code.");
      return;
    }

    if (rooms[roomId]) {
      const existingRoom = rooms[roomId];

      if (existingRoom.hostSocketId === null) {
        if (existingRoom.hostDisconnectTimer) {
          clearTimeout(existingRoom.hostDisconnectTimer);
          existingRoom.hostDisconnectTimer = null;
        }

        existingRoom.hostSocketId = socket.id;
        existingRoom.hostType = "browser";
        existingRoom.appliance = null;
        socket.join(roomId);

        const members = [socket.id, ...existingRoom.listeners];

        socket.emit("room-created", {
          roomId,
          role: "host",
          members
        });

        io.to(roomId).emit("room-updated", { roomId, members });

        console.log(`Room recovered by host: ${roomId}`);
        emitRoomsList();
        return;
      }

      socket.emit("error-message", "Room already exists.");
      return;
    }

    rooms[roomId] = createRoomState({
      hostSocketId: socket.id
    });

    socket.join(roomId);

    socket.emit("room-created", {
      roomId,
      role: "host",
      members: [socket.id]
    });

    console.log(`Room created: ${roomId}`);
    emitRoomsList();
  });

  socket.on("join-room", (roomCode) => {
    const roomId = sanitizeRoomCode(roomCode || "");
    const room = rooms[roomId];

    if (!room) {
      socket.emit("error-message", "Room not found.");
      return;
    }

    if (!room.hostSocketId) {
      socket.emit("error-message", "Host is reconnecting. Try again in a moment.");
      return;
    }

    if (!room.listeners.includes(socket.id)) {
      room.listeners.push(socket.id);
    }

    socket.join(roomId);

    const members = [room.hostSocketId, ...room.listeners];

    io.to(roomId).emit("room-updated", { roomId, members });

    socket.emit("joined-room", {
      roomId,
      role: "listener",
      members,
      isBroadcasting: room.isBroadcasting,
      hostType: room.hostType || "browser",
      appliance: room.appliance || null
    });

    if (room.hostType !== "appliance") {
      io.to(room.hostSocketId).emit("listener-joined", {
        listenerSocketId: socket.id
      });
    }

    console.log(`${socket.id} joined room ${roomId}`);
    emitRoomsList();
  });

  socket.on("leave-room", () => {
    const match = findRoomForSocket(socket.id);

    if (!match) {
      socket.emit("error-message", "You are not currently in a room.");
      return;
    }

    if (match.role === "host") {
      closeRoom(match.roomId, "Host ended the room.");
      return;
    }

    const index = match.room.listeners.indexOf(socket.id);

    if (index !== -1) {
      match.room.listeners.splice(index, 1);
      socket.leave(match.roomId);

      const members = [match.room.hostSocketId, ...match.room.listeners];

      io.to(match.roomId).emit("room-updated", { roomId: match.roomId, members });
      socket.emit("left-room", "You left the room.");

      console.log(`${socket.id} left room ${match.roomId}`);
      emitRoomsList();
      return;
    }
  });

  socket.on("end-room", () => {
    const match = findRoomForSocket(socket.id);

    if (!match || match.role !== "host") {
      socket.emit("error-message", "Only the host can end a room.");
      return;
    }

    closeRoom(match.roomId, "Host ended the room.");
  });

  socket.on("request-stream", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.listeners.includes(socket.id)) {
        if (!room.hostSocketId) {
          socket.emit("error-message", "Host is not connected.");
          return;
        }

        if (room.hostType === "appliance") {
          socket.emit("appliance-stream-ready", {
            roomId,
            appliance: room.appliance || null
          });
          return;
        }

        io.to(room.hostSocketId).emit("stream-requested", {
          listenerSocketId: socket.id
        });

        console.log(`${socket.id} requested stream in room ${roomId}`);
        return;
      }
    }

    socket.emit("error-message", "You must be in a room to request audio.");
  });

  socket.on("broadcast-started", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.hostSocketId === socket.id) {
        room.isBroadcasting = true;

        io.to(roomId).emit("broadcast-status", {
          isBroadcasting: true
        });

        console.log(`Broadcast started in room ${roomId}`);
        emitRoomsList();
        return;
      }
    }
  });

  socket.on("broadcast-stopped", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.hostSocketId === socket.id) {
        room.isBroadcasting = false;

        io.to(roomId).emit("broadcast-status", {
          isBroadcasting: false
        });

        console.log(`Broadcast stopped in room ${roomId}`);
        emitRoomsList();
        return;
      }
    }
  });

  socket.on("webrtc-offer", ({ target, offer }) => {
    io.to(target).emit("webrtc-offer", {
      sender: socket.id,
      offer
    });
  });

  socket.on("webrtc-answer", ({ target, answer }) => {
    io.to(target).emit("webrtc-answer", {
      sender: socket.id,
      answer
    });
  });

  socket.on("webrtc-ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("webrtc-ice-candidate", {
      sender: socket.id,
      candidate
    });
  });

  socket.on("get-rooms", () => {
    socket.emit("rooms-list", getPublicRooms());
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    adminSockets.delete(socket.id);

    for (const applianceId in applianceSockets) {
      if (applianceSockets[applianceId] === socket.id) {
        delete applianceSockets[applianceId];

        if (appliances[applianceId]) {
          appliances[applianceId].isOnline = false;
          appliances[applianceId].lastHeartbeat = nowIso();
          appliances[applianceId].updatedAt = nowIso();
          saveApplianceRecord(appliances[applianceId]);
        }

        emitApplianceList();
      }
    }

    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.hostSocketId === socket.id) {
        room.hostSocketId = null;
        room.isBroadcasting = false;

        io.to(roomId).emit("broadcast-status", {
          isBroadcasting: false
        });

        emitRoomsList();

        room.hostDisconnectTimer = setTimeout(() => {
          const latestRoom = rooms[roomId];

          if (latestRoom && latestRoom.hostSocketId === null) {
            closeRoom(roomId, "Host disconnected. Room closed.");
          }
        }, 15000);

        console.log(`Host disconnected from ${roomId}. Grace period started.`);
        return;
      }

      const index = room.listeners.indexOf(socket.id);

      if (index !== -1) {
        room.listeners.splice(index, 1);

        const members = [room.hostSocketId, ...room.listeners];

        io.to(roomId).emit("room-updated", { roomId, members });

        console.log(`${socket.id} removed from room ${roomId}`);
        emitRoomsList();
        return;
      }
    }
  });

  socket.on("recover-host-room", (roomCode) => {
    const roomId = sanitizeRoomCode(roomCode || "");
    const room = rooms[roomId];

    if (!room) {
      socket.emit("error-message", "Room could not be recovered.");
      return;
    }

    if (room.hostSocketId !== null) {
      socket.emit("error-message", "Room already has an active host.");
      return;
    }

    room.hostSocketId = socket.id;
    room.hostType = "browser";
    room.appliance = null;
    socket.join(roomId);

    const members = [room.hostSocketId, ...room.listeners];

    socket.emit("room-created", {
      roomId,
      role: "host",
      members
    });

    io.to(roomId).emit("room-updated", { roomId, members });

    console.log(`Host recovered room ${roomId}`);
    emitRoomsList();
  });

  socket.on("appliance:register", (payload = {}) => {
    if (!isAuthorizedApplianceSocket(socket)) {
      socket.emit("admin:error", "Invalid appliance token.");
      socket.disconnect(true);
      return;
    }

    updateApplianceStatus(payload, socket.id);
    socket.emit("appliance:registered", { ok: true });
  });

  socket.on("appliance:status", (payload = {}) => {
    if (!isAuthorizedApplianceSocket(socket)) return;
    updateApplianceStatus(payload, socket.id);
  });

  socket.on("admin:authenticate", ({ pin } = {}, callback) => {
    const adminPin = getAdminPin();

    if (!adminPin) {
      callback?.({
        ok: false,
        setupRequired: true,
        error: "Admin PIN is not configured. Set ADMIN_PIN on the backend."
      });
      return;
    }

    if (String(pin || "") !== String(adminPin)) {
      callback?.({ ok: false, error: "Invalid admin PIN." });
      return;
    }

    adminSockets.add(socket.id);
    socket.emit("admin:appliances", getApplianceCards());
    callback?.({ ok: true });
  });

  socket.on("admin:get-appliances", () => {
    if (!adminSockets.has(socket.id)) return;
    socket.emit("admin:appliances", getApplianceCards());
  });

  socket.on("admin:set-room-code", ({ applianceId, roomCode } = {}) => {
    const nextRoomCode = sanitizeRoomCode(roomCode || "");

    if (!nextRoomCode) {
      socket.emit("admin:error", "Room code is required.");
      return;
    }

    sendApplianceCommand(socket, applianceId, "appliance:set-room-code", {
      roomCode: nextRoomCode
    });
  });

  socket.on("admin:set-settings", ({ applianceId, settings } = {}) => {
    sendApplianceCommand(socket, applianceId, "appliance:set-settings", {
      settings
    });
  });

  socket.on("admin:start-audio", ({ applianceId } = {}) => {
    sendApplianceCommand(socket, applianceId, "appliance:start-audio");
  });

  socket.on("admin:stop-audio", ({ applianceId } = {}) => {
    sendApplianceCommand(socket, applianceId, "appliance:stop-audio");
  });

  socket.on("admin:activate-room", ({ applianceId } = {}) => {
    sendApplianceCommand(socket, applianceId, "appliance:activate-room");
  });

  socket.on("admin:deactivate-room", ({ applianceId } = {}) => {
    sendApplianceCommand(socket, applianceId, "appliance:deactivate-room");
  });

  socket.on("admin:restart", ({ applianceId } = {}) => {
    sendApplianceCommand(socket, applianceId, "appliance:restart");
  });
});

const requireApplianceToken = (req, res) => {
  if (!process.env.PI_HOST_TOKEN) return true;

  const token = req.get("x-pi-host-token");

  if (token === process.env.PI_HOST_TOKEN) return true;

  res.status(401).json({ error: "Invalid appliance token." });
  return false;
};

app.post("/api/appliance/rooms/:roomCode/start", (req, res) => {
  if (!requireApplianceToken(req, res)) return;

  const roomId = sanitizeRoomCode(req.params.roomCode || "");

  if (!roomId) {
    res.status(400).json({ error: "Invalid room code." });
    return;
  }

  const { room, error } = updateApplianceRoom(roomId, req.body || {});

  if (error) {
    res.status(409).json({ error });
    return;
  }

  console.log(`Pi appliance host online: ${roomId}`);

  res.json({
    roomId,
    isBroadcasting: room.isBroadcasting,
    hostType: room.hostType,
    listenerCount: room.listeners.length,
    appliance: room.appliance
  });
});

app.post("/api/appliance/rooms/:roomCode/heartbeat", (req, res) => {
  if (!requireApplianceToken(req, res)) return;

  const roomId = sanitizeRoomCode(req.params.roomCode || "");
  const room = rooms[roomId];

  if (!room || room.hostType !== "appliance") {
    res.status(404).json({ error: "Appliance room not found." });
    return;
  }

  updateApplianceRoom(roomId, req.body || room.appliance || {});

  res.json({ ok: true, roomId });
});

app.post("/api/appliance/rooms/:roomCode/stop", (req, res) => {
  if (!requireApplianceToken(req, res)) return;

  const roomId = sanitizeRoomCode(req.params.roomCode || "");

  markApplianceOffline(roomId, "Pi host stopped.");

  res.json({ ok: true, roomId });
});

app.post(
  "/api/appliance/rooms/:roomCode/audio",
  express.raw({ type: "*/*", limit: "1mb" }),
  (req, res) => {
    if (!requireApplianceToken(req, res)) return;

    const roomId = sanitizeRoomCode(req.params.roomCode || "");
    const room = rooms[roomId];

    if (!room || room.hostType !== "appliance" || !room.hostSocketId) {
      res.status(404).json({ error: "Appliance room is not online." });
      return;
    }

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Audio payload is required." });
      return;
    }

    room.appliance = {
      ...(room.appliance || {}),
      lastSeen: Date.now()
    };

    io.to(roomId).emit("appliance-audio-chunk", {
      roomId,
      sampleRate: room.appliance.sampleRate || 44100,
      channels: room.appliance.channels || 2,
      encoding: room.appliance.encoding || "pcm_s16le",
      chunk: req.body
    });

    res.status(204).end();
  }
);

const getAdminAppliance = (req, res) => {
  if (!requireAdminPin(req, res)) return null;

  const appliance = getManagedAppliance(req.params.applianceId);

  if (!appliance) {
    res.status(404).json({ error: "Appliance not found." });
    return null;
  }

  return appliance;
};

const sendAdminApplianceCommand = (res, appliance, eventName, payload = {}) => {
  const delivered = sendCommandToAppliance(
    appliance.applianceId,
    eventName,
    payload
  );

  if (!delivered) {
    res.status(409).json({
      error: "Appliance is offline. Command was not delivered.",
      appliance: toApplianceDto(appliance)
    });
    return false;
  }

  return true;
};

const getOwnedAppliance = (req, res, user) => {
  const appliance = getManagedAppliance(req.params.applianceId);

  if (!appliance || getOwnerUserId(appliance.applianceId) !== user.userId) {
    res.status(404).json({ error: "Appliance not found." });
    return null;
  }

  appliance.ownerUserId = user.userId;
  return appliance;
};

const sendOwnerApplianceCommand = (res, appliance, eventName, payload = {}) => {
  const delivered = sendCommandToAppliance(
    appliance.applianceId,
    eventName,
    payload
  );

  if (!delivered) {
    res.status(409).json({
      error: "Appliance is offline. Command was not delivered.",
      appliance: toApplianceDto(appliance)
    });
    return false;
  }

  return true;
};

const readApplianceSettingUpdates = (body = {}, currentAppliance, res) => {
  const updates = {};

  if (typeof body.displayName === "string") {
    updates.displayName = body.displayName.trim() || currentAppliance.displayName;
  }

  if (typeof body.roomName === "string") {
    updates.roomName = body.roomName.trim() || currentAppliance.roomName;
  }

  if (typeof body.roomCode === "string") {
    const nextRoomCode = sanitizeRoomCode(body.roomCode);

    if (!nextRoomCode) {
      res.status(400).json({ error: "Room code is required." });
      return null;
    }

    updates.roomCode = nextRoomCode;
  }

  if (typeof body.isPublic === "boolean") {
    updates.isPublic = body.isPublic;
  }

  return updates;
};

app.post("/api/auth/signup", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const displayName = String(req.body?.displayName || "").trim() || email;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: "Password must be at least 6 characters." });
    return;
  }

  if (db.prepare("SELECT user_id FROM users WHERE email = ?").get(email)) {
    res.status(409).json({ error: "An account already exists for that email." });
    return;
  }

  const userId = `user_${crypto.randomBytes(8).toString("hex")}`;
  const timestamp = nowIso();
  const passwordRecord = hashPassword(password);
  const user = {
    userId,
    email,
    displayName,
    password: passwordRecord,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.prepare(
    `
      INSERT INTO users (
        user_id,
        email,
        display_name,
        password_salt,
        password_hash,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    userId,
    email,
    displayName,
    passwordRecord.salt,
    passwordRecord.hash,
    timestamp,
    timestamp
  );

  const token = createSession(userId);
  res.status(201).json({ token, user: toUserDto(user) });
});

app.post("/api/auth/login", (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");
  const user = rowToUser(
    db.prepare("SELECT * FROM users WHERE email = ?").get(email)
  );

  if (!user || !verifyPassword(password, user.password)) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const token = createSession(user.userId);
  res.json({ token, user: toUserDto(user) });
});

app.get("/api/auth/me", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  res.json({ user: toUserDto(user) });
});

app.get("/api/my/appliances", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  res.json({
    appliances: db
      .prepare(
        `
          SELECT appliances.*
          FROM appliances
          JOIN ownerships ON ownerships.appliance_id = appliances.appliance_id
          WHERE ownerships.user_id = ?
          ORDER BY appliances.display_name
        `
      )
      .all(user.userId)
      .map((row) => {
        const appliance = rowToAppliance(row);
        appliances[appliance.applianceId] = {
          ...appliance,
          socketId: appliances[appliance.applianceId]?.socketId || null
        };
        return toApplianceDto(appliances[appliance.applianceId]);
      })
  });
});

app.post("/api/my/appliances/link", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;

  const pairingCode = String(req.body?.pairingCode || "").trim().toUpperCase();

  if (!pairingCode) {
    res.status(400).json({ error: "Pairing code is required." });
    return;
  }

  const pairing = db
    .prepare("SELECT appliance_id FROM pairing_codes WHERE pairing_code = ?")
    .get(pairingCode);
  let appliance = pairing
    ? getManagedAppliance(pairing.appliance_id) ||
      rowToAppliance(
        db.prepare("SELECT * FROM appliances WHERE appliance_id = ?").get(pairing.appliance_id)
      )
    : null;

  if (!appliance) {
    res.status(404).json({ error: "No appliance found for that pairing code." });
    return;
  }

  const existingOwner = getOwnerUserId(appliance.applianceId);

  if (existingOwner && existingOwner !== user.userId) {
    res.status(409).json({ error: "Appliance is already linked to another user." });
    return;
  }

  appliance.ownerUserId = user.userId;
  appliance.updatedAt = nowIso();
  appliances[appliance.applianceId] = {
    ...appliance,
    socketId: appliances[appliance.applianceId]?.socketId || null
  };
  db.prepare(
    `
      INSERT OR IGNORE INTO ownerships (user_id, appliance_id, created_at)
      VALUES (?, ?, ?)
    `
  ).run(user.userId, appliance.applianceId, nowIso());
  emitApplianceList();

  res.json({ appliance: toApplianceDto(appliances[appliance.applianceId]) });
});

app.get("/api/my/appliances/:applianceId", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const appliance = getOwnedAppliance(req, res, user);
  if (!appliance) return;

  res.json({ appliance: toApplianceDto(appliance) });
});

app.patch("/api/my/appliances/:applianceId/settings", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const appliance = getOwnedAppliance(req, res, user);
  if (!appliance) return;

  const updates = readApplianceSettingUpdates(req.body, appliance, res);
  if (!updates) return;

  if (Object.keys(updates).length === 0) {
    res.json({ appliance: toApplianceDto(appliance), delivered: false });
    return;
  }

  if (
    !sendOwnerApplianceCommand(res, appliance, "appliance:set-settings", {
      settings: updates
    })
  ) {
    return;
  }

  Object.assign(appliance, updates, { updatedAt: nowIso() });
  saveApplianceRecord(appliance);
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.post("/api/my/appliances/:applianceId/start-audio", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const appliance = getOwnedAppliance(req, res, user);
  if (!appliance) return;

  if (!sendOwnerApplianceCommand(res, appliance, "appliance:start-audio")) return;

  appliance.isAudioEnabled = true;
  appliance.isRoomActive = true;
  appliance.updatedAt = nowIso();
  saveApplianceRecord(appliance);
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.post("/api/my/appliances/:applianceId/stop-audio", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const appliance = getOwnedAppliance(req, res, user);
  if (!appliance) return;

  if (!sendOwnerApplianceCommand(res, appliance, "appliance:stop-audio")) return;

  appliance.isAudioEnabled = false;
  appliance.updatedAt = nowIso();
  saveApplianceRecord(appliance);
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.post("/api/my/appliances/:applianceId/activate-room", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const appliance = getOwnedAppliance(req, res, user);
  if (!appliance) return;

  if (
    !sendOwnerApplianceCommand(res, appliance, "appliance:activate-room", {
      roomCode: appliance.roomCode,
      roomName: appliance.roomName
    })
  ) {
    return;
  }

  appliance.isRoomActive = true;
  appliance.updatedAt = nowIso();
  saveApplianceRecord(appliance);
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.post("/api/my/appliances/:applianceId/deactivate-room", (req, res) => {
  const user = requireAuthUser(req, res);
  if (!user) return;
  const appliance = getOwnedAppliance(req, res, user);
  if (!appliance) return;

  if (!sendOwnerApplianceCommand(res, appliance, "appliance:deactivate-room")) {
    return;
  }

  appliance.isRoomActive = false;
  appliance.isAudioEnabled = false;
  appliance.updatedAt = nowIso();
  saveApplianceRecord(appliance);
  markApplianceOffline(appliance.roomCode, "Owner deactivated appliance room.");
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.get("/api/appliances", (req, res) => {
  if (!requireAdminPin(req, res)) return;

  res.json({
    appliances: Object.values(appliances).map(toApplianceDto)
  });
});

app.get("/api/appliances/:applianceId", (req, res) => {
  const appliance = getAdminAppliance(req, res);
  if (!appliance) return;

  res.json({ appliance: toApplianceDto(appliance) });
});

app.patch("/api/appliances/:applianceId/settings", (req, res) => {
  const appliance = getAdminAppliance(req, res);
  if (!appliance) return;

  const updates = readApplianceSettingUpdates(req.body, appliance, res);
  if (!updates) return;

  if (Object.keys(updates).length === 0) {
    res.json({ appliance: toApplianceDto(appliance), delivered: false });
    return;
  }

  if (
    !sendAdminApplianceCommand(res, appliance, "appliance:set-settings", {
      settings: updates
    })
  ) {
    return;
  }

  Object.assign(appliance, updates, { updatedAt: nowIso() });
  saveApplianceRecord(appliance);
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.post("/api/appliances/:applianceId/start-audio", (req, res) => {
  const appliance = getAdminAppliance(req, res);
  if (!appliance) return;

  if (!sendAdminApplianceCommand(res, appliance, "appliance:start-audio")) return;

  appliance.isAudioEnabled = true;
  appliance.isRoomActive = true;
  appliance.updatedAt = nowIso();
  saveApplianceRecord(appliance);
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.post("/api/appliances/:applianceId/stop-audio", (req, res) => {
  const appliance = getAdminAppliance(req, res);
  if (!appliance) return;

  if (!sendAdminApplianceCommand(res, appliance, "appliance:stop-audio")) return;

  appliance.isAudioEnabled = false;
  appliance.updatedAt = nowIso();
  saveApplianceRecord(appliance);
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.post("/api/appliances/:applianceId/activate-room", (req, res) => {
  const appliance = getAdminAppliance(req, res);
  if (!appliance) return;

  if (
    !sendAdminApplianceCommand(res, appliance, "appliance:activate-room", {
      roomCode: appliance.roomCode,
      roomName: appliance.roomName
    })
  ) {
    return;
  }

  appliance.isRoomActive = true;
  appliance.updatedAt = nowIso();
  saveApplianceRecord(appliance);
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.post("/api/appliances/:applianceId/deactivate-room", (req, res) => {
  const appliance = getAdminAppliance(req, res);
  if (!appliance) return;

  if (
    !sendAdminApplianceCommand(res, appliance, "appliance:deactivate-room")
  ) {
    return;
  }

  appliance.isRoomActive = false;
  appliance.isAudioEnabled = false;
  appliance.updatedAt = nowIso();
  saveApplianceRecord(appliance);
  markApplianceOffline(appliance.roomCode, "Admin deactivated appliance room.");
  emitApplianceList();
  res.json({ appliance: toApplianceDto(appliance), delivered: true });
});

app.get("/", (req, res) => {
  res.send("Server is running.");
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

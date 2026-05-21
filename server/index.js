const express = require("express");
const http = require("http");
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

const nowIso = () => new Date().toISOString();

const requireUserId = (req, res) => {
  const userId = String(req.get("x-user-id") || "").trim();

  if (!userId) {
    res.status(401).json({ error: "User account is required." });
    return null;
  }

  return userId;
};

const getDefaultPairingCode = (applianceId) =>
  String(applianceId || "").trim().toUpperCase();

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
      : payload.audioStatus
        ? payload.audioStatus === "running"
        : Boolean(existing.isAudioEnabled);
  const isRoomActive =
    typeof payload.isRoomActive === "boolean"
      ? payload.isRoomActive
      : Boolean(existing.isRoomActive || room?.hostSocketId);
  const timestamp = nowIso();

  appliances[applianceId] = {
    applianceId,
    ownerUserId: existing.ownerUserId || payload.ownerUserId || null,
    pairingCode:
      payload.pairingCode || existing.pairingCode || getDefaultPairingCode(applianceId),
    displayName: payload.displayName || payload.name || existing.displayName || applianceId,
    roomCode,
    roomName: payload.roomName || existing.roomName || roomCode,
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

  return appliances[applianceId];
};

const toOwnerApplianceDto = (appliance) => {
  const room = rooms[appliance.roomCode];

  return {
    applianceId: appliance.applianceId,
    ownerUserId: appliance.ownerUserId,
    displayName: appliance.displayName,
    roomCode: appliance.roomCode,
    roomName: appliance.roomName,
    isOnline: Boolean(appliance.isOnline),
    isAudioEnabled: Boolean(appliance.isAudioEnabled),
    isRoomActive: Boolean(appliance.isRoomActive || room?.hostSocketId),
    lastHeartbeat: appliance.lastHeartbeat,
    listenerCount: room?.listeners.length || appliance.listenerCount || 0,
    createdAt: appliance.createdAt,
    updatedAt: appliance.updatedAt
  };
};

const getOwnedAppliance = (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return null;

  const appliance = getManagedAppliance(req.params.id);

  if (!appliance || appliance.ownerUserId !== userId) {
    res.status(404).json({ error: "Appliance not found." });
    return null;
  }

  return appliance;
};

const getPublicRooms = () =>
  Object.entries(rooms)
    .filter(([, room]) => room.hostSocketId)
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
    const adminPin = process.env.ADMIN_PIN || process.env.SPORTSYNC_ADMIN_PIN;

    if (!adminPin) {
      callback?.({ ok: false, error: "Admin PIN is not configured." });
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

  socket.on("admin:start-audio", ({ applianceId } = {}) => {
    sendApplianceCommand(socket, applianceId, "appliance:start-audio");
  });

  socket.on("admin:stop-audio", ({ applianceId } = {}) => {
    sendApplianceCommand(socket, applianceId, "appliance:stop-audio");
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

app.get("/api/appliances/mine", (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  res.json({
    appliances: Object.values(appliances)
      .filter((appliance) => appliance.ownerUserId === userId)
      .map(toOwnerApplianceDto)
  });
});

app.post("/api/appliances/link", (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const pairingCode = String(req.body?.pairingCode || "").trim().toUpperCase();

  if (!pairingCode) {
    res.status(400).json({ error: "Pairing code is required." });
    return;
  }

  const appliance = Object.values(appliances).find(
    (candidate) => String(candidate.pairingCode || "").toUpperCase() === pairingCode
  );

  if (!appliance) {
    res.status(404).json({ error: "No appliance found for that pairing code." });
    return;
  }

  if (appliance.ownerUserId && appliance.ownerUserId !== userId) {
    res.status(409).json({ error: "Appliance is already linked." });
    return;
  }

  appliance.ownerUserId = userId;
  appliance.updatedAt = nowIso();

  res.json({ appliance: toOwnerApplianceDto(appliance) });
});

app.patch("/api/appliances/:id/settings", (req, res) => {
  const appliance = getOwnedAppliance(req, res);
  if (!appliance) return;

  const updates = {};

  if (typeof req.body?.displayName === "string") {
    updates.displayName = req.body.displayName.trim() || appliance.displayName;
  }

  if (typeof req.body?.roomName === "string") {
    updates.roomName = req.body.roomName.trim() || appliance.roomName;
  }

  if (typeof req.body?.roomCode === "string") {
    const nextRoomCode = sanitizeRoomCode(req.body.roomCode);

    if (!nextRoomCode) {
      res.status(400).json({ error: "Room code is required." });
      return;
    }

    updates.roomCode = nextRoomCode;
  }

  Object.assign(appliance, updates, { updatedAt: nowIso() });

  if (updates.roomCode) {
    sendCommandToAppliance(appliance.applianceId, "appliance:set-room-code", {
      roomCode: appliance.roomCode
    });
  }

  if (updates.roomName) {
    sendCommandToAppliance(appliance.applianceId, "appliance:set-room-name", {
      roomName: appliance.roomName
    });
  }

  emitApplianceList();
  res.json({ appliance: toOwnerApplianceDto(appliance) });
});

app.post("/api/appliances/:id/start-room", (req, res) => {
  const appliance = getOwnedAppliance(req, res);
  if (!appliance) return;

  appliance.isRoomActive = true;
  appliance.updatedAt = nowIso();
  const delivered = sendCommandToAppliance(
    appliance.applianceId,
    "appliance:activate-room",
    {
      roomCode: appliance.roomCode,
      roomName: appliance.roomName
    }
  );

  res.json({ appliance: toOwnerApplianceDto(appliance), delivered });
});

app.post("/api/appliances/:id/stop-room", (req, res) => {
  const appliance = getOwnedAppliance(req, res);
  if (!appliance) return;

  appliance.isRoomActive = false;
  appliance.isAudioEnabled = false;
  appliance.updatedAt = nowIso();
  markApplianceOffline(appliance.roomCode, "Owner deactivated appliance room.");
  const delivered = sendCommandToAppliance(
    appliance.applianceId,
    "appliance:deactivate-room"
  );

  res.json({ appliance: toOwnerApplianceDto(appliance), delivered });
});

app.post("/api/appliances/:id/start-audio", (req, res) => {
  const appliance = getOwnedAppliance(req, res);
  if (!appliance) return;

  appliance.isAudioEnabled = true;
  appliance.isRoomActive = true;
  appliance.updatedAt = nowIso();
  const delivered = sendCommandToAppliance(
    appliance.applianceId,
    "appliance:start-audio"
  );

  res.json({ appliance: toOwnerApplianceDto(appliance), delivered });
});

app.post("/api/appliances/:id/stop-audio", (req, res) => {
  const appliance = getOwnedAppliance(req, res);
  if (!appliance) return;

  appliance.isAudioEnabled = false;
  appliance.updatedAt = nowIso();
  const delivered = sendCommandToAppliance(
    appliance.applianceId,
    "appliance:stop-audio"
  );

  res.json({ appliance: toOwnerApplianceDto(appliance), delivered });
});

app.get("/", (req, res) => {
  res.send("Server is running.");
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

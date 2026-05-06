const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

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

const getPublicRooms = () =>
  Object.entries(rooms)
    .filter(([, room]) => room.hostSocketId)
    .map(([roomId, room]) => ({
      roomId,
      isBroadcasting: room.isBroadcasting,
      listenerCount: room.listeners.length
    }));

const emitRoomsList = () => {
  io.emit("rooms-list", getPublicRooms());
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

    rooms[roomId] = {
      hostSocketId: socket.id,
      listeners: [],
      isBroadcasting: false,
      hostDisconnectTimer: null
    };

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
      isBroadcasting: room.isBroadcasting
    });

    io.to(room.hostSocketId).emit("listener-joined", {
      listenerSocketId: socket.id
    });

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

        io.to(room.hostSocketId).emit("listener-joined", {
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
});

app.get("/", (req, res) => {
  res.send("Server is running.");
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

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

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("create-room", () => {
    const roomId = Math.random().toString(36).substring(2, 8);

    rooms[roomId] = {
      hostSocketId: socket.id,
      listeners: [],
      isBroadcasting: false
    };

    socket.join(roomId);

    socket.emit("room-created", {
      roomId,
      role: "host",
      members: [socket.id]
    });

    console.log(`Room created: ${roomId} by ${socket.id}`);
  });

  socket.on("join-room", (roomId) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit("error-message", "Room not found.");
      return;
    }

    if (!room.listeners.includes(socket.id)) {
      room.listeners.push(socket.id);
    }

    socket.join(roomId);

    const members = [room.hostSocketId, ...room.listeners];

    io.to(roomId).emit("room-updated", {
      roomId,
      members
    });

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
  });

  socket.on("leave-room", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.hostSocketId === socket.id) {
        io.to(roomId).emit("room-closed", "Host left. Room closed.");
        socket.leave(roomId);
        delete rooms[roomId];
        console.log(`Room ${roomId} closed by host.`);
        return;
      }

      const index = room.listeners.indexOf(socket.id);
      if (index !== -1) {
        room.listeners.splice(index, 1);
        socket.leave(roomId);

        const members = [room.hostSocketId, ...room.listeners];

        io.to(roomId).emit("room-updated", {
          roomId,
          members
        });

        socket.emit("left-room", "You left the room.");
        console.log(`${socket.id} left room ${roomId}`);
        return;
      }
    }

    socket.emit("error-message", "You are not currently in a room.");
  });

  socket.on("request-stream", () => {
    for (const roomId in rooms) {
      const room = rooms[roomId];
      if (room.listeners.includes(socket.id)) {
        io.to(room.hostSocketId).emit("listener-joined", {
          listenerSocketId: socket.id
        });
        console.log(`${socket.id} requested stream again in room ${roomId}`);
        return;
      }
    }

    socket.emit("error-message", "You must be in a room to request audio.");
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

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);

    for (const roomId in rooms) {
      const room = rooms[roomId];

      if (room.hostSocketId === socket.id) {
        io.to(roomId).emit("room-closed", "Host disconnected. Room closed.");
        delete rooms[roomId];
        console.log(`Room ${roomId} deleted because host left.`);
        break;
      }

      const index = room.listeners.indexOf(socket.id);
      if (index !== -1) {
        room.listeners.splice(index, 1);

        const members = [room.hostSocketId, ...room.listeners];
        io.to(roomId).emit("room-updated", {
          roomId,
          members
        });

        console.log(`${socket.id} removed from room ${roomId}`);
        break;
      }
    }
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
        return;
      }
    }
  });
});

app.get("/", (req, res) => {
  res.send("Server is running.");
});

app.post("/api/analyze-scoreboard", async (req, res) => {
  try {
    const { imageBase64, leagueHint } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required." });
    }

    const prompt = `
You are reading a sports scoreboard image.

Return JSON only with this exact shape:
{
  "league": "NBA | NFL | MLB | NHL | UNKNOWN",
  "team1": null,
  "score1": null,
  "team2": null,
  "score2": null,
  "period": null,
  "clock": null,
  "shot_clock": null,
  "confidence": null
}

Rules:
- Use uppercase team abbreviations when possible.
- Use null if uncertain.
- confidence should be a number from 0 to 1.
- Do not include explanation text.
- League hint: ${leagueHint || "none"}
`;

    const outputText = response.output_text;

    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (parseError) {
      return res.status(500).json({
        error: "Model did not return valid JSON.",
        raw: outputText
      });
    }

    res.json(parsed);
  } catch (error) {
    console.error("AI scoreboard analysis failed:", error);
    res.status(500).json({ error: "AI scoreboard analysis failed." });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
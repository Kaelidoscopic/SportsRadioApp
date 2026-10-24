const crypto = require("node:crypto");

const duration = (value, fallback) => {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 2147483647) {
    throw new Error("Desktop room durations must be positive milliseconds <= 2147483647");
  }
  return number;
};
const digest = (secret) => crypto.createHash("sha256").update(secret).digest();
const hasMembership = (rooms, socketId) => Object.values(rooms).some(
  (room) => room.hostSocketId === socketId || room.listeners.includes(socketId)
);

// Offer authority belongs exclusively to the host; answers exclusively to listeners.
const maySignal = (rooms, sender, target, event) => {
  if (typeof target !== "string" || sender === target) return false;
  return Object.values(rooms).some((room) => {
    if (room.hostType === "appliance" || !room.hostSocketId) return false;
    const outgoing = room.hostSocketId === sender && room.listeners.includes(target);
    const incoming = room.hostSocketId === target && room.listeners.includes(sender);
    return event === "webrtc-offer" ? outgoing
      : event === "webrtc-answer" ? incoming : outgoing || incoming;
  });
};

function createDesktopRooms({ rooms, io, createRoomState, closeRoom, emitRoomsList,
  graceMs, credentialTtlMs, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  graceMs = duration(graceMs, 15000);
  credentialTtlMs = duration(credentialTtlMs, 86400000);
  const fail = (ack, error) => { if (typeof ack === "function") ack({ ok: false, error }); };
  function attach(socket) {
    socket.on("desktop:register", (payload, ack) => {
      if (typeof ack !== "function") return; // Never create a credential the caller cannot receive.
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail(ack, "INVALID_REQUEST");
      if (hasMembership(rooms, socket.id)) return fail(ack, "ALREADY_IN_ROOM");
      let roomId = payload.roomCode;
      if (roomId === undefined || roomId === "") {
        do { roomId = crypto.randomBytes(4).toString("hex").toUpperCase(); } while (Object.hasOwn(rooms, roomId));
      }
      if (typeof roomId !== "string" || !/^[A-Za-z0-9]{1,32}$/.test(roomId)) return fail(ack, "INVALID_ROOM_CODE");
      roomId = roomId.toUpperCase();
      if (Object.hasOwn(rooms, roomId)) return fail(ack, "ROOM_UNAVAILABLE");
      if (payload.roomName !== undefined && (typeof payload.roomName !== "string" || payload.roomName.length > 120)) return fail(ack, "INVALID_ROOM_NAME");
      const credential = crypto.randomBytes(32).toString("hex");
      const room = createRoomState({ hostSocketId: socket.id, hostType: "desktop" });
      room.roomName = payload.roomName?.trim() || roomId;
      room.desktop = { credentialHash: digest(credential), expiresAt: now() + credentialTtlMs };
      rooms[roomId] = room;
      socket.join(roomId);
      ack({ ok: true, roomId, roomName: room.roomName, credential, expiresAt: room.desktop.expiresAt, members: [socket.id], graceMs });
      emitRoomsList();
    });
    socket.on("desktop:recover", (payload, ack) => {
      if (typeof ack !== "function") return;
      if (!payload || typeof payload.roomCode !== "string" || typeof payload.credential !== "string" || !/^[a-f0-9]{64}$/.test(payload.credential)) return fail(ack, "RECOVERY_DENIED");
      const roomId = payload.roomCode.toUpperCase();
      const room = Object.hasOwn(rooms, roomId) ? rooms[roomId] : null;
      if (!room?.desktop || room.hostType !== "desktop" || now() >= room.desktop.expiresAt ||
        !crypto.timingSafeEqual(digest(payload.credential), room.desktop.credentialHash)) return fail(ack, "RECOVERY_DENIED");
      if (hasMembership(rooms, socket.id)) return fail(ack, "ALREADY_IN_ROOM");
      if (room.hostSocketId || now() >= room.desktop.recoverUntil) return fail(ack, "RECOVERY_DENIED");
      cancel(room.hostDisconnectTimer);
      room.hostDisconnectTimer = null;
      room.hostSocketId = socket.id;
      delete room.desktop.recoverUntil;
      socket.join(roomId);
      const members = [socket.id, ...room.listeners];
      ack({ ok: true, roomId, roomName: room.roomName, members, expiresAt: room.desktop.expiresAt, graceMs });
      io.to(roomId).emit("room-updated", { roomId, members });
      emitRoomsList();
    });
    socket.on("disconnect", () => {
      for (const [roomId, room] of Object.entries(rooms)) {
        if (room.hostType !== "desktop" || room.hostSocketId !== socket.id) continue;
        room.hostSocketId = null;
        room.isBroadcasting = false;
        room.desktop.recoverUntil = now() + graceMs;
        io.to(roomId).emit("broadcast-status", { isBroadcasting: false });
        room.hostDisconnectTimer = schedule(() => {
          if (rooms[roomId] === room && !room.hostSocketId) closeRoom(roomId, "Desktop host disconnected. Room closed.");
        }, graceMs);
        emitRoomsList();
      }
    });
  }
  return { attach };
}
module.exports = { createDesktopRooms, maySignal, hasMembership };

const test = require("node:test");
const assert = require("node:assert/strict");
const { createDesktopRooms, maySignal } = require("../desktop-rooms");

function fixture() {
  const rooms = Object.create(null);
  let time = 1000;
  const timers = new Set();
  const service = createDesktopRooms({ rooms, io: { to: () => ({ emit() {} }) },
    createRoomState: (options) => ({ ...options, listeners: [], isBroadcasting: false }),
    closeRoom: (id) => { delete rooms[id]; }, emitRoomsList() {},
    graceMs: 100, credentialTtlMs: 200, now: () => time,
    schedule: (fn) => { timers.add(fn); return fn; }, cancel: (fn) => timers.delete(fn) });
  function socket(id) {
    const handlers = {};
    service.attach({ id, on: (name, fn) => { handlers[name] = fn; }, join() {} });
    return { call: (name, payload) => { let result; handlers[name](payload, (value) => { result = value; }); return result; }, disconnect: () => handlers.disconnect() };
  }
  return { rooms, socket, advance: (n) => { time += n; }, expire: () => { for (const fn of timers) fn(); } };
}

test("desktop registration generates unique credentials and stores hashes only", () => {
  const f = fixture();
  const result = f.socket("host").call("desktop:register", { roomCode: "abc", roomName: "TV" });
  assert.equal(result.ok, true);
  assert.match(result.credential, /^[a-f0-9]{64}$/);
  assert.equal(f.rooms.ABC.desktop.credential, undefined);
  assert.notEqual(f.rooms.ABC.desktop.credentialHash.toString("hex"), result.credential);
  assert.equal(f.socket("other").call("desktop:register", { roomCode: "abc" }).error, "ROOM_UNAVAILABLE");
  assert.notEqual(f.socket("next").call("desktop:register", {}).credential, result.credential);
});

test("only valid credentials recover a disconnected desktop room and cancel cleanup", () => {
  const f = fixture(), host = f.socket("host"), next = f.socket("next");
  const registration = host.call("desktop:register", { roomCode: "ROOM" });
  const payload = { roomCode: "ROOM", credential: registration.credential };
  assert.equal(next.call("desktop:recover", payload).ok, false);
  host.disconnect();
  assert.equal(next.call("desktop:recover", { ...payload, credential: "0".repeat(64) }).ok, false);
  assert.equal(next.call("desktop:recover", payload).ok, true);
  f.expire();
  assert.equal(f.rooms.ROOM.hostSocketId, "next");
  assert.equal(next.call("desktop:register", {}).error, "ALREADY_IN_ROOM");
});

test("listeners cannot recover even with a valid credential", () => {
  const f = fixture(), host = f.socket("host");
  const result = host.call("desktop:register", { roomCode: "ROOM" });
  f.rooms.ROOM.listeners.push("listener");
  host.disconnect();
  assert.equal(f.socket("listener").call("desktop:recover", { roomCode: "ROOM", credential: result.credential }).error, "ALREADY_IN_ROOM");
});

test("expired credentials and overdue grace deadlines cannot recover; cleanup revokes ownership", () => {
  for (const elapsed of [100, 201]) {
    const f = fixture(), host = f.socket("host");
    const result = host.call("desktop:register", { roomCode: "ROOM" });
    if (elapsed === 201) f.advance(150);
    host.disconnect();
    f.advance(elapsed === 201 ? 51 : 100);
    assert.equal(f.socket("next").call("desktop:recover", { roomCode: "ROOM", credential: result.credential }).ok, false);
    f.expire();
    assert.equal(f.rooms.ROOM, undefined);
    assert.equal(f.socket("fresh").call("desktop:register", { roomCode: "ROOM" }).ok, true);
  }
});

test("signaling permission matrix enforces direction and room membership", () => {
  const rooms = { A: { hostSocketId: "h", listeners: ["l", "l2"] }, B: { hostSocketId: "x", listeners: ["y"] } };
  assert.equal(maySignal(rooms, "h", "l", "webrtc-offer"), true);
  assert.equal(maySignal(rooms, "l", "h", "webrtc-answer"), true);
  for (const [from, to, event] of [["l", "h", "webrtc-offer"], ["h", "l", "webrtc-answer"], ["l", "l2", "webrtc-ice-candidate"], ["h", "y", "webrtc-offer"], ["outsider", "h", "webrtc-answer"]]) {
    assert.equal(maySignal(rooms, from, to, event), false);
  }
  rooms.A.hostType = "appliance";
  assert.equal(maySignal(rooms, "h", "l", "webrtc-offer"), false);
});

test("malformed registration/recovery does not create rooms or disclose credentials", () => {
  const f = fixture(), socket = f.socket("host");
  for (const payload of [null, [], "ROOM", { roomCode: 12 }, { roomCode: "bad-code" }, { roomName: {} }]) {
    assert.equal(socket.call("desktop:register", payload).ok, false);
  }
  assert.deepEqual(Object.keys(f.rooms), []);
  for (const payload of [null, {}, { roomCode: "ROOM", credential: "ROOM" }]) {
    assert.equal(socket.call("desktop:recover", payload).error, "RECOVERY_DENIED");
  }
});

test("expired credentials reject recovery even while the grace period remains open", () => {
  const f = fixture(), host = f.socket("host");
  const result = host.call("desktop:register", { roomCode: "ROOM" });
  f.advance(190); host.disconnect(); f.advance(10);
  assert.equal(f.socket("next").call("desktop:recover", { roomCode: "ROOM", credential: result.credential }).error, "RECOVERY_DENIED");
});

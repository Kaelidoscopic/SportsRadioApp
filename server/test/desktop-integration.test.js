const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { io } = require("socket.io-client");

const once = (socket, event) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`Timed out: ${event}`)); }, 4000);
  function handler(value) { clearTimeout(timer); resolve(value); }
  socket.once(event, handler);
});
const ack = (socket, event, payload) => new Promise((resolve, reject) => {
  socket.timeout(4000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response));
});

test("real backend desktop lifecycle, signaling, browser and Pi compatibility", { timeout: 20000 }, async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, "..", "index.js")], {
    env: { ...process.env, PORT: "0", SPORTSYNC_DB_PATH: ":memory:", SPORTSYNC_DESKTOP_GRACE_MS: "1000", SPORTSYNC_DESKTOP_CREDENTIAL_TTL_MS: "10000", PI_HOST_TOKEN: "integration-secret" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const sockets = [];
  t.after(() => { for (const socket of sockets) socket.disconnect(); child.kill(); });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timeout: ${stderr}`)), 5000);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
    child.stdout.on("data", (data) => {
      const match = String(data).match(/Server listening on port (\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });
  const url = `http://127.0.0.1:${port}`;
  async function connect() {
    const socket = io(url, { autoConnect: false, reconnection: false, transports: ["websocket"] });
    sockets.push(socket);
    const ready = once(socket, "connect"); socket.connect(); await ready; return socket;
  }
  const host = await connect(), listener = await connect(), attacker = await connect();
  const registration = await ack(host, "desktop:register", { roomCode: "DESK", roomName: "Desktop TV" });
  assert.equal(registration.ok, true);
  let pending = once(listener, "joined-room"); listener.emit("join-room", "DESK");
  assert.equal((await pending).hostType, "desktop");
  pending = once(attacker, "error-message"); attacker.emit("webrtc-offer", { target: listener.id, offer: { type: "offer", sdp: "test" } });
  assert.equal(await pending, "Unauthorized signaling.");
  pending = once(listener, "error-message"); listener.emit("webrtc-offer", { target: host.id, offer: { type: "offer", sdp: "test" } });
  assert.equal(await pending, "Unauthorized signaling.");
  pending = once(listener, "webrtc-offer"); host.emit("webrtc-offer", { target: listener.id, offer: { type: "offer", sdp: "test" } });
  assert.equal((await pending).sender, host.id);
  pending = once(host, "webrtc-answer"); listener.emit("webrtc-answer", { target: host.id, answer: { type: "answer", sdp: "answer" } });
  assert.equal((await pending).sender, listener.id);
  pending = once(host, "webrtc-ice-candidate"); listener.emit("webrtc-ice-candidate", { target: host.id, candidate: { candidate: "candidate:test" } });
  assert.equal((await pending).sender, listener.id);
  pending = once(listener, "broadcast-status"); listener.emit("broadcast-started"); host.emit("broadcast-started");
  assert.equal((await pending).isBroadcasting, true);
  pending = once(listener, "broadcast-status"); host.disconnect(); await pending;
  pending = once(attacker, "error-message"); attacker.emit("recover-host-room", "DESK"); await pending;
  pending = once(attacker, "error-message"); attacker.emit("create-room", "DESK"); await pending;
  const takeover = await fetch(`${url}/api/appliance/rooms/DESK/start`, { method: "POST", headers: { "content-type": "application/json", "x-pi-host-token": "integration-secret" }, body: "{}" });
  assert.equal(takeover.status, 409);
  assert.equal((await ack(attacker, "desktop:recover", { roomCode: "DESK", credential: "0".repeat(64) })).ok, false);
  const recovered = await connect();
  assert.equal((await ack(recovered, "desktop:recover", { roomCode: "DESK", credential: registration.credential })).ok, true);
  pending = once(listener, "error-message"); listener.emit("end-room"); await pending;
  pending = once(recovered, "error-message"); recovered.emit("webrtc-offer", null); await pending;
  pending = once(listener, "room-closed"); recovered.emit("end-room"); await pending;
  assert.equal((await ack(attacker, "desktop:recover", { roomCode: "DESK", credential: registration.credential })).ok, false);
  const fresh = await ack(attacker, "desktop:register", { roomCode: "DESK" }); assert.equal(fresh.ok, true);
  pending = once(listener, "joined-room"); listener.emit("join-room", "DESK"); await pending;
  pending = once(listener, "room-closed"); attacker.disconnect(); await pending;
  const browser = await connect();
  pending = once(browser, "room-created"); browser.emit("create-room", "BROWSER"); await pending;
  pending = once(listener, "joined-room"); listener.emit("join-room", "BROWSER"); assert.equal((await pending).hostType, "browser");
  pending = once(listener, "webrtc-offer"); browser.emit("webrtc-offer", { target: listener.id, offer: { type: "offer", sdp: "legacy" } }); await pending;
  pending = once(listener, "broadcast-status"); browser.disconnect(); await pending;
  const browserAgain = await connect();
  pending = once(browserAgain, "room-created"); browserAgain.emit("recover-host-room", "BROWSER"); await pending;
  pending = once(listener, "room-closed"); browserAgain.emit("end-room"); await pending;
  const response = await fetch(`${url}/api/appliance/rooms/PI/start`, { method: "POST", headers: { "content-type": "application/json", "x-pi-host-token": "integration-secret" }, body: JSON.stringify({ applianceId: "TEST_PI", roomName: "Pi" }) });
  assert.equal(response.ok, true, await response.text());
  pending = once(listener, "joined-room"); listener.emit("join-room", "PI"); assert.equal((await pending).hostType, "appliance");
  pending = once(listener, "appliance-stream-ready"); listener.emit("request-stream"); await pending;
});

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  AUDIO_EVENT,
  createApplianceAudioHandler,
  createCaptureChunkHandler,
  createLiveAudioSender
} = require("../appliance-audio");

const makeServerFixture = ({ authorized = true, roomOnline = true } = {}) => {
  const forwarded = [];
  const appliance = { applianceId: "BOX_1", roomCode: "5235" };
  const room = {
    hostType: "appliance",
    hostSocketId: roomOnline ? "appliance:5235" : null,
    appliance: {
      applianceId: "BOX_1",
      sampleRate: 44100,
      channels: 2,
      encoding: "pcm_s16le",
      lastSeen: 0
    }
  };
  const socket = {
    id: "socket-1",
    data: { applianceId: "BOX_1" },
    to: (roomId) => ({
      emit: (event, payload) => forwarded.push({ roomId, event, payload })
    })
  };
  const handler = createApplianceAudioHandler({
    rooms: { "5235": room },
    appliances: { BOX_1: appliance },
    applianceSockets: { BOX_1: "socket-1" },
    isAuthorized: () => authorized,
    sanitizeRoomCode: (value) => String(value).trim().toUpperCase(),
    now: () => 1700000000000,
    logger: { warn: () => {} }
  });

  return { appliance, forwarded, handler, room, socket };
};

test("forwards a binary appliance chunk to room listeners without echoing", () => {
  const fixture = makeServerFixture();
  const chunk = Buffer.from([1, 2, 3, 4]);
  const result = fixture.handler(fixture.socket, { roomCode: "5235", chunk });

  assert.equal(result.ok, true);
  assert.equal(fixture.forwarded.length, 1);
  assert.equal(fixture.forwarded[0].roomId, "5235");
  assert.equal(fixture.forwarded[0].event, "appliance-audio-chunk");
  assert.equal(fixture.forwarded[0].payload.chunk, chunk);
  assert.equal(fixture.room.appliance.lastSeen, 1700000000000);
  assert.equal(fixture.appliance.isOnline, true);
});

test("rejects unauthorized appliance audio", () => {
  const fixture = makeServerFixture({ authorized: false });
  const result = fixture.handler(fixture.socket, { chunk: Buffer.from([1]) });

  assert.equal(result.reason, "unauthorized");
  assert.equal(fixture.forwarded.length, 0);
});

test("rejects invalid and oversized binary chunks", () => {
  const fixture = makeServerFixture();
  const invalid = fixture.handler(fixture.socket, { chunk: "not-binary" });
  const oversized = fixture.handler(fixture.socket, {
    chunk: Buffer.alloc(64 * 1024 + 1)
  });

  assert.equal(invalid.reason, "invalid-chunk");
  assert.equal(oversized.reason, "oversized-chunk");
  assert.equal(fixture.forwarded.length, 0);
});

test("rejects audio when the registered appliance room is disconnected", () => {
  const fixture = makeServerFixture({ roomOnline: false });
  const result = fixture.handler(fixture.socket, { chunk: Buffer.from([1]) });

  assert.equal(result.reason, "room-unavailable");
  assert.equal(fixture.forwarded.length, 0);
});

test("drops audio when disconnected or buffered and sends only current chunks", () => {
  const emitted = [];
  const socket = {
    connected: false,
    io: { engine: { writeBuffer: [], transport: { writable: true } } },
    volatile: { emit: (event, payload) => emitted.push({ event, payload }) }
  };
  const sender = createLiveAudioSender({
    getSocket: () => socket,
    getMetadata: () => ({ roomCode: "5235" }),
    maxBufferedBytes: 16,
    logger: { warn: () => {}, error: () => {} },
    now: () => 10000
  });

  assert.equal(sender.send(Buffer.alloc(8)), false);
  socket.connected = true;
  socket.io.engine.writeBuffer = [{ data: Buffer.alloc(12) }];
  assert.equal(sender.send(Buffer.alloc(8)), false);
  socket.io.engine.writeBuffer = [];
  assert.equal(sender.send(Buffer.alloc(8, 7)), true);

  assert.equal(emitted.length, 1);
  assert.equal(emitted[0].event, AUDIO_EVENT);
  assert.equal(emitted[0].payload.chunk[0], 7);
  assert.deepEqual(sender.getStats(), {
    sent: 1,
    dropped: 2,
    lastDropReason: "buffer-limit"
  });
});

test("shutdown during chunk delivery never touches or resumes a stale stream", () => {
  let shuttingDown = false;
  let current = true;
  let pauseCalls = 0;
  let resumeCalls = 0;
  const stream = {
    destroyed: false,
    pause: () => { pauseCalls += 1; },
    resume: () => { resumeCalls += 1; }
  };
  const handler = createCaptureChunkHandler({
    stream,
    isCurrentStream: () => current,
    isShuttingDown: () => shuttingDown,
    isRoomRegistered: () => true,
    sendChunk: () => {
      shuttingDown = true;
      current = false;
      stream.destroyed = true;
      return true;
    },
    scheduleRetry: () => {},
    setAudioUploading: () => {}
  });

  assert.doesNotThrow(() => handler(Buffer.alloc(8)));
  assert.equal(handler(Buffer.alloc(8)), false);
  assert.equal(pauseCalls, 0);
  assert.equal(resumeCalls, 0);
});

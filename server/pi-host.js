const { execFile, spawn } = require("child_process");
require("dotenv").config();
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { io } = require("socket.io-client");

const SERVER_URL = process.env.SPORTSYNC_SERVER_URL || "http://localhost:5000";
const CONFIG_PATH =
  process.env.SPORTSYNC_CONFIG_PATH ||
  "/home/kael/sports-sync-pi/appliance-config.json";
const DEFAULT_CONFIG = {
  applianceId: process.env.SPORTSYNC_APPLIANCE_ID || "HOUSE_BOX_1",
  displayName: process.env.SPORTSYNC_APPLIANCE_NAME || "House Box 1",
  pairingCode: process.env.SPORTSYNC_PAIRING_CODE || "HOUSE-5235",
  roomCode: (process.env.SPORTSYNC_ROOM_CODE || "HOME").toUpperCase(),
  roomName: process.env.SPORTSYNC_ROOM_NAME || "Home Audio",
  audioDevice: process.env.SPORTSYNC_AUDIO_DEVICE || "auto",
  enabled: process.env.SPORTSYNC_AUDIO_ENABLED !== "false",
  roomActive: process.env.SPORTSYNC_ROOM_ACTIVE !== "false",
  isPublic: process.env.SPORTSYNC_ROOM_PUBLIC !== "false"
};
let audioDevice = null;
const SAMPLE_RATE = Number(process.env.SPORTSYNC_SAMPLE_RATE || 44100);
const CHANNELS = Number(process.env.SPORTSYNC_CHANNELS || 2);
const CHUNK_BYTES = Number(process.env.SPORTSYNC_CHUNK_BYTES || 8192);
const PI_HOST_TOKEN = process.env.PI_HOST_TOKEN || "";
const RETRY_DELAY_MS = Number(process.env.SPORTSYNC_RETRY_DELAY_MS || 2000);
const ROOM_404_EXIT_AFTER_MS = Number(
  process.env.SPORTSYNC_ROOM_404_EXIT_AFTER_MS || 10000
);

const sanitizeRoomCode = (code) =>
  String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const readApplianceConfig = () => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };

    return {
      ...DEFAULT_CONFIG,
      ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))
    };
  } catch (error) {
    console.error(`Failed to read appliance config: ${error.message}`);
    return { ...DEFAULT_CONFIG };
  }
};

const writeApplianceConfig = () => {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      `${JSON.stringify(applianceConfigState, null, 2)}\n`
    );
  } catch (error) {
    console.error(`Failed to write appliance config: ${error.message}`);
  }
};

let applianceConfigState = readApplianceConfig();
applianceConfigState.roomCode = sanitizeRoomCode(applianceConfigState.roomCode);
if (!fs.existsSync(CONFIG_PATH)) {
  writeApplianceConfig();
}

let applianceId = applianceConfigState.applianceId;
let displayName = applianceConfigState.displayName || applianceId;
let pairingCode = applianceConfigState.pairingCode || String(applianceId).toUpperCase();
let roomCode = applianceConfigState.roomCode || "HOME";
let roomName = applianceConfigState.roomName || roomCode;
let audioDeviceSetting = applianceConfigState.audioDevice || "auto";
let audioEnabled = applianceConfigState.enabled !== false;
let roomActive = applianceConfigState.roomActive !== false;
let isPublic = applianceConfigState.isPublic !== false;
let commandSocket = null;
const startedAt = Date.now();

const applianceRoomPath = (action) =>
  `/api/appliance/rooms/${roomCode}/${action}`;

const request = (path, body, contentType) =>
  new Promise((resolve, reject) => {
    const url = new URL(path, SERVER_URL);
    const transport = url.protocol === "https:" ? https : http;
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || "");

    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": contentType,
          "content-length": payload.length,
          ...(PI_HOST_TOKEN ? { "x-pi-host-token": PI_HOST_TOKEN } : {})
        }
      },
      (res) => {
        const chunks = [];

        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(Buffer.concat(chunks).toString("utf8"));
            return;
          }

          const error = new Error(
            `${res.statusCode} ${res.statusMessage}: ${Buffer.concat(
              chunks
            ).toString("utf8")}`
          );
          error.statusCode = res.statusCode;
          reject(error);
        });
      }
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });

const postJson = (path, data) =>
  request(path, JSON.stringify(data), "application/json");

const getStatusPayload = () => ({
  applianceId,
  name: displayName,
  displayName,
  pairingCode,
  roomCode,
  roomName,
  online: true,
  isRoomActive: roomActive,
  isAudioEnabled: audioEnabled,
  roomActive,
  audioEnabled,
  isPublic,
  audioStatus: audioEnabled && arecord ? "running" : "stopped",
  uptime: Math.floor((Date.now() - startedAt) / 1000),
  lastHeartbeat: new Date().toISOString(),
  sampleRate: SAMPLE_RATE,
  channels: CHANNELS,
  encoding: "pcm_s16le",
  label: os.hostname() || "Raspberry Pi appliance"
});

let shuttingDown = false;
let arecord = null;
let backendOnline = null;
let roomRegistered = false;
let audioUploading = false;
let registeringRoom = false;
let heartbeatTimer = null;
let retryTimer = null;
let roomMissingSince = null;
let audioDetectionTimer = null;

const setBackendOnline = (online) => {
  if (backendOnline === online) return;

  backendOnline = online;
  console.log(
    online
      ? "Backend reachable. Re-registering appliance room."
      : `Backend down. Dropping audio chunks and retrying every ${Math.round(
          RETRY_DELAY_MS / 1000
        )}s.`
  );
};

const setAudioUploading = (uploading) => {
  if (audioUploading === uploading) return;

  audioUploading = uploading;
  console.log(
    uploading
      ? "Audio upload resumed."
      : "Audio uploads paused until the backend is ready."
  );
};

const emitStatus = () => {
  if (commandSocket?.connected) {
    commandSocket.emit("appliance:status", getStatusPayload());
  }
};

const isRoomMissingError = (error) =>
  error?.statusCode === 404 || /^404\b/.test(error?.message || "");

const clearRoomMissingWatchdog = () => {
  roomMissingSince = null;
};

const noteRoomMissing = () => {
  const now = Date.now();

  if (!roomMissingSince) {
    roomMissingSince = now;
    return;
  }

  if (now - roomMissingSince > ROOM_404_EXIT_AFTER_MS) {
    console.error("Room recovery failed, exiting for supervisor restart.");
    process.exit(1);
  }
};

const markRoomLost = (reason) => {
  noteRoomMissing();

  if (roomRegistered || audioUploading) {
    console.error(`${reason} Room lost, re-registering...`);
  } else {
    console.error(`${reason} Room still missing, retrying registration...`);
  }

  roomRegistered = false;
  setAudioUploading(false);
};

const startRoom = async () => {
  await postJson(applianceRoomPath("start"), getStatusPayload());
  roomRegistered = true;
  clearRoomMissingWatchdog();
  setBackendOnline(true);
  emitStatus();
  console.log(`Room re-registered. ${roomCode} is online at ${SERVER_URL}.`);
};

const ensureRoomRegistered = async () => {
  if (shuttingDown || !roomActive) return false;

  if (registeringRoom) {
    return false;
  }

  registeringRoom = true;

  try {
    await startRoom();
    setAudioUploading(true);
    return true;
  } catch (error) {
    roomRegistered = false;
    setAudioUploading(false);

    if (error.statusCode === 409) {
      setBackendOnline(true);
      console.error("Room registration conflict:", error.message);
    } else {
      setBackendOnline(false);
    }

    return false;
  } finally {
    registeringRoom = false;
  }
};

const scheduleRetry = () => {
  if (retryTimer || shuttingDown) return;

  console.log(`Retrying room registration in ${RETRY_DELAY_MS / 1000}s.`);

  retryTimer = setTimeout(async () => {
    retryTimer = null;

    if (!(await ensureRoomRegistered())) {
      scheduleRetry();
    }
  }, RETRY_DELAY_MS);
};

const handleRecoverableError = async (label, error) => {
  if (isRoomMissingError(error)) {
    markRoomLost(`${label} got 404.`);

    if (!(await ensureRoomRegistered())) {
      scheduleRetry();
    }

    return;
  }

  if (!error.statusCode) {
    clearRoomMissingWatchdog();
    roomRegistered = false;
    setAudioUploading(false);
    setBackendOnline(false);
    scheduleRetry();
    return;
  }

  console.error(`${label} failed:`, error.message);
};

const sendHeartbeat = async () => {
  if (!roomActive) {
    emitStatus();
    return;
  }

  if (!audioEnabled) {
    emitStatus();
    return;
  }

  if (!roomRegistered) {
    scheduleRetry();
    return;
  }

  try {
    await postJson(
      applianceRoomPath("heartbeat"),
      getStatusPayload()
    );
    setBackendOnline(true);
    emitStatus();
  } catch (error) {
    await handleRecoverableError("Heartbeat", error);
  }
};

const sendAudioChunk = async (chunk) => {
  await request(
    applianceRoomPath("audio"),
    chunk,
    "application/octet-stream"
  );
};

const detectUsbAudioDevice = () =>
  new Promise((resolve, reject) => {
    execFile("arecord", ["-l"], (error, stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            stderr?.trim() || error.message || "Failed to run arecord -l."
          )
        );
        return;
      }

      const deviceMatch = stdout
        .split(/\r?\n/)
        .map((line) =>
          line.match(
            /card\s+(\d+):\s+\S+\s+\[USB Audio Device\],\s+device\s+(\d+):/i
          )
        )
        .find(Boolean);

      if (!deviceMatch) {
        resolve(null);
        return;
      }

      resolve(`plughw:${deviceMatch[1]},${deviceMatch[2]}`);
    });
  });

const resolveAudioDevice = async () => {
  if (
    audioDeviceSetting &&
    audioDeviceSetting.trim().toLowerCase() !== "auto"
  ) {
    audioDevice = audioDeviceSetting.trim();
    console.log(`Pi host audio device: ${audioDevice}`);
    return audioDevice;
  }

  const detectedDevice = await detectUsbAudioDevice();

  if (!detectedDevice) {
    console.error("USB audio capture device not found. Retrying in 3s.");
    return null;
  }

  audioDevice = detectedDevice;
  console.log(`Detected USB audio capture device: ${audioDevice}`);
  return audioDevice;
};

const scheduleCaptureStart = () => {
  if (audioDetectionTimer || shuttingDown) return;

  audioDetectionTimer = setTimeout(() => {
    audioDetectionTimer = null;
    startCapture();
  }, 3000);
};

const stopCapture = () => {
  if (audioDetectionTimer) {
    clearTimeout(audioDetectionTimer);
    audioDetectionTimer = null;
  }

  if (arecord) {
    arecord.kill("SIGTERM");
    arecord = null;
  }

  setAudioUploading(false);
  emitStatus();
};

const startCapture = () => {
  if (!audioEnabled || !roomActive) return;

  if (arecord && !arecord.killed) return;

  resolveAudioDevice()
    .then((device) => {
      if (!device || shuttingDown) {
        scheduleCaptureStart();
        return;
      }

      arecord = spawn("arecord", [
        "-D",
        device,
        "-f",
        "S16_LE",
        "-r",
        String(SAMPLE_RATE),
        "-c",
        String(CHANNELS),
        "-t",
        "raw",
        "--buffer-size",
        String(CHUNK_BYTES)
      ]);

      arecord.stdout.on("data", async (chunk) => {
        arecord.stdout.pause();

        try {
          if (!roomRegistered) {
            scheduleRetry();
            return;
          }

          await sendAudioChunk(chunk);
          setBackendOnline(true);
          setAudioUploading(true);
        } catch (error) {
          await handleRecoverableError("Audio upload", error);
        } finally {
          if (!shuttingDown) {
            arecord.stdout.resume();
          }
        }
      });

      arecord.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8").trim();

        if (text) {
          console.error(`arecord: ${text}`);
        }
      });

      arecord.on("exit", (code, signal) => {
        arecord = null;

        if (!shuttingDown) {
          console.error(`arecord exited with code ${code} signal ${signal}.`);
          console.error("Restarting audio capture in 3s.");
          setTimeout(startCapture, 3000);
        }
      });
    })
    .catch((error) => {
      console.error(`Audio device detection failed: ${error.message}`);
      scheduleCaptureStart();
    });
};

const stopRoom = async () => {
  shuttingDown = true;

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  if (retryTimer) {
    clearTimeout(retryTimer);
  }

  stopCapture();

  try {
    await postJson(applianceRoomPath("stop"), {});
  } catch (error) {
    console.error("Stop request failed:", error.message);
  }

  commandSocket?.disconnect();
};

const applyConfig = (updates = {}) => {
  applianceConfigState = {
    ...applianceConfigState,
    ...updates
  };
  applianceConfigState.roomCode = sanitizeRoomCode(applianceConfigState.roomCode);
  applianceConfigState.displayName =
    applianceConfigState.displayName || applianceConfigState.applianceId;
  applianceConfigState.pairingCode =
    applianceConfigState.pairingCode || String(applianceConfigState.applianceId).toUpperCase();
  applianceConfigState.roomName =
    applianceConfigState.roomName || applianceConfigState.roomCode;
  applianceConfigState.audioDevice = applianceConfigState.audioDevice || "auto";
  applianceConfigState.enabled = applianceConfigState.enabled !== false;
  applianceConfigState.roomActive = applianceConfigState.roomActive !== false;
  applianceConfigState.isPublic = applianceConfigState.isPublic !== false;

  applianceId = applianceConfigState.applianceId || applianceId;
  displayName = applianceConfigState.displayName || applianceId;
  pairingCode = applianceConfigState.pairingCode || String(applianceId).toUpperCase();
  roomCode = applianceConfigState.roomCode || roomCode;
  roomName = applianceConfigState.roomName || roomCode;
  audioDeviceSetting = applianceConfigState.audioDevice;
  audioEnabled = applianceConfigState.enabled;
  roomActive = applianceConfigState.roomActive;
  isPublic = applianceConfigState.isPublic;
  writeApplianceConfig();
};

const changeRoomCode = async (nextRoomCode) => {
  const cleanRoomCode = sanitizeRoomCode(nextRoomCode);

  if (!cleanRoomCode || cleanRoomCode === roomCode) return;

  const previousRoomPath = applianceRoomPath("stop");
  applyConfig({ roomCode: cleanRoomCode });
  roomRegistered = false;
  applianceAutoRestart();

  try {
    await postJson(previousRoomPath, {});
  } catch (error) {
    console.error("Previous room stop failed:", error.message);
  }

  await ensureRoomRegistered();
  emitStatus();
};

const changeRoomName = async (nextRoomName) => {
  const cleanRoomName = String(nextRoomName || "").trim();

  if (!cleanRoomName || cleanRoomName === roomName) return;

  applyConfig({ roomName: cleanRoomName });

  if (roomActive) {
    await ensureRoomRegistered();
  }

  emitStatus();
};

const applySettingsCommand = async ({ settings = {} } = {}) => {
  const updates = {};

  if (typeof settings.displayName === "string" && settings.displayName.trim()) {
    updates.displayName = settings.displayName.trim();
  }

  if (typeof settings.roomName === "string" && settings.roomName.trim()) {
    updates.roomName = settings.roomName.trim();
  }

  if (typeof settings.roomCode === "string" && sanitizeRoomCode(settings.roomCode)) {
    updates.roomCode = sanitizeRoomCode(settings.roomCode);
  }

  if (typeof settings.isPublic === "boolean") {
    updates.isPublic = settings.isPublic;
  }

  if (Object.keys(updates).length === 0) {
    emitStatus();
    return;
  }

  const previousRoomPath = updates.roomCode ? applianceRoomPath("stop") : null;
  applyConfig(updates);

  if (previousRoomPath) {
    roomRegistered = false;
    applianceAutoRestart();

    try {
      await postJson(previousRoomPath, {});
    } catch (error) {
      console.error("Previous room stop failed:", error.message);
    }
  }

  if (roomActive) {
    await ensureRoomRegistered();
  }

  emitStatus();
};

const activateRoomCommand = async ({ roomCode: nextRoomCode, roomName: nextRoomName } = {}) => {
  const updates = { roomActive: true };

  if (nextRoomCode) {
    updates.roomCode = sanitizeRoomCode(nextRoomCode);
  }

  if (nextRoomName) {
    updates.roomName = String(nextRoomName).trim();
  }

  applyConfig(updates);
  applianceAutoRestart();

  if (audioEnabled) {
    startCapture();
  }

  await ensureRoomRegistered();
  emitStatus();
};

const deactivateRoomCommand = async () => {
  applyConfig({ roomActive: false, enabled: false });
  stopCapture();
  roomRegistered = false;

  try {
    await postJson(applianceRoomPath("stop"), {});
  } catch (error) {
    console.error("Room deactivate update failed:", error.message);
  }

  emitStatus();
};

const startAudioCommand = async () => {
  applyConfig({ enabled: true, roomActive: true });
  audioEnabled = true;
  roomActive = true;
  startCapture();
  await ensureRoomRegistered();
  emitStatus();
};

const stopAudioCommand = async () => {
  applyConfig({ enabled: false });
  audioEnabled = false;
  stopCapture();

  emitStatus();
};

const applianceAutoRestart = () => {
  clearRoomMissingWatchdog();
  setAudioUploading(false);
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
};

const connectCommandSocket = () => {
  commandSocket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    auth: PI_HOST_TOKEN ? { token: PI_HOST_TOKEN } : undefined,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  commandSocket.on("connect", () => {
    commandSocket.emit("appliance:register", getStatusPayload());
  });

  const handleSetRoomCode = async ({ roomCode: nextRoomCode } = {}) => {
    await changeRoomCode(nextRoomCode);
  };

  const handleSetRoomName = async ({ roomName: nextRoomName } = {}) => {
    await changeRoomName(nextRoomName);
  };

  commandSocket.on("appliance:set-room-code", handleSetRoomCode);
  commandSocket.on("set-room-code", handleSetRoomCode);
  commandSocket.on("appliance:set-room-name", handleSetRoomName);
  commandSocket.on("set-room-name", handleSetRoomName);
  commandSocket.on("appliance:set-settings", applySettingsCommand);
  commandSocket.on("set-settings", applySettingsCommand);

  commandSocket.on("appliance:start-audio", startAudioCommand);
  commandSocket.on("start-audio", startAudioCommand);
  commandSocket.on("appliance:stop-audio", stopAudioCommand);
  commandSocket.on("stop-audio", stopAudioCommand);
  commandSocket.on("appliance:activate-room", activateRoomCommand);
  commandSocket.on("activate-room", activateRoomCommand);
  commandSocket.on("appliance:deactivate-room", deactivateRoomCommand);
  commandSocket.on("deactivate-room", deactivateRoomCommand);
  commandSocket.on("appliance:restart", () => {
    console.log("Restart command received.");
    process.exit(1);
  });
  commandSocket.on("restart", () => {
    console.log("Restart command received.");
    process.exit(1);
  });
};

const main = async () => {
  console.log(`Pi host server URL: ${SERVER_URL}`);
  console.log(`Pi host appliance ID: ${applianceId}`);
  console.log(`Pi host pairing code: ${pairingCode}`);
  console.log(`Pi host room code: ${roomCode}`);
  console.log(`Pi host room name: ${roomName}`);
  console.log(`Pi host audio device setting: ${audioDeviceSetting}`);
  console.log(`Start endpoint: ${applianceRoomPath("start")}`);
  console.log(`Heartbeat endpoint: ${applianceRoomPath("heartbeat")}`);
  console.log(`Audio endpoint: ${applianceRoomPath("audio")}`);

  connectCommandSocket();

  if (roomActive && audioEnabled) {
    startCapture();
  } else if (!roomActive) {
    console.log("Room is inactive by appliance config.");
  } else {
    console.log("Audio capture is disabled by appliance config.");
  }

  if (roomActive && audioEnabled && !(await ensureRoomRegistered())) {
    scheduleRetry();
  }

  heartbeatTimer = setInterval(sendHeartbeat, 3000);
};

process.on("SIGINT", async () => {
  await stopRoom();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await stopRoom();
  process.exit(0);
});

main().catch((error) => {
  console.error(error.message);
  setAudioUploading(false);
  setBackendOnline(false);
  scheduleRetry();
});

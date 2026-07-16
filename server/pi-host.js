const { execFile, spawn } = require("child_process");
require("dotenv").config();
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { io } = require("socket.io-client");
const packageJson = require("./package.json");
const {
  DEFAULT_MAX_AUDIO_CHUNK_BYTES,
  DEFAULT_MAX_BUFFERED_AUDIO_BYTES,
  createCaptureChunkHandler,
  createLiveAudioSender
} = require("./appliance-audio");
const {
  getDefaultConfigPath,
  loadBoxConfig,
  normalizeBoxConfig,
  sanitizeRoomCode,
  writeBoxConfigAtomic
} = require("./appliance-config");

const SERVER_URL = process.env.SPORTSYNC_SERVER_URL || "http://localhost:5000";
const CONFIG_PATH = getDefaultConfigPath();
let audioDevice = null;
const SAMPLE_RATE = Number(process.env.SPORTSYNC_SAMPLE_RATE || 44100);
const CHANNELS = Number(process.env.SPORTSYNC_CHANNELS || 2);
const CHUNK_BYTES = Number(process.env.SPORTSYNC_CHUNK_BYTES || 8192);
const MAX_AUDIO_CHUNK_BYTES = Number(
  process.env.SPORTSYNC_MAX_AUDIO_CHUNK_BYTES || DEFAULT_MAX_AUDIO_CHUNK_BYTES
);
const MAX_BUFFERED_AUDIO_BYTES = Number(
  process.env.SPORTSYNC_MAX_BUFFERED_AUDIO_BYTES ||
    DEFAULT_MAX_BUFFERED_AUDIO_BYTES
);
const PI_HOST_TOKEN = process.env.PI_HOST_TOKEN || "";
const HTTP_TIMEOUT_MS = Number(process.env.SPORTSYNC_HTTP_TIMEOUT_MS || 10000);
const RETRY_BASE_DELAY_MS = Number(
  process.env.SPORTSYNC_RETRY_BASE_DELAY_MS ||
    process.env.SPORTSYNC_RETRY_DELAY_MS ||
    1000
);
const RETRY_MAX_DELAY_MS = Number(
  process.env.SPORTSYNC_RETRY_MAX_DELAY_MS || 30000
);
const ROOM_404_EXIT_AFTER_MS = Number(
  process.env.SPORTSYNC_ROOM_404_EXIT_AFTER_MS || 10000
);
const {
  config: loadedConfig,
  created: configCreated,
  migratedFrom: configMigratedFrom
} = loadBoxConfig({
  configPath: CONFIG_PATH,
  legacyPaths: [
    path.resolve(process.cwd(), "appliance-config.json"),
    path.resolve(process.cwd(), "..", "appliance-config.json")
  ].filter((candidate) => candidate !== CONFIG_PATH)
});
let applianceConfigState = loadedConfig;

let applianceId = applianceConfigState.deviceId;
let displayName = applianceConfigState.deviceName;
let pairingCode = applianceConfigState.pairingCode;
let roomCode = applianceConfigState.roomCode || "HOME";
let roomName = applianceConfigState.roomName || roomCode;
let nowPlaying = applianceConfigState.nowPlaying || "";
let audioDeviceSetting = applianceConfigState.audioDevice || "auto";
let audioEnabled = applianceConfigState.audioEnabled !== false;
let roomActive = applianceConfigState.active !== false;
let isPublic = applianceConfigState.isPublic !== false;
let commandSocket = null;
let socketHasConnected = false;
let socketReconnectAttempt = 0;
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
    req.setTimeout(HTTP_TIMEOUT_MS, () => {
      req.destroy(new Error(`Request timed out after ${HTTP_TIMEOUT_MS}ms.`));
    });
    req.write(payload);
    req.end();
  });

const postJson = (path, data) =>
  request(path, JSON.stringify(data), "application/json");

const getStatusPayload = () => ({
  deviceId: applianceId,
  deviceName: displayName,
  applianceId,
  name: displayName,
  displayName,
  pairingCode,
  roomCode,
  roomName,
  sourceName: roomName,
  nowPlaying,
  online: true,
  isRoomActive: roomActive,
  isAudioEnabled: audioEnabled,
  active: roomActive,
  roomActive,
  audioEnabled,
  isPublic,
  audioStatus: audioEnabled && arecord ? "running" : "stopped",
  uptime: Math.floor((Date.now() - startedAt) / 1000),
  lastHeartbeat: new Date().toISOString(),
  sampleRate: SAMPLE_RATE,
  channels: CHANNELS,
  encoding: "pcm_s16le",
  label: os.hostname() || "Raspberry Pi appliance",
  softwareVersion: packageJson.version,
  hostType: "box",
  boxHostType: "raspberry-pi"
});

let shuttingDown = false;
let arecord = null;
let backendOnline = null;
let roomRegistered = false;
let audioUploading = false;
let registeringRoom = false;
let heartbeatTimer = null;
let retryTimer = null;
let retryAttempt = 0;
let roomMissingSince = null;
let audioDetectionTimer = null;
let captureDataHandler = null;
let captureStream = null;

const audioSender = createLiveAudioSender({
  getSocket: () => commandSocket,
  getMetadata: () => ({
    roomCode,
    sampleRate: SAMPLE_RATE,
    channels: CHANNELS,
    encoding: "pcm_s16le"
  }),
  maxChunkBytes: MAX_AUDIO_CHUNK_BYTES,
  maxBufferedBytes: MAX_BUFFERED_AUDIO_BYTES
});

const setBackendOnline = (online) => {
  if (backendOnline === online) return;

  backendOnline = online;
  console.log(
    online
      ? "Backend reachable. Re-registering appliance room."
      : "Backend unavailable. Audio uploads are paused while recovery continues."
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
  retryAttempt = 0;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  clearRoomMissingWatchdog();
  setBackendOnline(true);
  emitStatus();
  console.log(`Room activated: ${roomCode} is online at ${SERVER_URL}.`);
};

const ensureRoomRegistered = async () => {
  if (shuttingDown || !roomActive) return false;

  if (registeringRoom) {
    return false;
  }

  registeringRoom = true;

  try {
    await startRoom();
    setAudioUploading(Boolean(audioEnabled && arecord));
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

  const exponentialDelay = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * 2 ** retryAttempt
  );
  const delay = Math.min(
    RETRY_MAX_DELAY_MS,
    Math.max(
      RETRY_BASE_DELAY_MS,
      Math.round(exponentialDelay * (0.8 + Math.random() * 0.4))
    )
  );
  retryAttempt += 1;
  console.log(
    `Reconnection scheduled in ${delay}ms (room registration attempt ${retryAttempt}).`
  );

  retryTimer = setTimeout(async () => {
    retryTimer = null;

    if (!(await ensureRoomRegistered())) {
      scheduleRetry();
    }
  }, delay);
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

  const captureProcess = arecord;
  const stdout = captureStream;
  const dataHandler = captureDataHandler;

  arecord = null;
  captureStream = null;
  captureDataHandler = null;

  if (stdout && dataHandler) {
    stdout.removeListener("data", dataHandler);
  }

  if (captureProcess && !captureProcess.killed) {
    captureProcess.kill("SIGTERM");
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

      const captureProcess = spawn("arecord", [
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
      const stdout = captureProcess.stdout;
      arecord = captureProcess;
      captureStream = stdout;
      console.log(`Audio capture started on ${device}.`);

      const dataHandler = createCaptureChunkHandler({
        stream: stdout,
        isCurrentStream: () =>
          arecord === captureProcess && captureStream === stdout,
        isShuttingDown: () => shuttingDown,
        isRoomRegistered: () => roomRegistered,
        sendChunk: (chunk) => {
          const sent = audioSender.send(chunk);
          if (sent) {
            setBackendOnline(true);
          }
          return sent;
        },
        scheduleRetry,
        setAudioUploading
      });
      captureDataHandler = dataHandler;
      stdout.on("data", dataHandler);

      captureProcess.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8").trim();

        if (text) {
          console.error(`arecord: ${text}`);
        }
      });

      captureProcess.on("exit", (code, signal) => {
        stdout.removeListener("data", dataHandler);
        if (arecord === captureProcess) {
          arecord = null;
        }
        if (captureStream === stdout) {
          captureStream = null;
        }
        if (captureDataHandler === dataHandler) {
          captureDataHandler = null;
        }

        if (!shuttingDown && audioEnabled && roomActive) {
          console.error(`arecord exited with code ${code} signal ${signal}.`);
          console.error("Restarting audio capture in 3s.");
          scheduleCaptureStart();
        }
      });
    })
    .catch((error) => {
      console.error(`Audio device detection failed: ${error.message}`);
      scheduleCaptureStart();
    });
};

const stopRoom = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("Application shutting down.");

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  stopCapture();

  try {
    await postJson(applianceRoomPath("stop"), {});
  } catch (error) {
    console.error("Stop request failed:", error.message);
  }

  if (commandSocket) {
    commandSocket.removeAllListeners();
    commandSocket.disconnect();
    commandSocket = null;
  }
};

const applyConfig = (updates = {}) => {
  const canonicalUpdates = {
    ...updates,
    ...(updates.applianceId ? { deviceId: updates.applianceId } : {}),
    ...(updates.displayName ? { deviceName: updates.displayName } : {}),
    ...(typeof updates.roomActive === "boolean"
      ? { active: updates.roomActive }
      : {}),
    ...(typeof updates.enabled === "boolean"
      ? { audioEnabled: updates.enabled }
      : {})
  };
  delete canonicalUpdates.applianceId;
  delete canonicalUpdates.displayName;
  delete canonicalUpdates.roomActive;
  delete canonicalUpdates.enabled;

  applianceConfigState = normalizeBoxConfig({
    ...applianceConfigState,
    ...canonicalUpdates
  });

  applianceId = applianceConfigState.deviceId;
  displayName = applianceConfigState.deviceName;
  pairingCode = applianceConfigState.pairingCode;
  roomCode = applianceConfigState.roomCode || roomCode;
  roomName = applianceConfigState.roomName || roomCode;
  nowPlaying = applianceConfigState.nowPlaying || "";
  audioDeviceSetting = applianceConfigState.audioDevice;
  audioEnabled = applianceConfigState.audioEnabled;
  roomActive = applianceConfigState.active;
  isPublic = applianceConfigState.isPublic;
  writeBoxConfigAtomic(CONFIG_PATH, applianceConfigState);
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

  if (typeof settings.sourceName === "string" && settings.sourceName.trim()) {
    updates.roomName = settings.sourceName.trim();
  }

  if (typeof settings.nowPlaying === "string") {
    updates.nowPlaying = settings.nowPlaying.trim();
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

const activateRoomCommand = async ({
  roomCode: nextRoomCode,
  roomName: nextRoomName,
  sourceName: nextSourceName,
  nowPlaying: nextNowPlaying
} = {}) => {
  const updates = { roomActive: true };

  if (nextRoomCode) {
    updates.roomCode = sanitizeRoomCode(nextRoomCode);
  }

  if (nextSourceName || nextRoomName) {
    updates.roomName = String(nextSourceName || nextRoomName).trim();
  }

  if (typeof nextNowPlaying === "string") {
    updates.nowPlaying = nextNowPlaying.trim();
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
  if (commandSocket) return commandSocket;

  commandSocket = io(SERVER_URL, {
    transports: ["websocket", "polling"],
    auth: PI_HOST_TOKEN ? { token: PI_HOST_TOKEN } : undefined,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: RETRY_BASE_DELAY_MS,
    reconnectionDelayMax: RETRY_MAX_DELAY_MS,
    randomizationFactor: 0.2,
    timeout: HTTP_TIMEOUT_MS
  });

  commandSocket.on("connect", async () => {
    const reconnected = socketHasConnected;
    socketHasConnected = true;
    socketReconnectAttempt = 0;
    console.log(
      reconnected
        ? "Backend command socket reconnected successfully."
        : "Backend command socket connected."
    );
    commandSocket.emit("appliance:register", getStatusPayload());

    if (reconnected && roomActive && !(await ensureRoomRegistered())) {
      scheduleRetry();
    }
  });

  commandSocket.on("appliance:registered", () => {
    console.log("Box registered with backend.");
  });

  commandSocket.on("disconnect", (reason) => {
    if (shuttingDown) return;
    console.log(`Backend command socket disconnected (${reason}).`);
    roomRegistered = false;
    setAudioUploading(false);
    scheduleRetry();
  });

  commandSocket.io.on("reconnect_attempt", (attempt) => {
    socketReconnectAttempt = attempt;
    if (attempt === 1 || attempt % 5 === 0) {
      console.log(`Backend connection attempt ${attempt}.`);
    }
  });

  commandSocket.on("connect_error", (error) => {
    if (socketReconnectAttempt <= 1 || socketReconnectAttempt % 5 === 0) {
      console.error(`Backend command connection failed: ${error.message}`);
    }
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

  return commandSocket;
};

const main = async () => {
  console.log(`Box application started (version ${packageJson.version}).`);
  console.log(
    `Configuration ${configCreated ? "created" : "loaded"}: ${CONFIG_PATH}`
  );
  if (configMigratedFrom) {
    console.log(`Legacy configuration migrated from ${configMigratedFrom}.`);
  }
  console.log(`Device identity: ${applianceId}`);
  console.log(`Pi host server URL: ${SERVER_URL}`);
  console.log(`Pi host appliance ID: ${applianceId}`);
  console.log(`Pi host pairing code: ${pairingCode}`);
  console.log(`Pi host room code: ${roomCode}`);
  console.log(`Pi host room name: ${roomName}`);
  console.log(`Pi host audio device setting: ${audioDeviceSetting}`);
  console.log(`Start endpoint: ${applianceRoomPath("start")}`);
  console.log(`Heartbeat endpoint: ${applianceRoomPath("heartbeat")}`);
  console.log(`Audio endpoint: ${applianceRoomPath("audio")}`);
  console.log(
    `Live audio transport: Socket.IO volatile binary events (buffer limit ${MAX_BUFFERED_AUDIO_BYTES} bytes).`
  );

  connectCommandSocket();

  if (roomActive && audioEnabled) {
    startCapture();
  } else if (!roomActive) {
    console.log("Room is inactive by appliance config.");
  } else {
    console.log("Audio capture is disabled by appliance config.");
  }

  if (roomActive && !(await ensureRoomRegistered())) {
    scheduleRetry();
  }

  heartbeatTimer = setInterval(sendHeartbeat, 3000);
};

const handleShutdownSignal = async () => {
  await stopRoom();
  process.exit(0);
};

process.once("SIGINT", handleShutdownSignal);
process.once("SIGTERM", handleShutdownSignal);

main().catch((error) => {
  console.error(error.message);
  setAudioUploading(false);
  setBackendOnline(false);
  scheduleRetry();
});

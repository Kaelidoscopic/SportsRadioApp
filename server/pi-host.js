const { execFile, spawn } = require("child_process");
require("dotenv").config();
const http = require("http");
const https = require("https");

const SERVER_URL = process.env.SPORTSYNC_SERVER_URL || "http://localhost:5000";
const ROOM_CODE = (process.env.SPORTSYNC_ROOM_CODE || "SPORTS").toUpperCase();
const AUDIO_DEVICE_SETTING = process.env.SPORTSYNC_AUDIO_DEVICE || "auto";
let audioDevice = null;
const SAMPLE_RATE = Number(process.env.SPORTSYNC_SAMPLE_RATE || 44100);
const CHANNELS = Number(process.env.SPORTSYNC_CHANNELS || 2);
const CHUNK_BYTES = Number(process.env.SPORTSYNC_CHUNK_BYTES || 8192);
const PI_HOST_TOKEN = process.env.PI_HOST_TOKEN || "";
const RETRY_DELAY_MS = Number(process.env.SPORTSYNC_RETRY_DELAY_MS || 2000);
const ROOM_404_EXIT_AFTER_MS = Number(
  process.env.SPORTSYNC_ROOM_404_EXIT_AFTER_MS || 10000
);

const applianceRoomPath = (action) =>
  `/api/appliance/rooms/${ROOM_CODE}/${action}`;

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

const applianceConfig = {
  sampleRate: SAMPLE_RATE,
  channels: CHANNELS,
  encoding: "pcm_s16le",
  label: "Raspberry Pi Zero 2 W"
};

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
  await postJson(applianceRoomPath("start"), applianceConfig);
  roomRegistered = true;
  clearRoomMissingWatchdog();
  setBackendOnline(true);
  console.log(`Room re-registered. ${ROOM_CODE} is online at ${SERVER_URL}.`);
};

const ensureRoomRegistered = async () => {
  if (shuttingDown) return false;

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
  if (!roomRegistered) {
    scheduleRetry();
    return;
  }

  try {
    await postJson(
      applianceRoomPath("heartbeat"),
      applianceConfig
    );
    setBackendOnline(true);
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
    AUDIO_DEVICE_SETTING &&
    AUDIO_DEVICE_SETTING.trim().toLowerCase() !== "auto"
  ) {
    audioDevice = AUDIO_DEVICE_SETTING.trim();
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

const startCapture = () => {
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

  if (audioDetectionTimer) {
    clearTimeout(audioDetectionTimer);
  }

  if (arecord) {
    arecord.kill("SIGTERM");
  }

  try {
    await postJson(applianceRoomPath("stop"), {});
  } catch (error) {
    console.error("Stop request failed:", error.message);
  }
};

const main = async () => {
  console.log(`Pi host server URL: ${SERVER_URL}`);
  console.log(`Pi host room code: ${ROOM_CODE}`);
  console.log(`Pi host audio device setting: ${AUDIO_DEVICE_SETTING}`);
  console.log(`Start endpoint: ${applianceRoomPath("start")}`);
  console.log(`Heartbeat endpoint: ${applianceRoomPath("heartbeat")}`);
  console.log(`Audio endpoint: ${applianceRoomPath("audio")}`);

  startCapture();
  if (!(await ensureRoomRegistered())) {
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

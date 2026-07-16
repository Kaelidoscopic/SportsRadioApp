const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_CONFIG_DIRECTORY = path.join(".config", "venue-audio");
const DEFAULT_CONFIG_FILENAME = "box-config.json";

const parseBoolean = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
};

const sanitizeRoomCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const requireString = (value, field, { max = 128, pattern } = {}) => {
  const clean = String(value || "").trim();

  if (!clean || clean.length > max || (pattern && !pattern.test(clean))) {
    throw new Error(`Invalid ${field} in appliance configuration.`);
  }

  return clean;
};

const optionalString = (value, field, max = 128) => {
  const clean = String(value || "").trim();

  if (clean.length > max) {
    throw new Error(`Invalid ${field} in appliance configuration.`);
  }

  return clean;
};

const getDefaultConfigPath = (env = process.env) =>
  env.SPORTSYNC_CONFIG_PATH ||
  path.join(
    env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    env.XDG_CONFIG_HOME ? "venue-audio" : path.join("venue-audio"),
    DEFAULT_CONFIG_FILENAME
  );

const createPairingCode = (deviceId) =>
  `BOX-${deviceId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase()}`;

const normalizeBoxConfig = (input = {}, env = process.env, idFactory = crypto.randomUUID) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Appliance configuration must be a JSON object.");
  }

  const deviceId = requireString(
    input.deviceId ||
      input.applianceId ||
      env.SPORTSYNC_DEVICE_ID ||
      env.SPORTSYNC_APPLIANCE_ID ||
      idFactory(),
    "deviceId",
    { max: 128, pattern: /^[A-Za-z0-9._:-]+$/ }
  );
  const roomCode = sanitizeRoomCode(
    input.roomCode || env.SPORTSYNC_ROOM_CODE || "HOME"
  );

  if (!roomCode || roomCode.length > 16) {
    throw new Error("Invalid roomCode in appliance configuration.");
  }

  return {
    deviceId,
    deviceName: requireString(
      input.deviceName ||
        input.displayName ||
        env.SPORTSYNC_DEVICE_NAME ||
        env.SPORTSYNC_APPLIANCE_NAME ||
        "Venue Audio Box",
      "deviceName",
      { max: 80 }
    ),
    pairingCode: requireString(
      input.pairingCode || env.SPORTSYNC_PAIRING_CODE || createPairingCode(deviceId),
      "pairingCode",
      { max: 64, pattern: /^[A-Za-z0-9_-]+$/ }
    ).toUpperCase(),
    roomName: requireString(
      input.roomName || env.SPORTSYNC_ROOM_NAME || roomCode,
      "roomName",
      { max: 80 }
    ),
    roomCode,
    active: parseBoolean(
      input.active ?? input.roomActive,
      parseBoolean(env.SPORTSYNC_ROOM_ACTIVE, true)
    ),
    audioEnabled: parseBoolean(
      input.audioEnabled ?? input.enabled,
      parseBoolean(env.SPORTSYNC_AUDIO_ENABLED, true)
    ),
    audioDevice: requireString(
      input.audioDevice || env.SPORTSYNC_AUDIO_DEVICE || "auto",
      "audioDevice",
      { max: 128 }
    ),
    isPublic: parseBoolean(
      input.isPublic,
      parseBoolean(env.SPORTSYNC_ROOM_PUBLIC, true)
    ),
    nowPlaying: optionalString(
      input.nowPlaying ?? env.SPORTSYNC_NOW_PLAYING ?? "",
      "nowPlaying",
      160
    )
  };
};

const writeBoxConfigAtomic = (configPath, config, fsModule = fs) => {
  const directory = path.dirname(configPath);
  const temporaryPath = `${configPath}.tmp-${process.pid}`;
  fsModule.mkdirSync(directory, { recursive: true, mode: 0o700 });

  try {
    fsModule.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    fsModule.renameSync(temporaryPath, configPath);
  } catch (error) {
    try {
      fsModule.rmSync(temporaryPath, { force: true });
    } catch {}
    throw error;
  }
};

const loadBoxConfig = ({
  configPath = getDefaultConfigPath(),
  legacyPaths = [],
  env = process.env,
  fsModule = fs,
  idFactory = crypto.randomUUID
} = {}) => {
  const exists = fsModule.existsSync(configPath);
  const migratedFrom = exists
    ? null
    : legacyPaths.find((candidate) => fsModule.existsSync(candidate)) || null;
  const readPath = exists ? configPath : migratedFrom;
  let parsed = {};

  if (readPath) {
    try {
      parsed = JSON.parse(fsModule.readFileSync(readPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Cannot read appliance configuration at ${readPath}: ${error.message}`
      );
    }
  }

  const config = normalizeBoxConfig(parsed, env, idFactory);

  if (!exists) {
    writeBoxConfigAtomic(configPath, config, fsModule);
  }

  return { config, configPath, created: !exists && !migratedFrom, migratedFrom };
};

module.exports = {
  DEFAULT_CONFIG_DIRECTORY,
  DEFAULT_CONFIG_FILENAME,
  getDefaultConfigPath,
  loadBoxConfig,
  normalizeBoxConfig,
  sanitizeRoomCode,
  writeBoxConfigAtomic
};

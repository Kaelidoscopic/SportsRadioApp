const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  loadBoxConfig,
  normalizeBoxConfig,
  writeBoxConfigAtomic
} = require("../appliance-config");

const makeTempConfigPath = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "venue-audio-config-"));
  return { directory, configPath: path.join(directory, "box-config.json") };
};

test("generates and persists a permanent device id once", () => {
  const { directory, configPath } = makeTempConfigPath();

  try {
    const first = loadBoxConfig({
      configPath,
      env: {},
      idFactory: () => "device-generated-once"
    });
    const second = loadBoxConfig({
      configPath,
      env: {},
      idFactory: () => "unexpected-second-id"
    });

    assert.equal(first.created, true);
    assert.equal(first.config.deviceId, "device-generated-once");
    assert.equal(second.created, false);
    assert.equal(second.config.deviceId, "device-generated-once");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("migrates legacy appliance fields without using the room code as identity", () => {
  const config = normalizeBoxConfig(
    {
      applianceId: "LEGACY_BOX_1",
      displayName: "Legacy Box",
      roomCode: "main-tv",
      roomActive: false,
      enabled: false
    },
    {},
    () => "unused-id"
  );

  assert.equal(config.deviceId, "LEGACY_BOX_1");
  assert.equal(config.deviceName, "Legacy Box");
  assert.equal(config.roomCode, "MAINTV");
  assert.equal(config.active, false);
  assert.equal(config.audioEnabled, false);
});

test("copies a legacy config into the new location without changing identity", () => {
  const { directory, configPath } = makeTempConfigPath();
  const legacyPath = path.join(directory, "appliance-config.json");
  const nextPath = path.join(directory, "config", "box-config.json");

  try {
    fs.writeFileSync(
      legacyPath,
      JSON.stringify({ applianceId: "LEGACY_DEVICE", roomCode: "OLD" })
    );
    const result = loadBoxConfig({
      configPath: nextPath,
      legacyPaths: [legacyPath],
      env: {},
      idFactory: () => "unexpected-id"
    });

    assert.equal(result.created, false);
    assert.equal(result.migratedFrom, legacyPath);
    assert.equal(result.config.deviceId, "LEGACY_DEVICE");
    assert.equal(JSON.parse(fs.readFileSync(nextPath, "utf8")).deviceId, "LEGACY_DEVICE");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects invalid persisted identity instead of silently replacing it", () => {
  assert.throws(
    () => normalizeBoxConfig({ deviceId: "invalid id", roomCode: "MAIN" }, {}),
    /Invalid deviceId/
  );
});

test("atomic writes do not leave a temporary file", () => {
  const { directory, configPath } = makeTempConfigPath();

  try {
    const config = normalizeBoxConfig(
      { deviceId: "DEVICE_1", roomCode: "MAIN" },
      {}
    );
    writeBoxConfigAtomic(configPath, config);

    assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), config);
    assert.deepEqual(
      fs.readdirSync(directory).filter((name) => name.includes(".tmp-")),
      []
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const crypto = require("node:crypto");
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
class PairingError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
function createLimiter(db, now = Date.now) {
  db.exec(`CREATE TABLE IF NOT EXISTS api_rate_limits (bucket TEXT NOT NULL, slot INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(bucket,slot));`);
  return (key, limit, window = 60000) => {
    const slot = Math.floor(now() / window) * window;
    db.prepare("DELETE FROM api_rate_limits WHERE slot < ?").run(now() - 86400000);
    const row = db.prepare(`INSERT INTO api_rate_limits VALUES (?, ?, 1) ON CONFLICT(bucket,slot) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).get(digest(key), slot);
    if (row.attempts > limit) throw new PairingError("RATE_LIMITED", 429);
  };
}
function createDeviceRegistry(db, { now = Date.now } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS tv_devices (
    device_id TEXT PRIMARY KEY, credential_hash TEXT NOT NULL, name TEXT NOT NULL,
    owner_user_id TEXT REFERENCES users(user_id), created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tv_pairings (
    code_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL UNIQUE REFERENCES tv_devices(device_id),
    expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);`);
  const limit = createLimiter(db, now);
  const fail = (code, status) => { throw new PairingError(code, status); };
  function authenticate(id, credential) {
    if (typeof credential !== "string" || !/^[a-f0-9]{64}$/.test(credential) || typeof id !== "string") fail("INVALID_DEVICE_CREDENTIAL", 401);
    const row = db.prepare("SELECT * FROM tv_devices WHERE device_id=?").get(id);
    if (!row || !crypto.timingSafeEqual(Buffer.from(row.credential_hash, "hex"), Buffer.from(digest(credential), "hex"))) fail("INVALID_DEVICE_CREDENTIAL", 401);
    return row;
  }
  function status(id, credential) {
    const device = authenticate(id, credential);
    db.prepare("UPDATE tv_devices SET last_seen=? WHERE device_id=?").run(now(), id);
    const pairing = db.prepare("SELECT expires_at,used FROM tv_pairings WHERE device_id=?").get(id);
    return { deviceId: id, name: device.name, status: device.owner_user_id ? "Paired" : !pairing ? "Unpaired" : pairing.expires_at <= now() || pairing.used ? "Expired" : "Waiting for Pairing", expiresAt: pairing?.expires_at ?? null };
  }
  return {
    limit, authenticate, status,
    register(id, credential, name) {
      if (typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) || typeof credential !== "string" || !/^[a-f0-9]{64}$/.test(credential)) fail("INVALID_REGISTRATION", 400);
      const existing = db.prepare("SELECT device_id FROM tv_devices WHERE device_id=?").get(id);
      if (existing) return status(id, credential); // ID alone never overwrites credentials/ownership.
      db.prepare("INSERT INTO tv_devices VALUES (?, ?, ?, NULL, ?, ?)").run(id, digest(credential), typeof name === "string" ? name.trim().slice(0,80) || "Android TV" : "Android TV", now(), now());
      return status(id, credential);
    },
    start(id, credential) {
      const device = authenticate(id, credential); limit(`pair:${id}`, 3, 900000);
      if (device.owner_user_id) fail("ALREADY_PAIRED", 409);
      const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      let code;
      do { code = Array.from({length:10}, () => alphabet[crypto.randomInt(32)]).join(""); } while (db.prepare("SELECT code_hash FROM tv_pairings WHERE code_hash=?").get(digest(code)));
      const expiresAt = now() + 300000;
      db.prepare("DELETE FROM tv_pairings WHERE device_id=?").run(id);
      db.prepare("INSERT INTO tv_pairings VALUES (?, ?, ?, 0)").run(digest(code), id, expiresAt);
      return { ...status(id, credential), code: code.slice(0,5) + "-" + code.slice(5), expiresAt };
    },
    claim(userId, code) {
      limit(`claim-user:${userId}`, 10, 900000);
      if (typeof code !== "string" || !/^[0-9A-HJKMNP-TV-Z]{10}$/.test(code.toUpperCase().replace(/-/g,""))) fail("INVALID_CODE", 400);
      const hashed = digest(code.toUpperCase().replace(/-/g,""));
      db.exec("BEGIN IMMEDIATE");
      try {
        if (!db.prepare("SELECT user_id FROM users WHERE user_id=?").get(userId)) fail("LOGIN_REQUIRED", 401);
        const row = db.prepare("SELECT * FROM tv_pairings WHERE code_hash=?").get(hashed);
        if (!row || row.used) fail("INVALID_CODE", 400);
        if (row.expires_at <= now()) fail("EXPIRED_CODE", 410);
        const updated = db.prepare("UPDATE tv_devices SET owner_user_id=? WHERE device_id=? AND owner_user_id IS NULL").run(userId, row.device_id);
        if (updated.changes !== 1) fail("ALREADY_PAIRED", 409);
        db.prepare("UPDATE tv_pairings SET used=1 WHERE code_hash=?").run(hashed);
        db.exec("COMMIT");
        return { deviceId: row.device_id, status: "Paired" };
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    },
    rotate(id, credential, next) {
      authenticate(id, credential); limit(`rotate:${id}`, 5, 3600000);
      if (typeof next !== "string" || !/^[a-f0-9]{64}$/.test(next) || next === credential) fail("INVALID_CREDENTIAL", 400);
      db.prepare("UPDATE tv_devices SET credential_hash=? WHERE device_id=? AND credential_hash=?").run(digest(next), id, digest(credential));
      db.prepare("DELETE FROM tv_pairings WHERE device_id=?").run(id);
      return status(id, next);
    },
    list(userId) {
      return db.prepare("SELECT device_id AS deviceId,name,last_seen AS lastSeen FROM tv_devices WHERE owner_user_id=? ORDER BY created_at DESC").all(userId).map(row => ({ ...row, online: now() - row.lastSeen < 45000 }));
    }
  };
}
function installDeviceRoutes(app, registry, { enabled, getUser }) {
  app.use("/api/devices", (req,res,next) => {
    res.set("Cache-Control", "no-store");
    if (!enabled) return res.status(503).json({ error: "PAIRING_NOT_CONFIGURED" });
    next();
  });
  const route = fn => (req,res) => {
    try { fn(req,res); } catch (error) { res.status(error instanceof PairingError ? error.status : 500).json({error: error instanceof PairingError ? error.code : "DEVICE_OPERATION_FAILED"}); }
  };
  const credential = req => String(req.get("authorization") || "").replace(/^Bearer /i, "");
  const user = req => { const value = getUser(req); if (!value) throw new PairingError("LOGIN_REQUIRED",401); return value; };
  const device = req => { registry.limit(`device-ip:${req.ip}`, 120); registry.authenticate(req.params.id, credential(req)); };
  app.post("/api/devices/register", route((req,res) => { registry.limit(`register-ip:${req.ip}`,30,900000); res.json(registry.register(req.body?.deviceId, credential(req), req.body?.name)); }));
  app.post("/api/devices/claim", route((req,res) => { const account=user(req); registry.limit(`claim-ip:${req.ip}`,30,900000); res.json(registry.claim(account.userId, req.body?.code)); }));
  app.get("/api/devices", route((req,res) => { res.json({devices:registry.list(user(req).userId)}); }));
  app.post("/api/devices/:id/status", route((req,res) => { device(req); res.json(registry.status(req.params.id, credential(req))); }));
  app.post("/api/devices/:id/pairing", route((req,res) => { device(req); res.json(registry.start(req.params.id, credential(req))); }));
  app.post("/api/devices/:id/rotate", route((req,res) => { device(req); res.json(registry.rotate(req.params.id, credential(req), req.body?.credential)); }));
}
module.exports = {createDeviceRegistry,createLimiter,installDeviceRoutes,digest,PairingError};

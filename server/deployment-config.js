const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const productionHosts = new Set(["sportsradioapp.onrender.com","sports-radio-app.vercel.app"]);
function stagingOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || productionHosts.has(url.hostname.replace(/\.$/, ""))) throw new Error("Invalid staging origin");
  return url.origin;
}
function deploymentConfig(env) {
  const environment = env.SPORTSYNC_ENVIRONMENT || "production";
  if (!["production","staging"].includes(environment)) throw new Error("Unknown deployment environment");
  if (environment === "production") return {environment, database:env.SPORTSYNC_DB_PATH, sessionHash: value=>crypto.createHash("sha256").update(value).digest("hex")};
  const id=env.SPORTSYNC_DEPLOYMENT_ID;
  if (!/^[a-z0-9-]{8,64}$/.test(id || "")) throw new Error("Staging deployment ID required");
  if (!/^[a-f0-9]{64}$/.test(env.SPORTSYNC_SESSION_SECRET || "")) throw new Error("Fresh staging session secret required (64+ characters)");
  const database=env.SPORTSYNC_DB_PATH,root=env.SPORTSYNC_DURABLE_STORAGE_ROOT;
  if (!database || !root || !path.isAbsolute(database) || !path.isAbsolute(root) || env.SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK !== "true") throw new Error("Acknowledged absolute staging storage paths required");
  const relative=path.relative(path.resolve(root),path.resolve(database));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Database must be within staging storage root");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("Storage root must already exist; verify mounted disk manually");
  // Resolve existing ancestors to reject symlink escapes, before any DB writes.
  let ancestor=path.dirname(database);while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
  const realRelative=path.relative(fs.realpathSync(root),fs.realpathSync(ancestor));
  if(realRelative.startsWith("..") || path.isAbsolute(realRelative) || (fs.existsSync(database) && fs.lstatSync(database).isSymbolicLink())) throw new Error("Storage path escapes staging root");
  const frontendOrigin=stagingOrigin(env.SPORTSYNC_STAGING_FRONTEND_URL);
  return {environment,id,database,frontendOrigin,sessionHash:value=>crypto.createHmac("sha256",env.SPORTSYNC_SESSION_SECRET).update(`staging:${id}:${value}`).digest("hex")};
}
/** Read-only check BEFORE opening writable SQLite or running account migrations. */
function assertDatabaseEnvironment(file, config) {
  if(file === ":memory:" || !fs.existsSync(file) || fs.statSync(file).size===0) return;
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='deployment_identity'").get();
    const marker=exists ? db.prepare("SELECT environment,deployment_id FROM deployment_identity WHERE singleton=1").get() : null;
    if(config.environment==="staging" && (!marker || marker.environment!=="staging" || marker.deployment_id!==config.id)) throw new Error("Refusing unmarked or foreign database before migrations");
    if(config.environment==="production" && marker?.environment==="staging") throw new Error("Production cannot open staging database");
  } finally { db.close(); }
}
function stampDatabase(db,config) {
  if(config.environment!=="staging")return;
  db.exec("CREATE TABLE IF NOT EXISTS deployment_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1),environment TEXT NOT NULL,deployment_id TEXT NOT NULL)");
  db.prepare("INSERT OR IGNORE INTO deployment_identity VALUES (1,?,?)").run(config.environment,config.id);
}
module.exports={deploymentConfig,assertDatabaseEnvironment,stampDatabase,stagingOrigin};

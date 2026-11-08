const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {spawnSync}=require("node:child_process");
const {DatabaseSync}=require("node:sqlite");
const {deploymentConfig,assertDatabaseEnvironment,stampDatabase}=require("../deployment-config");
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),"sportsradio-stage-"));t.after(()=>{for(const file of fs.readdirSync(root))fs.unlinkSync(path.join(root,file));fs.rmdirSync(root);});return {SPORTSYNC_ENVIRONMENT:"staging",SPORTSYNC_DEPLOYMENT_ID:"pairing-stage-test",SPORTSYNC_SESSION_SECRET:crypto.randomBytes(32).toString("hex"),SPORTSYNC_DB_PATH:path.join(root,"stage.sqlite"),SPORTSYNC_DURABLE_STORAGE_ROOT:root,SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK:"true",SPORTSYNC_STAGING_FRONTEND_URL:"https://stage-web.invalid"};}
test("staging refuses production/unmarked DB read-only before legacy session migration",t=>{
 const env=fixture(t);let db=new DatabaseSync(env.SPORTSYNC_DB_PATH);db.exec("CREATE TABLE sessions(token TEXT); INSERT INTO sessions VALUES ('revocation-sentinel');");db.close();
 const before=fs.readFileSync(env.SPORTSYNC_DB_PATH);assert.throws(()=>assertDatabaseEnvironment(env.SPORTSYNC_DB_PATH,deploymentConfig(env)),/Refusing/);
 assert.deepEqual(fs.readFileSync(env.SPORTSYNC_DB_PATH),before);
 const boot=spawnSync(process.execPath,[path.join(__dirname,"../index.js")],{env:{...process.env,...env,PORT:"0"},encoding:"utf8",timeout:5000});
 assert.equal(boot.status,1);assert.match(boot.stderr,/Refusing unmarked or foreign/);
 assert.deepEqual(fs.readFileSync(env.SPORTSYNC_DB_PATH),before);
 db=new DatabaseSync(env.SPORTSYNC_DB_PATH);assert.equal(db.prepare("SELECT token FROM sessions").get().token,"revocation-sentinel");db.close();
});
test("fresh staging marker survives restarts and rejects other environment IDs",t=>{
 const env=fixture(t),config=deploymentConfig(env);assertDatabaseEnvironment(env.SPORTSYNC_DB_PATH,config);
 const db=new DatabaseSync(env.SPORTSYNC_DB_PATH);stampDatabase(db,config);db.close();
 assertDatabaseEnvironment(env.SPORTSYNC_DB_PATH,config);
 assert.throws(()=>assertDatabaseEnvironment(env.SPORTSYNC_DB_PATH,{...config,id:"another-stage"}),/Refusing/);
 assert.throws(()=>assertDatabaseEnvironment(env.SPORTSYNC_DB_PATH,{environment:"production"}),/Production cannot/);
});
test("staging needs acknowledged scoped storage, fresh secret and nonproduction frontend",t=>{
 const env=fixture(t);for(const override of [{SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK:"false"},{SPORTSYNC_SESSION_SECRET:""},{SPORTSYNC_DB_PATH:":memory:"},{SPORTSYNC_DB_PATH:path.join(path.dirname(env.SPORTSYNC_DURABLE_STORAGE_ROOT),"escape.sqlite")},{SPORTSYNC_STAGING_FRONTEND_URL:"https://sports-radio-app.vercel.app"}])assert.throws(()=>deploymentConfig({...env,...override}));
});
test("staging session hashes differ from production and other staging deployments",t=>{
 const env=fixture(t),token=crypto.randomBytes(32).toString("hex");const stage=deploymentConfig(env).sessionHash(token);
 assert.notEqual(stage,deploymentConfig({}).sessionHash(token));
 assert.notEqual(stage,deploymentConfig({...env,SPORTSYNC_DEPLOYMENT_ID:"different-stage"}).sessionHash(token));
 assert.notEqual(stage,deploymentConfig({...env,SPORTSYNC_SESSION_SECRET:crypto.randomBytes(32).toString("hex")}).sessionHash(token));
});

test("fresh databases never share device credentials or pairing ownership",t=>{
 const {createDeviceRegistry}=require("../device-pairing");
 const env=fixture(t);const other=path.join(env.SPORTSYNC_DURABLE_STORAGE_ROOT,"other.sqlite");
 const a=new DatabaseSync(env.SPORTSYNC_DB_PATH),b=new DatabaseSync(other);
 try {
   for(const db of [a,b])db.exec("CREATE TABLE users(user_id TEXT PRIMARY KEY);INSERT INTO users VALUES ('test-account');");
   const first=createDeviceRegistry(a),second=createDeviceRegistry(b);
   const id=crypto.randomUUID(),key=crypto.randomBytes(32).toString("hex");first.register(id,key,"Stage A");const code=first.start(id,key).code;
   assert.throws(()=>second.status(id,key),/INVALID_DEVICE_CREDENTIAL/);
   assert.throws(()=>second.claim("test-account",code),/INVALID_CODE/);
   first.claim("test-account",code);assert.equal(second.list("test-account").length,0);
 } finally {a.close();b.close();}
});

test("dedicated staging entry point rejects accidental production mode before startup",()=>{
 const boot=spawnSync(process.execPath,[path.join(__dirname,"../start-staging.js")],{env:{...process.env,SPORTSYNC_ENVIRONMENT:"production"},encoding:"utf8",timeout:5000});
 assert.equal(boot.status,1);assert.match(boot.stderr,/rejects another environment/);assert.doesNotMatch(boot.stdout,/Server listening/);
});

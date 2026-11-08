const test=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {once}=require("node:events");
const path=require("node:path"),fs=require("node:fs"),os=require("node:os"),crypto=require("node:crypto");
const {DatabaseSync}=require("node:sqlite");
test("HTTP device pairing requires login, persists after restart, hashes sessions and fails closed",{timeout:30000},async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),"sportsradio-pair-"));const file=path.join(folder,"test.sqlite");let child;
 const stagingSecret=crypto.randomBytes(32).toString("hex");
 async function stop(){if(child && child.exitCode===null){const ended=once(child,"exit");child.kill();await ended;}child=null;}
 t.after(async()=>{await stop();for(const name of fs.readdirSync(folder))fs.unlinkSync(path.join(folder,name));fs.rmdirSync(folder);});
 async function start(enabled=true){
   child=spawn(process.execPath,[path.join(__dirname,"../index.js")],{env:{...process.env,PORT:"0",SPORTSYNC_ENVIRONMENT:"staging",SPORTSYNC_DEPLOYMENT_ID:"pairing-http-stage",SPORTSYNC_SESSION_SECRET:stagingSecret,SPORTSYNC_DURABLE_STORAGE_ROOT:folder,SPORTSYNC_STAGING_FRONTEND_URL:"https://staging-web.invalid",SPORTSYNC_DB_PATH:file,SPORTSYNC_DEVICE_PAIRING_ENABLED:String(enabled),SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK:"true"},stdio:["ignore","pipe","pipe"]});
   return await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error("Startup timeout")),5000);child.once("exit",()=>{clearTimeout(timeout);reject(new Error("Startup failed"));});child.stdout.on("data",chunk=>{const match=String(chunk).match(/Server listening on port (\d+)/);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`);}});});
 }
 let base=await start();
 assert.equal((await (await fetch(base+"/api/deployment")).json()).environment,"staging");
 async function call(route,token,body){const response=await fetch(base+route,{method:body?"POST":"GET",headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:response.status===204 ? {} : await response.json()};}
 const malformed=await fetch(base+"/api/devices/register",{method:"POST",headers:{"content-type":"application/json"},body:'{"credential":"not-for-response"'});
 assert.equal(malformed.status,400);assert.equal((await malformed.text()).includes("not-for-response"),false);
 const signup=await call("/api/auth/signup",null,{email:"pair@example.test",password:"unique-fixture-password"});assert.equal(signup.status,201);const token=signup.data.token;
 const second=await call("/api/auth/signup",null,{email:"other@example.test",password:"different-fixture-password"});
 const id=crypto.randomUUID(),key=crypto.randomBytes(32).toString("hex");
 assert.equal((await call("/api/devices/register",key,{deviceId:id})).status,200);
 const pair=await call(`/api/devices/${id}/pairing`,key,{});assert.equal(pair.status,200);assert.equal(pair.data.credential,undefined);
 assert.equal((await call("/api/devices/claim",null,{code:pair.data.code})).status,401);
 assert.equal((await call("/api/devices/claim",token,{code:pair.data.code})).status,200);
 assert.equal((await call("/api/devices/claim",second.data.token,{code:pair.data.code})).status,400);
 assert.equal((await call("/api/devices",second.data.token)).data.devices.length,0);
 const invalid=await call(`/api/devices/${id}/status`,"b".repeat(64),{});assert.equal(invalid.status,401);
 let db=new DatabaseSync(file);assert.equal(db.prepare("SELECT token_hash FROM auth_sessions WHERE token_hash=?").get(token),undefined);assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n,0);db.close();
 await stop();base=await start();assert.equal((await call("/api/devices",token)).data.devices[0].deviceId,id);
 assert.equal((await call(`/api/devices/${id}/status`,key,{})).data.status,"Paired");
 db=new DatabaseSync(file);db.prepare("UPDATE auth_sessions SET expires_at=0").run();db.close();assert.equal((await call("/api/devices",token)).status,401);
 const fresh=await call("/api/auth/login",null,{email:"pair@example.test",password:"unique-fixture-password"});assert.equal(fresh.status,200);
 assert.equal((await call("/api/auth/logout",fresh.data.token,{})).status,204);
 assert.equal((await call("/api/auth/me",fresh.data.token)).status,401);
 let limited;for(let i=0;i<22;i++)limited=await call("/api/auth/login",null,{email:"missing@example.test",password:"invalid"});assert.equal(limited.status,429);
 await stop();base=await start(false);assert.equal((await call("/api/devices/register",key,{deviceId:id})).status,503);
});

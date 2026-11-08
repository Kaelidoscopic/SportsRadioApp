const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {DatabaseSync} = require("node:sqlite");
const {createDeviceRegistry,digest} = require("../device-pairing");
function fixture(t) {
 const db=new DatabaseSync(":memory:"); t.after(()=>db.close());
 db.exec("CREATE TABLE users(user_id TEXT PRIMARY KEY); INSERT INTO users VALUES ('alice'),('bob');");
 let now=1000000; const registry=createDeviceRegistry(db,{now:()=>now});
 const id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString("hex");
 registry.register(id,secret,"TV"); return {db,registry,id,secret,advance:ms=>{now+=ms;}};
}
test("single-use pairing assigns persistent server ownership without storing raw secrets",t=>{
 const {db,registry:r,id,secret}=fixture(t); const pair=r.start(id,secret);
 assert.equal(r.status(id,secret).status,"Waiting for Pairing");
 assert.equal(db.prepare("SELECT credential_hash FROM tv_devices").get().credential_hash,digest(secret));
 assert.notEqual(db.prepare("SELECT code_hash FROM tv_pairings").get().code_hash,pair.code);
 r.claim("alice",pair.code); assert.equal(r.status(id,secret).status,"Paired");
 assert.equal(r.list("alice").length,1); assert.equal(r.list("bob").length,0);
 assert.throws(()=>r.claim("bob",pair.code),/INVALID_CODE/);
 assert.throws(()=>r.start(id,secret),/ALREADY_PAIRED/);
 assert.equal(createDeviceRegistry(db).list("alice").length,1);
});
test("expiry and online timeout use server time",t=>{const {registry:r,id,secret,advance}=fixture(t); const p=r.start(id,secret);advance(300001);assert.equal(r.status(id,secret).status,"Expired");assert.throws(()=>r.claim("alice",p.code),/EXPIRED_CODE/);});
test("ID alone and invalid credentials cannot impersonate or overwrite a device",t=>{const {registry:r,id,secret}=fixture(t);assert.throws(()=>r.status(id,id),/INVALID_DEVICE_CREDENTIAL/);assert.throws(()=>r.register(id,"b".repeat(64),"stolen"),/INVALID_DEVICE_CREDENTIAL/);assert.equal(r.status(id,secret).name,"TV");assert.throws(()=>r.claim("alice",{}),/INVALID_CODE/);});
test("rotation revokes old credential and waiting code; ownership survives",t=>{const {registry:r,id,secret}=fixture(t);const p=r.start(id,secret);const next=crypto.randomBytes(32).toString("hex");r.rotate(id,secret,next);assert.throws(()=>r.status(id,secret),/INVALID_DEVICE_CREDENTIAL/);assert.throws(()=>r.claim("alice",p.code),/INVALID_CODE/);r.claim("alice",r.start(id,next).code);assert.equal(r.status(id,next).status,"Paired");});
test("pair generation and invalid attempts are bounded and durable",t=>{const {db,registry:r,id,secret}=fixture(t);for(let i=0;i<3;i++)r.start(id,secret);assert.throws(()=>r.start(id,secret),/RATE_LIMITED/);for(let i=0;i<10;i++)assert.throws(()=>r.claim("bob","0000000000"),/INVALID_CODE/);assert.throws(()=>r.claim("bob","0000000000"),/RATE_LIMITED/);assert.throws(()=>createDeviceRegistry(db,{now:()=>1000000}).claim("bob","0000000000"),/RATE_LIMITED/);});
test("superseded code cannot be claimed and missing user cannot own device",t=>{const {registry:r,id,secret}=fixture(t);const old=r.start(id,secret);const latest=r.start(id,secret);assert.throws(()=>r.claim("alice",old.code),/INVALID_CODE/);assert.throws(()=>r.claim("invented",latest.code),/LOGIN_REQUIRED/);r.claim("alice",latest.code);});

test("online status expires and credential rotation preserves existing owner",t=>{
 const {registry:r,id,secret,advance}=fixture(t);r.claim("alice",r.start(id,secret).code);
 assert.equal(r.list("alice")[0].online,true);advance(45001);assert.equal(r.list("alice")[0].online,false);
 const next=crypto.randomBytes(32).toString("hex");r.rotate(id,secret,next);
 assert.equal(r.list("alice")[0].online,true);assert.equal(r.list("bob").length,0);
 assert.equal(r.status(id,next).status,"Paired");
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readConfig,frontendEnv,backendEnv,defaultFile}=require('../../tools/hosted-staging/config.cjs');
const sample={version:1,backendUrl:'https://api-stage.example.com',frontendUrl:'https://web-stage.example.com',deploymentId:'test-hosted-staging'};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synclink-public-config-')),file=path.join(dir,'config.json');t.after(()=>{fs.unlinkSync(file);fs.rmdirSync(dir)});return value=>{fs.writeFileSync(file,JSON.stringify(value));return file};}
test('central public configuration produces consistent backend and frontend identity',t=>{
 const write=fixture(t),c=readConfig(write(sample),{ready:true});
 assert.equal(frontendEnv(c).VITE_STAGING_DEPLOYMENT_ID,backendEnv(c,{}).SPORTSYNC_DEPLOYMENT_ID);
 assert.equal(frontendEnv(c).VITE_STAGING_FRONTEND_URL,backendEnv(c,{}).SPORTSYNC_STAGING_FRONTEND_URL);
 assert.equal(frontendEnv(c).VITE_BACKEND_URL,c.backendUrl);
 assert.throws(()=>backendEnv(c,{SPORTSYNC_ENVIRONMENT:'production'}),/rejects/);
 assert.throws(()=>backendEnv(c,{SPORTSYNC_DEPLOYMENT_ID:'foreign-stage'}),/disagrees/);
});
test('hosted configuration rejects production, LAN, insecure, secret-bearing and ambiguous origins',t=>{
 const write=fixture(t);
 for(const url of ['https://sportsradioapp.onrender.com','https://sports-radio-app.vercel.app','https://SPORTSRADIOAPP.ONRENDER.COM.','https://10.0.0.139','http://stage.example.com','https://secret@stage.example.com','https://stage.example.com/path','https://stage.example.com?token=secret','https://localhost','https://stage.local'])
  assert.throws(()=>readConfig(write({...sample,backendUrl:url})));
 assert.throws(()=>readConfig(write({...sample,sessionSecret:'forbidden'})));
 assert.throws(()=>readConfig(write({...sample,deploymentId:'production?'})));
});
test('unconfigured review build cannot pass deployment readiness or start backend',t=>{
 const write=fixture(t),file=write({...sample,backendUrl:'https://unconfigured.invalid'});
 assert.throws(()=>readConfig(file,{ready:true}),/placeholders/);
 const result=require('node:child_process').spawnSync(process.execPath,[path.join(__dirname,'../start-hosted-staging.js')],{encoding:'utf8',timeout:5000,env:{...process.env,SPORTSYNC_PUBLIC_STAGING_CONFIG:file}});
 assert.equal(result.status,1);assert.match(result.stderr,/placeholders/);assert.doesNotMatch(result.stdout,/Server listening/);
});
test('hosted launcher starts isolated configured backend and preserves DB identity across restart',{timeout:20000},async t=>{
 const {spawn}=require('node:child_process'),{once}=require('node:events');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'synclink-hosted-boot-')),file=path.join(root,'public.json');
 fs.writeFileSync(file,JSON.stringify(sample));let child;
 async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}child=null;}
 t.after(async()=>{await stop();for(const name of fs.readdirSync(root))fs.unlinkSync(path.join(root,name));fs.rmdirSync(root)});
 const env={...process.env,SPORTSYNC_PUBLIC_STAGING_CONFIG:file,SPORTSYNC_ENVIRONMENT:'staging',SPORTSYNC_DEPLOYMENT_ID:sample.deploymentId,SPORTSYNC_STAGING_FRONTEND_URL:sample.frontendUrl,SPORTSYNC_SESSION_SECRET:require('node:crypto').randomBytes(32).toString('hex'),SPORTSYNC_DURABLE_STORAGE_ROOT:root,SPORTSYNC_DB_PATH:path.join(root,'stage.sqlite'),SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK:'true',SPORTSYNC_DEVICE_PAIRING_ENABLED:'true',SPORTSYNC_BIND_HOST:'127.0.0.1',PORT:'0'};
 async function start(){child=spawn(process.execPath,[path.join(__dirname,'../start-hosted-staging.js')],{env,stdio:['ignore','pipe','pipe']});return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),5000);child.once('exit',()=>{clearTimeout(timer);reject(Error('Isolated startup failed'))});child.stdout.on('data',data=>{const m=String(data).match(/Server listening on port (\d+)/);if(m){clearTimeout(timer);resolve('http://127.0.0.1:'+m[1])}})});}
 let url=await start();assert.deepEqual(await (await fetch(url+'/api/deployment')).json(),{environment:'staging',deploymentId:sample.deploymentId});
 await stop();url=await start();assert.equal((await (await fetch(url+'/api/deployment')).json()).deploymentId,sample.deploymentId);
});

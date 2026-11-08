// Live local-only acceptance checks. Start backend and HTTPS gateway first.
const {test}=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),fs=require('node:fs'),path=require('node:path');
const {load}=require('./start.cjs');
const {state,c}=load(process.env.SPORTSRADIO_LOCAL_CONFIG);
const ca=fs.readFileSync(path.join(state,'public-ca/root-ca.pem'));
function get(route,options={}){return new Promise((resolve,reject)=>{https.get(c.origin+route,{ca,...options},r=>{let body='';r.on('data',v=>body+=v);r.on('end',()=>resolve({status:r.statusCode,body}));}).on('error',reject);});}
test('trusted HTTPS exposes only expected staging identity',async()=>{const r=await get('/api/deployment');assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{environment:'staging',deploymentId:c.deploymentId});});
test('untrusted certificate and wrong hostname are rejected',async()=>{await assert.rejects(get('/',{ca:undefined}));await assert.rejects(get('/',{servername:'wrong.invalid'}));});
test('static website serves successfully; unexpected Host is rejected',async()=>{assert.match((await get('/')).body,/<html/);assert.equal((await get('/',{servername:c.lanAddress,headers:{Host:'sportsradioapp.onrender.com'}})).status,400);assert.equal((await get('/%2e%2e%2fconfig.json')).status,403);});
test('secure WebSocket upgrades work through gateway',async()=>{const {io}=require('../../server/node_modules/socket.io-client');await new Promise((resolve,reject)=>{const socket=io(c.origin,{ca,transports:['websocket'],reconnection:false,timeout:3000,extraHeaders:{Origin:c.origin}});socket.once('connect',()=>{socket.disconnect();resolve();});socket.once('connect_error',e=>{socket.disconnect();reject(e);});});});
test('secure WebSocket connection rejects an untrusted CA',async()=>{
 const {io}=require('../../server/node_modules/socket.io-client');
 await new Promise((resolve,reject)=>{
  const socket=io(c.origin,{transports:['websocket'],reconnection:false,timeout:3000,extraHeaders:{Origin:c.origin}});
  socket.once('connect',()=>{socket.disconnect();reject(Error('Untrusted WebSocket certificate accepted'));});
  socket.once('connect_error',error=>{socket.disconnect();try{assert.equal(error.description?.error?.code || error.description?.code,'UNABLE_TO_VERIFY_LEAF_SIGNATURE');resolve();}catch(e){reject(e);}});
 });
});

if(process.env.SPORTSRADIO_EXPIRED_TLS_ARCHIVE) test('real TLS handshake rejects archived expired server certificate',async()=>{
 const archive=path.resolve(process.env.SPORTSRADIO_EXPIRED_TLS_ARCHIVE);
 if(!archive.startsWith(path.join(state,'tls-history')+path.sep))throw Error('Use only this staging instance TLS archive');
 const {decrypt}=require('./start.cjs');
 const s=https.createServer({cert:fs.readFileSync(path.join(archive,'server-cert.pem')),key:decrypt(path.join(archive,'tls-key.dpapi'))},(_,res)=>res.end('must not be accepted'));
 await new Promise(resolve=>s.listen(0,c.lanAddress,resolve));
 try {await assert.rejects(new Promise((resolve,reject)=>https.get(`${c.origin}:${s.address().port}/`,{ca:fs.readFileSync(path.join(archive,'public-ca/root-ca.pem'))},r=>{r.resume();resolve();}).on('error',reject)),{code:'CERT_HAS_EXPIRED'});}finally{await new Promise(resolve=>s.close(resolve));}
});

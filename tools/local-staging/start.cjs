const fs=require('node:fs'),path=require('node:path'),https=require('node:https'),http=require('node:http'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..');
function validateTls(certPem,caPem,c,now=Date.now()) {
 const {X509Certificate,createHash}=require('node:crypto');
 const cert=new X509Certificate(certPem),ca=new X509Certificate(caPem);
 for(const item of [cert,ca])if(now<Date.parse(item.validFrom)||now>=Date.parse(item.validTo))throw Error('Local staging TLS certificate expired or not yet valid; rotate TLS and rebuild staging APK');
 if(!ca.ca||createHash('sha256').update(ca.raw).digest('hex')!==c.caSha256||!cert.checkIssued(ca)||!cert.verify(ca.publicKey)||cert.checkIP(c.lanAddress)!==c.lanAddress)throw Error('Local staging TLS identity or CA mismatch');
}
function load(file){const state=path.dirname(path.resolve(file)),c=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 if(c.version!==1||!/^local-pairing-[a-f0-9]{12}$/.test(c.deploymentId)||c.origin!==`https://${c.lanAddress}`||!/^10\.\d+\.\d+\.\d+$|^192\.168\.\d+\.\d+$|^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(c.lanAddress)||c.backendPort!==5051)throw Error('Invalid local configuration');
 return {state,c};}
function decrypt(file){const command='Add-Type -AssemblyName System.Security; [Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:SPORTSRADIO_DPAPI_PATH),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))';
 const r=cp.spawnSync(`${process.env.SystemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe`,['-NoProfile','-NonInteractive','-Command',command],{env:{...process.env,SPORTSRADIO_DPAPI_PATH:file},encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('Cannot decrypt local state as this Windows user');return r.stdout;}
function gateway(c,dist,tls){
 const marker=JSON.parse(fs.readFileSync(path.join(dist,'local-deployment.json')));if(marker.origin!==c.origin||marker.deploymentId!==c.deploymentId)throw Error('Rebuild local staging frontend');
 const allowed=req=>req.headers.host===c.lanAddress;
 const options=req=>({host:'127.0.0.1',port:5051,path:req.url,method:req.method,headers:req.headers});
 const s=https.createServer(tls,(req,res)=>{
  if(!allowed(req)||!req.url.startsWith('/')||req.url.startsWith('//')){res.writeHead(400).end();return;}
  if(req.url.startsWith('/api/')||req.url.startsWith('/socket.io/')){const p=http.request(options(req),r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});p.on('error',()=>res.writeHead(502).end());req.pipe(p);return;}
  let name;try{name=decodeURIComponent(req.url.split('?')[0]);}catch{res.writeHead(400).end();return;}
  const target=path.resolve(dist,'.'+name);if(path.relative(dist,target).startsWith('..')||name.includes('\\')){res.writeHead(403).end();return;}
  const file=fs.existsSync(target)&&fs.statSync(target).isFile()?target:path.join(dist,'index.html');
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
  res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');fs.createReadStream(file).pipe(res);
 });
 s.on('upgrade',(req,socket,head)=>{if(!allowed(req)||!req.url.startsWith('/socket.io/'))return socket.destroy();const p=http.request(options(req));p.on('upgrade',(r,up,upHead)=>{socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(r.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(upHead.length)socket.write(upHead);if(head.length)up.write(head);up.pipe(socket);socket.pipe(up);up.on('error',()=>socket.destroy());socket.on('error',()=>up.destroy());});p.on('response',()=>socket.destroy());p.on('error',()=>socket.destroy());p.end();});return s;
}
async function main(){const [role,file]=process.argv.slice(2);const {state,c}=load(file);
 if(role==='backend'){
  const env={};for(const k of ['PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'])if(process.env[k])env[k]=process.env[k];
  Object.assign(env,{SPORTSYNC_ENVIRONMENT:'staging',SPORTSYNC_DEPLOYMENT_ID:c.deploymentId,SPORTSYNC_SESSION_SECRET:decrypt(path.join(state,'session-secret.dpapi')),SPORTSYNC_DB_PATH:path.join(state,'data/pairing.sqlite'),SPORTSYNC_DURABLE_STORAGE_ROOT:path.join(state,'data'),SPORTSYNC_DEVICE_PAIRING_STORAGE_ACK:'true',SPORTSYNC_DEVICE_PAIRING_ENABLED:'true',SPORTSYNC_STAGING_FRONTEND_URL:c.origin,SPORTSYNC_BIND_HOST:'127.0.0.1',PORT:'5051'});
  const child=cp.spawn(process.execPath,[path.join(root,'server/start-staging.js')],{env,stdio:'inherit',windowsHide:true});child.on('exit',code=>process.exitCode=code||0);return;
 }
 if(role!=='https')throw Error('Use backend or https');
 const r=await fetch('http://127.0.0.1:5051/api/deployment',{redirect:'error'}),d=await r.json();if(d.environment!=='staging'||d.deploymentId!==c.deploymentId)throw Error('Wrong backend identity');
 const cert=fs.readFileSync(path.join(state,'server-cert.pem')),ca=fs.readFileSync(path.join(state,'public-ca/root-ca.pem'));
 validateTls(cert,ca,c);
 const s=gateway(c,path.join(root,'client/dist-staging'),{cert,key:decrypt(path.join(state,'tls-key.dpapi'))});s.listen(443,c.lanAddress,()=>console.log(`Local staging website/API: ${c.origin}`));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={load,gateway,validateTls,decrypt};

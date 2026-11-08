const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
test('TLS rotation preserves SQLite, session secret, deployment and rollback archive',{timeout:30000},()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'sportsradio-tls-rotation-')),state=path.join(base,'instance');
 const run=(script,args)=>{const result=cp.spawnSync('pwsh',['-NoProfile','-File',path.join(__dirname,script),...args],{encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr);};
 const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 try {
  run('Initialize-LocalStaging.ps1',['-LanAddress','10.0.0.139','-StateDirectory',state]);
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(path.join(state,'data/pairing.sqlite'));
  db.exec("CREATE TABLE preservation_fixture (device TEXT, owner TEXT); INSERT INTO preservation_fixture VALUES ('test-device','test-owner')");db.close();
  const before=JSON.parse(fs.readFileSync(path.join(state,'config.json'),'utf8').replace(/^\uFEFF/,''));
  const files=['session-secret.dpapi','data/pairing.sqlite'];const hashes=files.map(f=>digest(path.join(state,f)));
  run('Rotate-LocalStagingTls.ps1',['-Config',path.join(state,'config.json')]);
  const after=JSON.parse(fs.readFileSync(path.join(state,'config.json'),'utf8'));
  assert.notEqual(after.caSha256,before.caSha256);
  for(const k of ['deploymentId','origin','backendPort','lanAddress','version'])assert.equal(after[k],before[k]);
  assert.deepEqual(files.map(f=>digest(path.join(state,f))),hashes);
  const {validateTls}=require('./start.cjs');validateTls(fs.readFileSync(path.join(state,'server-cert.pem')),fs.readFileSync(path.join(state,'public-ca/root-ca.pem')),after);
  assert.equal(fs.readdirSync(path.join(state,'tls-history')).length,1);
  assert.equal(fs.readdirSync(state).some(n=>n.startsWith('tls-candidate-')),false);
 } finally {
  const resolved=fs.realpathSync(base),temp=fs.realpathSync(os.tmpdir());
  if(path.dirname(resolved)!==temp||!path.basename(resolved).startsWith('sportsradio-tls-rotation-'))throw Error('Unsafe fixture cleanup');
  fs.rmSync(resolved,{recursive:true,force:true});
 }
});

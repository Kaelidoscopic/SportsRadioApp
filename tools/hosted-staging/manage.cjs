// Builds/checks only. This tool has no deployment, Git, provisioning or secret-generation command.
const path=require('node:path'),cp=require('node:child_process');
const {readConfig,frontendEnv,defaultFile}=require('./config.cjs');
const root=path.resolve(__dirname,'../..');
const [action,file=defaultFile]=process.argv.slice(2);
try {
 const configFile=path.resolve(file),c=readConfig(configFile,{ready:action==='check'});
 if(action==='check') {console.log('Public hosted staging configuration ready; infrastructure/storage/secrets still require operator verification.');}
 else if(action==='frontend') {
  const env={...process.env,...frontendEnv(c)};
  for(const key of Object.keys(frontendEnv(c)))if(process.env[key]&&process.env[key]!==env[key])throw Error(`Remove conflicting ${key} before hosted build`);
  const npm=process.platform==='win32'?'npm.cmd':'npm';
  const result=cp.spawnSync(npm,['run','build:staging'],{cwd:path.join(root,'client'),env,stdio:'inherit',shell:process.platform==='win32'});
  if(result.error)throw Error('Frontend build could not start');process.exitCode=result.status??1;
 } else throw Error('Use check or frontend');
} catch(error){console.error(error.message);process.exitCode=1;}

const fs=require('node:fs'),path=require('node:path');
const defaultFile=path.resolve(__dirname,'../../config/staging.json');
function readConfig(file=defaultFile,{ready=false}={}) {
 const c=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
 if(Object.keys(c).sort().join(',')!=='backendUrl,deploymentId,frontendUrl,version'||c.version!==1||!/^[a-z0-9-]{8,64}$/.test(c.deploymentId))throw Error('Invalid non-secret staging configuration; credentials are prohibited');
 for(const key of ['backendUrl','frontendUrl']) {
  const u=new URL(c[key]),host=u.hostname.toLowerCase().replace(/\.$/,'');
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||c[key]!==u.origin||!host.includes('.')||/^[\d.]+$/.test(host)||host.includes(':')||host.endsWith('.local')||host.endsWith('.localhost')||host==='sportsradioapp.onrender.com'||host==='sports-radio-app.vercel.app')throw Error('Hosted staging requires dedicated HTTPS DNS origins, never production or LAN IPs');
  if(ready&&host.endsWith('.invalid'))throw Error('Configure assigned hosted staging URLs before deployment; placeholders are intentionally non-routable');
 }
 return c;
}
function frontendEnv(c) {return {VITE_DEPLOYMENT_ENV:'staging',VITE_STAGING_DEPLOYMENT_ID:c.deploymentId,VITE_BACKEND_URL:c.backendUrl,VITE_STAGING_FRONTEND_URL:c.frontendUrl};}
function backendEnv(c,env) {
 if(env.SPORTSYNC_ENVIRONMENT && env.SPORTSYNC_ENVIRONMENT!=='staging')throw Error('Hosted staging entry rejects another environment');
 const values={SPORTSYNC_ENVIRONMENT:'staging',SPORTSYNC_DEPLOYMENT_ID:c.deploymentId,SPORTSYNC_STAGING_FRONTEND_URL:c.frontendUrl};
 for(const [key,value] of Object.entries(values))if(env[key]&&env[key]!==value)throw Error(`Hosted staging configuration disagrees with ${key}`);
 return {...env,...values};
}
module.exports={readConfig,frontendEnv,backendEnv,defaultFile};

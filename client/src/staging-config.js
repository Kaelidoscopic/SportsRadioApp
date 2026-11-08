const productionHosts = new Set(["sportsradioapp.onrender.com", "sports-radio-app.vercel.app"]);
export function stagingOrigin(value) {
  const url=new URL(value);
  if(url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash || productionHosts.has(url.hostname.replace(/\.$/, ""))) throw new Error("Staging requires dedicated HTTPS origins");
  return url.origin;
}
export function validateStaging(env) {
  if(env.VITE_DEPLOYMENT_ENV!=="staging" || !/^[a-z0-9-]{8,64}$/.test(env.VITE_STAGING_DEPLOYMENT_ID || "")) throw new Error("Explicit staging identity required");
  return {backend:stagingOrigin(env.VITE_BACKEND_URL),frontend:stagingOrigin(env.VITE_STAGING_FRONTEND_URL),id:env.VITE_STAGING_DEPLOYMENT_ID};
}
export async function verifyStaging(env, origin, fetcher=fetch) {
  const config=validateStaging(env);
  if(origin!==config.frontend) throw new Error("Unexpected staging website origin");
  const response=await fetcher(config.backend+"/api/deployment",{credentials:"omit",redirect:"error",cache:"no-store"});
  const data=await response.json();
  if(!response.ok || data.environment!=="staging" || data.deploymentId!==config.id) throw new Error("Staging backend identity mismatch");
}
export function environmentStorageKey(key,env,id) { return env==="staging" ? `staging:${id}:${key}` : key; }

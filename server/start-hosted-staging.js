// Run from a NEW service rooted at the repository root so shared public config is available.
const {readConfig,backendEnv}=require('../tools/hosted-staging/config.cjs');
const config=readConfig(process.env.SPORTSYNC_PUBLIC_STAGING_CONFIG,{ready:true});
Object.assign(process.env,backendEnv(config,process.env));
// Reject missing/foreign storage and secrets before any DB write or migration.
require('./deployment-config').deploymentConfig(process.env);
require('./start-staging');

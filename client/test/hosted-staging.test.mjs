import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateStaging,verifyStaging,environmentStorageKey} from '../src/staging-config.js';
const {readConfig,frontendEnv}=createRequire(import.meta.url)('../../tools/hosted-staging/config.cjs');
test('central hosted public config feeds existing browser isolation guard',async()=>{
 const config=readConfig(),env=frontendEnv(config);
 assert.equal(validateStaging(env).backend,config.backendUrl);
 await verifyStaging(env,config.frontendUrl,async()=>({ok:true,json:async()=>({environment:'staging',deploymentId:config.deploymentId})}));
 await assert.rejects(verifyStaging(env,config.frontendUrl,async()=>({ok:true,json:async()=>({environment:'production',deploymentId:config.deploymentId})})));
 assert.notEqual(environmentStorageKey('sportsAudioAuthToken','staging',config.deploymentId),'sportsAudioAuthToken');
});

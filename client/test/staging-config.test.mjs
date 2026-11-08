import test from "node:test";
import assert from "node:assert/strict";
import {validateStaging,verifyStaging,environmentStorageKey} from "../src/staging-config.js";
const env={VITE_DEPLOYMENT_ENV:"staging",VITE_BACKEND_URL:"https://stage-api.invalid",VITE_STAGING_FRONTEND_URL:"https://stage-web.invalid",VITE_STAGING_DEPLOYMENT_ID:"pairing-stage-test"};
test("staging frontend rejects production, insecure and missing URLs",()=>{
 for(const override of [{VITE_BACKEND_URL:"https://sportsradioapp.onrender.com"},{VITE_STAGING_FRONTEND_URL:"https://sports-radio-app.vercel.app"},{VITE_BACKEND_URL:"http://localhost:5000"},{VITE_DEPLOYMENT_ENV:""},{VITE_BACKEND_URL:"https://user:secret@stage.invalid"}])assert.throws(()=>validateStaging({...env,...override}));
});
test("identity probe sends no credentials and rejects production metadata",async()=>{
 let called=false;await verifyStaging(env,env.VITE_STAGING_FRONTEND_URL,async(url,options)=>{called=true;assert.equal(url,env.VITE_BACKEND_URL+"/api/deployment");assert.equal(options.credentials,"omit");assert.equal(options.headers,undefined);return {ok:true,json:async()=>({environment:"staging",deploymentId:env.VITE_STAGING_DEPLOYMENT_ID})};});assert.equal(called,true);
 await assert.rejects(verifyStaging(env,env.VITE_STAGING_FRONTEND_URL,async()=>({ok:true,json:async()=>({environment:"production"})})),/mismatch/);
 await assert.rejects(verifyStaging(env,"https://sports-radio-app.vercel.app"),/origin/);
});
test("staging local tokens cannot collide with production or another stage",()=>{
 assert.equal(environmentStorageKey("token","production"),"token");
 assert.notEqual(environmentStorageKey("token","staging","stage-a"),"token");
 assert.notEqual(environmentStorageKey("token","staging","stage-a"),environmentStorageKey("token","staging","stage-b"));
});

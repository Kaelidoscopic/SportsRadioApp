import {environmentStorageKey} from "./staging-config";
const env={VITE_DEPLOYMENT_ENV:import.meta.env?.VITE_DEPLOYMENT_ENV,VITE_STAGING_DEPLOYMENT_ID:import.meta.env?.VITE_STAGING_DEPLOYMENT_ID};
export const storageKey=key=>environmentStorageKey(key,env.VITE_DEPLOYMENT_ENV,env.VITE_STAGING_DEPLOYMENT_ID);
export const authTokenKey=storageKey("sportsAudioAuthToken");
export const authUserKey=storageKey("sportsAudioAuthUser");

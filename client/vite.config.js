import process from 'node:process'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import {validateStaging} from './src/staging-config.js'
export default defineConfig(({mode}) => {
  const env={...loadEnv(mode,process.cwd(),''),...process.env};
  if(mode==='staging') validateStaging(env);
  if(mode!=='staging' && env.VITE_DEPLOYMENT_ENV==='staging') throw new Error('Use --mode staging for isolated staging output');
  return {plugins:[react()],build:{outDir:mode==='staging'?'dist-staging':'dist'}};
})

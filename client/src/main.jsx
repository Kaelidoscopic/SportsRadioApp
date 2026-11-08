import React from "react";
import ReactDOM from "react-dom/client";
import { verifyStaging } from "./staging-config";
import "./index.css";

async function start() {
  if(import.meta.env.VITE_DEPLOYMENT_ENV==="staging") await verifyStaging({VITE_DEPLOYMENT_ENV:import.meta.env.VITE_DEPLOYMENT_ENV,VITE_BACKEND_URL:import.meta.env.VITE_BACKEND_URL,VITE_STAGING_FRONTEND_URL:import.meta.env.VITE_STAGING_FRONTEND_URL,VITE_STAGING_DEPLOYMENT_ID:import.meta.env.VITE_STAGING_DEPLOYMENT_ID},window.location.origin);
  // App constructs its signaling socket at module load: import ONLY after verification.
  const {default:App}=await import("./App");
  ReactDOM.createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
}
start().catch(()=>{document.getElementById("root").textContent="Staging configuration unavailable or mismatched. No account or signaling connection was started.";});

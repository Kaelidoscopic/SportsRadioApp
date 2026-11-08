import { authTokenKey } from "./auth-storage";
import { useEffect, useState } from "react";
import { normalizePairingCode, pairingMessage } from "./device-pairing";
const backend = import.meta.env.VITE_BACKEND_URL || (import.meta.env.DEV ? "http://localhost:5000" : "");
export default function MyDevices({ onBack, onSignIn }) {
  const [devices,setDevices] = useState([]);
  const [code,setCode] = useState("");
  const [message,setMessage] = useState("");
  const [busy,setBusy] = useState(false);
  async function request(path, body) {
    const token = localStorage.getItem(authTokenKey) || "";
    const response = await fetch(`${backend}/api/devices${path}`, {method:body ? "POST":"GET",
      headers:{authorization:`Bearer ${token}`,"content-type":"application/json"}, ...(body ? {body:JSON.stringify(body)} : {})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    return data;
  }
  useEffect(() => {
    let active = true;
    const refresh = () => request("").then(data => {if(active) setDevices(data.devices);}).catch(error => {if(active) setMessage(pairingMessage(error.message));});
    refresh(); const timer=setInterval(refresh,15000);
    return () => {active=false;clearInterval(timer);};
  },[]);
  async function claim(event) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await request("/claim",{code:normalizePairingCode(code)}); setCode(""); setMessage(pairingMessage("Paired")); setDevices((await request("")).devices); }
    catch(error) {setMessage(pairingMessage(error.message));} finally {setBusy(false);}
  }
  return <div className="page-shell"><div className="main-card">
    <button className="back-button" onClick={onBack}>Back</button><h1>My Devices</h1>
    <p>On your TV, open Pair TV to Account and request a code. Enter it here to link that TV to this signed-in account.</p>
    <form onSubmit={claim}><label>TV pairing code <input value={code} maxLength={11} autoComplete="off" onChange={e=>setCode(e.target.value)} /></label>
    <button className="primary-button" disabled={busy || normalizePairingCode(code).length!==10}>Pair TV</button></form>
    <p role="status">{message}</p>
    {message === pairingMessage("LOGIN_REQUIRED") && <button onClick={onSignIn}>Sign in again</button>}
    <ul>{devices.map(device=><li key={device.deviceId}>{device.name} — {device.online ? "Online":"Offline"}</li>)}</ul>
    {!devices.length && <p>No paired TVs listed.</p>}
    <p>Pairing does not start a broadcast or grant Android capture permission.</p>
  </div></div>;
}

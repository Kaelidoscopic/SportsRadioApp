import { QRCodeSVG } from "qrcode.react";

function HostDashboard({
  currentRoom,
  isBroadcasting,
  isMuted,
  leaveRoom,
  startBroadcasting,
  stopBroadcasting,
  toggleMute,
  audioInputs,
  selectedAudioInput,
  setSelectedAudioInput,
  broadcastSourceType,
  setBroadcastSourceType
}) {
  const joinLink = currentRoom
    ? `${import.meta.env.VITE_FRONTEND_URL}/?room=${currentRoom}`
    : "";

  const toggleBroadcast = () => {
    if (isBroadcasting) {
      stopBroadcasting();
    } else {
      startBroadcasting();
    }
  };

  return (
    <div className="page-shell">
      <div className="main-card dashboard-card host-card">
        <div className="room-code-card host-room-card">
          <div className="room-code-value">{currentRoom || "------"}</div>

          <div className={`live-pill ${isBroadcasting ? "live" : "offline"}`}>
            {isBroadcasting ? (isMuted ? "MUTED" : "LIVE") : "OFFLINE"}
          </div>
        </div>

        {currentRoom && (
          <div className="qr-card">
            <div className="qr-box">
              <QRCodeSVG value={joinLink} size={180} />
            </div>
          </div>
        )}

        <div className="panel-card host-controls">
          {!isBroadcasting && (
            <p className="host-hint">
              Choose an audio input device, or share audio from a browser tab or screen.
            </p>
          )}
          <select
            className="audio-select"
            value={broadcastSourceType}
            onChange={(e) => setBroadcastSourceType(e.target.value)}
            disabled={isBroadcasting}
          >
            <option value="input">Audio Input Device</option>
            <option value="tab">Browser Tab / Screen Audio</option>
          </select>

          {broadcastSourceType === "input" && (
            <select
              className="audio-select"
              value={selectedAudioInput}
              onChange={(e) => setSelectedAudioInput(e.target.value)}
              disabled={isBroadcasting}
            >
              {audioInputs.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || "Audio Input"}
                </option>
              ))}
            </select>
          )}

          <button className="primary-button" onClick={toggleBroadcast}>
            {isBroadcasting ? "Stop Broadcasting" : "Choose Audio Source"}
          </button>

          {isBroadcasting && (
            <button className="secondary-button" onClick={toggleMute}>
              {isMuted ? "Unmute Broadcast" : "Mute Broadcast"}
            </button>
          )}

          <button className="ghost-button" onClick={leaveRoom}>
            End Room
          </button>
        </div>
      </div>
    </div>
  );
}

export default HostDashboard;
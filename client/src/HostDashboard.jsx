import { QRCodeSVG } from "qrcode.react";

function HostDashboard({
  currentRoom,
  isBroadcasting,
  isMuted,
  leaveRoom,
  startBroadcasting,
  stopBroadcasting,
  toggleMute
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
              Choose the tab or screen playing audio. Enable audio sharing when prompted.
            </p>
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
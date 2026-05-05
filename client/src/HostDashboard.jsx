import { QRCodeSVG } from "qrcode.react";

function HostDashboard({
  currentRoom,
  isMicOn,
  listenerCount,
  leaveRoom,
  startMicrophone,
  stopMicrophone
}) {
  const joinLink = currentRoom
    ? `${import.meta.env.VITE_FRONTEND_URL}/?room=${currentRoom}`
    : "";

  const toggleBroadcast = () => {
    if (isMicOn) {
      stopMicrophone();
    } else {
      startMicrophone();
    }
  };

  return (
    <div className="page-shell">
      <div className="main-card dashboard-card host-card">
        <div className="room-code-card host-room-card">
          <p className="room-code-label">Room Code</p>
          <div className="room-code-value">{currentRoom || "------"}</div>

          <div className={`live-pill host-pill ${isMicOn ? "live" : "offline"}`}>
            {isMicOn ? "LIVE" : "OFFLINE"}
          </div>
        </div>

        {currentRoom && (
          <div className="qr-card">
            <p className="room-code-label">Scan to Join</p>
            <div className="qr-box">
              <QRCodeSVG value={joinLink} size={180} />
            </div>
            <p className="qr-link-text">{joinLink}</p>
          </div>
        )}

        <div className="panel-card">
          <h2>Broadcast Controls</h2>

          <div className="button-stack">
            <button className="primary-button" onClick={toggleBroadcast}>
              {isMicOn ? "Stop Broadcasting" : "Start Broadcasting"}
            </button>

            <button className="ghost-button" onClick={leaveRoom}>
              End Room
            </button>
          </div>
        </div>

        <div className="stat-card host-listener-card">
          <span className="stat-label">Listeners</span>
          <span className="stat-value">{listenerCount}</span>
        </div>
      </div>
    </div>
  );
}

export default HostDashboard;
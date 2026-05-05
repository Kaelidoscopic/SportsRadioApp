import { QRCodeSVG } from "qrcode.react";

function HostDashboard({
  currentRoom,
  message,
  isMicOn,
  listenerCount,
  createRoom,
  leaveRoom,
  startMicrophone,
  stopMicrophone,
  copyRoomCode,
  copyJoinLink
}) {
  const DEV_HOST = import.meta.env.VITE_FRONTEND_URL;

    const joinLink = currentRoom
      ? `${import.meta.env.VITE_FRONTEND_URL}/?room=${currentRoom}`
      : "";

  return (
    <div className="page-shell">
      <div className="main-card dashboard-card">
        <div className="dashboard-header">
          <div>
            <h1 className="app-title">Broadcast Room</h1>
            <p className="app-subtitle">
              Share live audio with nearby listeners.
            </p>
          </div>

          <div className={`live-pill ${isMicOn ? "live" : "offline"}`}>
            {isMicOn ? "LIVE" : "OFFLINE"}
          </div>
        </div>

        <div className="room-code-card">
          <p className="room-code-label">Room Code</p>
          <div className="room-code-value">{currentRoom || "------"}</div>
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

        <div className="dashboard-grid">
          <div className="panel-card">
            <h2>Broadcast Controls</h2>
            <div className="button-stack">
              <button className="primary-button" onClick={startMicrophone}>
                Start Broadcasting
              </button>
              <button className="secondary-button" onClick={stopMicrophone}>
                Stop Broadcasting
              </button>
              <button className="ghost-button" onClick={leaveRoom}>
                End Room
              </button>
            </div>
          </div>

          <div className="panel-card">
            <h2>Share Room</h2>
            <div className="button-stack">
              <button className="primary-button" onClick={copyRoomCode}>
                Copy Room Code
              </button>
              <button className="secondary-button" onClick={copyJoinLink}>
                Copy Join Link
              </button>
              <button className="ghost-button" onClick={createRoom}>
                Create New Room
              </button>
            </div>
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-card">
            <span className="stat-label">Broadcast</span>
            <span className="stat-value">{isMicOn ? "On" : "Off"}</span>
          </div>

          <div className="stat-card">
            <span className="stat-label">Listeners</span>
            <span className="stat-value">{listenerCount}</span>
          </div>
        </div>

        <div className="status-banner">
          <strong>Status:</strong> {message}
        </div>
      </div>
    </div>
  );
}

export default HostDashboard;
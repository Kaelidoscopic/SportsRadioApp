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

        {/* ROOM CODE + STATUS */}
        <div className="room-code-card host-room-card">
          <div className="room-code-value">
            {currentRoom || "------"}
          </div>

          <div className={`live-pill ${isMicOn ? "live" : "offline"}`}>
            {isMicOn ? "LIVE" : "OFFLINE"}
          </div>
        </div>

        {/* QR ONLY */}
        {currentRoom && (
          <div className="qr-card">
            <div className="qr-box">
              <QRCodeSVG value={joinLink} size={180} />
            </div>
          </div>
        )}

        {/* CONTROLS (no title) */}
        <div className="panel-card host-controls">

          <button className="primary-button" onClick={toggleBroadcast}>
            {isMicOn ? "Stop Broadcasting" : "Start Broadcasting"}
          </button>

          <button className="ghost-button" onClick={leaveRoom}>
            End Room
          </button>

        </div>

        {/* LISTENER COUNT (minimal) */}
        <div className="stat-card host-listener-card">
          <span className="stat-value">{listenerCount}</span>
        </div>

      </div>
    </div>
  );
}

export default HostDashboard;
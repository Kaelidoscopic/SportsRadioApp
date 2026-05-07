import { QRCodeSVG } from "qrcode.react";

function HostDashboard({
  currentRoom,
  isBroadcasting,
  isMuted,
  leaveRoom,
  startBroadcasting,
  stopBroadcasting,
  toggleMute,
  audioInputs = [],
  selectedAudioInput,
  setSelectedAudioInput,
  broadcastSourceType,
  setBroadcastSourceType,
  refreshAudioInputs,
  listenerCount,
  statusMessage
}) {
  const frontendUrl =
    import.meta.env.VITE_FRONTEND_URL || window.location.origin;
  const joinLink = currentRoom
    ? `${frontendUrl}/?room=${currentRoom}`
    : "";

  const handleBroadcastToggle = () => {
    if (isBroadcasting) {
      stopBroadcasting();
    } else {
      startBroadcasting();
    }
  };

  const statusText = isBroadcasting
    ? isMuted
      ? "MUTED"
      : "LIVE"
    : "OFFLINE";

  const copyRoomCode = async () => {
    if (!currentRoom) return;
    await navigator.clipboard.writeText(currentRoom);
  };

  const copyJoinLink = async () => {
    if (!joinLink) return;
    await navigator.clipboard.writeText(joinLink);
  };

  return (
    <div className="page-shell">
      <div className="main-card dashboard-card host-card">
        <div className="room-code-card host-room-card">
          <div className="room-code-value">{currentRoom || "------"}</div>

          <div className={`live-pill ${isBroadcasting ? "live" : "offline"}`}>
            {statusText}
          </div>
        </div>

        <div className="status-grid">
          <div className="metric-card">
            <span className="metric-label">Listeners</span>
            <span className="metric-value">{listenerCount}</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Room</span>
            <span className="metric-value">{currentRoom ? "Open" : "Closed"}</span>
          </div>
        </div>

        {statusMessage && <div className="status-banner">{statusMessage}</div>}

        {currentRoom && (
          <div className="qr-card">
            <div className="qr-box">
              <QRCodeSVG value={joinLink} size={180} />
            </div>
          </div>
        )}

        {currentRoom && (
          <div className="share-actions">
            <button className="secondary-button" onClick={copyRoomCode}>
              Copy Room Code
            </button>

            <button className="secondary-button" onClick={copyJoinLink}>
              Copy Join Link
            </button>
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
            <>
              <select
                className="audio-select"
                value={selectedAudioInput}
                onChange={(e) => setSelectedAudioInput(e.target.value)}
                disabled={isBroadcasting || audioInputs.length === 0}
              >
                {audioInputs.length === 0 ? (
                  <option value="">No audio inputs found</option>
                ) : (
                  audioInputs.map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Audio Input ${index + 1}`}
                    </option>
                  ))
                )}
              </select>

              <button
                className="ghost-button"
                onClick={refreshAudioInputs}
                disabled={isBroadcasting}
              >
                Refresh Audio Devices
              </button>

              {audioInputs.length === 0 && (
                <p className="small-warning">
                  No audio input devices detected.
                </p>
              )}
            </>
          )}

          <button className="primary-button" onClick={handleBroadcastToggle}>
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

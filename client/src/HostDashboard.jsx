import QRJoinScreen from "./QRJoinScreen";

const printPayloadPrefix = "sportsAudioPrintBox:";

function HostDashboard({
  currentRoom,
  isBroadcasting,
  leaveRoom,
  startBroadcasting,
  stopBroadcasting,
  audioInputs = [],
  selectedAudioInput,
  setSelectedAudioInput,
  broadcastSourceType,
  setBroadcastSourceType,
  refreshAudioInputs,
  listenerCount,
  isSocketConnected
}) {
  const frontendUrl =
    import.meta.env.VITE_FRONTEND_URL || window.location.origin;
  const joinLink = currentRoom
    ? `${frontendUrl}/?room=${currentRoom}`
    : "";

  const copyJoinLink = async () => {
    if (!joinLink) return;
    await navigator.clipboard.writeText(joinLink);
  };

  const printRoomQr = () => {
    if (!currentRoom || !joinLink) return;
    const printId = `room-${currentRoom}`;
    const payload = {
      boxId: printId,
      boxName: `Room ${currentRoom}`,
      venueName: "SyncLink Venue",
      roomCode: currentRoom,
      joinUrl: joinLink
    };
    const storageKey = `${printPayloadPrefix}${printId}`;
    const printUrl = `/print/box/${encodeURIComponent(printId)}`;

    sessionStorage.setItem(storageKey, JSON.stringify(payload));
    localStorage.setItem(storageKey, JSON.stringify(payload));

    const printWindow = window.open(printUrl, "_blank");

    if (!printWindow) {
      window.location.assign(printUrl);
    }
  };

  return (
    <div className="page-shell">
      <div className="main-card dashboard-card host-card simple-host-card">
        <div className="brand-block centered-brand">
          <h1 className="app-title">Broadcasting</h1>
          <p className="app-subtitle">Room code</p>
        </div>

        <div className="room-code-card host-room-card">
          <div className="room-code-value">{currentRoom || "------"}</div>
          <div className={`live-pill ${isBroadcasting ? "live" : "offline"}`}>
            {isBroadcasting ? "LIVE" : "READY"}
          </div>
        </div>

        <div className="simple-status-row">
          <div className="metric-card">
            <span className="metric-label">Listeners</span>
            <span className="metric-value">{listenerCount}</span>
          </div>

          <div className="metric-card">
            <span className="metric-label">Connection</span>
            <span className="metric-value">
              {isSocketConnected ? "Connected" : "Offline"}
            </span>
          </div>
        </div>

        <QRJoinScreen roomCode={currentRoom} joinUrl={joinLink} />

        {currentRoom && (
          <div className="share-actions">
            <button className="secondary-button" onClick={copyJoinLink}>
              QR / Share Link
            </button>

            <button className="secondary-button" onClick={printRoomQr}>
              Print Room QR
            </button>
          </div>
        )}

        {!isBroadcasting && (
          <div className="panel-card host-controls">
            <select
              className="audio-select"
              value={broadcastSourceType}
              onChange={(event) => setBroadcastSourceType(event.target.value)}
            >
              <option value="input">Audio Input</option>
              <option value="tab">Browser Tab / Screen</option>
            </select>

            {broadcastSourceType === "input" && (
              <>
                <select
                  className="audio-select"
                  value={selectedAudioInput}
                  onChange={(event) => setSelectedAudioInput(event.target.value)}
                  disabled={audioInputs.length === 0}
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

                <button className="ghost-button" onClick={refreshAudioInputs}>
                  Refresh Audio Devices
                </button>
              </>
            )}

            <button
              className="primary-button big-button"
              onClick={startBroadcasting}
              disabled={!isSocketConnected}
            >
              Start Broadcast
            </button>
          </div>
        )}

        <div className="compact-actions">
          {isBroadcasting && (
            <button className="primary-button big-button stop-button" onClick={stopBroadcasting}>
              Stop Broadcast
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

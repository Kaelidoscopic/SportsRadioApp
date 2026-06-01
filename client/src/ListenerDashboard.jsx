function ListenerDashboard({
  currentRoom,
  isListening,
  isHostLive,
  hostType = "browser",
  sourceName,
  leaveRoom,
  startListening,
  resumeApplianceAudio,
  needsUserAudioGesture = false,
  remoteAudioRef,
  isSocketConnected
}) {
  const roomLabel =
    sourceName ||
    (hostType === "appliance" ? `TV Audio - ${currentRoom}` : `Room ${currentRoom}`);
  const isConnected = isSocketConnected && isHostLive;
  const shouldShowStartButton = !isListening || needsUserAudioGesture;

  const handleStart = () => {
    if (needsUserAudioGesture && hostType === "appliance") {
      resumeApplianceAudio();
      return;
    }

    startListening();
  };

  return (
    <div className="page-shell">
      <div className="main-card dashboard-card listener-card simple-listener-card">
        <div className="brand-block centered-brand">
          <h1 className="app-title">{roomLabel}</h1>
          <p className="app-subtitle">
            {isConnected ? "You're connected" : "Waiting for audio"}
          </p>
        </div>

        <div className="simple-status-row">
          <div className={`live-pill ${isHostLive ? "live" : "offline"}`}>
            {isHostLive ? "LIVE" : "OFFLINE"}
          </div>

          <div className={`connection-pill ${isSocketConnected ? "live" : "offline"}`}>
            {isSocketConnected ? "Connected" : "Disconnected"}
          </div>
        </div>

        <div className="compact-actions">
          {shouldShowStartButton && (
            <button
              className="primary-button big-button"
              onClick={handleStart}
              disabled={!isHostLive || !isSocketConnected}
            >
              {needsUserAudioGesture ? "Tap to Start Listening" : "Start Listening"}
            </button>
          )}

          <button className="ghost-button" onClick={leaveRoom}>
            Leave Audio
          </button>
        </div>

        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
}

export default ListenerDashboard;

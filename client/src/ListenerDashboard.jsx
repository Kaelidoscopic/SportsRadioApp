function ListenerDashboard({
  currentRoom,
  isListening,
  isHostLive,
  hostType = "browser",
  sourceName,
  nowPlaying,
  leaveRoom,
  startListening,
  resumeApplianceAudio,
  needsUserAudioGesture = false,
  remoteAudioRef,
  listenerCount = 0,
  isSocketConnected
}) {
  const roomLabel =
    sourceName ||
    (hostType === "appliance" ? `TV Audio - ${currentRoom}` : `Room ${currentRoom}`);
  const isConnected = isSocketConnected && isHostLive;
  const statusText = isConnected ? "LIVE" : isSocketConnected ? "Connected" : "Disconnected";
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
          {nowPlaying && <p className="now-playing-label">{nowPlaying}</p>}
          <p className="app-subtitle">
            {isConnected ? "You're connected" : "Waiting for audio"}
          </p>
        </div>

        <div className="listener-status-stack">
          <div className={`live-pill ${isConnected ? "live" : "offline"}`}>
            {statusText}
          </div>
          <div className="listener-count-label">
            {listenerCount} {listenerCount === 1 ? "listener" : "listeners"}
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

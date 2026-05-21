function ListenerDashboard({
  currentRoom,
  isListening,
  isHostLive,
  hostType = "browser",
  leaveRoom,
  startListening,
  stopListening,
  reconnectAudio,
  resumeApplianceAudio,
  needsUserAudioGesture = false,
  remoteAudioRef,
  statusMessage,
  isSocketConnected
}) {
  const handleListeningToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div className="page-shell">
      <div className="main-card dashboard-card listener-card">
        <div className="room-code-card listener-room-card">
          <div className="room-code-value">{currentRoom || "------"}</div>

          <div className={`live-pill ${isHostLive ? "live" : "offline"}`}>
            {isHostLive ? "ONLINE" : "OFFLINE"}
          </div>
        </div>

        <div className="panel-card listener-controls">
          {statusMessage && <div className="status-banner">{statusMessage}</div>}

          <div
            className={`connection-pill ${
              isSocketConnected ? "live" : "offline"
            }`}
          >
            {isSocketConnected ? "Server connected" : "Server disconnected"}
          </div>

          <div className={`live-pill ${isListening ? "live" : "offline"}`}>
            {isListening ? "LIVE" : "PAUSED"}
          </div>

          <div className="source-pill">
            {hostType === "appliance" ? "Pi appliance" : "Browser host"}
          </div>

          <button
            className="primary-button"
            onClick={handleListeningToggle}
            disabled={(!isHostLive || !isSocketConnected) && !isListening}
          >
            {isListening ? "Stop Listening" : "Start Listening"}
          </button>

          {needsUserAudioGesture && hostType === "appliance" && (
            <button
              className="primary-button"
              onClick={resumeApplianceAudio}
              disabled={!isHostLive || !isSocketConnected}
            >
              Tap to Start Listening
            </button>
          )}

          <button
            className="secondary-button"
            onClick={reconnectAudio}
            disabled={!isHostLive || !isSocketConnected}
          >
            Reconnect Audio
          </button>

          <button className="ghost-button" onClick={leaveRoom}>
            Leave Room
          </button>
        </div>

        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
}

export default ListenerDashboard;

function ListenerDashboard({
  currentRoom,
  isListening,
  isHostLive,
  leaveRoom,
  startListening,
  stopListening,
  reconnectAudio,
  remoteAudioRef
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
          <div className={`live-pill ${isListening ? "live" : "offline"}`}>
            {isListening ? "LIVE" : "PAUSED"}
          </div>

          <button
            className="primary-button"
            onClick={handleListeningToggle}
            disabled={!isHostLive && !isListening}
          >
            {isListening ? "Stop Listening" : "Start Listening"}
          </button>

          <button
            className="secondary-button"
            onClick={reconnectAudio}
            disabled={!isHostLive}
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
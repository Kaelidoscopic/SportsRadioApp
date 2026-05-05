function ListenerDashboard({
  currentRoom,
  isListening,
  leaveRoom,
  startListening,
  stopListening,
  remoteAudioRef,
  isHostLive // <-- new prop
}) {
  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <div className="page-shell">
      <div className="main-card dashboard-card listener-card">

        {/* ROOM STATUS */}
        <div className="room-code-card listener-room-card">
          <div className="room-code-value">
            {currentRoom || "------"}
          </div>

          <div className={`live-pill ${isHostLive ? "live" : "offline"}`}>
            {isHostLive ? "ONLINE" : "OFFLINE"}
          </div>
        </div>

        {/* AUDIO CONTROL */}
        <div className="panel-card listener-controls">

          <div className={`live-pill ${isListening ? "live" : "offline"}`}>
            {isListening ? "LIVE" : "PAUSED"}
          </div>

          <button
            className="primary-button"
            onClick={toggleListening}
            disabled={!isHostLive && !isListening}
          >
            {isListening ? "Stop Listening" : "Start Listening"}
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
function ListenerDashboard({
  currentRoom,
  isListening,
  leaveRoom,
  startListening,
  stopListening,
  remoteAudioRef
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
        <div className="room-code-card listener-room-card">
          <p className="room-code-label">Connected Room</p>
          <div className="room-code-value">{currentRoom || "------"}</div>

          <div className={`live-pill listener-pill ${isListening ? "live" : "offline"}`}>
            {isListening ? "LIVE" : "PAUSED"}
          </div>
        </div>

        <div className="panel-card">
          <h2>Audio Controls</h2>

          <div className="button-stack">
            <button className="primary-button" onClick={toggleListening}>
              {isListening ? "Stop Listening" : "Start Listening"}
            </button>

            <button className="ghost-button" onClick={leaveRoom}>
              Leave Room
            </button>
          </div>
        </div>

        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
}

export default ListenerDashboard;
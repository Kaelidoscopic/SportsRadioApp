function ListenerDashboard({
  currentRoom,
  message,
  isListening,
  volume,
  setVolume,
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
      <div className="main-card dashboard-card">
        <div className="dashboard-header">
          <div>
            <h1 className="app-title">Connected Audio</h1>
            <p className="app-subtitle">
              Listen to the live room on your device.
            </p>
          </div>

          <div className={`live-pill ${isListening ? "live" : "offline"}`}>
            {isListening ? "LISTENING" : "PAUSED"}
          </div>
        </div>

        <div className="room-code-card">
          <p className="room-code-label">Connected Room</p>
          <div className="room-code-value">{currentRoom || "------"}</div>
        </div>

        <div className="dashboard-grid">
          <div className="panel-card">
            <h2>Listening Controls</h2>
            <div className="button-stack">
              <button className="primary-button" onClick={toggleListening}>
                {isListening ? "Stop Listening" : "Start Listening"}
              </button>

              <button className="ghost-button" onClick={leaveRoom}>
                Leave Room
              </button>
            </div>
          </div>

          <div className="panel-card">
            <h2>Volume</h2>

            <div className="slider-group">
              <label>{Math.round(volume * 100)}%</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <audio ref={remoteAudioRef} autoPlay />

        <div className="status-banner">
          <strong>Status:</strong> {message}
        </div>
      </div>
    </div>
  );
}

export default ListenerDashboard;
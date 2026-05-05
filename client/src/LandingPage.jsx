function LandingPage({ roomId, setRoomId, createRoom, joinRoom, message }) {
  return (
    <div className="page-shell">
      <div className="main-card landing-card">
        <div className="brand-block">
          <h1 className="app-title">Venue Audio</h1>
          <p className="app-subtitle">
            Start a live audio room or join one nearby.
          </p>
        </div>

        <div className="landing-grid">
          <div className="panel-card">
            <h2>Host a Room</h2>
            <p className="panel-copy">
              Start broadcasting audio for a TV or public screen.
            </p>
            <button className="primary-button" onClick={createRoom}>
              Start a Room
            </button>
          </div>

          <div className="panel-card">
            <h2>Join a Room</h2>
            <p className="panel-copy">
              Enter the room code provided by the venue or host.
            </p>

            <input
              className="room-input"
              type="text"
              placeholder="Enter room code"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />

            <button className="primary-button" onClick={joinRoom}>
              Join Audio
            </button>
          </div>
        </div>

        <div className="status-banner">
          <strong>Status:</strong> {message}
        </div>
      </div>
    </div>
  );
}

export default LandingPage;
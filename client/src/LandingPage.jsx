function LandingPage({ roomId, setRoomId, createRoom, joinRoom }) {
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      joinRoom();
    }
  };

  return (
    <div className="page-shell">
      <div className="main-card landing-card compact-landing">
        <div className="brand-block centered-brand">
          <h1 className="app-title">Venue Audio</h1>
          <p className="app-subtitle">
            Hear live audio from a nearby screen.
          </p>
        </div>

        <div className="compact-actions">
          <button className="primary-button" onClick={createRoom}>
            Start a Room
          </button>

          <div className="join-divider">or</div>

          <input
            className="room-input compact-input"
            type="text"
            placeholder="Enter room code"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            onKeyDown={handleKeyDown}
          />

          <button className="secondary-button" onClick={joinRoom}>
            Join Audio
          </button>
        </div>
      </div>
    </div>
  );
}

export default LandingPage;
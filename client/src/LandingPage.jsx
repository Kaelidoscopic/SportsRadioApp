function LandingPage({ roomId, setRoomId, createRoom, joinRoom, activeRooms }) {
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
          <p className="app-subtitle">Hear live audio from a nearby screen.</p>
        </div>

        <div className="compact-actions">
          <input
            className="room-input compact-input"
            type="text"
            placeholder="Enter or create room code"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
          />

          <button className="primary-button" onClick={createRoom}>
            Start Room
          </button>

          <button className="secondary-button" onClick={joinRoom}>
            Join Audio
          </button>
        </div>

        {activeRooms.length > 0 && (
          <div className="room-directory">
            {activeRooms.map((room) => (
              <button
                key={room.roomId}
                className="room-list-card"
                onClick={() => joinRoom(room.roomId)}
              >
                <span className="room-list-code">{room.roomId}</span>

                <span className={`mini-pill ${room.isBroadcasting ? "live" : "offline"}`}>
                  {room.isBroadcasting ? "ONLINE" : "OFFLINE"}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default LandingPage;
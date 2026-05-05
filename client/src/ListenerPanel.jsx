function ListenerPanel({
  roomId,
  setRoomId,
  joinRoom,
  leaveRoom,
  startListening,
  stopListening,
  currentRoom,
  isListening,
  members,
  message,
  remoteAudioRef,
  volume,
  setVolume,
  delayMs,
  setDelayMs
}) {
  return (
    <div>
      <h1>Sports Radio App</h1>

      <div style={{ marginBottom: "1rem" }}>
        <input
          type="text"
          placeholder="Enter room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          style={{ marginRight: "1rem", padding: "0.5rem" }}
        />

        <button onClick={joinRoom} style={{ marginRight: "1rem" }}>
          Join Room
        </button>

        <button onClick={leaveRoom} style={{ marginRight: "1rem" }}>
          Leave Room
        </button>

        <button onClick={startListening} style={{ marginRight: "1rem" }}>
          Start Listening
        </button>

        <button onClick={stopListening} style={{ marginRight: "1rem" }}>
          Stop Listening
        </button>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Current Room:</strong> {currentRoom || "None"}
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Role:</strong> listener
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Listening:</strong> {isListening ? "On" : "Off"}
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Volume:</strong> {Math.round(volume * 100)}%
        <br />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ width: "250px" }}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Delay:</strong> {delayMs} ms
        <br />
        <input
          type="range"
          min="0"
          max="3000"
          step="100"
          value={delayMs}
          onChange={(e) => setDelayMs(Number(e.target.value))}
          style={{ width: "250px" }}
        />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Members:</strong>
        <ul>
          {members.map((member, index) => (
            <li key={index}>{member}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Status:</strong> {message}
      </div>

      <audio ref={remoteAudioRef} autoPlay controls />
    </div>
  );
}

export default ListenerPanel;
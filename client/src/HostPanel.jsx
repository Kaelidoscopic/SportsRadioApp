function HostPanel({
  createRoom,
  leaveRoom,
  startMicrophone,
  stopMicrophone,
  copyRoomCode,
  shareRoomLink,
  currentRoom,
  isMicOn,
  members,
  message
}) {
  return (
    <div>
      <h1>Sports Radio App</h1>

      <div style={{ marginBottom: "1rem" }}>
        <button onClick={createRoom} style={{ marginRight: "1rem" }}>
          Create Room
        </button>

        <button onClick={leaveRoom} style={{ marginRight: "1rem" }}>
          Leave Room
        </button>

        <button onClick={startMicrophone} style={{ marginRight: "1rem" }}>
          Start Mic
        </button>

        <button onClick={stopMicrophone} style={{ marginRight: "1rem" }}>
          Stop Mic
        </button>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <button onClick={copyRoomCode} style={{ marginRight: "1rem" }}>
          Copy Room Code
        </button>

        <button onClick={shareRoomLink}>
          Copy Join Link
        </button>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Current Room:</strong> {currentRoom || "None"}
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Role:</strong> host
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <strong>Microphone:</strong> {isMicOn ? "On" : "Off"}
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
    </div>
  );
}

export default HostPanel;
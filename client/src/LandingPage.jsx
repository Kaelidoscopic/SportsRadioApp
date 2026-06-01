import { useState } from "react";
import QRScanner from "./QRScanner";

function LandingPage({
  roomId,
  setRoomId,
  createRoom,
  joinRoom,
  activeRooms = [],
  statusMessage,
  isSocketConnected,
  preferredMode = null
}) {
  const [mode, setMode] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const activeMode = mode || preferredMode;

  const savedHostCode = localStorage.getItem("venueAudioHostCode") || "";

  const cleanRoomCode = (code) => {
    return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  };

  const usePreviousCode = () => {
    if (!savedHostCode) return;
    setRoomId(savedHostCode);
  };

  const resetSavedHost = () => {
    localStorage.removeItem("venueAudioHostMode");
    localStorage.removeItem("venueAudioHostCode");
    localStorage.removeItem("venueAudioSourceType");
    localStorage.removeItem("venueAudioInputId");
    setRoomId("");
  };

  const handleCreateRoom = () => {
    const cleanCode = cleanRoomCode(roomId);
    setRoomId(cleanCode);
    createRoom(cleanCode);
  };

  const handleJoinRoom = () => {
    joinRoom(cleanRoomCode(roomId));
  };

  const handleJoinKeyDown = (e) => {
    if (e.key === "Enter") {
      handleJoinRoom();
    }
  };

  const handleScan = (decodedText) => {
    let scannedRoomCode = decodedText;

    try {
      const url = new URL(decodedText);
      scannedRoomCode = url.searchParams.get("room") || decodedText;
    } catch {
      scannedRoomCode = decodedText;
    }

    const cleanCode = cleanRoomCode(scannedRoomCode);

    setRoomId(cleanCode);
    setScannerOpen(false);

    setTimeout(() => {
      joinRoom(cleanCode);
    }, 0);
  };

  const openApplianceControl = () => {
    window.location.assign("/admin");
  };

  if (activeMode === "host") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card host-menu-card">
          <button className="back-button" onClick={() => setMode("menu")}>
            ← Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Host Audio</h1>
            <p className="app-subtitle">
              Create or recover a room for nearby listeners.
            </p>
          </div>

            {statusMessage && (
              <div className="status-banner">{statusMessage}</div>
            )}

          <div
            className={`connection-pill ${
              isSocketConnected ? "live" : "offline"
            }`}
          >
            {isSocketConnected ? "Server connected" : "Server disconnected"}
          </div>

          <div className="compact-actions">
            <div className="panel-card managed-host-panel">
              <div className="section-heading-row">
                <div>
                  <span className="metric-label">Physical Boxes</span>
                  <h2 className="section-title">Appliance Control</h2>
                </div>

                <div
                  className={`mini-pill ${
                    isSocketConnected ? "live" : "offline"
                  }`}
                >
                  {isSocketConnected ? "SERVER" : "OFFLINE"}
                </div>
              </div>

              <button
                className="primary-button"
                onClick={openApplianceControl}
                disabled={!isSocketConnected}
              >
                Manage Audio Boxes
              </button>

              <p className="small-note">
                Admin PIN required. Use this to control connected Raspberry Pi
                audio appliances.
              </p>
            </div>

            <div className="host-mode-divider">
              <span>Browser host mode</span>
            </div>

            <input
              className="room-input compact-input"
              type="text"
              placeholder="Optional room code"
              value={roomId}
              onChange={(e) => setRoomId(cleanRoomCode(e.target.value))}
            />

            {savedHostCode && (
              <button className="secondary-button" onClick={usePreviousCode}>
                Use Previous Code: {savedHostCode}
              </button>
            )}

            <button
              className="primary-button"
              onClick={handleCreateRoom}
              disabled={!isSocketConnected}
            >
              Start Room
            </button>

            <button className="ghost-button" onClick={resetSavedHost}>
              Reset Saved Host
            </button>

            <p className="small-note">
              Leave the code blank to generate a random one. Successful room
              codes are remembered so you can reuse them later.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (activeMode === "listener") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card compact-landing">
          <button className="back-button" onClick={() => setMode("menu")}>
            ← Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Join Audio</h1>
            <p className="app-subtitle">Enter a code or scan a QR code.</p>
          </div>

          {statusMessage && (
            <div className="status-banner">{statusMessage}</div>
          )}

          <div
            className={`connection-pill ${
              isSocketConnected ? "live" : "offline"
            }`}
          >
            {isSocketConnected ? "Server connected" : "Server disconnected"}
          </div>

          <div className="compact-actions">
            <input
              className="room-input compact-input"
              type="text"
              placeholder="Enter room code"
              value={roomId}
              onChange={(e) => setRoomId(cleanRoomCode(e.target.value))}
              onKeyDown={handleJoinKeyDown}
            />

            <button
              className="primary-button"
              onClick={handleJoinRoom}
              disabled={!isSocketConnected}
            >
              Join Audio
            </button>

            <button
              className="secondary-button"
              onClick={() => setScannerOpen(true)}
            >
              Scan QR Code
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
                  <span>
                    <span className="room-list-code">{room.roomId}</span>
                    {room.roomName && room.roomName !== room.roomId && (
                      <span className="room-list-name">{room.roomName}</span>
                    )}
                  </span>

                  <span
                    className={`mini-pill ${
                      room.isBroadcasting ? "live" : "offline"
                    }`}
                  >
                    {room.hostType === "appliance"
                      ? "PI"
                      : room.isBroadcasting
                        ? "ONLINE"
                        : "OFFLINE"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {scannerOpen && (
          <QRScanner
            onScan={handleScan}
            onClose={() => setScannerOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="main-card landing-card compact-landing">
        <div className="brand-block centered-brand">
          <h1 className="app-title">Venue Audio</h1>
          <p className="app-subtitle">Hear live audio from a nearby screen.</p>
        </div>

        {statusMessage && <div className="status-banner">{statusMessage}</div>}

        <div
          className={`connection-pill ${
            isSocketConnected ? "live" : "offline"
          }`}
        >
          {isSocketConnected ? "Server connected" : "Server disconnected"}
        </div>

        <div className="compact-actions">
          <button
            className="primary-button"
            onClick={() => {
              if (!roomId && savedHostCode) {
                setRoomId(savedHostCode);
              }

              setMode("host");
            }}
          >
            Host Audio
          </button>

          <button
            className="secondary-button"
            onClick={() => setMode("listener")}
          >
            Join Audio
          </button>
        </div>
      </div>
    </div>
  );
}

export default LandingPage;

import { useEffect, useState } from "react";
import QRScanner from "./QRScanner";

function LandingPage({
  roomId,
  setRoomId,
  createRoom,
  joinRoom,
  activeRooms = []
}) {
  const [mode, setMode] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const savedHostCode = localStorage.getItem("venueAudioHostCode") || "";

  useEffect(() => {
    const isHostDevice = localStorage.getItem("venueAudioHostMode") === "true";

    if (isHostDevice && savedHostCode) {
      setRoomId(savedHostCode);
      setMode("host");
    }
  }, [savedHostCode, setRoomId]);

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

  if (mode === "host") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card compact-landing">
          <button className="back-button" onClick={() => setMode(null)}>
            ← Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Host Audio</h1>
            <p className="app-subtitle">
              Create or recover a room for nearby listeners.
            </p>
          </div>

          <div className="compact-actions">
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

            <button className="primary-button" onClick={handleCreateRoom}>
              Start Room
            </button>

            <button className="ghost-button" onClick={resetSavedHost}>
              Reset Saved Host
            </button>

            <p className="small-note">
              Leave the code blank to generate a random one. After a room is
              created, you can save that active room as the host device from the
              host dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "listener") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card compact-landing">
          <button className="back-button" onClick={() => setMode(null)}>
            ← Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Join Audio</h1>
            <p className="app-subtitle">Enter a code or scan a QR code.</p>
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

            <button className="primary-button" onClick={handleJoinRoom}>
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
                  <span className="room-list-code">{room.roomId}</span>

                  <span
                    className={`mini-pill ${
                      room.isBroadcasting ? "live" : "offline"
                    }`}
                  >
                    {room.isBroadcasting ? "ONLINE" : "OFFLINE"}
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
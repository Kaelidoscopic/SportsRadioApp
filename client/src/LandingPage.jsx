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

  const saveHostCode = () => {
    const cleanCode = roomId.trim().toUpperCase();
    if (!cleanCode) return;

    localStorage.setItem("venueAudioHostCode", cleanCode);
    setRoomId(cleanCode);
  };

  const resetSavedHost = () => {
    localStorage.removeItem("venueAudioHostMode");
    localStorage.removeItem("venueAudioHostCode");
    localStorage.removeItem("venueAudioSourceType");
    localStorage.removeItem("venueAudioInputId");
    setRoomId("");
  };

  const handleCreateRoom = () => {
    saveHostCode();
    createRoom();
  };

  const handleSaveAsHostDevice = () => {
    saveHostCode();
    localStorage.setItem("venueAudioHostMode", "true");
  };

  const handleJoinKeyDown = (e) => {
    if (e.key === "Enter") {
      joinRoom();
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

    const cleanRoomCode = scannedRoomCode.trim().toUpperCase();

    setRoomId(cleanRoomCode);
    setScannerOpen(false);

    setTimeout(() => {
      joinRoom(cleanRoomCode);
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
              Create a room for nearby listeners.
            </p>
          </div>

          <div className="compact-actions">
            <input
              className="room-input compact-input"
              type="text"
              placeholder="Optional room code"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            />

            {savedHostCode && (
              <button
                className="secondary-button"
                onClick={() => setRoomId(savedHostCode)}
              >
                Use Saved Code: {savedHostCode}
              </button>
            )}

            <button
              className="ghost-button"
              onClick={saveHostCode}
              disabled={!roomId.trim()}
            >
              Save This Code
            </button>

            <button className="primary-button" onClick={handleCreateRoom}>
              Start Room
            </button>

            <button
              className="secondary-button"
              onClick={handleSaveAsHostDevice}
              disabled={!roomId.trim()}
            >
              Save as Host Device
            </button>

            <button className="ghost-button" onClick={resetSavedHost}>
              Reset Saved Host
            </button>

            <p className="small-note">
              Leave the code blank to generate a random one.
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
            <p className="app-subtitle">
              Enter a code or scan a QR code.
            </p>
          </div>

          <div className="compact-actions">
            <input
              className="room-input compact-input"
              type="text"
              placeholder="Enter room code"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              onKeyDown={handleJoinKeyDown}
            />

            <button className="primary-button" onClick={joinRoom}>
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
          <p className="app-subtitle">
            Hear live audio from a nearby screen.
          </p>
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
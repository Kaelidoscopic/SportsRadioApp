import QRScanner from "./QRScanner";
import { useEffect, useState } from "react";

function LandingPage({ roomId, setRoomId, createRoom, joinRoom }) {
  const [mode, setMode] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const savedHostCode = localStorage.getItem("venueAudioHostCode") || "";
  const [autoCreateAttempted, setAutoCreateAttempted] = useState(false);

  const handleJoinKeyDown = (e) => {
    if (e.key === "Enter") {
      joinRoom();
    }
  };

  const handleScan = (decodedText) => {
    try {
      const url = new URL(decodedText);
      const roomFromQr = url.searchParams.get("room");

      if (roomFromQr) {
        setRoomId(roomFromQr.toUpperCase());
        setScannerOpen(false);
        setTimeout(() => joinRoom(roomFromQr), 0);
        return;
      }
    } catch {
      // QR may just be a plain room code
    }

    setRoomId(decodedText.toUpperCase());
    setScannerOpen(false);
    setTimeout(() => joinRoom(decodedText), 0);
  };

  const saveHostCode = () => {
    if (!roomId.trim()) return;

    localStorage.setItem("venueAudioHostCode", roomId.trim().toUpperCase());
  };

  useEffect(() => {
    const isHostDevice = localStorage.getItem("venueAudioHostMode") === "true";
    const savedCode = localStorage.getItem("venueAudioHostCode");

    if (isHostDevice && savedCode) {
      setRoomId(savedCode);
      setMode("host");
    }
  }, []);

  useEffect(() => {
    const isHostDevice = localStorage.getItem("venueAudioHostMode") === "true";
    const savedCode = localStorage.getItem("venueAudioHostCode");

    if (
      mode === "host" &&
      isHostDevice &&
      savedCode &&
      !autoCreateAttempted
    ) {
      setAutoCreateAttempted(true);

      setTimeout(() => {
        createRoom(savedCode);
      }, 300);
    }
  }, [mode, autoCreateAttempted, createRoom]);

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
              Create a room for people nearby to join.
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

            <p className="small-note">
              Leave the code blank to generate a random one.
            </p>

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

            <button
              className="primary-button"
              onClick={() => {
                saveHostCode();
                createRoom();
              }}
            >
              Start Room
            </button>

            <button
              className="secondary-button"
              onClick={() => {
                saveHostCode();
                localStorage.setItem("venueAudioHostMode", "true");
                createRoom();
              }}
            >
              Save as Host Device
            </button>

            <p className="small-note">
              Saved host devices will reopen this screen and create the room automatically.
            </p>

            <button
              className="ghost-button"
              onClick={() => {
                localStorage.removeItem("venueAudioHostMode");
                localStorage.removeItem("venueAudioHostCode");
                localStorage.removeItem("venueAudioSourceType");
                localStorage.removeItem("venueAudioInputId");
                setRoomId("");
              }}
            >
              Reset Saved Host
            </button>
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
              Enter a room code or scan a QR code.
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

            <button className="secondary-button" onClick={() => setScannerOpen(true)}>
              Scan QR Code
            </button>
          </div>
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

          <button className="secondary-button" onClick={() => setMode("listener")}>
            Join Audio
          </button>
        </div>
      </div>
    </div>
  );
}

export default LandingPage;
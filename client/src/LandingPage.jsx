import QRScanner from "./QRScanner";
import { useState } from "react";

function LandingPage({ roomId, setRoomId, createRoom, joinRoom }) {
  const [scannerOpen, setScannerOpen] = useState(false);

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      joinRoom();
    }
  };

  const handleScan = (decodedText) => {
    try {
      const url = new URL(decodedText);
      const roomFromQr = url.searchParams.get("room");

      if (roomFromQr) {
        setRoomId(roomFromQr);
        setScannerOpen(false);
        setTimeout(() => joinRoom(roomFromQr), 0);
        return;
      }
    } catch {
      // If QR is just the raw room code
    }

    setRoomId(decodedText);
    setScannerOpen(false);
    setTimeout(() => joinRoom(decodedText), 0);
  };

  return (
    <div className="page-shell">
      <div className="main-card landing-card compact-landing">
        <div className="brand-block centered-brand">
          <h1 className="app-title">Venue Audio</h1>
          <p className="app-subtitle">Hear live audio from a nearby screen.</p>
        </div>

        <div className="compact-actions">
          <button className="primary-button" onClick={createRoom}>
            Start a Room
          </button>

          <div className="join-divider">or</div>

          <input
            className="room-input compact-input"
            type="text"
            placeholder="Enter or create room code"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value.toUpperCase())}
            onKeyDown={handleKeyDown}
          />

          <button className="secondary-button" onClick={joinRoom}>
            Join Audio
          </button>

          <button className="ghost-button" onClick={() => setScannerOpen(true)}>
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

export default LandingPage;
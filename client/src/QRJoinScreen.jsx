import { QRCodeSVG } from "qrcode.react";

function QRJoinScreen({ roomCode, joinUrl }) {
  if (!roomCode || !joinUrl) return null;

  return (
    <div className="qr-join-card">
      <div className="qr-box">
        <QRCodeSVG value={joinUrl} size={180} />
      </div>

      <div className="qr-join-details">
        <span className="metric-label">Room Code</span>
        <span className="qr-join-code">{roomCode}</span>
        <span className="metric-label">Join URL</span>
        <span className="qr-join-url">{joinUrl}</span>
      </div>
    </div>
  );
}

export default QRJoinScreen;

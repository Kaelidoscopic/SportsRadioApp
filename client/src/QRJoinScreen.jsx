import { QRCodeSVG } from "qrcode.react";

function QRJoinScreen({ roomCode, joinUrl, variant = "default" }) {
  if (!roomCode || !joinUrl) return null;

  const qrSize = variant === "print" ? 260 : 180;

  return (
    <div className={`qr-join-card ${variant === "print" ? "print-qr-card" : ""}`}>
      <div className="qr-box">
        <QRCodeSVG value={joinUrl} size={qrSize} />
      </div>

      {variant !== "print" && (
        <div className="qr-join-details">
          <span className="metric-label">Room Code</span>
          <span className="qr-join-code">{roomCode}</span>
          <span className="metric-label">Join URL</span>
          <span className="qr-join-url">{joinUrl}</span>
        </div>
      )}
    </div>
  );
}

export default QRJoinScreen;

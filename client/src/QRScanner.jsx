import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";

function QRScanner({ onScan, onClose }) {
  const scannerRef = useRef(null);

  useEffect(() => {
    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
          onScan(decodedText);
        },
        () => {}
      )
      .catch((err) => {
        console.error("QR scanner failed:", err);
      });

    return () => {
      scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => {});
    };
  }, [onScan]);

  return (
    <div className="scanner-overlay">
      <div className="scanner-card">
        <div id="qr-reader" />
        <button className="ghost-button" onClick={onClose}>
          Close Scanner
        </button>
      </div>
    </div>
  );
}

export default QRScanner;
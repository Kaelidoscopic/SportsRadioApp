import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

function QRScanner({ onScan, onClose }) {
  const scannerRef = useRef(null);
  const hasClosedRef = useRef(false);
  const [scannerError, setScannerError] = useState("");

  const stopScanner = async () => {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;

    try {
      const scanner = scannerRef.current;

      if (scanner) {
        await scanner.stop();
        await scanner.clear();
      }
    } catch {
      // Scanner may already be stopped. Safe to ignore.
    }

    onClose();
  };

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
        async (decodedText) => {
          await stopScanner();
          onScan(decodedText);
        },
        () => {}
      )
      .catch((err) => {
        console.error("QR scanner failed:", err);
        setScannerError("Camera could not be started.");
      });

    return () => {
      if (scannerRef.current && !hasClosedRef.current) {
        scannerRef.current
          .stop()
          .then(() => scannerRef.current.clear())
          .catch(() => {});
      }
    };
  }, []);

  return (
    <div className="scanner-overlay">
      <div className="scanner-card">
        <div id="qr-reader" />

        {scannerError && <p className="small-warning">{scannerError}</p>}

        <button className="ghost-button" onClick={stopScanner}>
          Close Scanner
        </button>
      </div>
    </div>
  );
}

export default QRScanner;
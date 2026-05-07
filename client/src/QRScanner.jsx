import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

function QRScanner({ onScan, onClose }) {
  const scannerElementId = useId().replace(/:/g, "");
  const scannerRef = useRef(null);
  const isMountedRef = useRef(false);
  const hasClosedRef = useRef(false);
  const onScanRef = useRef(onScan);
  const onCloseRef = useRef(onClose);
  const [scannerError, setScannerError] = useState("");

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const cleanupScanner = useCallback(async () => {
    try {
      const scanner = scannerRef.current;

      if (scanner) {
        if (scanner.isScanning) {
          await scanner.stop();
        }

        await scanner.clear();
      }
    } catch {
      // Scanner may already be stopped. Safe to ignore.
    } finally {
      scannerRef.current = null;
    }
  }, []);

  const closeScanner = useCallback(async () => {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;

    await cleanupScanner();
    onCloseRef.current();
  }, [cleanupScanner]);

  const completeScan = useCallback(async (decodedText) => {
    if (hasClosedRef.current) return;
    hasClosedRef.current = true;

    await cleanupScanner();
    onScanRef.current(decodedText);
  }, [cleanupScanner]);

  const stopScanner = () => {
    void closeScanner();
  };

  useEffect(() => {
    isMountedRef.current = true;

    const scanner = new Html5Qrcode(scannerElementId);
    scannerRef.current = scanner;

    const startScanner = async () => {
      try {
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          (decodedText) => {
            void completeScan(decodedText);
          },
          () => {}
        );
      } catch (err) {
        console.error("QR scanner failed:", err);

        if (isMountedRef.current && !hasClosedRef.current) {
          setScannerError("Camera could not be started.");
        }
      }
    };

    void startScanner();

    return () => {
      isMountedRef.current = false;

      if (!hasClosedRef.current) {
        hasClosedRef.current = true;
        void cleanupScanner();
      }
    };
  }, [cleanupScanner, completeScan, scannerElementId]);

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true">
      <div className="scanner-card">
        <div id={scannerElementId} />

        {scannerError && <p className="small-warning">{scannerError}</p>}

        <button className="ghost-button" onClick={stopScanner}>
          Close Scanner
        </button>
      </div>
    </div>
  );
}

export default QRScanner;

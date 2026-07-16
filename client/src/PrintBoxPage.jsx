import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

const authTokenKey = "sportsAudioAuthToken";
const authUserKey = "sportsAudioAuthUser";
const printPayloadPrefix = "sportsAudioPrintBox:";

const getApiUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) return import.meta.env.VITE_BACKEND_URL;
  if (import.meta.env.DEV) return "http://localhost:5000";
  return "";
};

const readSavedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(authUserKey) || "null");
  } catch {
    return null;
  }
};

const readStoredPrintPayload = (storageKey) => {
  const storedPayload =
    sessionStorage.getItem(storageKey) || localStorage.getItem(storageKey);

  if (!storedPayload) return null;

  try {
    return JSON.parse(storedPayload);
  } catch {
    sessionStorage.removeItem(storageKey);
    localStorage.removeItem(storageKey);
    return null;
  }
};

function PrintBoxPage() {
  const boxId = decodeURIComponent(
    window.location.pathname.replace(/^\/print\/box\//, "").split("/")[0] || ""
  );
  const shouldAutoPrint =
    new URLSearchParams(window.location.search).get("print") === "true";
  const frontendUrl =
    import.meta.env.VITE_FRONTEND_URL || window.location.origin;
  const storageKey = useMemo(() => `${printPayloadPrefix}${boxId}`, [boxId]);
  const [payload, setPayload] = useState(() => readStoredPrintPayload(storageKey));
  const [message, setMessage] = useState(() => {
    if (readStoredPrintPayload(storageKey)) return "";
    if (!localStorage.getItem(authTokenKey) || !boxId) {
      return "Open this page from My Audio Boxes to print the QR code.";
    }
    return "Loading print sign...";
  });

  useEffect(() => {
    if (payload) return;

    const token = localStorage.getItem(authTokenKey);

    if (!token || !boxId) {
      return;
    }

    fetch(`${getApiUrl()}/api/my/appliances/${encodeURIComponent(boxId)}`, {
      headers: { authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Unable to load box.");
        return data.appliance;
      })
      .then((box) => {
        const user = readSavedUser();
        setPayload({
          boxId: box.applianceId,
          boxName: box.sourceName || box.roomName || box.displayName || box.applianceId,
          venueName: user?.displayName || "SyncLink Venue",
          nowPlaying: box.nowPlaying || "",
          roomCode: box.roomCode || "",
          joinUrl: box.roomCode
            ? `${frontendUrl}/?room=${encodeURIComponent(box.roomCode)}`
            : ""
        });
        setMessage("");
      })
      .catch((error) => setMessage(error.message));
  }, [boxId, frontendUrl, payload]);

  useEffect(() => {
    if (!shouldAutoPrint || !payload?.roomCode || !payload?.joinUrl) return undefined;

    const printTimer = window.setTimeout(() => {
      window.print();
    }, 450);

    return () => window.clearTimeout(printTimer);
  }, [payload, shouldAutoPrint]);

  const goBackToDashboard = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.location.assign("/");
  };

  if (message) {
    return (
      <main className="print-page">
        <div className="print-page-actions">
          <button className="secondary-button" onClick={goBackToDashboard}>
            Back to Dashboard
          </button>
          <button className="primary-button" onClick={() => window.print()}>
            Print QR Code
          </button>
        </div>

        <section className="print-sign-card">
          <div className="print-brand visible-print-text">SyncLink</div>
          <p className="print-message">{message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="print-page">
      <div className="print-page-actions">
        <button className="secondary-button" onClick={goBackToDashboard}>
          Back to Dashboard
        </button>
        <button className="primary-button" onClick={() => window.print()}>
          Print QR Code
        </button>
      </div>

      <section className="print-sign-card">
        <div className="print-brand visible-print-text">SyncLink</div>
        <h1 className="print-title visible-print-text">Listen to this TV Audio</h1>
        <div className="print-source-name visible-print-text">{payload.boxName}</div>
        <div className="print-venue-name visible-print-text">{payload.venueName}</div>
        {payload.nowPlaying && (
          <div className="print-now-playing visible-print-text">{payload.nowPlaying}</div>
        )}

        <div className="print-page-qr-box">
          <QRCodeSVG value={payload.joinUrl} size={320} />
        </div>

        <div className="print-room-code visible-print-text">{payload.roomCode}</div>
        <p className="print-instruction visible-print-text">
          Scan this QR code or enter the room code to listen.
        </p>
        <p className="print-sub-instruction visible-print-text">
          Open SyncLink - Join Audio - Enter Room Code
        </p>
      </section>
    </main>
  );
}

export default PrintBoxPage;

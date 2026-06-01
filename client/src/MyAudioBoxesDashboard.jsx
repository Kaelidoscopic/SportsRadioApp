import { useCallback, useEffect, useState } from "react";

const getApiUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) return import.meta.env.VITE_BACKEND_URL;
  if (import.meta.env.DEV) return "http://localhost:5000";
  return "";
};

const cleanRoomCode = (code) =>
  String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

function MyAudioBoxesDashboard({ isSocketConnected, onBack }) {
  const [pin, setPin] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [boxes, setBoxes] = useState([]);
  const [selectedBoxId, setSelectedBoxId] = useState("");
  const [edits, setEdits] = useState({});
  const [message, setMessage] = useState("Sign in is a Phase 1 placeholder. Use the admin PIN to manage boxes.");
  const [setupRequired, setSetupRequired] = useState(false);
  const apiUrl = getApiUrl();

  const selectedBox = boxes.find((box) => box.applianceId === selectedBoxId);

  const adminFetch = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${apiUrl}${path}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          "x-admin-pin": pin.trim(),
          ...(options.headers || {})
        }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSetupRequired(response.status === 503);
        throw new Error(data.error || "Admin request failed.");
      }

      setSetupRequired(false);
      return data;
    },
    [apiUrl, pin]
  );

  const syncEdits = (nextBoxes) => {
    setEdits((current) => {
      const next = { ...current };

      nextBoxes.forEach((box) => {
        if (!next[box.applianceId]) {
          next[box.applianceId] = {
            displayName: box.displayName || "",
            roomName: box.roomName || "",
            roomCode: box.roomCode || "",
            isPublic: box.isPublic !== false
          };
        }
      });

      return next;
    });
  };

  const refreshBoxes = useCallback(async () => {
    const data = await adminFetch("/api/appliances");
    const nextBoxes = data.appliances || [];

    setBoxes(nextBoxes);
    syncEdits(nextBoxes);
    setIsUnlocked(true);
    setMessage(
      nextBoxes.length
        ? "My Audio Boxes loaded."
        : "No boxes have checked in yet."
    );
  }, [adminFetch]);

  useEffect(() => {
    if (!isUnlocked) return undefined;

    const timer = window.setInterval(() => {
      refreshBoxes().catch((error) => setMessage(error.message));
    }, 5000);

    return () => window.clearInterval(timer);
  }, [isUnlocked, refreshBoxes]);

  const unlock = () => {
    if (!pin.trim()) {
      setMessage("Enter the admin PIN.");
      return;
    }

    refreshBoxes().catch((error) => setMessage(error.message));
  };

  const updateEdit = (applianceId, key, value) => {
    setEdits((current) => ({
      ...current,
      [applianceId]: {
        ...(current[applianceId] || {}),
        [key]: key === "roomCode" ? cleanRoomCode(value) : value
      }
    }));
  };

  const saveSettings = async (applianceId) => {
    try {
      await adminFetch(`/api/appliances/${applianceId}/settings`, {
        method: "PATCH",
        body: JSON.stringify(edits[applianceId] || {})
      });
      setMessage("Box settings saved.");
      await refreshBoxes();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const sendCommand = async (applianceId, action, successMessage) => {
    try {
      await adminFetch(`/api/appliances/${applianceId}/${action}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage(successMessage);
      await refreshBoxes();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const renderBoxCard = (box) => (
    <button
      className="smart-box-card"
      key={box.applianceId}
      onClick={() => setSelectedBoxId(box.applianceId)}
    >
      <div className="smart-box-topline">
        <span className="smart-box-name">{box.displayName || box.applianceId}</span>
        <span className={`mini-pill ${box.isOnline ? "live" : "offline"}`}>
          {box.isOnline ? "ONLINE" : "OFFLINE"}
        </span>
      </div>

      <span className="room-list-name">{box.roomName || "Audio Room"}</span>

      <div className="smart-box-code">{box.roomCode || "----"}</div>

      <div className="smart-box-stats">
        <span>{box.isAudioEnabled ? "Audio On" : "Audio Off"}</span>
        <span>{box.isRoomActive ? "Room Active" : "Room Inactive"}</span>
        <span>{box.listenerCount || 0} listening</span>
      </div>

      <div className="smart-box-actions" onClick={(event) => event.stopPropagation()}>
        <button
          className="secondary-button"
          onClick={() =>
            sendCommand(
              box.applianceId,
              box.isAudioEnabled ? "stop-audio" : "start-audio",
              box.isAudioEnabled ? "Audio stop command sent." : "Audio start command sent."
            )
          }
          disabled={!box.isOnline}
        >
          {box.isAudioEnabled ? "Turn Audio Off" : "Turn Audio On"}
        </button>
        <button
          className="ghost-button"
          onClick={() =>
            sendCommand(
              box.applianceId,
              box.isRoomActive ? "deactivate-room" : "activate-room",
              box.isRoomActive ? "Room deactivate command sent." : "Room activate command sent."
            )
          }
          disabled={!box.isOnline}
        >
          {box.isRoomActive ? "Deactivate" : "Activate"}
        </button>
      </div>
    </button>
  );

  return (
    <div className="page-shell">
      <div className="main-card boxes-dashboard-card">
        <button className="back-button" onClick={onBack}>
          Back
        </button>

        <div className="dashboard-header">
          <div>
            <span className="metric-label">Host / Manage Boxes</span>
            <h1 className="app-title">My Audio Boxes</h1>
            <p className="app-subtitle">
              Manage physical TV audio appliances from one dashboard.
            </p>
          </div>

          <div className={`connection-pill ${isSocketConnected ? "live" : "offline"}`}>
            {isSocketConnected ? "Server connected" : "Server disconnected"}
          </div>
        </div>

        {message && (
          <div className={`status-banner ${setupRequired ? "warning-banner" : ""}`}>
            {message}
          </div>
        )}

        {!isUnlocked ? (
          <div className="panel-card auth-panel">
            <h2 className="section-title">Login / Sign Up</h2>
            <p className="small-note">
              Full accounts come in Phase 2. For Phase 1, unlock appliance
              management with the backend admin PIN.
            </p>

            {setupRequired && (
              <p className="small-warning">
                Set ADMIN_PIN in the backend environment, then restart the backend.
              </p>
            )}

            <input
              className="room-input compact-input"
              type="password"
              placeholder="Admin PIN"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") unlock();
              }}
            />

            <button
              className="primary-button"
              onClick={unlock}
              disabled={!isSocketConnected}
            >
              Open My Audio Boxes
            </button>
          </div>
        ) : selectedBox ? (
          <div className="box-settings-layout">
            <button
              className="ghost-button"
              onClick={() => setSelectedBoxId("")}
            >
              All Boxes
            </button>

            <div className="panel-card appliance-card">
              <div className="appliance-card-header">
                <div>
                  <span className="metric-label">Box Settings</span>
                  <div className="appliance-title">
                    {selectedBox.displayName || selectedBox.applianceId}
                  </div>
                </div>
                <span className={`mini-pill ${selectedBox.isOnline ? "live" : "offline"}`}>
                  {selectedBox.isOnline ? "ONLINE" : "OFFLINE"}
                </span>
              </div>

              <div className="admin-control-stack">
                <input
                  className="room-input"
                  placeholder="Box display name"
                  value={edits[selectedBox.applianceId]?.displayName || ""}
                  onChange={(event) =>
                    updateEdit(selectedBox.applianceId, "displayName", event.target.value)
                  }
                />
                <input
                  className="room-input"
                  placeholder="Room name"
                  value={edits[selectedBox.applianceId]?.roomName || ""}
                  onChange={(event) =>
                    updateEdit(selectedBox.applianceId, "roomName", event.target.value)
                  }
                />
                <input
                  className="room-input compact-input"
                  placeholder="Room code"
                  value={edits[selectedBox.applianceId]?.roomCode || ""}
                  onChange={(event) =>
                    updateEdit(selectedBox.applianceId, "roomCode", event.target.value)
                  }
                />

                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={edits[selectedBox.applianceId]?.isPublic !== false}
                    onChange={(event) =>
                      updateEdit(selectedBox.applianceId, "isPublic", event.target.checked)
                    }
                  />
                  Public room listing
                </label>

                <button
                  className="secondary-button"
                  onClick={() => saveSettings(selectedBox.applianceId)}
                  disabled={!selectedBox.isOnline}
                >
                  Save Settings
                </button>
              </div>
            </div>

            <div className="status-grid">
              <div className="metric-card">
                <span className="metric-label">Audio</span>
                <span className="metric-value compact-value">
                  {selectedBox.isAudioEnabled ? "On" : "Off"}
                </span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Room</span>
                <span className="metric-value compact-value">
                  {selectedBox.isRoomActive ? "Active" : "Inactive"}
                </span>
              </div>
              <div className="metric-card">
                <span className="metric-label">Backend</span>
                <span className="metric-value compact-value">
                  {isSocketConnected ? "Connected" : "Offline"}
                </span>
              </div>
            </div>

            <div className="share-actions">
              <button
                className="primary-button"
                onClick={() =>
                  sendCommand(selectedBox.applianceId, "start-audio", "Audio start command sent.")
                }
                disabled={!selectedBox.isOnline}
              >
                Start Audio
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  sendCommand(selectedBox.applianceId, "stop-audio", "Audio stop command sent.")
                }
                disabled={!selectedBox.isOnline}
              >
                Stop Audio
              </button>
              <button
                className="primary-button"
                onClick={() =>
                  sendCommand(selectedBox.applianceId, "activate-room", "Room activate command sent.")
                }
                disabled={!selectedBox.isOnline}
              >
                Activate Room
              </button>
              <button
                className="secondary-button"
                onClick={() =>
                  sendCommand(selectedBox.applianceId, "deactivate-room", "Room deactivate command sent.")
                }
                disabled={!selectedBox.isOnline}
              >
                Deactivate Room
              </button>
            </div>

            <div className="panel-card">
              <h2 className="section-title">Diagnostics</h2>
              <div className="diagnostic-list">
                <span>ID: {selectedBox.applianceId}</span>
                <span>Last heartbeat: {selectedBox.lastHeartbeat ? new Date(selectedBox.lastHeartbeat).toLocaleString() : "Never"}</span>
                <span>Current audio device: reported by Pi logs</span>
                <span>Uptime: tracked by appliance service</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="boxes-grid">
              {boxes.length === 0 ? (
                <div className="panel-card">
                  <p className="small-note">
                    No boxes are registered yet. Start the Pi appliance and refresh.
                  </p>
                </div>
              ) : (
                boxes.map(renderBoxCard)
              )}
            </div>

            <button className="ghost-button" onClick={() => refreshBoxes().catch((error) => setMessage(error.message))}>
              Refresh Boxes
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default MyAudioBoxesDashboard;

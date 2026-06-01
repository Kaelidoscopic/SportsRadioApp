import { useCallback, useEffect, useState } from "react";

const getApiUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }

  if (import.meta.env.DEV) {
    return "http://localhost:5000";
  }

  return "";
};

const cleanRoomCode = (code) =>
  String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

function ApplianceAdminPage({ isSocketConnected }) {
  const [pin, setPin] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [appliances, setAppliances] = useState([]);
  const [message, setMessage] = useState("Enter admin PIN.");
  const [setupRequired, setSetupRequired] = useState(false);
  const [edits, setEdits] = useState({});
  const apiUrl = getApiUrl();

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
        const isSetupMessage = response.status === 503;
        setSetupRequired(isSetupMessage);
        throw new Error(data.error || "Admin request failed.");
      }

      setSetupRequired(false);
      return data;
    },
    [apiUrl, pin]
  );

  const syncEdits = (nextAppliances) => {
    setEdits((current) => {
      const next = { ...current };

      nextAppliances.forEach((appliance) => {
        if (!next[appliance.applianceId]) {
          next[appliance.applianceId] = {
            displayName: appliance.displayName || "",
            roomName: appliance.roomName || "",
            roomCode: appliance.roomCode || ""
          };
        }
      });

      return next;
    });
  };

  const refreshAppliances = useCallback(async () => {
    try {
      const data = await adminFetch("/api/appliances");
      const nextAppliances = data.appliances || [];
      setAppliances(nextAppliances);
      syncEdits(nextAppliances);
      setIsAuthenticated(true);
      setMessage(
        nextAppliances.length
          ? "Admin controls unlocked."
          : "Admin controls unlocked. No appliances have checked in yet."
      );
    } catch (error) {
      setIsAuthenticated(false);
      setMessage(error.message);
    }
  }, [adminFetch]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const timer = window.setInterval(refreshAppliances, 5000);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, refreshAppliances]);

  const authenticate = () => {
    if (!pin.trim()) {
      setMessage("Enter admin PIN.");
      return;
    }

    refreshAppliances();
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
      const payload = edits[applianceId] || {};
      await adminFetch(`/api/appliances/${applianceId}/settings`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      setMessage("Settings command sent.");
      await refreshAppliances();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const sendCommand = async (applianceId, command, successMessage) => {
    try {
      await adminFetch(`/api/appliances/${applianceId}/${command}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage(successMessage);
      await refreshAppliances();
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <div className="page-shell">
      <div className="main-card admin-card">
        <div className="brand-block centered-brand">
          <h1 className="app-title">Appliance Control</h1>
          <p className="app-subtitle">Manage Raspberry Pi audio boxes.</p>
        </div>

        {message && (
          <div className={`status-banner ${setupRequired ? "warning-banner" : ""}`}>
            {message}
          </div>
        )}

        <div
          className={`connection-pill ${isSocketConnected ? "live" : "offline"}`}
        >
          {isSocketConnected ? "Server connected" : "Server disconnected"}
        </div>

        {!isAuthenticated ? (
          <div className="compact-actions">
            {setupRequired && (
              <p className="small-warning">
                Set ADMIN_PIN in the backend environment, then restart the
                backend.
              </p>
            )}

            <input
              className="room-input compact-input"
              type="password"
              placeholder="Admin PIN"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") authenticate();
              }}
            />

            <button
              className="primary-button"
              onClick={authenticate}
              disabled={!isSocketConnected}
            >
              Unlock Controls
            </button>
          </div>
        ) : (
          <div className="appliance-grid">
            {appliances.length === 0 && (
              <div className="panel-card">
                <p className="small-note">No appliances have checked in yet.</p>
              </div>
            )}

            {appliances.map((appliance) => {
              const edit = edits[appliance.applianceId] || {};

              return (
                <div
                  className="panel-card appliance-card"
                  key={appliance.applianceId}
                >
                  <div className="appliance-card-header">
                    <div>
                      <span className="metric-label">Appliance</span>
                      <div className="appliance-title">
                        {appliance.displayName || appliance.applianceId}
                      </div>
                    </div>

                    <div
                      className={`mini-pill ${
                        appliance.isOnline ? "live" : "offline"
                      }`}
                    >
                      {appliance.isOnline ? "ONLINE" : "OFFLINE"}
                    </div>
                  </div>

                  <div className="admin-metrics">
                    <div>
                      <span className="metric-label">Room Code</span>
                      <span className="metric-value">
                        {appliance.roomCode || "----"}
                      </span>
                    </div>
                    <div>
                      <span className="metric-label">Room Name</span>
                      <span className="metric-value compact-value">
                        {appliance.roomName || "Unnamed"}
                      </span>
                    </div>
                    <div>
                      <span className="metric-label">Audio</span>
                      <span className="metric-value compact-value">
                        {appliance.isAudioEnabled ? "On" : "Off"}
                      </span>
                    </div>
                    <div>
                      <span className="metric-label">Room</span>
                      <span className="metric-value compact-value">
                        {appliance.isRoomActive ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <div>
                      <span className="metric-label">Listeners</span>
                      <span className="metric-value">
                        {appliance.listenerCount || 0}
                      </span>
                    </div>
                    <div>
                      <span className="metric-label">Heartbeat</span>
                      <span className="metric-value compact-value">
                        {appliance.lastHeartbeat
                          ? new Date(appliance.lastHeartbeat).toLocaleTimeString()
                          : "Never"}
                      </span>
                    </div>
                  </div>

                  <div className="admin-control-stack">
                    <input
                      className="room-input"
                      placeholder="Display name"
                      value={edit.displayName || ""}
                      onChange={(event) =>
                        updateEdit(
                          appliance.applianceId,
                          "displayName",
                          event.target.value
                        )
                      }
                    />

                    <input
                      className="room-input"
                      placeholder="Room name"
                      value={edit.roomName || ""}
                      onChange={(event) =>
                        updateEdit(
                          appliance.applianceId,
                          "roomName",
                          event.target.value
                        )
                      }
                    />

                    <input
                      className="room-input compact-input"
                      placeholder="Room code"
                      value={edit.roomCode || ""}
                      onChange={(event) =>
                        updateEdit(
                          appliance.applianceId,
                          "roomCode",
                          event.target.value
                        )
                      }
                    />

                    <button
                      className="secondary-button"
                      onClick={() => saveSettings(appliance.applianceId)}
                      disabled={!appliance.isOnline}
                    >
                      Save Settings
                    </button>

                    <div className="share-actions">
                      <button
                        className="primary-button"
                        onClick={() =>
                          sendCommand(
                            appliance.applianceId,
                            "start-audio",
                            "Start audio command sent."
                          )
                        }
                        disabled={!appliance.isOnline}
                      >
                        Start Audio
                      </button>

                      <button
                        className="secondary-button"
                        onClick={() =>
                          sendCommand(
                            appliance.applianceId,
                            "stop-audio",
                            "Stop audio command sent."
                          )
                        }
                        disabled={!appliance.isOnline}
                      >
                        Stop Audio
                      </button>
                    </div>

                    <div className="share-actions">
                      <button
                        className="primary-button"
                        onClick={() =>
                          sendCommand(
                            appliance.applianceId,
                            "activate-room",
                            "Activate room command sent."
                          )
                        }
                        disabled={!appliance.isOnline}
                      >
                        Activate Room
                      </button>

                      <button
                        className="secondary-button"
                        onClick={() =>
                          sendCommand(
                            appliance.applianceId,
                            "deactivate-room",
                            "Deactivate room command sent."
                          )
                        }
                        disabled={!appliance.isOnline}
                      >
                        Deactivate Room
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApplianceAdminPage;

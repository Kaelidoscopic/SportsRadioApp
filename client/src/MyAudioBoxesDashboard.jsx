import { useCallback, useEffect, useState } from "react";
const authTokenKey = "sportsAudioAuthToken";
const authUserKey = "sportsAudioAuthUser";
const printPayloadPrefix = "sportsAudioPrintBox:";

const getApiUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) return import.meta.env.VITE_BACKEND_URL;
  if (import.meta.env.DEV) return "http://localhost:5000";
  return "";
};

const cleanRoomCode = (code) =>
  String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const readSavedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(authUserKey) || "null");
  } catch {
    return null;
  }
};

function MyAudioBoxesDashboard({ isSocketConnected, onBack }) {
  const [token, setToken] = useState(localStorage.getItem(authTokenKey) || "");
  const [user, setUser] = useState(readSavedUser());
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    displayName: "",
    email: "",
    password: ""
  });
  const [useAdminFallback, setUseAdminFallback] = useState(false);
  const [pin, setPin] = useState("");
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [boxes, setBoxes] = useState([]);
  const [selectedBoxId, setSelectedBoxId] = useState("");
  const [edits, setEdits] = useState({});
  const [message, setMessage] = useState("Log in or sign up to manage your audio boxes.");
  const [setupRequired, setSetupRequired] = useState(false);
  const apiUrl = getApiUrl();
  const frontendUrl =
    import.meta.env.VITE_FRONTEND_URL || window.location.origin;

  const selectedBox = boxes.find((box) => box.applianceId === selectedBoxId);
  const isUnlocked = Boolean(token && user) || adminUnlocked;

  const getJoinUrl = (box) => {
    if (!box?.roomCode) return "";
    return `${frontendUrl}/?room=${encodeURIComponent(box.roomCode)}`;
  };

  const getBoxSourceName = (box) =>
    box?.displayName || box?.roomName || box?.applianceId || "Audio Box";

  const getVenueName = () => user?.displayName || "SyncLink Venue";

  const request = useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${apiUrl}${path}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(options.headers || {})
        }
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Request failed.");
      }

      return data;
    },
    [apiUrl, token]
  );

  const adminRequest = useCallback(
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

  const activeRequest = useAdminFallback ? adminRequest : request;
  const applianceBasePath = useAdminFallback ? "/api/appliances" : "/api/my/appliances";

  const saveSession = useCallback((nextToken, nextUser) => {
    localStorage.setItem(authTokenKey, nextToken);
    localStorage.setItem(authUserKey, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(authTokenKey);
    localStorage.removeItem(authUserKey);
    setToken("");
    setUser(null);
    setBoxes([]);
    setSelectedBoxId("");
    setMessage("Signed out.");
  }, []);

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
    const data = await activeRequest(applianceBasePath);
    const nextBoxes = data.appliances || [];

    setBoxes(nextBoxes);
    syncEdits(nextBoxes);
    setMessage(
      nextBoxes.length
        ? "My Audio Boxes loaded."
        : useAdminFallback
          ? "No boxes have checked in yet."
          : "No boxes linked yet. Enter a pairing code to add one."
    );
  }, [activeRequest, applianceBasePath, useAdminFallback]);

  useEffect(() => {
    if (!token) return;

    request("/api/auth/me")
      .then((data) => {
        saveSession(token, data.user);
      })
      .catch(() => {
        clearSession();
      });
  }, [clearSession, request, saveSession, token]);

  useEffect(() => {
    if (!isUnlocked) return undefined;

    const refreshTimer = window.setTimeout(() => {
      refreshBoxes().catch((error) => setMessage(error.message));
    }, 0);
    const timer = window.setInterval(() => {
      refreshBoxes().catch((error) => setMessage(error.message));
    }, 5000);

    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(timer);
    };
  }, [isUnlocked, refreshBoxes]);

  const submitAuth = async () => {
    try {
      const path = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const data = await request(path, {
        method: "POST",
        body: JSON.stringify(authForm)
      });

      saveSession(data.token, data.user);
      setMessage(`Signed in as ${data.user.email}.`);
      setUseAdminFallback(false);
      setAdminUnlocked(false);
      setBoxes([]);
    } catch (error) {
      setMessage(error.message);
    }
  };

  const unlockAdminFallback = () => {
    if (!pin.trim()) {
      setMessage("Enter the admin PIN.");
      return;
    }

    setUseAdminFallback(true);
    adminRequest("/api/appliances")
      .then((data) => {
        setAdminUnlocked(true);
        setBoxes(data.appliances || []);
        syncEdits(data.appliances || []);
        setMessage("Admin fallback unlocked.");
      })
      .catch((error) => {
        setAdminUnlocked(false);
        setMessage(error.message);
      });
  };

  const linkBox = async () => {
    try {
      const cleanPairingCode = pairingCode.trim().toUpperCase();

      if (!cleanPairingCode) {
        setMessage("Enter the pairing code shown by the Pi.");
        return;
      }

      await request("/api/my/appliances/link", {
        method: "POST",
        body: JSON.stringify({ pairingCode: cleanPairingCode })
      });
      setPairingCode("");
      setMessage("Box linked to your account.");
      await refreshBoxes();
    } catch (error) {
      setMessage(error.message);
    }
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
      await activeRequest(`${applianceBasePath}/${applianceId}/settings`, {
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
      await activeRequest(`${applianceBasePath}/${applianceId}/${action}`, {
        method: "POST",
        body: JSON.stringify({})
      });
      setMessage(successMessage);
      await refreshBoxes();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const openQrPageForBox = (box, autoPrint = false) => {
    if (!box.roomCode) {
      setMessage("Set a room code before opening a QR code.");
      return;
    }

    const payload = {
      boxId: box.applianceId,
      boxName: getBoxSourceName(box),
      venueName: getVenueName(),
      roomCode: box.roomCode,
      joinUrl: getJoinUrl(box)
    };
    const storageKey = `${printPayloadPrefix}${box.applianceId}`;
    const printUrl = `/print/box/${encodeURIComponent(box.applianceId)}${
      autoPrint ? "?print=true" : ""
    }`;

    sessionStorage.setItem(storageKey, JSON.stringify(payload));
    localStorage.setItem(storageKey, JSON.stringify(payload));

    const printWindow = window.open(printUrl, "_blank");

    if (!printWindow) {
      window.location.assign(printUrl);
    }
  };

  const renderBoxCard = (box) => (
    <div
      className="smart-box-card"
      key={box.applianceId}
      onClick={() => setSelectedBoxId(box.applianceId)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSelectedBoxId(box.applianceId);
        }
      }}
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
          onClick={() => openQrPageForBox(box)}
          disabled={!box.roomCode}
        >
          Show QR Code
        </button>
        <button
          className="secondary-button"
          onClick={() => openQrPageForBox(box, true)}
          disabled={!box.roomCode}
        >
          Print QR Code
        </button>
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

    </div>
  );

  const authPanel = (
    <div className="panel-card auth-panel">
      <h2 className="section-title">{authMode === "signup" ? "Sign Up" : "Log In"}</h2>
      <p className="small-note">
        Create an account, then link your Pi audio box with its pairing code.
      </p>

      {authMode === "signup" && (
        <input
          className="room-input"
          placeholder="Display name"
          value={authForm.displayName}
          onChange={(event) =>
            setAuthForm((current) => ({
              ...current,
              displayName: event.target.value
            }))
          }
        />
      )}

      <input
        className="room-input"
        type="email"
        placeholder="Email"
        value={authForm.email}
        onChange={(event) =>
          setAuthForm((current) => ({ ...current, email: event.target.value }))
        }
      />

      <input
        className="room-input"
        type="password"
        placeholder="Password"
        value={authForm.password}
        onChange={(event) =>
          setAuthForm((current) => ({
            ...current,
            password: event.target.value
          }))
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") submitAuth();
        }}
      />

      <button className="primary-button" onClick={submitAuth}>
        {authMode === "signup" ? "Create Account" : "Log In"}
      </button>

      <button
        className="ghost-button"
        onClick={() => setAuthMode(authMode === "signup" ? "login" : "signup")}
      >
        {authMode === "signup"
          ? "Already have an account?"
          : "Need an account?"}
      </button>

      <div className="host-mode-divider">
        <span>Fallback</span>
      </div>

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
      />

      <button
        className="secondary-button"
        onClick={unlockAdminFallback}
        disabled={!isSocketConnected}
      >
        Use Admin PIN Fallback
      </button>
    </div>
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
          authPanel
        ) : selectedBox ? (
          <div className="box-settings-layout">
            <button className="ghost-button" onClick={() => setSelectedBoxId("")}>
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
                className="secondary-button"
                onClick={() => openQrPageForBox(selectedBox)}
                disabled={!selectedBox.roomCode}
              >
                Show QR Code
              </button>
              <button
                className="secondary-button"
                onClick={() => openQrPageForBox(selectedBox, true)}
                disabled={!selectedBox.roomCode}
              >
                Print QR Code
              </button>
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
                <span>Owner: {selectedBox.ownerUserId ? "Linked to account" : "Unlinked"}</span>
                <span>Last heartbeat: {selectedBox.lastHeartbeat ? new Date(selectedBox.lastHeartbeat).toLocaleString() : "Never"}</span>
                <span>Current audio device: reported by Pi logs</span>
                <span>Uptime: tracked by appliance service</span>
              </div>
            </div>
          </div>
        ) : (
          <>
            {!useAdminFallback && (
              <div className="panel-card">
                <div className="section-heading-row">
                  <div>
                    <span className="metric-label">Link Box</span>
                    <h2 className="section-title">Pair A Purchased Box</h2>
                  </div>
                </div>
                <div className="inline-control-row">
                  <input
                    className="room-input compact-input"
                    placeholder="Pairing code"
                    value={pairingCode}
                    onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
                  />
                  <button className="secondary-button" onClick={linkBox}>
                    Link Box
                  </button>
                </div>
              </div>
            )}

            <div className="boxes-grid">
              {boxes.length === 0 ? (
                <div className="panel-card">
                  <p className="small-note">
                    {useAdminFallback
                      ? "No boxes are registered yet. Start the Pi appliance and refresh."
                      : "No boxes linked yet. Enter your pairing code to add one."}
                  </p>
                </div>
              ) : (
                boxes.map(renderBoxCard)
              )}
            </div>

            <div className="share-actions">
              <button
                className="ghost-button"
                onClick={() => refreshBoxes().catch((error) => setMessage(error.message))}
              >
                Refresh Boxes
              </button>
              {!useAdminFallback && (
                <button className="secondary-button" onClick={clearSession}>
                  Sign Out
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default MyAudioBoxesDashboard;

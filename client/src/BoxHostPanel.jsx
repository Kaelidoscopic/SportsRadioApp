import { useCallback, useEffect, useState } from "react";

const accountStorageKey = "sportsAudioOwnerUserId";

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

const createOwnerId = () =>
  `owner_${Math.random().toString(36).slice(2, 10)}${Date.now()
    .toString(36)
    .slice(-4)}`;

function BoxHostPanel({ isSocketConnected }) {
  const [ownerUserId, setOwnerUserId] = useState(
    localStorage.getItem(accountStorageKey) || ""
  );
  const [pairingCode, setPairingCode] = useState("");
  const [appliances, setAppliances] = useState([]);
  const [edits, setEdits] = useState({});
  const [message, setMessage] = useState("");
  const apiUrl = getApiUrl();

  const apiFetch = useCallback(async (path, options = {}) => {
    if (!ownerUserId) {
      throw new Error("Create or load an account first.");
    }

    const response = await fetch(`${apiUrl}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        "x-user-id": ownerUserId,
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    return data;
  }, [apiUrl, ownerUserId]);

  const refreshAppliances = useCallback(async () => {
    if (!ownerUserId) return;

    try {
      const data = await apiFetch("/api/appliances/mine");
      setAppliances(data.appliances || []);
      setEdits((current) => {
        const next = { ...current };

        (data.appliances || []).forEach((appliance) => {
          next[appliance.applianceId] = {
            displayName: appliance.displayName || "",
            roomName: appliance.roomName || "",
            roomCode: appliance.roomCode || "",
            ...(next[appliance.applianceId] || {})
          };
        });

        return next;
      });
    } catch (error) {
      setMessage(error.message);
    }
  }, [apiFetch, ownerUserId]);

  useEffect(() => {
    const timer = window.setTimeout(refreshAppliances, 0);

    return () => window.clearTimeout(timer);
  }, [refreshAppliances]);

  const createAccount = () => {
    const nextOwnerId = createOwnerId();
    localStorage.setItem(accountStorageKey, nextOwnerId);
    setOwnerUserId(nextOwnerId);
    setMessage("Account created for this browser.");
  };

  const linkAppliance = async () => {
    try {
      const cleanPairingCode = pairingCode.trim().toUpperCase();

      if (!cleanPairingCode) {
        setMessage("Enter the pairing code shown in Pi logs.");
        return;
      }

      await apiFetch("/api/appliances/link", {
        method: "POST",
        body: JSON.stringify({ pairingCode: cleanPairingCode })
      });
      setPairingCode("");
      setMessage("Box linked.");
      await refreshAppliances();
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
      await apiFetch(`/api/appliances/${applianceId}/settings`, {
        method: "PATCH",
        body: JSON.stringify(edits[applianceId] || {})
      });
      setMessage("Box settings saved.");
      await refreshAppliances();
    } catch (error) {
      setMessage(error.message);
    }
  };

  const sendControl = async (applianceId, action, successMessage) => {
    try {
      await apiFetch(`/api/appliances/${applianceId}/${action}`, {
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
    <div className="panel-card managed-host-panel">
      <div className="section-heading-row">
        <div>
          <span className="metric-label">Physical Boxes</span>
          <h2 className="section-title">Linked Audio Boxes</h2>
        </div>

        <div className={`mini-pill ${isSocketConnected ? "live" : "offline"}`}>
          {isSocketConnected ? "SERVER" : "OFFLINE"}
        </div>
      </div>

      {message && <div className="status-banner compact-banner">{message}</div>}

      {!ownerUserId ? (
        <button className="primary-button" onClick={createAccount}>
          Create Host Account
        </button>
      ) : (
        <>
          <p className="small-note">Account: {ownerUserId}</p>

          <div className="inline-control-row">
            <input
              className="room-input compact-input"
              placeholder="Pairing code"
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
            />

            <button className="secondary-button" onClick={linkAppliance}>
              Link Box
            </button>
          </div>

          <button className="ghost-button" onClick={refreshAppliances}>
            Refresh Boxes
          </button>

          {appliances.length === 0 ? (
            <p className="small-note">
              Start the Pi host, then enter its pairing code to link it.
            </p>
          ) : (
            <div className="box-list">
              {appliances.map((appliance) => {
                const edit = edits[appliance.applianceId] || {};

                return (
                  <div className="box-card" key={appliance.applianceId}>
                    <div className="appliance-card-header">
                      <div>
                        <span className="metric-label">Box</span>
                        <div className="appliance-title">
                          {appliance.displayName}
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
                        <span className="metric-label">Room</span>
                        <span className="metric-value">{appliance.roomCode}</span>
                      </div>
                      <div>
                        <span className="metric-label">Listeners</span>
                        <span className="metric-value">
                          {appliance.listenerCount}
                        </span>
                      </div>
                      <div>
                        <span className="metric-label">Room State</span>
                        <span className="metric-value compact-value">
                          {appliance.isRoomActive ? "Active" : "Inactive"}
                        </span>
                      </div>
                      <div>
                        <span className="metric-label">Audio</span>
                        <span className="metric-value compact-value">
                          {appliance.isAudioEnabled ? "On" : "Off"}
                        </span>
                      </div>
                    </div>

                    <div className="admin-control-stack">
                      <input
                        className="room-input"
                        placeholder="Box name"
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
                      >
                        Save Settings
                      </button>

                      <div className="share-actions">
                        <button
                          className="primary-button"
                          onClick={() =>
                            sendControl(
                              appliance.applianceId,
                              "start-room",
                              "Room activation command sent."
                            )
                          }
                          disabled={!appliance.isOnline}
                        >
                          Activate Room
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() =>
                            sendControl(
                              appliance.applianceId,
                              "stop-room",
                              "Room deactivation command sent."
                            )
                          }
                        >
                          Deactivate Room
                        </button>
                      </div>

                      <div className="share-actions">
                        <button
                          className="primary-button"
                          onClick={() =>
                            sendControl(
                              appliance.applianceId,
                              "start-audio",
                              "Audio start command sent."
                            )
                          }
                          disabled={!appliance.isOnline}
                        >
                          Start Audio
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() =>
                            sendControl(
                              appliance.applianceId,
                              "stop-audio",
                              "Audio stop command sent."
                            )
                          }
                          disabled={!appliance.isOnline}
                        >
                          Stop Audio
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default BoxHostPanel;

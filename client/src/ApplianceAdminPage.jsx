import { useEffect, useState } from "react";

function ApplianceAdminPage({ socket, isSocketConnected }) {
  const [pin, setPin] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [appliances, setAppliances] = useState([]);
  const [message, setMessage] = useState("Enter admin PIN.");
  const [roomEdits, setRoomEdits] = useState({});

  useEffect(() => {
    const handleAppliances = (nextAppliances) => {
      setAppliances(nextAppliances || []);
      setRoomEdits((current) => {
        const next = { ...current };

        (nextAppliances || []).forEach((appliance) => {
          if (!next[appliance.applianceId]) {
            next[appliance.applianceId] = appliance.roomCode || "";
          }
        });

        return next;
      });
    };

    const handleError = (error) => {
      setMessage(error || "Admin command failed.");
    };

    socket.on("admin:appliances", handleAppliances);
    socket.on("admin:error", handleError);

    return () => {
      socket.off("admin:appliances", handleAppliances);
      socket.off("admin:error", handleError);
    };
  }, [socket]);

  useEffect(() => {
    if (isAuthenticated && isSocketConnected) {
      socket.emit("admin:authenticate", { pin: pin.trim() }, (response) => {
        if (!response?.ok) {
          setIsAuthenticated(false);
          setMessage(response?.error || "Admin session expired.");
          return;
        }

        socket.emit("admin:get-appliances");
      });
    }
  }, [isAuthenticated, isSocketConnected, pin, socket]);

  const authenticate = () => {
    if (!pin.trim()) {
      setMessage("Enter admin PIN.");
      return;
    }

    socket.emit("admin:authenticate", { pin: pin.trim() }, (response) => {
      if (!response?.ok) {
        setIsAuthenticated(false);
        setMessage(response?.error || "Invalid admin PIN.");
        return;
      }

      setIsAuthenticated(true);
      setMessage("Admin controls unlocked.");
    });
  };

  const updateRoomCode = (applianceId) => {
    const nextRoomCode = (roomEdits[applianceId] || "").trim().toUpperCase();

    if (!nextRoomCode) {
      setMessage("Enter a room code.");
      return;
    }

    socket.emit("admin:set-room-code", {
      applianceId,
      roomCode: nextRoomCode
    });
    setMessage("Room code command sent.");
  };

  const sendCommand = (eventName, applianceId, successMessage) => {
    socket.emit(eventName, { applianceId });
    setMessage(successMessage);
  };

  return (
    <div className="page-shell">
      <div className="main-card admin-card">
        <div className="brand-block centered-brand">
          <h1 className="app-title">Appliance Control</h1>
          <p className="app-subtitle">Manage Raspberry Pi audio boxes.</p>
        </div>

        {message && <div className="status-banner">{message}</div>}

        <div
          className={`connection-pill ${isSocketConnected ? "live" : "offline"}`}
        >
          {isSocketConnected ? "Server connected" : "Server disconnected"}
        </div>

        {!isAuthenticated ? (
          <div className="compact-actions">
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

            {appliances.map((appliance) => (
              <div className="panel-card appliance-card" key={appliance.applianceId}>
                <div className="appliance-card-header">
                  <div>
                    <span className="metric-label">Appliance</span>
                    <div className="appliance-title">
                      {appliance.name || appliance.applianceId}
                    </div>
                  </div>

                  <div
                    className={`mini-pill ${
                      appliance.online ? "live" : "offline"
                    }`}
                  >
                    {appliance.online ? "ONLINE" : "OFFLINE"}
                  </div>
                </div>

                <div className="admin-metrics">
                  <div>
                    <span className="metric-label">Room</span>
                    <span className="metric-value">
                      {appliance.roomCode || "----"}
                    </span>
                  </div>
                  <div>
                    <span className="metric-label">Audio</span>
                    <span className="metric-value">
                      {appliance.broadcasting ? "On" : "Off"}
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
                  <div>
                    <span className="metric-label">Uptime</span>
                    <span className="metric-value compact-value">
                      {Math.floor((appliance.uptime || 0) / 60)} min
                    </span>
                  </div>
                </div>

                <div className="admin-control-stack">
                  <input
                    className="room-input compact-input"
                    aria-label={`Room code for ${appliance.applianceId}`}
                    value={roomEdits[appliance.applianceId] || ""}
                    onChange={(event) =>
                      setRoomEdits((current) => ({
                        ...current,
                        [appliance.applianceId]: event.target.value.toUpperCase()
                      }))
                    }
                  />

                  <button
                    className="secondary-button"
                    onClick={() => updateRoomCode(appliance.applianceId)}
                    disabled={!appliance.online}
                  >
                    Change Room Code
                  </button>

                  <div className="share-actions">
                    <button
                      className="primary-button"
                      onClick={() =>
                        sendCommand(
                          "admin:start-audio",
                          appliance.applianceId,
                          "Start audio command sent."
                        )
                      }
                      disabled={!appliance.online}
                    >
                      Start Audio
                    </button>

                    <button
                      className="secondary-button"
                      onClick={() =>
                        sendCommand(
                          "admin:stop-audio",
                          appliance.applianceId,
                          "Stop audio command sent."
                        )
                      }
                      disabled={!appliance.online}
                    >
                      Stop Audio
                    </button>
                  </div>

                  <button
                    className="ghost-button"
                    onClick={() =>
                      sendCommand(
                        "admin:restart",
                        appliance.applianceId,
                        "Restart command sent."
                      )
                    }
                    disabled={!appliance.online}
                  >
                    Restart Appliance
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApplianceAdminPage;

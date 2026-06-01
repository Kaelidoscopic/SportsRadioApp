import { useState } from "react";
import QRScanner from "./QRScanner";
import MyAudioBoxesDashboard from "./MyAudioBoxesDashboard";

const authTokenKey = "sportsAudioAuthToken";
const authUserKey = "sportsAudioAuthUser";

const getApiUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) return import.meta.env.VITE_BACKEND_URL;
  if (import.meta.env.DEV) return "http://localhost:5000";
  return "";
};

function LandingPage({
  roomId,
  setRoomId,
  createRoom,
  joinRoom,
  activeRooms = [],
  statusMessage,
  isSocketConnected,
  preferredMode = null
}) {
  const [mode, setMode] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({
    displayName: "",
    email: "",
    password: ""
  });
  const [authMessage, setAuthMessage] = useState("");
  const requestedMode = mode || preferredMode;
  const activeMode =
    requestedMode === "listener"
      ? "join"
      : requestedMode || (localStorage.getItem(authTokenKey) ? "home" : "auth");

  const cleanRoomCode = (code) => {
    return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  };

  const apiRequest = async (path, body) => {
    const response = await fetch(`${getApiUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Request failed.");
    }

    return data;
  };

  const submitAuth = async () => {
    try {
      const path = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const data = await apiRequest(path, authForm);

      localStorage.setItem(authTokenKey, data.token);
      localStorage.setItem(authUserKey, JSON.stringify(data.user));
      setAuthMessage("");
      setMode("home");
    } catch (error) {
      setAuthMessage(error.message);
    }
  };

  const signOut = () => {
    localStorage.removeItem(authTokenKey);
    localStorage.removeItem(authUserKey);
    setMode("auth");
  };

  const openJoin = () => {
    setRoomId("");
    setMode("join");
  };

  const backToStart = () => {
    setMode(localStorage.getItem(authTokenKey) ? "home" : "auth");
  };

  const openBrowserHost = () => {
    setRoomId("");
    setMode("browser-host");
  };

  const handleCreateRoom = () => {
    const cleanCode = cleanRoomCode(roomId);
    setRoomId(cleanCode);
    createRoom(cleanCode);
  };

  const handleJoinRoom = () => {
    joinRoom(cleanRoomCode(roomId));
  };

  const handleJoinKeyDown = (event) => {
    if (event.key === "Enter") {
      handleJoinRoom();
    }
  };

  const handleScan = (decodedText) => {
    let scannedRoomCode = decodedText;

    try {
      const url = new URL(decodedText);
      scannedRoomCode = url.searchParams.get("room") || decodedText;
    } catch {
      scannedRoomCode = decodedText;
    }

    const cleanCode = cleanRoomCode(scannedRoomCode);

    setRoomId(cleanCode);
    setScannerOpen(false);

    setTimeout(() => {
      joinRoom(cleanCode);
    }, 0);
  };

  if (activeMode === "boxes") {
    return (
      <MyAudioBoxesDashboard
        isSocketConnected={isSocketConnected}
        onBack={() => setMode("host")}
      />
    );
  }

  if (activeMode === "auth") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card compact-landing">
          <div className="brand-block centered-brand">
            <h1 className="app-title">Login / Sign Up</h1>
            <p className="app-subtitle">
              Manage boxes as a host, or join audio without an account.
            </p>
          </div>

          {(authMessage || statusMessage) && (
            <div className="status-banner">{authMessage || statusMessage}</div>
          )}

          <div className="compact-actions">
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
              className="secondary-button"
              onClick={() => setAuthMode(authMode === "signup" ? "login" : "signup")}
            >
              {authMode === "signup" ? "Already Have Account" : "Sign Up"}
            </button>

            <button className="ghost-button" onClick={openJoin}>
              Join Audio Without Account
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeMode === "home") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card app-home-card">
          <div className="brand-block centered-brand">
            <h1 className="app-title">Venue Audio</h1>
            <p className="app-subtitle">Choose what you want to do.</p>
          </div>

          {statusMessage && <div className="status-banner">{statusMessage}</div>}

          <div
            className={`connection-pill ${
              isSocketConnected ? "live" : "offline"
            }`}
          >
            {isSocketConnected ? "Server connected" : "Server disconnected"}
          </div>

          <div className="action-card-grid">
            <button className="action-card-button" onClick={openJoin}>
              <span className="action-card-title">Join Audio</span>
              <span className="action-card-copy">
                Enter a code, scan QR, or choose an active room.
              </span>
            </button>

            <button className="action-card-button" onClick={() => setMode("host")}>
              <span className="action-card-title">Host Audio</span>
              <span className="action-card-copy">
                Manage audio boxes or host from this browser.
              </span>
            </button>
          </div>

          <button className="ghost-button" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (activeMode === "host") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card host-menu-card">
          <button className="back-button" onClick={backToStart}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Host Audio</h1>
            <p className="app-subtitle">
              Choose physical appliance hosting or browser hosting.
            </p>
          </div>

          {statusMessage && <div className="status-banner">{statusMessage}</div>}

          <div className="action-card-grid">
            <button
              className="action-card-button"
              onClick={() => setMode("boxes")}
              disabled={!isSocketConnected}
            >
              <span className="action-card-title">Host with Audio Box</span>
              <span className="action-card-copy">
                Open My Audio Boxes and control a Raspberry Pi appliance.
              </span>
            </button>

            <button
              className="action-card-button"
              onClick={openBrowserHost}
              disabled={!isSocketConnected}
            >
              <span className="action-card-title">Host from Browser</span>
              <span className="action-card-copy">
                Create a temporary room using this browser audio source.
              </span>
            </button>
          </div>

          <button
            className="secondary-button"
            onClick={() => window.location.assign("/admin")}
            disabled={!isSocketConnected}
          >
            Admin PIN Fallback
          </button>
        </div>
      </div>
    );
  }

  if (activeMode === "browser-host") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card compact-landing">
          <button className="back-button" onClick={() => setMode("host")}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Host from Browser</h1>
            <p className="app-subtitle">
              Create a room using a microphone, input device, browser tab, or screen.
            </p>
          </div>

          {statusMessage && <div className="status-banner">{statusMessage}</div>}

          <div className="compact-actions">
            <input
              className="room-input compact-input"
              type="text"
              placeholder="Optional room code"
              value={roomId}
              onChange={(event) => setRoomId(cleanRoomCode(event.target.value))}
            />

            <button
              className="primary-button"
              onClick={handleCreateRoom}
              disabled={!isSocketConnected}
            >
              Start Browser Room
            </button>

            <p className="small-note">
              Leave the code blank to generate a random one.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (activeMode === "join") {
    return (
      <div className="page-shell">
        <div className="main-card landing-card host-menu-card">
          <button className="back-button" onClick={backToStart}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Join Audio</h1>
            <p className="app-subtitle">
              Join with a code, QR scan, or active public room.
            </p>
          </div>

          {statusMessage && <div className="status-banner">{statusMessage}</div>}

          <div className="option-section-grid">
            <div className="panel-card">
              <h2 className="section-title">Join by Code</h2>
              <div className="compact-actions">
                <input
                  className="room-input compact-input"
                  type="text"
                  placeholder="Enter room code"
                  value={roomId}
                  onChange={(event) => setRoomId(cleanRoomCode(event.target.value))}
                  onKeyDown={handleJoinKeyDown}
                />

                <button
                  className="primary-button"
                  onClick={handleJoinRoom}
                  disabled={!isSocketConnected}
                >
                  Join Audio
                </button>
              </div>
            </div>

            <div className="panel-card">
              <h2 className="section-title">Scan QR Code</h2>
              <p className="small-note">Use a venue QR code to join directly.</p>
              <button
                className="secondary-button"
                onClick={() => setScannerOpen(true)}
              >
                Scan QR Code
              </button>
            </div>

            <div className="panel-card">
              <h2 className="section-title">Join Room in Area</h2>
              {activeRooms.length > 0 ? (
                <div className="room-directory">
                  {activeRooms.map((room) => (
                    <button
                      key={room.roomId}
                      className="room-list-card"
                      onClick={() => joinRoom(room.roomId)}
                    >
                      <span>
                        <span className="room-list-code">{room.roomId}</span>
                        {room.roomName && room.roomName !== room.roomId && (
                          <span className="room-list-name">{room.roomName}</span>
                        )}
                      </span>

                      <span
                        className={`mini-pill ${
                          room.isBroadcasting ? "live" : "offline"
                        }`}
                      >
                        {room.hostType === "appliance" ? "BOX" : "LIVE"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="small-note">
                  No public rooms are listed yet. Enter a room code if you have one.
                </p>
              )}
            </div>
          </div>

          {scannerOpen && (
            <QRScanner
              onScan={handleScan}
              onClose={() => setScannerOpen(false)}
            />
          )}
        </div>
      </div>
    );
  }

  return null;
}

export default LandingPage;

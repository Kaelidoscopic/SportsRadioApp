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
  isSocketConnected,
  preferredMode = null
}) {
  const [mode, setMode] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authReturnMode, setAuthReturnMode] = useState("host");
  const [authForm, setAuthForm] = useState({
    displayName: "",
    email: "",
    password: ""
  });
  const [authMessage, setAuthMessage] = useState("");
  const requestedMode = mode || preferredMode;
  const activeMode = requestedMode === "listener" ? "join" : requestedMode || "landing";
  const isLoggedIn = Boolean(localStorage.getItem(authTokenKey));

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

  const openAuth = (returnMode = "host") => {
    setAuthReturnMode(returnMode);
    setAuthMessage("");
    setMode("auth");
  };

  const submitAuth = async () => {
    try {
      const path = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const data = await apiRequest(path, authForm);

      localStorage.setItem(authTokenKey, data.token);
      localStorage.setItem(authUserKey, JSON.stringify(data.user));
      setAuthMessage("");
      setMode(authReturnMode);
    } catch (error) {
      setAuthMessage(error.message);
    }
  };

  const signOut = () => {
    localStorage.removeItem(authTokenKey);
    localStorage.removeItem(authUserKey);
    setMode("landing");
  };

  const openJoin = () => {
    setRoomId("");
    setMode("join");
  };

  const openEnterCode = () => {
    setRoomId("");
    setMode("enter-code");
  };

  const openHost = () => {
    if (!isLoggedIn) {
      openAuth("host");
      return;
    }

    setMode("host");
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
        <div className="main-card compact-landing synclink-screen">
          <button className="back-button" onClick={() => setMode("landing")}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Host Login</h1>
            <p className="app-subtitle">Sign in to broadcast or manage devices.</p>
          </div>

          {authMessage && <div className="status-banner">{authMessage}</div>}

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

            <button className="primary-button big-button" onClick={submitAuth}>
              {authMode === "signup" ? "Create Account" : "Log In"}
            </button>

            <button
              className="secondary-button"
              onClick={() => setAuthMode(authMode === "signup" ? "login" : "signup")}
            >
              {authMode === "signup" ? "Already Have Account" : "Sign Up"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeMode === "landing") {
    return (
      <div className="page-shell">
        <div className="main-card compact-landing synclink-screen">
          <div className="brand-block centered-brand synclink-brand">
            <div className="synclink-logo">SyncLink</div>
            <p className="app-subtitle">Live audio for the screen in front of you.</p>
          </div>

          <div className="compact-actions">
            <button className="primary-button big-button" onClick={openJoin}>
              Join Audio
            </button>

            <button className="secondary-button big-button" onClick={openHost}>
              Host Audio
            </button>
          </div>

          <div className="small-link-row">
            <button className="text-link-button" onClick={() => setMode("settings")}>
              Settings
            </button>
            <button className="text-link-button" onClick={() => setMode("help")}>
              Help
            </button>
            {isLoggedIn ? (
              <button className="text-link-button" onClick={signOut}>
                Log Out
              </button>
            ) : (
              <button className="text-link-button" onClick={() => openAuth("host")}>
                Login
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (activeMode === "join") {
    return (
      <div className="page-shell">
        <div className="main-card compact-landing synclink-screen">
          <button className="back-button" onClick={() => setMode("landing")}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Join Audio</h1>
          </div>

          <div className="stacked-option-list">
            <button className="action-card-button recommended-card" onClick={() => setScannerOpen(true)}>
              <span className="action-card-title">Scan QR Code</span>
              <span className="action-card-copy">Fastest way to connect.</span>
            </button>

            <button className="action-card-button" onClick={openEnterCode}>
              <span className="action-card-title">Enter Room Code</span>
              <span className="action-card-copy">Use a code like HOME.</span>
            </button>

            <button className="action-card-button" onClick={() => setMode("nearby")}>
              <span className="action-card-title">Nearby Rooms</span>
              <span className="action-card-copy">Pick from active public rooms.</span>
            </button>
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

  if (activeMode === "connecting") {
    return (
      <div className="page-shell">
        <div className="main-card compact-landing synclink-screen connecting-card">
          <div className="brand-block centered-brand">
            <div className="loading-dot" />
            <h1 className="app-title">Connecting...</h1>
            <p className="app-subtitle">
              {roomId ? `Joining ${roomId}` : "Joining audio"}
            </p>
          </div>

          <button className="ghost-button" onClick={() => setMode("join")}>
            Back to Join Audio
          </button>
        </div>
      </div>
    );
  }

  if (activeMode === "enter-code") {
    return (
      <div className="page-shell">
        <div className="main-card compact-landing synclink-screen">
          <button className="back-button" onClick={() => setMode("join")}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Enter Room Code</h1>
          </div>

          <div className="compact-actions">
            <input
              className="room-input room-code-input"
              type="text"
              placeholder="Enter code"
              value={roomId}
              onChange={(event) => setRoomId(cleanRoomCode(event.target.value))}
              onKeyDown={handleJoinKeyDown}
              autoFocus
            />

            <button
              className="primary-button big-button"
              onClick={handleJoinRoom}
              disabled={!isSocketConnected || !roomId}
            >
              Join
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeMode === "nearby") {
    return (
      <div className="page-shell">
        <div className="main-card compact-landing synclink-screen">
          <button className="back-button" onClick={() => setMode("join")}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Nearby Rooms</h1>
          </div>

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

                  <span className={`mini-pill ${room.isBroadcasting ? "live" : "offline"}`}>
                    {room.isBroadcasting ? "LIVE" : "OFFLINE"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="small-note roomy-note">
              No nearby rooms are listed yet. Scan a QR code or enter a room code.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (activeMode === "host") {
    if (!isLoggedIn) {
      return (
        <div className="page-shell">
          <div className="main-card compact-landing synclink-screen">
            <button className="back-button" onClick={() => setMode("landing")}>
              Back
            </button>

            <div className="brand-block centered-brand">
              <h1 className="app-title">Host Login</h1>
              <p className="app-subtitle">Log in to start hosting.</p>
            </div>

            <button className="primary-button big-button" onClick={() => openAuth("host")}>
              Login / Sign Up
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="page-shell">
        <div className="main-card compact-landing synclink-screen">
          <button className="back-button" onClick={() => setMode("landing")}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Host Audio</h1>
          </div>

          <div className="stacked-option-list">
            <button
              className="action-card-button"
              onClick={openBrowserHost}
              disabled={!isSocketConnected}
            >
              <span className="action-card-title">Browser Audio</span>
              <span className="action-card-copy">Host live audio from this device.</span>
            </button>

            <button
              className="action-card-button"
              onClick={() => setMode("boxes")}
              disabled={!isSocketConnected}
            >
              <span className="action-card-title">Host Device / Audio Box</span>
              <span className="action-card-copy">Control a linked physical audio box.</span>
            </button>
          </div>

          <button
            className="text-link-button center-link"
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
        <div className="main-card compact-landing synclink-screen">
          <button className="back-button" onClick={() => setMode("host")}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">Browser Audio</h1>
          </div>

          <div className="compact-actions">
            <input
              className="room-input room-code-input"
              type="text"
              placeholder="Optional code"
              value={roomId}
              onChange={(event) => setRoomId(cleanRoomCode(event.target.value))}
            />

            <button
              className="primary-button big-button"
              onClick={handleCreateRoom}
              disabled={!isSocketConnected}
            >
              Start Broadcast
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (activeMode === "settings" || activeMode === "help") {
    return (
      <div className="page-shell">
        <div className="main-card compact-landing synclink-screen">
          <button className="back-button" onClick={() => setMode("landing")}>
            Back
          </button>

          <div className="brand-block centered-brand">
            <h1 className="app-title">{activeMode === "settings" ? "Settings" : "Help"}</h1>
            <p className="app-subtitle">
              {activeMode === "settings"
                ? "More listener settings will live here."
                : "Scan a venue QR code or enter the room code shown by the host."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default LandingPage;

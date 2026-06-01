import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import LandingPage from "./LandingPage";
import HostDashboard from "./HostDashboard";
import ListenerDashboard from "./ListenerDashboard";
import ApplianceAdminPage from "./ApplianceAdminPage";

const getSocketUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }

  if (import.meta.env.DEV) {
    return "http://localhost:5000";
  }

  return undefined;
};

const socket = io(getSocketUrl(), {
  autoConnect: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000
});

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

const getMediaDevices = () => navigator.mediaDevices || null;
const mediaUnavailableMessage =
  "Audio input capture requires HTTPS or localhost.";
const savedListenerRoomKey = "venueAudioListenerRoomCode";
const savedListenerWasListeningKey = "venueAudioListenerWasListening";

function App() {
  const isAdminPage =
    window.location.pathname === "/admin" ||
    new URLSearchParams(window.location.search).get("admin") === "1";

  const [roomId, setRoomId] = useState("");
  const [currentRoom, setCurrentRoom] = useState("");
  const [role, setRole] = useState("");
  const [members, setMembers] = useState([]);
  const [message, setMessage] = useState("Welcome.");

  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isHostLive, setIsHostLive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [userPausedListening, setUserPausedListening] = useState(false);
  const [isSocketConnected, setIsSocketConnected] = useState(socket.connected);
  const [hostType, setHostType] = useState("browser");
  const [applianceDetails, setApplianceDetails] = useState(null);
  const [preferredLandingMode, setPreferredLandingMode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("room") ? "join" : null;
  });
  const [needsUserAudioGesture, setNeedsUserAudioGesture] = useState(false);

  const [activeRooms, setActiveRooms] = useState([]);
  const [audioInputs, setAudioInputs] = useState([]);

  const [broadcastSourceType, setBroadcastSourceType] = useState(
    localStorage.getItem("venueAudioSourceType") || "input"
  );

  const [selectedAudioInput, setSelectedAudioInput] = useState(
    localStorage.getItem("venueAudioInputId") || ""
  );

  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const roleRef = useRef("");
  const currentRoomRef = useRef("");
  const hostTypeRef = useRef("browser");
  const isHostLiveRef = useRef(false);
  const isListeningRef = useRef(false);
  const userPausedListeningRef = useRef(false);
  const shouldRestoreApplianceAudioRef = useRef(false);
  const applianceDetailsRef = useRef(null);
  const applianceRestoreInFlightRef = useRef(false);
  const applianceAudioActiveRef = useRef(false);
  const applianceListeningRef = useRef(false);
  const applianceAudioListenerAttachedRef = useRef(false);
  const applianceAudioChunkHandlerRef = useRef(null);
  const applianceAudioAttachCountRef = useRef(0);
  const applianceAudioDetachCountRef = useRef(0);
  const applianceAutoStartAttemptedRef = useRef(false);
  const applianceAudioRef = useRef({
    context: null,
    nextStartTime: 0
  });
  const listenerPeerRef = useRef(null);
  const hostPeerConnectionsRef = useRef({});
  const linkJoinRoomRef = useRef("");
  const linkJoinRetryCountRef = useRef(0);
  const roomRejoinTimerRef = useRef(null);
  const pendingJoinRoomRef = useRef("");

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    hostTypeRef.current = hostType;
  }, [hostType]);

  useEffect(() => {
    isHostLiveRef.current = isHostLive;
  }, [isHostLive]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    userPausedListeningRef.current = userPausedListening;
  }, [userPausedListening]);

  useEffect(() => {
    applianceDetailsRef.current = applianceDetails;
  }, [applianceDetails]);

  useEffect(() => {
    localStorage.setItem("venueAudioSourceType", broadcastSourceType);
  }, [broadcastSourceType]);

  useEffect(() => {
    if (selectedAudioInput) {
      localStorage.setItem("venueAudioInputId", selectedAudioInput);
    }
  }, [selectedAudioInput]);

  const loadAudioInputs = async () => {
    const mediaDevices = getMediaDevices();

    if (!mediaDevices) {
      setAudioInputs([]);
      setSelectedAudioInput("");
      return;
    }

    try {
      await mediaDevices.getUserMedia({ audio: true });

      const devices = await mediaDevices.enumerateDevices();
      const audioDevices = devices.filter(
        (device) => device.kind === "audioinput"
      );

      setAudioInputs(audioDevices);

      if (audioDevices.length === 0) {
        setSelectedAudioInput("");
        return;
      }

      const savedInputId = localStorage.getItem("venueAudioInputId");
      const savedStillExists = audioDevices.some(
        (device) => device.deviceId === savedInputId
      );

      setSelectedAudioInput(
        savedInputId && savedStillExists
          ? savedInputId
          : audioDevices[0].deviceId
      );
    } catch (error) {
      console.error("Failed to load audio devices:", error);
    }
  };

  const refreshAudioInputs = async () => {
    if (!getMediaDevices()) {
      setAudioInputs([]);
      setSelectedAudioInput("");
      setMessage(mediaUnavailableMessage);
      return;
    }

    await loadAudioInputs();
    setMessage("Audio devices refreshed.");
  };

  useEffect(() => {
    const loadTimer = setTimeout(loadAudioInputs, 0);
    const mediaDevices = getMediaDevices();

    if (mediaDevices?.addEventListener) {
      mediaDevices.addEventListener("devicechange", loadAudioInputs);
    }

    return () => {
      clearTimeout(loadTimer);

      if (mediaDevices?.removeEventListener) {
        mediaDevices.removeEventListener("devicechange", loadAudioInputs);
      }
    };
  }, []);

  const playRemoteAudio = async () => {
    if (!remoteAudioRef.current) return;

    try {
      await remoteAudioRef.current.play();
      setIsListening(true);
      setMessage("Listening to live audio.");
    } catch (err) {
      console.log("Autoplay blocked.", err);
      setMessage("Tap Start Listening to begin audio.");
    }
  };

  const getAudioChunkBytes = (chunk) => {
    if (chunk instanceof ArrayBuffer) {
      return new Uint8Array(chunk);
    }

    if (ArrayBuffer.isView(chunk)) {
      return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }

    if (Array.isArray(chunk?.data)) {
      return Uint8Array.from(chunk.data);
    }

    return null;
  };

  const getApplianceAudioContext = (sampleRate = 44100) => {
    const existingContext = applianceAudioRef.current.context;

    if (existingContext && existingContext.state !== "closed") {
      return existingContext;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextClass({ sampleRate });

    applianceAudioRef.current.context = context;
    applianceAudioRef.current.nextStartTime = context.currentTime + 0.12;

    return context;
  };

  const startApplianceAudio = async (sampleRate = 44100) => {
    const context = getApplianceAudioContext(sampleRate);

    try {
      if (context.state === "suspended") {
        await context.resume();
        console.log("AudioContext resumed");
      }
    } catch (error) {
      console.warn("AudioContext resume blocked:", error);
      applianceListeningRef.current = false;
      applianceAudioActiveRef.current = false;
      setIsListening(false);
      setNeedsUserAudioGesture(true);
      setMessage("Tap to Start Listening.");
      throw error;
    }

    applianceListeningRef.current = true;
    applianceAudioActiveRef.current = true;
    shouldRestoreApplianceAudioRef.current = true;
    applianceAutoStartAttemptedRef.current = true;
    setNeedsUserAudioGesture(false);
    applianceAudioRef.current.nextStartTime = context.currentTime + 0.12;
    setIsListening(true);
    setMessage("Listening to Pi audio.");

    if (roleRef.current === "listener" && currentRoomRef.current) {
      saveListenerSession(currentRoomRef.current, true);
    }
  };

  const pauseApplianceAudio = async () => {
    applianceListeningRef.current = false;
    applianceAudioActiveRef.current = false;

    const context = applianceAudioRef.current.context;

    if (context && context.state === "running") {
      await context.suspend();
    }
  };

  const closeApplianceAudio = async () => {
    applianceListeningRef.current = false;
    applianceAudioActiveRef.current = false;

    const context = applianceAudioRef.current.context;
    applianceAudioRef.current.context = null;
    applianceAudioRef.current.nextStartTime = 0;

    if (context && context.state !== "closed") {
      await context.close();
    }
  };

  const isAppliancePipelineRunning = () => {
    const context = applianceAudioRef.current.context;

    return (
      applianceAudioActiveRef.current &&
      applianceListeningRef.current &&
      context &&
      context.state === "running"
    );
  };

  const playApplianceAudioChunk = async ({
    roomId,
    sampleRate = 44100,
    channels = 2,
    chunk
  }) => {
    if (
      roleRef.current !== "listener" ||
      hostTypeRef.current !== "appliance" ||
      currentRoomRef.current !== roomId ||
      !applianceListeningRef.current
    ) {
      return;
    }

    const bytes = getAudioChunkBytes(chunk);
    const channelCount = Math.max(Number(channels) || 1, 1);

    if (!bytes || bytes.length < channelCount * 2) return;

    const frameCount = Math.floor(bytes.length / 2 / channelCount);
    const context = getApplianceAudioContext(sampleRate);

    if (context.state === "suspended") {
      await context.resume();
    }

    const audioBuffer = context.createBuffer(
      channelCount,
      frameCount,
      sampleRate
    );
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sampleIndex = frame * channelCount + channel;
        const sample = view.getInt16(sampleIndex * 2, true) / 32768;
        audioBuffer.getChannelData(channel)[frame] = sample;
      }
    }

    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    const earliestStart = context.currentTime + 0.05;
    const nextStartTime = applianceAudioRef.current.nextStartTime;
    const startTime =
      nextStartTime < earliestStart || nextStartTime - context.currentTime > 1
        ? context.currentTime + 0.12
        : nextStartTime;

    source.start(startTime);
    applianceAudioRef.current.nextStartTime =
      startTime + audioBuffer.duration;
  };

  const attachApplianceAudioListener = () => {
    if (!applianceAudioChunkHandlerRef.current) {
      applianceAudioChunkHandlerRef.current = (payload) => {
        playApplianceAudioChunk(payload);
      };
    }

    if (applianceAudioChunkHandlerRef.current) {
      socket.off("appliance-audio-chunk", applianceAudioChunkHandlerRef.current);
      if (applianceAudioListenerAttachedRef.current) {
        applianceAudioDetachCountRef.current += 1;
        console.log(
          `Appliance audio listener detached (${applianceAudioDetachCountRef.current})`
        );
      }
      applianceAudioListenerAttachedRef.current = false;
    }

    socket.on("appliance-audio-chunk", applianceAudioChunkHandlerRef.current);
    applianceAudioListenerAttachedRef.current = true;
    applianceAudioAttachCountRef.current += 1;
    console.log(
      `Appliance audio listener attached (${applianceAudioAttachCountRef.current})`
    );
  };

  const detachApplianceAudioListener = () => {
    if (
      !applianceAudioChunkHandlerRef.current ||
      !applianceAudioListenerAttachedRef.current
    ) {
      return;
    }

    socket.off("appliance-audio-chunk", applianceAudioChunkHandlerRef.current);
    applianceAudioListenerAttachedRef.current = false;
    applianceAudioDetachCountRef.current += 1;
    console.log(
      `Appliance audio listener detached (${applianceAudioDetachCountRef.current})`
    );
  };

  const resetApplianceAudioPipeline = async () => {
    detachApplianceAudioListener();
    await closeApplianceAudio();
    applianceAudioRef.current.nextStartTime = 0;
  };

  const restartRestoredApplianceAudio = async ({
    resetPipeline = false,
    requestStream = false,
    allowUserGesturePrompt = true
  } = {}) => {
    if (
      roleRef.current !== "listener" ||
      hostTypeRef.current !== "appliance" ||
      !currentRoomRef.current ||
      !socket.connected ||
      userPausedListeningRef.current ||
      !shouldRestoreApplianceAudioRef.current ||
      applianceRestoreInFlightRef.current
    ) {
      return;
    }

    if (!resetPipeline && isAppliancePipelineRunning()) {
      return;
    }

    applianceRestoreInFlightRef.current = true;
    console.log("Restored room, restarting appliance audio");

    try {
      if (resetPipeline) {
        await resetApplianceAudioPipeline();
      }

      attachApplianceAudioListener();
      await startApplianceAudio(
        applianceDetailsRef.current?.sampleRate || 44100
      );

      if (requestStream) {
        socket.emit("request-stream");
      }
    } catch (error) {
      console.error("Failed to restart restored appliance audio:", error);
      if (allowUserGesturePrompt) {
        setNeedsUserAudioGesture(true);
        setMessage("Tap to Start Listening.");
      }
    } finally {
      applianceRestoreInFlightRef.current = false;
    }
  };

  const createHostPeerConnection = (listenerSocketId) => {
    const pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc-ice-candidate", {
          target: listenerSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed" ||
        pc.connectionState === "disconnected"
      ) {
        if (hostPeerConnectionsRef.current[listenerSocketId] === pc) {
          delete hostPeerConnectionsRef.current[listenerSocketId];
        }
      }
    };

    return pc;
  };

  const createListenerPeerConnection = (hostSocketId) => {
    const pc = new RTCPeerConnection(rtcConfig);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc-ice-candidate", {
          target: hostSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = async (event) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = event.streams[0];
        await playRemoteAudio();
      }
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed" ||
        pc.connectionState === "disconnected"
      ) {
        if (listenerPeerRef.current === pc) {
          setIsListening(false);
          setMessage("Audio connection was interrupted.");
        }
      }
    };

    return pc;
  };

  const cleanupHostConnections = () => {
    Object.values(hostPeerConnectionsRef.current).forEach((pc) => pc.close());
    hostPeerConnectionsRef.current = {};
  };

  const cleanupListenerConnection = () => {
    if (listenerPeerRef.current) {
      const pc = listenerPeerRef.current;
      listenerPeerRef.current = null;
      pc.close();
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
      remoteAudioRef.current.srcObject = null;
    }

    setIsListening(false);
  };

  const cleanupAllConnections = () => {
    cleanupHostConnections();
    cleanupListenerConnection();
    closeApplianceAudio();
  };

  const resetRoomState = () => {
    currentRoomRef.current = "";
    roleRef.current = "";
    hostTypeRef.current = "browser";
    userPausedListeningRef.current = false;
    shouldRestoreApplianceAudioRef.current = false;
    applianceDetailsRef.current = null;
    applianceRestoreInFlightRef.current = false;
    applianceAudioActiveRef.current = false;
    applianceAutoStartAttemptedRef.current = false;
    setNeedsUserAudioGesture(false);
    setCurrentRoom("");
    setRole("");
    setPreferredLandingMode(null);
    setMembers([]);
    setIsBroadcasting(false);
    setIsHostLive(false);
    setHostType("browser");
    setApplianceDetails(null);
    setIsMuted(false);
    setIsListening(false);
    setUserPausedListening(false);
  };

  const saveListenerSession = (roomCode, wasListening = false) => {
    localStorage.setItem(savedListenerRoomKey, roomCode);
    localStorage.setItem(
      savedListenerWasListeningKey,
      wasListening ? "true" : "false"
    );
  };

  const clearSavedListenerSession = () => {
    localStorage.removeItem(savedListenerRoomKey);
    localStorage.removeItem(savedListenerWasListeningKey);
    pendingJoinRoomRef.current = "";
  };

  const requestJoinRoom = (roomCode) => {
    const cleanRoomCode = String(roomCode || "").trim().toUpperCase();

    if (!cleanRoomCode) return;

    setRoomId(cleanRoomCode);

    if (socket.connected) {
      socket.emit("join-room", cleanRoomCode);
      return;
    }

    pendingJoinRoomRef.current = cleanRoomCode;
  };

  const stopBroadcastTracksOnly = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setIsBroadcasting(false);
  };

  const sendOfferToListener = async (
    listenerSocketId,
    streamToSend,
    forceNewConnection = false
  ) => {
    try {
      const existingPc = hostPeerConnectionsRef.current[listenerSocketId];

      if (existingPc && forceNewConnection) {
        existingPc.close();
        delete hostPeerConnectionsRef.current[listenerSocketId];
      }

      if (
        existingPc &&
        !forceNewConnection &&
        existingPc.connectionState !== "closed" &&
        existingPc.signalingState !== "closed"
      ) {
        console.log("Peer connection already exists for:", listenerSocketId);
        return;
      }

      const pc = createHostPeerConnection(listenerSocketId);
      hostPeerConnectionsRef.current[listenerSocketId] = pc;

      streamToSend.getTracks().forEach((track) => {
        pc.addTrack(track, streamToSend);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("webrtc-offer", {
        target: listenerSocketId,
        offer
      });
    } catch (error) {
      console.error("Error creating offer:", error);
      setMessage("Failed to create live audio connection.");
    }
  };

  const clearRoomRejoinTimer = () => {
    if (roomRejoinTimerRef.current) {
      clearTimeout(roomRejoinTimerRef.current);
      roomRejoinTimerRef.current = null;
    }
  };

  const scheduleRoomRejoin = (delay = 1500) => {
    if (
      roomRejoinTimerRef.current ||
      roleRef.current !== "listener" ||
      !currentRoomRef.current
    ) {
      return;
    }

    roomRejoinTimerRef.current = setTimeout(() => {
      roomRejoinTimerRef.current = null;

      if (
        roleRef.current === "listener" &&
        currentRoomRef.current &&
        socket.connected
      ) {
        socket.emit("join-room", currentRoomRef.current);
      }
    }, delay);
  };

  const restoreApplianceRoomState = () => {
    if (
      roleRef.current !== "listener" ||
      hostTypeRef.current !== "appliance" ||
      !currentRoomRef.current ||
      !socket.connected
    ) {
      return;
    }

    console.log("Restoring appliance room state");
    socket.emit("join-room", currentRoomRef.current);
  };

  useEffect(() => {
    socket.on("room-created", (data) => {
      currentRoomRef.current = data.roomId;
      roleRef.current = data.role;
      hostTypeRef.current = "browser";
      setCurrentRoom(data.roomId);
      setRoomId(data.roomId);
      setRole(data.role);
      setPreferredLandingMode(null);
      setMembers(data.members);
      setHostType("browser");
      setApplianceDetails(null);
      setMessage(`Room ${data.roomId} created.`);

      localStorage.setItem("venueAudioHostCode", data.roomId);
    });

    socket.on("joined-room", (data) => {
      clearRoomRejoinTimer();
      pendingJoinRoomRef.current = "";
      linkJoinRoomRef.current = "";
      linkJoinRetryCountRef.current = 0;
      currentRoomRef.current = data.roomId;
      roleRef.current = data.role;
      setCurrentRoom(data.roomId);
      setRole(data.role);
      setPreferredLandingMode(null);
      setMembers(data.members);
      setIsHostLive(Boolean(data.isBroadcasting));
      isHostLiveRef.current = Boolean(data.isBroadcasting);
      hostTypeRef.current = data.hostType || "browser";
      setHostType(data.hostType || "browser");
      applianceDetailsRef.current = data.appliance || null;
      setApplianceDetails(data.appliance || null);
      setUserPausedListening(
        data.hostType === "appliance" &&
          userPausedListeningRef.current &&
          !shouldRestoreApplianceAudioRef.current
      );
      setMessage(`Connected to room ${data.roomId}.`);
      saveListenerSession(data.roomId, shouldRestoreApplianceAudioRef.current);

      if (
        data.hostType === "appliance" &&
        data.isBroadcasting &&
        shouldRestoreApplianceAudioRef.current &&
        !applianceAutoStartAttemptedRef.current
      ) {
        restartRestoredApplianceAudio({ requestStream: true });
      }
    });

    socket.on("room-updated", (data) => {
      setMembers(data.members);
    });

    socket.on("broadcast-status", (data) => {
      const wasHostLive = isHostLiveRef.current;

      setIsHostLive(data.isBroadcasting);
      isHostLiveRef.current = data.isBroadcasting;

      if (data.hostType) {
        hostTypeRef.current = data.hostType;
        setHostType(data.hostType);
      }

      if (data.appliance) {
        applianceDetailsRef.current = data.appliance;
        setApplianceDetails(data.appliance);
      }

      if (!data.isBroadcasting) {
        setIsListening(false);
        pauseApplianceAudio();
      }

      if (
        data.hostType === "appliance" &&
        data.isBroadcasting &&
        !wasHostLive &&
        shouldRestoreApplianceAudioRef.current &&
        !applianceAutoStartAttemptedRef.current
      ) {
        restartRestoredApplianceAudio({ requestStream: true });
      }
    });

    socket.on("room-closed", (msg) => {
      clearRoomRejoinTimer();
      cleanupAllConnections();
      stopBroadcastTracksOnly();
      localStorage.removeItem("venueAudioHostMode");
      clearSavedListenerSession();
      resetRoomState();
      setMessage(msg);
    });

    socket.on("left-room", (msg) => {
      clearRoomRejoinTimer();
      cleanupAllConnections();
      stopBroadcastTracksOnly();
      clearSavedListenerSession();
      resetRoomState();
      setMessage(msg);
    });

    socket.on("connect", async () => {
      setIsSocketConnected(true);

      if (pendingJoinRoomRef.current && !roleRef.current) {
        const roomToJoin = pendingJoinRoomRef.current;
        pendingJoinRoomRef.current = "";
        socket.emit("join-room", roomToJoin);
        setMessage(`Reconnecting to room ${roomToJoin}...`);
        return;
      }

      if (roleRef.current === "host" && currentRoomRef.current) {
        socket.emit("recover-host-room", currentRoomRef.current);
        setMessage("Reconnected to host room.");
      }

      if (roleRef.current === "listener" && currentRoomRef.current) {
        if (hostTypeRef.current === "appliance") {
          console.log("Mobile/server reconnect detected");

          if (isListeningRef.current || applianceListeningRef.current) {
            shouldRestoreApplianceAudioRef.current = true;
          }

          await pauseApplianceAudio();
          setIsListening(false);
          restoreApplianceRoomState();
          setMessage("Reconnected. Waiting for Pi audio...");
          return;
        }

        socket.emit("join-room", currentRoomRef.current);
        setMessage("Reconnected to room.");
      }
    });

    socket.on("disconnect", () => {
      setIsSocketConnected(false);

      if (roleRef.current === "listener" && hostTypeRef.current === "appliance") {
        if (isListeningRef.current || applianceListeningRef.current) {
          shouldRestoreApplianceAudioRef.current = true;
        }

        pauseApplianceAudio();
        setIsListening(false);
      }

      setMessage("Connection lost. Trying to reconnect...");
    });

    socket.on("connect_error", () => {
      setIsSocketConnected(false);
      setMessage("Could not reach the audio server.");
    });

    socket.on("error-message", (msg) => {
      const shouldRetryCurrentApplianceRoom =
        roleRef.current === "listener" &&
        currentRoomRef.current &&
        hostTypeRef.current === "appliance" &&
        (msg === "Room not found." ||
          msg === "Host is reconnecting. Try again in a moment." ||
          msg === "You must be in a room to request audio.");

      if (shouldRetryCurrentApplianceRoom) {
        setIsListening(false);
        setIsHostLive(false);
        setMessage("Waiting for the Pi room to come back online...");
        scheduleRoomRejoin();
        return;
      }

      if (
        (msg === "Room not found." ||
          msg === "Host is reconnecting. Try again in a moment.") &&
        linkJoinRoomRef.current
      ) {
        if (linkJoinRetryCountRef.current < 4) {
          linkJoinRetryCountRef.current += 1;
          setMessage("Looking for the room...");

          setTimeout(() => {
            if (linkJoinRoomRef.current) {
              socket.emit("join-room", linkJoinRoomRef.current);
            }
          }, 1200);

          return;
        }

        linkJoinRoomRef.current = "";
        linkJoinRetryCountRef.current = 0;
        setMessage(
          "Saved room is not online yet. Start the Pi host or tap Join Audio to try again."
        );
        setPreferredLandingMode("join");
        return;
      }

      setMessage(msg);
    });

    socket.on("listener-joined", async ({ listenerSocketId }) => {
      if (roleRef.current !== "host") return;

      if (!localStreamRef.current) {
        setMessage("A listener joined, but broadcasting has not started yet.");
        return;
      }

      await sendOfferToListener(listenerSocketId, localStreamRef.current);
    });

    socket.on("stream-requested", async ({ listenerSocketId }) => {
      if (roleRef.current !== "host") return;

      if (!localStreamRef.current) {
        setMessage("A listener requested audio, but broadcasting has not started yet.");
        return;
      }

      await sendOfferToListener(listenerSocketId, localStreamRef.current, true);
    });

    socket.on("webrtc-offer", async ({ sender, offer }) => {
      if (roleRef.current !== "listener") return;

      try {
        cleanupListenerConnection();

        const pc = createListenerPeerConnection(sender);
        listenerPeerRef.current = pc;

        await pc.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("webrtc-answer", {
          target: sender,
          answer
        });

        setMessage("Connected to host audio.");
      } catch (error) {
        console.error("Error handling offer:", error);
        setMessage("Failed to connect to host audio.");
      }
    });

    socket.on("webrtc-answer", async ({ sender, answer }) => {
      if (roleRef.current !== "host") return;

      try {
        const pc = hostPeerConnectionsRef.current[sender];
        if (!pc) return;

        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error("Error handling answer:", error);
      }
    });

    socket.on("webrtc-ice-candidate", async ({ sender, candidate }) => {
      try {
        if (!candidate) return;

        if (roleRef.current === "host") {
          const pc = hostPeerConnectionsRef.current[sender];
          if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          }
          return;
        }

        if (roleRef.current === "listener" && listenerPeerRef.current) {
          await listenerPeerRef.current.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        }
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    });

    socket.on("rooms-list", (rooms) => {
      setActiveRooms(rooms);
    });

    socket.on("appliance-stream-ready", ({ appliance }) => {
      if (hostTypeRef.current !== "appliance") return;

      applianceDetailsRef.current = appliance || null;
      setApplianceDetails(appliance || null);
      setIsHostLive(true);
      isHostLiveRef.current = true;

      if (
        shouldRestoreApplianceAudioRef.current &&
        !userPausedListeningRef.current &&
        !applianceAutoStartAttemptedRef.current
      ) {
        restartRestoredApplianceAudio();
      }

      setMessage("Pi audio stream is ready.");
    });

    socket.emit("get-rooms");

    return () => {
      socket.off("room-created");
      socket.off("joined-room");
      socket.off("room-updated");
      socket.off("broadcast-status");
      socket.off("room-closed");
      socket.off("left-room");
      socket.off("error-message");
      socket.off("listener-joined");
      socket.off("stream-requested");
      socket.off("webrtc-offer");
      socket.off("webrtc-answer");
      socket.off("webrtc-ice-candidate");
      socket.off("rooms-list");
      socket.off("appliance-stream-ready");
      detachApplianceAudioListener();
      socket.off("connect");
      socket.off("disconnect");
      socket.off("connect_error");
      clearRoomRejoinTimer();
    };
  }, []);

  const createRoom = (overrideCode) => {
    if (!isSocketConnected) {
      setMessage("Audio server is disconnected.");
      return;
    }

    const code =
      typeof overrideCode === "string" ? overrideCode.trim() : roomId.trim();

    socket.emit("create-room", code || null);
  };

  const joinRoom = (overrideRoomId) => {
    if (!isSocketConnected) {
      setMessage("Audio server is disconnected.");
      return;
    }

    const codeToJoin =
      typeof overrideRoomId === "string" ? overrideRoomId : roomId;

    if (!codeToJoin.trim()) {
      setMessage("Enter a room code first.");
      return;
    }

    socket.emit("join-room", codeToJoin.trim());
  };

  const leaveRoom = () => {
    const leavingAsHost = roleRef.current === "host";

    clearRoomRejoinTimer();
    cleanupAllConnections();
    stopBroadcastTracksOnly();
    clearSavedListenerSession();

    if (leavingAsHost) {
      localStorage.removeItem("venueAudioHostMode");
      socket.emit("end-room");
    } else {
      socket.emit("leave-room");
    }

    resetRoomState();
    setMessage(leavingAsHost ? "Room ended." : "You left the room.");
  };

  const startBroadcasting = async () => {
    if (roleRef.current !== "host") return;

    if (!isSocketConnected) {
      setMessage("Audio server is disconnected.");
      return;
    }

    try {
      let stream;
      const mediaDevices = getMediaDevices();

      if (!mediaDevices) {
        setMessage(mediaUnavailableMessage);
        return;
      }

      if (broadcastSourceType === "tab") {
        if (!mediaDevices.getDisplayMedia) {
          setMessage(mediaUnavailableMessage);
          return;
        }

        const displayStream = await mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });

        const audioTracks = displayStream.getAudioTracks();

        if (audioTracks.length === 0) {
          setMessage(
            "No tab or screen audio was shared. Enable audio sharing when prompted."
          );
          displayStream.getTracks().forEach((track) => track.stop());
          return;
        }

        stream = new MediaStream(audioTracks);
        displayStream.getVideoTracks().forEach((track) => track.stop());
      } else {
        stream = await mediaDevices.getUserMedia({
          audio: {
            deviceId: selectedAudioInput
              ? { exact: selectedAudioInput }
              : undefined,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        });
      }

      const audioTracks = stream.getAudioTracks();

      if (audioTracks.length === 0) {
        setMessage("No audio source detected.");
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      localStreamRef.current = stream;

      setIsBroadcasting(true);
      setIsMuted(false);
      setIsHostLive(true);
      socket.emit("broadcast-started");

      const listenerIds = members.filter((memberId) => memberId !== socket.id);

      for (const listenerId of listenerIds) {
        await sendOfferToListener(listenerId, stream);
      }

      setMessage("Broadcast is live.");

      audioTracks[0].onended = () => {
        stopBroadcasting();
      };
    } catch (error) {
      console.error("Audio capture failed:", error);
      setMessage("Could not access selected audio source.");
    }
  };

  const stopBroadcasting = () => {
    if (roleRef.current !== "host") return;

    stopBroadcastTracksOnly();
    cleanupHostConnections();

    setIsHostLive(false);
    setIsMuted(false);
    socket.emit("broadcast-stopped");

    setMessage("Broadcast stopped.");
  };

  const toggleMute = () => {
    if (roleRef.current !== "host") return;

    if (!localStreamRef.current) {
      setMessage("Start broadcasting before muting.");
      return;
    }

    const newMutedState = !isMuted;

    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !newMutedState;
    });

    setIsMuted(newMutedState);
    setMessage(newMutedState ? "Broadcast muted." : "Broadcast unmuted.");
  };

  const startListening = async () => {
    if (roleRef.current !== "listener") return;

    if (!isSocketConnected) {
      setMessage("Audio server is disconnected.");
      return;
    }

    if (!isHostLive) {
      setIsListening(false);
      setMessage("Host is offline.");
      return;
    }

    setUserPausedListening(false);
    shouldRestoreApplianceAudioRef.current = true;

    if (currentRoomRef.current) {
      saveListenerSession(currentRoomRef.current, true);
    }

    if (hostTypeRef.current === "appliance") {
      applianceAutoStartAttemptedRef.current = true;
      attachApplianceAudioListener();
      await startApplianceAudio(applianceDetails?.sampleRate || 44100);
      socket.emit("request-stream");
      return;
    }

    const listenerConnectionState = listenerPeerRef.current?.connectionState;
    const hasActiveRemoteStream =
      remoteAudioRef.current?.srcObject instanceof MediaStream &&
      remoteAudioRef.current.srcObject.active &&
      remoteAudioRef.current.srcObject
        .getAudioTracks()
        .some((track) => track.readyState === "live");
    const canResumeExistingAudio =
      hasActiveRemoteStream &&
      (listenerConnectionState === "connected" ||
        listenerConnectionState === "completed");

    if (canResumeExistingAudio) {
      await playRemoteAudio();
    } else {
      cleanupListenerConnection();
      socket.emit("request-stream");
      setMessage("Requesting live audio...");
    }
  };

  const stopListening = () => {
    if (roleRef.current !== "listener") return;

    setUserPausedListening(true);
    shouldRestoreApplianceAudioRef.current = false;

    if (currentRoomRef.current) {
      saveListenerSession(currentRoomRef.current, false);
    }

    if (hostTypeRef.current === "appliance") {
      pauseApplianceAudio();
      applianceAutoStartAttemptedRef.current = false;
      setNeedsUserAudioGesture(false);
      setIsListening(false);
      setMessage("Listening paused.");
      return;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
    }

    setIsListening(false);
    setMessage("Listening paused.");
  };

  const reconnectAudio = async () => {
    if (roleRef.current !== "listener") return;

    if (!isSocketConnected) {
      setMessage("Audio server is disconnected.");
      return;
    }

    cleanupListenerConnection();
    pauseApplianceAudio();
    setUserPausedListening(false);
    setIsListening(false);

    if (!isHostLive) {
      setMessage("Host is offline.");
      return;
    }

    if (hostTypeRef.current === "appliance") {
      shouldRestoreApplianceAudioRef.current = true;
      if (currentRoomRef.current) {
        saveListenerSession(currentRoomRef.current, true);
      }
      applianceAutoStartAttemptedRef.current = false;
      await restartRestoredApplianceAudio({
        resetPipeline: true,
        requestStream: true
      });
      setMessage("Reconnecting Pi audio...");
      return;
    }

    socket.emit("request-stream");
    setMessage("Reconnecting audio...");
  };

  const resumeApplianceAudioFromGesture = async () => {
    if (roleRef.current !== "listener" || hostTypeRef.current !== "appliance") {
      return;
    }

    shouldRestoreApplianceAudioRef.current = true;
    applianceAutoStartAttemptedRef.current = false;
    setNeedsUserAudioGesture(false);
    setUserPausedListening(false);

    if (currentRoomRef.current) {
      saveListenerSession(currentRoomRef.current, true);
    }

    await restartRestoredApplianceAudio({
      resetPipeline: true,
      requestStream: true,
      allowUserGesturePrompt: false
    });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");

    if (roomFromUrl) {
      const cleanRoomCode = roomFromUrl.trim().toUpperCase();

      setTimeout(() => {
        linkJoinRoomRef.current = cleanRoomCode;
        linkJoinRetryCountRef.current = 0;
        shouldRestoreApplianceAudioRef.current = true;
        applianceAutoStartAttemptedRef.current = false;
        setNeedsUserAudioGesture(false);
        setUserPausedListening(false);
        setPreferredLandingMode("join");
        setMessage(`Joining room ${cleanRoomCode}...`);
        requestJoinRoom(cleanRoomCode);
      }, 300);

      return;
    }

    clearSavedListenerSession();
    localStorage.removeItem("venueAudioHostCode");
    localStorage.removeItem("venueAudioHostMode");
    setRoomId("");
  }, []);

  useEffect(() => {
    if (
      role === "listener" &&
      isHostLive &&
      !isListening &&
      !userPausedListening
    ) {
      if (hostType === "appliance") {
        if (
          shouldRestoreApplianceAudioRef.current &&
          !applianceAutoStartAttemptedRef.current
        ) {
          setTimeout(() => {
            restartRestoredApplianceAudio({ requestStream: true });
          }, 0);
        }

        return;
      }

      setTimeout(startListening, 0);
    }
  }, [hostType, isHostLive, role, isListening, userPausedListening]);

  if (isAdminPage) {
    return (
      <ApplianceAdminPage
        socket={socket}
        isSocketConnected={isSocketConnected}
      />
    );
  }

  if (!role) {
    return (
      <LandingPage
        roomId={roomId}
        setRoomId={setRoomId}
        createRoom={createRoom}
        joinRoom={joinRoom}
        activeRooms={activeRooms}
        statusMessage={message}
        isSocketConnected={isSocketConnected}
        preferredMode={preferredLandingMode}
      />
    );
  }

  if (role === "host") {
    return (
      <HostDashboard
        currentRoom={currentRoom}
        isBroadcasting={isBroadcasting}
        isMuted={isMuted}
        leaveRoom={leaveRoom}
        startBroadcasting={startBroadcasting}
        stopBroadcasting={stopBroadcasting}
        toggleMute={toggleMute}
        audioInputs={audioInputs}
        selectedAudioInput={selectedAudioInput}
        setSelectedAudioInput={setSelectedAudioInput}
        broadcastSourceType={broadcastSourceType}
        setBroadcastSourceType={setBroadcastSourceType}
        refreshAudioInputs={refreshAudioInputs}
        listenerCount={Math.max(members.length - 1, 0)}
        statusMessage={message}
        isSocketConnected={isSocketConnected}
      />
    );
  }

  return (
    <ListenerDashboard
      currentRoom={currentRoom}
      isListening={isListening}
      isHostLive={isHostLive}
      hostType={hostType}
      sourceName={
        applianceDetails?.roomName ||
        applianceDetails?.displayName ||
        applianceDetails?.applianceId
      }
      leaveRoom={leaveRoom}
      startListening={startListening}
      stopListening={stopListening}
      reconnectAudio={reconnectAudio}
      resumeApplianceAudio={resumeApplianceAudioFromGesture}
      needsUserAudioGesture={needsUserAudioGesture}
      remoteAudioRef={remoteAudioRef}
      statusMessage={message}
      isSocketConnected={isSocketConnected}
    />
  );
}

export default App;

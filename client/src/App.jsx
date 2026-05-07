import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import LandingPage from "./LandingPage";
import HostDashboard from "./HostDashboard";
import ListenerDashboard from "./ListenerDashboard";

const socket = io(import.meta.env.VITE_BACKEND_URL);

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function App() {
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
  const listenerPeerRef = useRef(null);
  const hostPeerConnectionsRef = useRef({});

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  useEffect(() => {
    localStorage.setItem("venueAudioSourceType", broadcastSourceType);
  }, [broadcastSourceType]);

  useEffect(() => {
    if (selectedAudioInput) {
      localStorage.setItem("venueAudioInputId", selectedAudioInput);
    }
  }, [selectedAudioInput]);

  const loadAudioInputs = async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const devices = await navigator.mediaDevices.enumerateDevices();
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
    await loadAudioInputs();
    setMessage("Audio devices refreshed.");
  };

  useEffect(() => {
    const loadTimer = setTimeout(loadAudioInputs, 0);

    navigator.mediaDevices.addEventListener("devicechange", loadAudioInputs);

    return () => {
      clearTimeout(loadTimer);
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        loadAudioInputs
      );
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
        delete hostPeerConnectionsRef.current[listenerSocketId];
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

    return pc;
  };

  const cleanupHostConnections = () => {
    Object.values(hostPeerConnectionsRef.current).forEach((pc) => pc.close());
    hostPeerConnectionsRef.current = {};
  };

  const cleanupListenerConnection = () => {
    if (listenerPeerRef.current) {
      listenerPeerRef.current.close();
      listenerPeerRef.current = null;
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
  };

  const resetRoomState = () => {
    currentRoomRef.current = "";
    roleRef.current = "";
    setCurrentRoom("");
    setRole("");
    setMembers([]);
    setIsBroadcasting(false);
    setIsHostLive(false);
    setIsMuted(false);
    setIsListening(false);
    setUserPausedListening(false);
  };

  const stopBroadcastTracksOnly = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setIsBroadcasting(false);
  };

  const sendOfferToListener = async (listenerSocketId, streamToSend) => {
    try {
      const existingPc = hostPeerConnectionsRef.current[listenerSocketId];

      if (
        existingPc &&
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

  useEffect(() => {
    socket.on("room-created", (data) => {
      currentRoomRef.current = data.roomId;
      roleRef.current = data.role;
      setCurrentRoom(data.roomId);
      setRoomId(data.roomId);
      setRole(data.role);
      setMembers(data.members);
      setMessage(`Room ${data.roomId} created.`);

      localStorage.setItem("venueAudioHostCode", data.roomId);
    });

    socket.on("joined-room", (data) => {
      currentRoomRef.current = data.roomId;
      roleRef.current = data.role;
      setCurrentRoom(data.roomId);
      setRole(data.role);
      setMembers(data.members);
      setIsHostLive(Boolean(data.isBroadcasting));
      setUserPausedListening(false);
      setMessage(`Connected to room ${data.roomId}.`);
    });

    socket.on("room-updated", (data) => {
      setMembers(data.members);
    });

    socket.on("broadcast-status", (data) => {
      setIsHostLive(data.isBroadcasting);

      if (!data.isBroadcasting) {
        setIsListening(false);
        setUserPausedListening(false);
      }
    });

    socket.on("room-closed", (msg) => {
      cleanupAllConnections();
      stopBroadcastTracksOnly();
      localStorage.removeItem("venueAudioHostMode");
      resetRoomState();
      setMessage(msg);
    });

    socket.on("left-room", (msg) => {
      cleanupAllConnections();
      stopBroadcastTracksOnly();
      resetRoomState();
      setMessage(msg);
    });

    socket.on("connect", () => {
      if (roleRef.current === "host" && currentRoomRef.current) {
        socket.emit("recover-host-room", currentRoomRef.current);
        setMessage("Reconnected to host room.");
      }

      if (roleRef.current === "listener" && currentRoomRef.current) {
        socket.emit("join-room", currentRoomRef.current);
        setMessage("Reconnected to room.");
      }
    });

    socket.on("disconnect", () => {
      setMessage("Connection lost. Trying to reconnect...");
    });

    socket.on("error-message", (msg) => {
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
      socket.off("webrtc-offer");
      socket.off("webrtc-answer");
      socket.off("webrtc-ice-candidate");
      socket.off("rooms-list");
      socket.off("connect");
      socket.off("disconnect");
    };
  }, []);

  const createRoom = (overrideCode) => {
    const code =
      typeof overrideCode === "string" ? overrideCode.trim() : roomId.trim();

    socket.emit("create-room", code || null);
  };

  const joinRoom = (overrideRoomId) => {
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

    cleanupAllConnections();
    stopBroadcastTracksOnly();

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

    try {
      let stream;

      if (broadcastSourceType === "tab") {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({
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
        stream = await navigator.mediaDevices.getUserMedia({
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

    if (!isHostLive) {
      setIsListening(false);
      setMessage("Host is offline.");
      return;
    }

    setUserPausedListening(false);

    if (remoteAudioRef.current && remoteAudioRef.current.srcObject) {
      await playRemoteAudio();
    } else {
      socket.emit("request-stream");
      setMessage("Requesting live audio...");
    }
  };

  const stopListening = () => {
    if (roleRef.current !== "listener") return;

    setUserPausedListening(true);

    if (remoteAudioRef.current) {
      remoteAudioRef.current.pause();
    }

    setIsListening(false);
    setMessage("Listening paused.");
  };

  const reconnectAudio = () => {
    if (roleRef.current !== "listener") return;

    cleanupListenerConnection();
    setUserPausedListening(false);

    if (!isHostLive) {
      setMessage("Host is offline.");
      return;
    }

    socket.emit("request-stream");
    setMessage("Reconnecting audio...");
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");

    if (roomFromUrl) {
      const cleanRoomCode = roomFromUrl.trim();

      setTimeout(() => {
        setRoomId(cleanRoomCode);
        setMessage(`Joining room ${cleanRoomCode}...`);
        joinRoom(cleanRoomCode);
      }, 300);
    }
  }, []);

  useEffect(() => {
    if (
      role === "listener" &&
      isHostLive &&
      !isListening &&
      !userPausedListening
    ) {
      setTimeout(startListening, 0);
    }
  }, [isHostLive, role, isListening, userPausedListening]);

  if (!role) {
    return (
      <LandingPage
        roomId={roomId}
        setRoomId={setRoomId}
        createRoom={createRoom}
        joinRoom={joinRoom}
        activeRooms={activeRooms}
        statusMessage={message}
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
      />
    );
  }

  return (
    <ListenerDashboard
      currentRoom={currentRoom}
      isListening={isListening}
      isHostLive={isHostLive}
      leaveRoom={leaveRoom}
      startListening={startListening}
      stopListening={stopListening}
      reconnectAudio={reconnectAudio}
      remoteAudioRef={remoteAudioRef}
      statusMessage={message}
    />
  );
}

export default App;

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import LandingPage from "./LandingPage";
import HostDashboard from "./HostDashboard";
import ListenerDashboard from "./ListenerDashboard";

const socket = io(import.meta.env.VITE_BACKEND_URL);

function App() {
  const [roomId, setRoomId] = useState("");
  const [currentRoom, setCurrentRoom] = useState("");
  const [role, setRole] = useState("");
  const [members, setMembers] = useState([]);
  const [message, setMessage] = useState("Welcome.");
  const [isBroadcasting, setIsBroadcasting] = useState(false);  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const roleRef = useRef("");
  const listenerPeerRef = useRef(null);
  const hostPeerConnectionsRef = useRef({});
  const [isHostLive, setIsHostLive] = useState(false);
  const [userPausedListening, setUserPausedListening] = useState(false);

  const rtcConfig = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  };

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");

    if (roomFromUrl) {
      const cleanRoomCode = roomFromUrl.trim();

      setRoomId(cleanRoomCode);
      setMessage(`Joining room ${cleanRoomCode}...`);

      setTimeout(() => {
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
      startListening();
    }
  }, [isHostLive, role, isListening, userPausedListening]);

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

      setMessage("Receiving live audio.");
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

  const stopBroadcastTracksOnly = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    setIsBroadcasting(false);
  };

  const sendOfferToListener = async (listenerSocketId, streamToSend) => {
    try {
      if (hostPeerConnectionsRef.current[listenerSocketId]) {
        hostPeerConnectionsRef.current[listenerSocketId].close();
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

      setMessage(`Live audio sent to listener ${listenerSocketId.slice(0, 6)}.`);
    } catch (error) {
      console.error("Error creating offer:", error);
      setMessage("Failed to create live audio connection.");
    }
  };

  useEffect(() => {
    socket.on("room-created", (data) => {
      setCurrentRoom(data.roomId);
      setRole(data.role);
      setMembers(data.members);
      setMessage(`Room ${data.roomId} created.`);
    });

    socket.on("joined-room", (data) => {
      setCurrentRoom(data.roomId);
      setRole(data.role);
      setMembers(data.members);
      setMessage(`Connected to room ${data.roomId}.`);
      setIsHostLive(Boolean(data.isBroadcasting));
      setUserPausedListening(false);

      if (data.isBroadcasting) {
        setTimeout(() => {
          socket.emit("request-stream");
        }, 500);
      }
    });

    socket.on("broadcast-status", (data) => {
      setIsHostLive(data.isBroadcasting);

      if (!data.isBroadcasting) {
        setIsListening(false);
        setUserPausedListening(false);
      }
    });

    socket.on("room-updated", (data) => {
      setMembers(data.members);
      setMessage(`Room ${data.roomId} updated.`);
    });

    socket.on("room-closed", (msg) => {
      cleanupAllConnections();
      stopBroadcastTracksOnly();
      setCurrentRoom("");
      setRole("");
      setMembers([]);
      setMessage(msg);
      setIsHostLive(false);
      setIsListening(false);
      setUserPausedListening(false);
    });

    socket.on("left-room", (msg) => {
      cleanupAllConnections();
      stopBroadcastTracksOnly();
      setCurrentRoom("");
      setRole("");
      setMembers([]);
      setMessage(msg);
      setIsHostLive(false);
      setIsListening(false);
      setUserPausedListening(false);
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
        setMessage("Broadcast connection established.");
      } catch (error) {
        console.error("Error handling answer:", error);
        setMessage("Failed to finalize broadcast connection.");
      }
    });

    socket.on("webrtc-ice-candidate", async ({ sender, candidate }) => {
      try {
        if (!candidate) return;

        if (roleRef.current === "host") {
          const pc = hostPeerConnectionsRef.current[sender];
          if (!pc) return;

          await pc.addIceCandidate(new RTCIceCandidate(candidate));
          return;
        }

        if (roleRef.current === "listener") {
          if (!listenerPeerRef.current) return;

          await listenerPeerRef.current.addIceCandidate(
            new RTCIceCandidate(candidate)
          );
        }
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    });

    return () => {
      socket.off("room-created");
      socket.off("joined-room");
      socket.off("room-updated");
      socket.off("room-closed");
      socket.off("left-room");
      socket.off("error-message");
      socket.off("listener-joined");
      socket.off("webrtc-offer");
      socket.off("webrtc-answer");
      socket.off("webrtc-ice-candidate");
      socket.off("broadcast-status");
    };
  }, []);

  const createRoom = () => {
    const code = roomId.trim();

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
    cleanupAllConnections();
    stopBroadcastTracksOnly();
    socket.emit("leave-room");
    setUserPausedListening(false);
  };

  const startBroadcasting = async () => {
    if (roleRef.current !== "host") return;

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      const audioTracks = stream.getAudioTracks();

      if (audioTracks.length === 0) {
        setMessage("No audio was shared. Choose a tab/window and enable Share audio.");
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      localStreamRef.current = new MediaStream(audioTracks);

      setIsBroadcasting(true);
      setIsMuted(false);
      setIsHostLive(true);
      socket.emit("broadcast-started");

      const listenerIds = members.filter((memberId) => memberId !== socket.id);

      if (listenerIds.length > 0) {
        for (const listenerId of listenerIds) {
          await sendOfferToListener(listenerId, localStreamRef.current);
        }
        setMessage("Broadcast is live.");
      } else {
        setMessage("Broadcast is live. Waiting for listeners.");
      }

      stream.getVideoTracks().forEach((track) => {
        track.stop();
      });

      audioTracks[0].onended = () => {
        stopBroadcasting();
      };
    } catch (error) {
      console.error("Audio source capture failed:", error);
      setMessage("Could not start broadcast. Make sure audio sharing is enabled.");
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

  const copyRoomCode = async () => {
    if (!currentRoom) {
      setMessage("No room code available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(currentRoom);
      setMessage(`Copied room code: ${currentRoom}`);
    } catch (error) {
      console.error("Failed to copy room code:", error);
      setMessage("Could not copy room code.");
    }
  };

  const copyJoinLink = async () => {
    if (!currentRoom) {
      setMessage("No join link available.");
      return;
    }

    const joinLink = `${import.meta.env.VITE_FRONTEND_URL}/?room=${currentRoom}`;

    try {
      await navigator.clipboard.writeText(joinLink);
      setMessage("Copied join link.");
    } catch (error) {
      console.error("Failed to copy join link:", error);
      setMessage("Could not copy join link.");
    }
  };

  if (!role) {
    return (
      <LandingPage
        roomId={roomId}
        setRoomId={setRoomId}
        createRoom={createRoom}
        joinRoom={joinRoom}
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
    />
  );
}

export default App;
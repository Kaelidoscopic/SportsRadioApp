# Windows broadcaster — architecture assessment and implementation plan

Stage 1 backend ownership/recovery and signaling validation are implemented. See [Stage 1 implementation and Stage 2 contract](windows-broadcaster-stage-1.md) for exact events, expiry semantics, tests, remaining legacy risks, and the next implementation steps. The architecture assessment below describes the pre-implementation baseline; proposed later-stage files remain planned.

Stage 2's Electron implementation is now present in `desktop/`. See [Windows broadcaster operation and validation](windows-broadcaster.md). The main process owns encrypted credentials and signaling; the sandboxed renderer owns capture and WebRTC. A separate Windows process's test tone was captured through native loopback and measured as nonzero audio at a local audio-only WebRTC receiver. Real phone playback remains unverified. No React or Pi transport changes were needed.

## Current architecture

- `client/src/App.jsx` owns Socket.IO room state, host capture, WebRTC peers, listener playback, and reconnect behavior. `HostDashboard.jsx` and `ListenerDashboard.jsx` render controls. Browser hosts capture microphone input or user-selected display/tab audio; neither is a dedicated desktop system-loopback implementation.
- Browser audio travels directly from host to listener over one WebRTC peer per listener. Socket.IO relays `webrtc-offer`, `webrtc-answer`, and `webrtc-ice-candidate`. The listener assigns the received stream to its audio element. ICE currently uses Google STUN only; there is no TURN relay.
- `server/index.js` owns in-memory rooms, membership, broadcast status, and a 15-second host disconnect grace period. `create-room`, `recover-host-room`, `end-room`, and `request-stream` are reusable protocol concepts. Explicit room closure differs from temporary disconnection.
- Browser room creation/recovery is unauthenticated; recovery trusts a room code. Signaling currently relays to arbitrary socket IDs without room membership checks. Account sessions exist for appliance management, but do not secure browser hosting.
- `server/pi-host.js` captures ALSA audio through `arecord`. `server/appliance-audio.js` validates and forwards PCM chunks, and the web listener has a separate appliance playback path. Appliance registration uses an optional PI_HOST_TOKEN. Preserve this implementation and protocol.
- QR joining is a frontend URL/room-code concern and does not depend on capture hardware. A desktop room can use the ordinary WebRTC listener path and existing join-link format.
- Server tests use Node's built-in test runner and currently cover appliance configuration/audio. Client scripts provide Vite development/build and ESLint, with no browser automation test script. The backend requires a Node release with `node:sqlite`; the inspected host runs Node 22.16.0.

## Selected implementation

Add an isolated Electron application under `desktop/`. Use Electron's documented Windows system-loopback source through `session.setDisplayMediaRequestHandler` with `audio: 'loopback'`. The renderer requests a media stream through Electron's capture bridge; the source is Windows playback, not microphone input or a user-selected browser tab. If Electron requires a video source to establish capture, retain it only as required internally, never attach it to WebRTC, and release it with the capture session. Validate whether stopping it immediately preserves loopback on the selected Electron version.

Reference: https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts

Use a sandboxed renderer with context isolation, no renderer Node integration, a narrow preload API, local bundled content, and navigation/permission restrictions. Allow capture only from the application's own frame during an explicit start operation. No remote website may acquire capture permission.

Keep three boundaries:

1. Capture adapter: `start()`, `stop()`, state/error notifications, and an audio-only `MediaStream` result. Windows is implemented; other platforms explicitly report unsupported until adapters exist.
2. Broadcaster controller: room lifecycle, saved room identity, reconnect intent, listener membership, and start/stop state transitions. No Windows capture details.
3. WebRTC transport: per-listener peers, serialized negotiation, queued early ICE, failed-peer cleanup, and track attachment. No room ownership or native capture details.

Use a narrowly added desktop registration/recovery event with a persisted random ownership secret. Store its hash server-side, require the secret for recovery, and prevent legacy browser recovery from reclaiming desktop rooms. Preserve desktop identity across reconnects; recover within the grace period and safely recreate after room expiry/backend restart if the code is free. An active conflicting host must never be replaced. Room state remains in memory in Phase 1: persistent reservation across backend restart is not promised.

Keep desktop rooms on the listener's existing non-appliance WebRTC branch. Add room display-name metadata where needed without changing QR/code join behavior. Constrain signaling to host/listener pairs within the same room. Preserve existing browser event payloads.

On signaling disconnect, close stale peers and release capture; retain desired broadcast intent for reconnect. Recover the room before restarting capture and offering to current listeners. Stop cancels pending starts/reconnect restarts, stops every track, and closes peers. App exit explicitly ends the room where possible; crash/disconnect relies on backend expiry. A late capture promise must release its stream if the user already stopped.

## Proposed files and dependencies

- `desktop/package.json`, lockfile: Electron (development runtime), electron-builder (Windows packaging), socket.io-client, and a QR encoder. Pin resolved versions after compatibility verification. No paid service.
- `desktop/main.cjs`, `preload.cjs`: secure window, capture grants, application settings and exit handling.
- `desktop/index.html`, `renderer.js`, `styles.css`: room name/code, QR/join link, backend URL, connection state, listener count, capture state, Start/Stop.
- `desktop/src/capture/windows-loopback.js`: platform capture adapter and resource cleanup.
- `desktop/src/broadcaster-controller.js`, `webrtc-transport.js`: lifecycle and listener transport.
- `desktop/test/`: state transitions, cancellation races, reconnect/close behavior, peer and track cleanup.
- `server/desktop-rooms.js` and `server/test/desktop-rooms.test.js`: bounded desktop room ownership/registration behavior and tests; integrate into `server/index.js` without rewriting appliance management.
- `server/test/desktop-signaling.test.js`: real Socket.IO lifecycle, membership checks, browser protocol compatibility, and cleanup.
- `docs/windows-broadcaster.md`: exact PowerShell installation/run/package commands and Windows-to-phone test checklist.
- `README.md`: software-first entry point, retaining appliance instructions.

## Verification and implementation order

1. Record current server tests, client build, and lint baseline before implementation.
2. Implement and test desktop room registration/recovery plus bounded signaling validation, preserving legacy payloads.
3. Implement capture adapter and controller tests with injected capture/socket/peer dependencies. Test repeated Start, Stop during pending capture, denied/ended capture, disconnected socket, recovery failure, intentional close, listener departure, and stale asynchronous negotiation.
4. Build the Electron UI, native loopback binding, WebRTC transport, QR link, and Windows packaging script.
5. Run server/desktop tests and builds; document existing failures separately from new failures. Smoke-test ordinary browser host/listener room lifecycle and appliance protocol behavior. Physical Pi audio requires hardware validation.
6. On Windows, launch backend, listener frontend, and desktop app. Start capture with microphone access disabled, play a known YouTube/source signal, join from a phone by code and then QR, and verify audibility. Check Stop, restart, phone rejoin, backend restart, network interruption, app close, output-device changes, and absence of residual capture.

Use the existing deployed HTTPS listener when compatible backend changes are deployed, or a LAN-accessible development listener with the correct backend URL. A phone cannot reach the PC through its own localhost. Firewall and ICE connectivity must be checked; STUN-only operation is not reliable across every network. Do not introduce a paid relay in this phase.

## Acceptance boundary

Automated lifecycle tests and a successful build cannot establish real system-audio capture. Report actual Windows playback-to-phone verification separately, including Windows/Electron versions, output device, phone/browser, network, audibility, and observed delay. Until that test is completed, system capture and end-to-end audio remain unverified. macOS, Android TV, code signing, persistent backend room reservations, and larger-scale audio distribution are future work.

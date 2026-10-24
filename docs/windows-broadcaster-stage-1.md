# Stage 1 implementation and Stage 2 contract

Implemented backend-only desktop room ownership and recovery. No Electron application, audio capture, frontend redesign, dependency additions, or Pi audio changes are included.

## Files

- `server/desktop-rooms.js`: separate registration/recovery service, credential hashing/expiry, disconnect grace, and signaling permission helper.
- `server/index.js`: service wiring, protected desktop rooms across legacy recovery and appliance registration, directional signaling validation, single-room membership guards, and Socket.IO membership cleanup on room closure. Null-prototype room storage avoids inherited property collisions. Startup logs the actual bound port for ephemeral-port integration tests.
- `server/test/desktop-rooms.test.js`: seven deterministic lifecycle/security tests.
- `server/test/desktop-integration.test.js`: one live-backend integration test using ephemeral port, in-memory SQLite, and real Socket.IO clients.
- `docs/windows-broadcaster-plan.md`: original assessment plus Stage 1 status.
- This document: protocol, limitations, verification, and next steps.

## Protocol

Both new events require a Socket.IO acknowledgement callback. Without one, no registration or recovery occurs. Use a timeout and inspect `ok`; no legacy `room-created` event is emitted for desktop registration/recovery.

```js
socket.timeout(5000).emit('desktop:register', {
  roomCode: 'DESK', // optional: omit or use empty string for a generated code
  roomName: 'Living room PC' // optional, max 120 characters
}, (error, result) => { /* securely save result.credential on success */ });

socket.timeout(5000).emit('desktop:recover', {
  roomCode: savedRoomCode,
  credential: savedCredential
}, (error, result) => { /* restore room state only after result.ok */ });
```

Custom desktop codes must contain 1–32 ASCII letters/digits and are normalized to uppercase. Auto-generated codes use four cryptographically random bytes and collision checking. Existing browser/Pi code formats are unchanged.

Registration returns `{ok:true, roomId, roomName, credential, expiresAt, members, graceMs}`. The credential is 32 cryptographically random bytes encoded as 64 lowercase hex characters; it is independent of the room code. Only SHA-256 hash and absolute expiry are retained in the room. Constant-time hash comparison authenticates recovery. Credentials never appear in room lists, listener messages, or logs.

Recovery returns `{ok:true, roomId, roomName, members, expiresAt, graceMs}` without returning the secret. It requires an existing desktop room, matching unexpired credential, disconnected host, unexpired grace deadline, and a caller with no current room membership. Knowing the room code cannot recover a desktop room. Neither legacy browser recovery nor Pi registration can take it over during grace.

Failures return `{ok:false,error}`. Registration errors: `INVALID_REQUEST`, `INVALID_ROOM_CODE`, `INVALID_ROOM_NAME`, `ALREADY_IN_ROOM`, `ROOM_UNAVAILABLE`. Recovery uses `RECOVERY_DENIED` for missing, expired, incorrect, busy, or unavailable ownership; an already joined caller receives `ALREADY_IN_ROOM` after credential validation.

Environment settings (positive integer milliseconds, maximum 2147483647; invalid settings stop startup):

| Variable | Default | Meaning |
| --- | --- | --- |
| `SPORTSYNC_DESKTOP_GRACE_MS` | 15000 | Time after host disconnect to recover before room cleanup |
| `SPORTSYNC_DESKTOP_CREDENTIAL_TTL_MS` | 86400000 | Absolute credential lifetime from registration; recovery does not extend it |

Expiry revokes recovery authority, not an already authenticated live socket. There is no credential renewal endpoint in Stage 1. To obtain fresh credentials after expiry, explicitly end the live room and register anew. Expired disconnected rooms remain reserved until grace cleanup; they cannot be reclaimed through recovery.

Desktop disconnect marks broadcasting stopped, retains listeners during grace, and starts cleanup. Valid recovery cancels cleanup and requires an explicit `broadcast-started` when the future capture pipeline is ready. Explicit `end-room`/host `leave-room` immediately closes and invalidates the room/credential. Closing a room removes all Socket.IO room subscriptions, preventing old listeners from receiving events after the code is reused. Listener departures remove application membership and therefore signaling authority.

The listener receives `hostType: 'desktop'`, which uses the existing non-appliance WebRTC path. Existing `listener-joined`, `stream-requested`, `room-updated`, `broadcast-status`, and WebRTC payload formats remain available. Broadcast Start/Stop and room closure rely on the authenticated host socket identity. Membership guards prevent a socket from hosting and listening simultaneously or joining multiple rooms; duplicate joins to the same listener room remain supported.

## Signaling permissions

All browser and desktop WebRTC events are checked, not merely desktop events:

| Event | Allowed sender → target |
| --- | --- |
| `webrtc-offer` | Current room host → listener in that room |
| `webrtc-answer` | Listener → current host of that room |
| `webrtc-ice-candidate` | Either direction between that host/listener pair |

Self-targeting, outsiders, listener-to-listener traffic, cross-room traffic, wrong directions, and appliance-room WebRTC are rejected. SDP payloads require matching offer/answer types and string SDP; ICE requires a candidate object with string `candidate`. Malformed payloads produce `error-message` instead of crashing the handler. The backend always supplies sender identity; client-supplied sender fields are ignored. Pi PCM remains a separate validated transport.

## Verification results

Final `node --test` in `server/`, outside the filesystem/network sandbox: **19 passed, 0 failed, 0 skipped**. Includes all 11 existing appliance tests, seven new unit tests, and one live-backend integration test. The live test covers valid/invalid recovery, legacy recovery rejection, Pi takeover rejection during desktop grace, permitted offer/answer/ICE, rejected host impersonation, malformed signaling, unauthorized closure, grace cleanup, code reuse, ordinary browser registration/recovery, and Pi start/join/request-stream.

`npm run build` in `client/`: passed with existing bundle-size warning. `npm run lint`: passed with zero errors and two pre-existing hook dependency warnings. `git diff --check`: passed.

The original three appliance-config `EPERM` failures reproduce in sandbox temp storage, but the identical tests pass when TEMP/TMP point to a writable workspace directory, and all pass using normal temp storage outside the sandbox. No appliance-config production code was changed. The sandbox also prevents live Socket.IO loopback connections; that integration test passes outside it. These are environmental restrictions, not evidence requiring an unsafe non-atomic config-write fallback.

PowerShell verification from the repository root:

```powershell
npm --prefix server ci
Push-Location server
node --test
Pop-Location
npm --prefix client ci
npm --prefix client run build
npm --prefix client run lint
```

Run network integration tests in an environment permitting child processes and local loopback connections. No dependency installation was needed during this implementation because existing dependencies were present.

## Remaining security and validation boundaries

- Browser room creation remains anonymous and legacy browser recovery still trusts a code for disconnected browser rooms. Existing browser listeners cannot promote themselves on their current joined socket, but an attacker opening a fresh socket can still exploit that legacy recovery mechanism. Desktop ownership never uses it.
- New desktop room creation is anonymous; the credential proves ownership of that room, not a licensed device/account. Registration/recovery have no dedicated rate limit or per-account quota. Existing permissive CORS and public room discovery remain.
- Pi authentication is still optional when PI_HOST_TOKEN is unset, and uses a shared token when set. Existing Pi management security has not been redesigned.
- Credentials are bearer secrets. Production requires HTTPS/WSS and secure desktop storage in Stage 2; plaintext development HTTP is unsuitable for untrusted networks. Lost registration acknowledgements leave a room whose credential the caller cannot recover; disconnect cleanup releases it after grace.
- Ownership exists only in backend memory. Backend restart or room deletion invalidates credentials. Re-registering a free code creates a new room and credential, not proof of previous ownership. Do not silently fall back from failed recovery to an ownership claim; Stage 2 must distinguish new registration from recovery.
- No SDP negotiation-state machine or signaling rate limiting is introduced. Membership/role validation does not establish that supplied SDP or ICE is usable; the peer handles media negotiation.
- Tests verify backend protocol compatibility, not browser audio playback, QR camera operation, physical Pi capture, or actual Windows system playback. Those require manual end-to-end verification. Existing STUN-only networking limitations remain.

## Exact Stage 2 work

1. Add the isolated Electron app with sandboxed renderer, context isolation, a narrow preload API, local content, and capture grants limited to its own frame.
2. Store the registration credential using Windows-backed secure storage in the Electron main process; never place it in QR codes, URLs, room metadata, logs, or remote content. Persist code and expiry alongside it. Handle acknowledgement timeouts explicitly.
3. Build the room controller around the events above. On reconnect, clear old peers, recover with the saved credential before broadcasting, and surface denied/expired ownership. After backend restart/expiry, offer explicit new registration of a free code with a new credential.
4. Implement the Windows system-loopback capture adapter separately from room management, then attach audio tracks to per-listener WebRTC peers. Serialize offers and queue early ICE. Release tracks/peers on Stop, capture failure, disconnect, and exit; cancel late asynchronous starts.
5. Add room name/code, connection state, listener count, QR/join link, and Start/Stop controls. Reuse existing listener URL conventions.
6. Test lifecycle/capture cancellation and packaging, then perform real Windows playback-to-phone verification by code and QR. Record versions, output device, network, audibility, latency, reconnects, and Pi/browser regression results. Until then, make no system-audio success claim.

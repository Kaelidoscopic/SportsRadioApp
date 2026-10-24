# Windows desktop broadcaster — Stage 2

The Electron application is implemented in `desktop/`. It registers with the Stage 1 backend, captures Windows system playback using native loopback, and sends audio tracks over the existing WebRTC protocol. No microphone, Pi, sound card, cable, or browser-tab picker is used. The existing React listener and Pi PCM code are unchanged.

**Validation boundary:** on Windows 10.0.26200 with Electron 45.0.0, encrypted credential save/reload passed, native capture started with deviceId `loopback`, and a local WebRTC receiver received one audio track and zero video tracks. A separate Windows PowerShell/SoundPlayer process played a quiet 440 Hz tone; the receiver measured peak RMS **0.02853**, confirming nonzero playback audio crossed the capture/WebRTC pipeline. Stop completed. No real phone has been tested, and no human listening verification is claimed. The app's Live status, RTP bytes, or successful packaging alone do not establish audible end-to-end playback.

The initial receiver-only silence was a test-harness issue: it awaited AudioContext resume before wiring the receiving stream. Wiring the stream before resume and attaching a playback sink resolved it. Production phone listening already uses an audio element and was not modified for this test.

## Architecture and files

| File | Responsibility |
| --- | --- |
| `desktop/main.cjs` | Sandboxed window, trusted-frame IPC, one-shot capture permission, native Windows loopback grant, room socket, QR generation and clipboard |
| `desktop/preload.cjs` | Explicit room/capture/signaling methods and two filtered event subscriptions; no generic IPC or Node API |
| `desktop/src/credential-store.cjs` | Electron asynchronous safeStorage encryption backed by Windows DPAPI; atomic ciphertext writes and cancellation on ownership removal |
| `desktop/src/room-session.cjs` | Backend connection, registration, credential recovery, listener membership, broadcast status and shutdown |
| `desktop/src/validation.cjs` | Backend URL, room input and host signaling validation |
| `desktop/src/capture/windows-loopback.mjs` | Platform adapter returning an audio-only MediaStream; capture cancellation and release of every raw track |
| `desktop/src/broadcast-controller.mjs` | Start/Stop, disconnect suspension, recovery intent and capture/transport coordination |
| `desktop/src/webrtc-transport.mjs` | One peer per listener, audio tracks, offer/answer, queued early ICE and peer cleanup |
| `desktop/index.html`, `renderer.mjs`, `styles.css` | Minimal room/status/Start/Stop/listener-count/copy/QR interface |
| `desktop/test/` | Capture/controller, transport, encrypted store and main-process room-session unit tests |
| `desktop/scripts/check.cjs`, `smoke.cjs` | Syntax checks and optional hidden Windows runtime/loopback test |
| `desktop/package.json`, `package-lock.json` | Pinned dependencies and Windows packaging |

Other changes: `.gitignore` excludes build/smoke output; `README.md` links the software-first workflow; the architecture plan records Stage 2 status. The Stage 1 live-backend test's grace period was increased from 150 ms to 1000 ms because concurrent packaging caused a timing failure; production defaults are unchanged.

The main process owns Socket.IO and all credentials. Registration/recovery acknowledgements never cross IPC. Encrypted storage contains the backend URL, room metadata, expiry and credential; only public room state reaches the renderer. Backend changes never forward another backend's credential. HTTPS is required except localhost HTTP; a deliberately enabled `SPORTSRADIO_ALLOW_INSECURE_LAN=1` permits trusted development LAN HTTP. Avoid that override in production. DPAPI protects at rest against other Windows users, not malicious programs running as the same user.

The local renderer has context isolation, sandboxing, disabled Node integration, restrictive CSP, denied navigation/popups/webviews and no arbitrary IPC channel access. The main process validates the top-level sender frame, room membership, outgoing signaling and capture grants. All microphone permissions are denied. A capture request is allowed only for the app's own frame with a ready room and a short-lived explicit Start grant; the grant is consumed once and cancelled on Stop.

Electron's display-capture API requires an internal video source. The app keeps that low-frame-rate track alive for capture compatibility, creates a separate MediaStream containing only the loopback audio tracks, and passes **only those audio tracks** to WebRTC. Stop/disconnect/capture-ended releases both audio and internal video. No desktop images are transmitted to listeners.

New listeners and `request-stream` use the existing backend contracts. Membership updates close departed listeners' peers. Local ICE is sent after the offer; early incoming ICE is queued until the answer. Peers support multiple listeners without modifying the phone application. A brief disconnect stops capture and closes peers, retains broadcast intent, recovers authenticated ownership, and attempts to restart capture. If Windows/Chromium requires another gesture, select Start again. Denied/expired recovery never silently creates a replacement room; use Create New Room explicitly. Rooms/credentials still expire according to Stage 1.

## Install and run: exact PowerShell procedure

Use Windows x64 with Node 22.16+ (a current Node LTS is preferable). The backend uses `node:sqlite`. Keep the PC awake, select a normal active playback output, and put the phone on the same non-isolated Wi-Fi for the first test.

Install once, from the repository root:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp'
npm --prefix server ci
npm --prefix client ci
npm --prefix desktop ci
```

Terminal 1 — backend:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\server'
$env:PORT = '5000'
node index.js
```

Terminal 2 — existing phone website, configured for this PC's backend:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp'
$pcAddress = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1).IPv4Address.IPAddress
$pcAddress
$env:VITE_BACKEND_URL = "http://${pcAddress}:5000"
$env:VITE_FRONTEND_URL = "http://${pcAddress}:5173"
npm --prefix client run dev -- --host 0.0.0.0 --port 5173
```

Check the displayed IP is the Wi-Fi/LAN address reachable by the phone, not a VPN address. If necessary set `$pcAddress = '192.168.1.50'` to the actual PC address before setting the URL variables. Windows Firewall must permit Node on the private network for TCP ports 5000 and 5173. Do not disable the firewall. Guest Wi-Fi/client isolation can prevent WebRTC even when the website loads.

Terminal 3 — desktop:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp'
$pcAddress = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1).IPv4Address.IPAddress
$env:SPORTSRADIO_BACKEND_URL = 'http://localhost:5000'
$env:SPORTSRADIO_LISTENER_URL = "http://${pcAddress}:5173"
npm --prefix desktop start
```

In the desktop application:

1. Confirm Connected. Enter a room name and optional code, then select **Create New Room**. Blank code generates a code. Saved credentials are recovered automatically when still valid; Recover Saved Room retries explicitly.
2. Select **Start Broadcasting**. No microphone permission or tab-sharing selection should appear. Wait for Live. Live indicates a capture track was acquired and attached; it does not prove sound is present.
3. Play an ordinary YouTube video in the PC browser, or audio in another Windows application. First verify it is audible through the selected PC playback output.
4. On the phone open the `http://PC-IP:5173` website printed above, choose Listener and enter the displayed room code. Alternatively scan the desktop QR using the phone's native Camera app. Tap Start Listening/Resume Audio if prompted.
5. Confirm the phone reproduces the same audio. Observe listener count and peer connection status in the desktop app. Headphones on the phone help separate its sound from the PC speakers.
6. Select **Stop Broadcasting** and verify phone audio stops. Restart and verify audio resumes. **End Room** releases ownership and the code; Stop alone retains the room.

A public HTTPS listener can only be used when it points at the **same updated backend** as the desktop app. A deployed listener configured for Render cannot hear rooms created on localhost. Do not put `localhost` in a QR URL intended for a phone. Native camera QR opening works for LAN HTTP; the website's camera scanner generally requires HTTPS.

For a deployed setup set `SPORTSRADIO_BACKEND_URL` to the deployed HTTPS Stage 1 backend and `SPORTSRADIO_LISTENER_URL` to its associated HTTPS listener. STUN-only networking may fail between restrictive networks; first demonstrate on the same LAN.

## Build and tests

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp'
npm --prefix desktop test
npm --prefix desktop run check
npm --prefix desktop run build
# Optional single-file, unsigned Windows portable executable:
npm --prefix desktop run dist
Push-Location server
node --test
Pop-Location
npm --prefix client run build
npm --prefix client run lint
```

Default output: `desktop/release/win-unpacked/SportsRadio Broadcaster.exe`, or `desktop/release/SportsRadio Broadcaster 0.1.0.exe` for portable packaging. Ship the entire unpacked folder if using the unpacked build. The portable executable needs no separate Node installation. Builds are unsigned and use Electron's default icon.

OneDrive caused `EPERM`/`EBUSY` locks during the initial archive-based build here. The configuration now uses the installed Electron distribution. If the output is still locked, build outside OneDrive:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\desktop'
$desktopBuildOutput = Join-Path $env:LOCALAPPDATA 'SportsRadio-build'
& '.\node_modules\.bin\electron-builder.cmd' --win portable --x64 "-c.directories.output=$desktopBuildOutput"
```

Test environments must permit child processes, local loopback networking and atomic temp-file renames. As in Stage 1, restricted sandbox temp storage can produce `EPERM`; unchanged tests pass outside that sandbox. Do not replace encryption or atomic writes with a plaintext/non-atomic fallback.

Optional hidden local runtime check (backend already running):

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp'
$env:SPORTSRADIO_BACKEND_URL = 'http://localhost:5000'
npm --prefix desktop run smoke
# Optional brief quiet tone from a separate PowerShell playback process:
$env:SPORTSRADIO_SMOKE_TONE = '1'
npm --prefix desktop run smoke
Remove-Item Env:SPORTSRADIO_SMOKE_TONE
```

Results are written to `desktop/.smoke/result.json`, including track count, RTP statistics, storage checks and optional received tone RMS. The tone mode fails if it measures silence. The test harness enables autoplay for its receiver only; production playback policies remain unchanged. This is a local software receiver, never a substitute for phone acceptance.

## Diagnosing problems

| Symptom | Check |
| --- | --- |
| App cannot connect | Backend URL, running backend, port, TLS certificate, firewall. The backend must include Stage 1 events. Old deployments cause registration timeouts. |
| Recovery denied | Backend restart, room ended, grace elapsed, absolute credential expiry (24 hours default), or another host active. Create a new room explicitly; using the same free code creates new ownership. |
| Startup cannot decrypt saved data | Use the same Windows account and app profile. Do not copy encrypted ownership between users. With the app closed, rename `%APPDATA%\SportsRadio Broadcaster\room.dpapi` to a backup and create a new room; old ownership is not recovered. `SPORTSRADIO_USER_DATA` overrides the profile path for tests. |
| Capture denied / no live track | Use Windows with an active playback output and a desktop session; retry Start. Check Windows privacy/security restrictions and remote-session limitations. No microphone permission is needed. No source-picker fallback is used. |
| Live but silence | Verify PC audio is actually audible, application and output-device volume are nonzero, the application uses the normal Windows output, and the phone has tapped Play/Resume and has media volume up. Try an unprotected local audio file. Stop/Start after switching outputs. DRM-protected audio can be unavailable to capture. Compare tone RMS with RTP statistics; packets alone do not prove audio content. |
| Phone sees room but peer fails | Use same LAN first, disable guest/client isolation for the test network, check desktop peer status and host firewall. WebRTC uses UDP as well as signaling TCP. There is no TURN relay in this release. |
| Audio stops on reconnect | Recovery is allowed only during grace and before credential expiry. Capture is released on disconnect. If automatic capture restart is denied by gesture policy, click Start again. Long outages/backend restart require explicit new registration. Phone browsers may require another Play tap. |
| QR points to wrong room server | Set Phone listener website URL to a site built with this backend URL and update the QR. The frontend and backend URLs serve different purposes. |

## Manual acceptance checklist (pending)

- [ ] Record Windows build, Electron version, playback output, phone model/browser and network.
- [ ] With microphone access disabled and no external audio hardware, hear YouTube playback on the PC and then on the phone by room code.
- [ ] Join by QR; verify code and QR resolve to the same backend/room.
- [ ] Verify an ordinary non-browser Windows playback source too.
- [ ] Confirm a second phone receives audio; listener count updates and one departing listener does not interrupt another.
- [ ] Stop removes capture and stops phone audio; Start works again without microphone/tab sharing.
- [ ] Stop during capture startup; no late capture or broadcast appears.
- [ ] Briefly interrupt networking, restore within grace, and verify authenticated recovery/restart or a clear Start retry prompt.
- [ ] Stop while disconnected; reconnection must not resume broadcasting.
- [ ] Restart backend / exceed grace; recovery fails visibly and explicit registration is required.
- [ ] End Room and close app; verify peers/capture end and no stale listener subscription survives code reuse.
- [ ] Switch Windows output; document whether Stop/Start is required.
- [ ] Smoke-test browser host → phone and physical Pi → phone playback. Backend protocol tests cover them, not physical audio.
- [ ] Record audibility, observed delay, dropouts and whether phone unlock/backgrounding needs Resume Audio.

## Results and next work

Final verification: **19 desktop unit tests passed; 19 backend tests passed**. Client build and desktop syntax checks passed; client lint passed with zero errors and two existing hook warnings. The existing client bundle-size warning remains. Windows unpacked and portable packaging passed using an output folder outside OneDrive. No frontend code was changed. Dependencies are pinned to Electron 45.0.0, electron-builder 26.18.0, Socket.IO client 4.8.4 and qrcode 1.5.4; installation audit reported zero vulnerabilities.

Next priority is an interactive Windows-to-real-phone acceptance run using the procedure above. Then verify output-device changes, reconnect timing and multiple real phones. Production hardening (code signing, credential renewal/persistent backend reservations, TURN strategy and legacy browser/Pi security) remains separate work. Other operating systems/TVs intentionally remain unsupported.

# Windows → phone silent-audio diagnosis and fix

## Finding

A confirmed listener negotiation race can leave the room joined with no media connection. In the previous React code, `startListening()` called `cleanupListenerConnection()` whenever the peer was not yet connected, even if an offer was being processed. The desktop coalesced requests while waiting for that offer's answer, with no deadline. Tapping Start Listening (or a scheduled automatic start) at the wrong time could therefore close the receiving peer and leave the desktop waiting indefinitely. Room membership and Broadcasting: Live did not expose this distinction.

This is the most likely implementation failure for the reported symptoms. The exact phone session has not been inspected, so its final root cause is not conclusively established; autoplay and local-network policy must still be checked using the diagnostics below.

Confirmed supporting defects: listener ICE could be dropped before a peer/remote description existed; an old asynchronous offer could send an answer after its peer was replaced; streamless track events were not handled; autoplay rejection did not set the persistent gesture-required state. The UI called the room LIVE even without a connected peer or incoming audio.

## Evidence

The public deployed Vercel JavaScript bundle was inspected and points at `https://sportsradioapp.onrender.com`. A separate test room was used; no existing user room was touched.

| Check | Result |
| --- | --- |
| Pre-fix React, real Chromium, Start during offer | Closed peer in `have-remote-offer`; 0 inbound bytes; desktop offer pending, 0 outbound bytes, listener count 1 |
| Corrected React, same controlled timing | Peer and ICE connected, answer sent/applied, inbound/outbound counters increasing, audio element unmuted and playing |
| Corrected local React using deployed Render signaling | Passed: connected peer/ICE, about 19 KB inbound after 12 seconds, element paused=false and readyState=4 |
| Windows native loopback after transport changes | Passed: separate PowerShell SoundPlayer tone measured about 0.02844 RMS at a local WebRTC receiver, 1 audio track and 0 video tracks |
| Actual phone listening | Pending; no claim of verified phone playback |

The runtime regression uses the actual React application, not only a mocked peer or the synthetic receiver from Stage 2. It includes an optional deliberate Start click during SDP negotiation to make the timing reproducible. Autoplay is allowed in this test harness, so mobile gesture behavior remains a separate manual check. The production Render test used a locally served corrected React build, not the still-old public Vercel UI.

An initial restricted-sandbox desktop test hit the already-known atomic-file-rename EPERM; the full desktop suite passes with normal Windows temp permissions. Early runtime harness failures were corrected before the results above; temporary harness data/builds are ignored under `desktop/.smoke`.

## Pipeline assessment

1. `WindowsLoopbackCapture` still requests Electron-granted Windows `loopback`, not a microphone or tab source. The internal video track remains private. Only the audio tracks enter the outgoing MediaStream.
2. Desktop `WebRTCTransport` creates one peer per listener and calls `addTrack(track, stream)` for each captured audio track. No video is added. Runtime source/RTP diagnostics confirm samples continue after a receiver joins.
3. Main-process `RoomSession` retains credentials and forwards only allowed host signaling. The backend's room/role checks allow host offers, listener answers and ICE in either direction within the room. The deployed backend successfully relayed this flow in the test room.
4. React's new `ListenerWebRTC` helper owns peer lifetime and early ICE. Offers/answers retain the existing event names and payloads. Local ICE is emitted after the answer, also improving compatibility with browser hosts.
5. Remote audio attaches to the audio element, with a MediaStream fallback for streamless track events. Playback is explicitly unmuted. NotAllowedError exposes a Start Listening gesture prompt; replaying the same stream does not destroy a connecting peer.

Render carries Socket.IO signaling, not the WebRTC audio packets. STUN-only connectivity can still fail across restrictive NAT/firewalls or isolated Wi-Fi, but a successful Render socket connection does not establish that failure. The same-Wi-Fi report and reproduced negotiation race favor fixing negotiation first. No paid relay/service or TURN configuration was introduced. References: [WebRTC connection overview](https://webrtc.org/getting-started/peer-connections), [early ICE requirements](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addIceCandidate).

## Files changed

- `client/src/listener-webrtc.js` (new): testable offer/ICE lifecycle, stale-operation cancellation, stream attachment, safe audio playback and allowlisted RTP statistics.
- `client/src/App.jsx`: use that helper, preserve connecting peers, track autoplay state, sanitize WebRTC errors and stop diagnostic polling on cleanup.
- `client/src/ListenerDashboard.jsx`: accurate media status, persistent Start/Retry controls, playsInline and an Audio diagnostics panel.
- `client/test/listener-webrtc.test.mjs` (new), `client/package.json`: six regression tests and the test command. No new frontend dependency.
- `desktop/src/webrtc-transport.mjs`: bounded answer wait, queued retry, per-peer signaling/ICE state and RTP/source statistics.
- `desktop/src/peer-diagnostics.mjs` (new): explicit safe statistics allowlist.
- `desktop/test/transport.test.mjs`: timeout/retry and diagnostic privacy tests.
- `desktop/renderer.mjs`, `index.html`, `styles.css`: visible capture/peer diagnostics sampled every two seconds.
- `desktop/main.cjs`, `package.json`, `package-lock.json`: version 0.1.1 and display its version in the UI.
- `desktop/scripts/listener-smoke.cjs` (new): real React runtime regression test using isolated encrypted test storage and a dedicated room.
- This document, plus a link from the broadcaster operation guide.

Diagnostics contain track live/enabled/muted state; SDP stage success/failure; peer, ICE and signaling states; audio bytes/packets; source energy/duration/level; selected candidate **types**; audio element paused/muted/readyState and error names/codes. No credentials, full SDP, ICE strings/addresses or auth tokens are logged. No backend source, room authentication, Pi PCM transport, hosting configuration or QR protocol changed.

## Verification and deployment

- Backend: **19 tests passed**.
- Desktop: **21 tests passed**.
- Frontend helper: **6 tests passed**.
- Frontend production build passed; existing bundle-size warning remains.
- Frontend lint passed with zero errors and two existing dependency-array warnings.
- Desktop syntax and Git whitespace checks passed. Windows portable 0.1.1 packaging passed (unsigned).

**Vercel needs a frontend redeployment** containing the corrected React source. **Render needs no backend code/configuration change** for this fix; its current signaling was exercised successfully. A push to main could still trigger its configured automatic deployment. Release these fixes through the existing main-branch Git integration and verify that the Vercel production deployment matches the pushed commit before phone acceptance.

Use the new **desktop 0.1.1 executable** for the timeout/retry behavior and diagnostics. The old desktop may benefit from the frontend fix alone, but it lacks the new safeguards and observability. Close every old broadcaster instance first, then verify the footer says 0.1.1. Ownership remains encrypted in the same Windows profile.

## Exact real-phone acceptance procedure

1. Deploy the updated frontend to the existing Vercel site with its existing backend URL. Do not change the URL to localhost. On the phone reload the site fully or use a fresh private tab; confirm Audio diagnostics and Retry audio connection are visible. Without those controls, the phone is still running the old frontend.
2. Close the 0.1.0 broadcaster, open 0.1.1, and connect to `https://sportsradioapp.onrender.com`. Create a fresh room/code for this test. Leave the Phone listener website URL as `https://sports-radio-app.vercel.app`.
3. Start a normal, unprotected YouTube video or local audio file on Windows. Confirm it is audible on the PC's normal output. Select Start Broadcasting.
4. Open Audio diagnostics on the desktop. Capture must be live, enabled=true, muted=false. After the phone joins, compare two readings 5 seconds apart: `sourceDuration` must advance and `sourceEnergy` must grow while sound is playing. A zero instantaneous `audioLevel` between sounds alone is not an error.
5. Keep the phone on the same Wi-Fi, open the listener site, and join the room. Tap Start Listening if shown. Also test tapping while it is connecting; the peer must not be discarded just because connection is pending.
6. Expand Audio diagnostics on the phone. Expect offer=received, answer=sent, connection=connected, ice=connected/completed, and increasing bytes/packets. Playback must have paused=false, muted=false, readyState at least 2, and playbackError=null. Turn the phone's media volume up and listen using headphones if possible.
7. If a gesture is required, tap Start Listening once more. If an old negotiation failed, use Retry audio connection. Compare the desktop peer's offer=sent, answer=applied, increasing bytesSent/packetsSent and the phone's increasing inbound counters.
8. Verify audible content, Stop/Start, phone rejoin, two listeners, and brief network interruption. Record phone model/browser, network, the diagnostic readings and whether actual audio was heard. Real-phone acceptance remains pending until this is done.

Interpretation:

| Observation | Failure boundary / next action |
| --- | --- |
| Capture live, but source energy never increases during audible PC playback | Output route/capture source; Stop/Start after choosing normal Windows output, try unprotected local audio |
| Offer sent, answer pending | Frontend/signaling/negotiation; ensure corrected frontend loaded, then Retry; desktop now releases unanswered offers after 12 seconds |
| Answer applied, ICE checking/failed, bytesSent remains 0 | Direct media path/firewall/Wi-Fi isolation; test same non-guest Wi-Fi; TURN is a separate next step if direct ICE demonstrably cannot connect |
| Connected, outbound bytes increasing, no inbound bytes | Receiver/path failure; capture both panels and Retry |
| Inbound bytes increase but playbackError=NotAllowedError or paused=true | Phone playback gesture; use Start Listening, not a new room |
| Incoming audio and player running, but still inaudible | Check changing source/received energy, phone volume/output, Bluetooth routing and actual source content |

To test corrected React locally before publishing it (same Wi-Fi only):

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\client'
$env:VITE_BACKEND_URL = 'https://sportsradioapp.onrender.com'
npm run build
& '.\node_modules\.bin\vite.cmd' preview --host 0.0.0.0 --port 5178
```

Open `http://PC-LAN-IP:5178` on the phone, with Node allowed on the private network. Use the desktop's Render room code. This is a receiving-only diagnostic page; use the deployed HTTPS frontend if the phone restricts WebRTC on LAN HTTP. Do not open localhost on the phone. This local preview does not update Vercel.

Developer checks:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp'
npm --prefix client test
npm --prefix client run build
npm --prefix client run lint
npm --prefix desktop test
npm --prefix desktop run check
Push-Location server
node --test
Pop-Location
```

Optional actual-React runtime regression (serve a frontend built for the selected backend first):

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\desktop'
$env:SPORTSRADIO_BACKEND_URL = 'https://sportsradioapp.onrender.com'
$env:SPORTSRADIO_TEST_LISTENER_URL = 'http://127.0.0.1:5178'
$env:SPORTSRADIO_TEST_START_DURING_OFFER = '1'
& '.\node_modules\.bin\electron.cmd' scripts/listener-smoke.cjs
```

This creates and closes its own test room and writes `desktop/.smoke/listener-result.json`. It does not touch an existing listener room or verify a physical phone.

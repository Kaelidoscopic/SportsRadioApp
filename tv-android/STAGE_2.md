# Android TV Stage 2 — native WebRTC broadcaster 0.2.0

Stage 1 is committed/pushed as `a5518eb228c9ba456bb89627af525809e8170d52`, including the user's Hisense HiSmartTV A4 / Android TV 11 (API 30) results: capture RMS 0.057152 (−24.9 dBFS), peak 0.079987, 1025 measured windows. Stage 2 extends that capture adapter; it does not change Windows, React, backend, Render/Vercel settings or Pi transport. Stage 2 / version 0.2.0 is functionally verified on the user-reported TV-to-iPhone configuration below.

## Implementation

- Native `AudioPlaybackCapture` remains the only audio input. MediaProjection consent and foreground-service order are preserved. No microphone capture, root, protected-content bypass or paid hosted SDK is used.
- `BroadcastRuntime` connects to `https://sportsradioapp.onrender.com`. TV UI displays room name/code, listener count, connection/authentication messages, capture RMS/peak, native input and RTP counters. D-pad controls create/recover/end rooms and Start/Stop Broadcasting. Room creation precedes projection consent; capture Stop/Start does not end a connected room.
- `room/RoomSession.kt` reuses `desktop:register`, `desktop:recover`, timed acknowledgements, `room-updated`, `listener-joined`, `stream-requested`, `broadcast-started/stopped`, `end-room`, and the existing SDP/ICE events. Server identifies this compatible software host as `desktop`; phone listener follows its existing WebRTC branch.
- `EncryptedOwnershipStore` uses an Android Keystore AES-GCM key and atomic ciphertext in app-private no-backup storage. The secret is backend-scoped, independent of the room code, absent from UI/QR/logging, and redacted in debug string representations. There is no plaintext fallback. Registration is cancelled if secure persistence fails.
- On network loss, peers and capture stop; Socket.IO reconnects and authenticates saved ownership. A new capture requires user Start and fresh projection consent. Recovery denial never silently creates a room. A dead connection can remain known to the backend until its transport heartbeat expires, so the app retries **the same credential** every two seconds for at most 60 seconds. The server still enforces ownership, expiry and its own grace. A timeout or final denial is explicit; Create New Room is a user action.
- `transport/PcmQueue.java` accepts every PCM frame **before** the Stage 1 meter's 10 Hz sampling. It reframes partial reads into PCM16 mono 48 kHz / 480-sample blocks. Five-block queue bounds pending audio to 50 ms; underruns supply zeros and overflow drops oldest frames. Queue drops while there are no listeners are expected. No PCM files are recorded.
- A custom playback-only `org.webrtc.audio.WebRtcAudioRecord` feeds that queue through the pinned SDK's existing native recording JNI into its AudioDeviceBuffer/encoder. It never constructs Android AudioRecord. See `WEBRTC-NOTICE.md` for the checksum-verified AAR transformation, exact ABI dependency and packaged licenses. The SDK microphone recorder for this ADM is removed; no reflection or Android native hooking is involved.
- `WebRtcAudioTransport` owns one native audio source/track and one send-only RTCPeerConnection per listener. No video transceiver is created. Capture source samples are shared, not reacquired for each phone. `HostPeers` preserves offer-before-local-ICE, queues early remote ICE until an answer, ignores stale async completions, coalesces pending retries, expires unanswered offers, and closes only departed peers.
- Stop/revocation/task removal/error releases capture, native peers/track/source/factory/ADM, clears PCM, stops projection and foreground service. Returning with Home does not stop a running broadcast. Removing/exiting the app disconnects its host session; saved ownership is recoverable only while backend policy permits.

## Verification

Automated Android tests cover capture lifecycle/levels (5), room ownership/signaling/recovery (8), and PCM framing/queue + peer negotiation lifecycle (7): **20 passed**. `:app:assembleDebug`, `:app:lintDebug`, `:test-player:assembleDebug` and `:test-player:lintDebug` pass. Warnings about prototype English strings, banner, pinned dependency updates and unstripped SDK libraries are not test failures. Both build and native ABI are tied to the checked SDK version; do not upgrade blindly.

Preservation-pass regressions: backend **19/19**, desktop **28/28** plus JavaScript syntax checks, and frontend **6/6** pass. Backend browser/Pi compatibility integration is retained. Android debug APK signature verification passes. Frontend production build and lint pass, retaining two existing React hook warnings and the bundle-size warning. No backend deployment is required by these TV-only changes.

### Physical TV → controlled WebRTC receiver

The attached physical **Hisense HiSmartTV A4, API 30**, was updated through ADB. An explicitly eligible, separate Test Player app supplied ordinary Android AudioTrack playback. The TV registered with the existing Render backend, captured playback PCM and negotiated audio-only native WebRTC to an Electron test receiver on Windows.

Measured positive check: **peak decoded receiver RMS 0.056904**, connected ICE/peer, 967 received RTP packets / 71111 bytes, 918720 decoded samples, one audio track and **zero video tracks**. TV showed capture RMS about 0.0562 and increasing nonzero native-input energy while a receiver was connected.

Two simultaneous controlled receivers also passed: peak decoded RMS **0.056665** and **0.056853**; each connected and decoded nonzero audio. Listener departure and subsequent rejoin produced replacement peers without restarting native capture. These are controlled Windows receivers, **not two real phones**, and no synchronized output is promised.

On the final recovery-enabled APK, both concurrent receivers again passed with peak decoded RMS **0.056990** / **0.056628**, each reporting a maximum of two listeners, one audio track, no video and no playback/context errors. A physical app process restart recovered the **same room** using encrypted ownership in **23.88 seconds**. An initial single-attempt recovery check failed while the old connection was still being timed out; this led to the bounded same-credential retry fix and two regression tests. No backend validation or grace setting was changed.

Physical Stop Broadcasting was checked: `dumpsys media_projection` no longer listed SportsRadio, the capture service was absent, and displayed RMS/peak and measured windows reset to zero. A fresh Start in the same connected room requested new projection consent and restored decoded receiver RMS **0.056924**. This establishes one physical Stop/Start cycle, not three cycles or real-phone audibility. Remote D-pad focus movement and selection of Start / Android's Start Now were exercised on the TV. Multi-key ADB injection was unreliable; separate D-pad events worked.

Initial negative receiver-harness checks were not counted as passes. The fixture must actually be playing; the receiver also needs a bound media element in addition to its Web Audio graph to trigger reliable decoding. `tools/receiver-smoke.cjs` now explicitly attaches a muted audio element, uses a zero-gain analysis sink, and requires decoded RMS above 0.0001, RTP packets, connected state, one audio/no video. It never asserts phone audibility. Received `totalAudioEnergy` remained zero even during nonzero decoded PCM; that counter alone is not a silence verdict.

### User-confirmed TV-to-iPhone acceptance

The user reports successful end-to-end playback using **Hisense HiSmartTV A4, Android TV 11 (API 30), SportsRadio TV Broadcaster 0.2.0**, and an **iPhone using the deployed SportsRadioApp web listener**. TV playback capture, room registration/broadcast through the existing backend, phone joining, and **audible audio on the iPhone** all passed. This is user-confirmed physical acceptance evidence, not an agent-observed phone listening test.

The source application/version, iPhone/browser version and test duration were not supplied. Functional verification applies to this tested configuration; commercial streaming applications, HDMI sources, other TV models/ABIs, two real phones, long-duration broadcasting and physical Wi-Fi outage recovery remain unverified.

## Build / update using Windows PowerShell

Prerequisites: Android SDK platform 36, build-tools 36.0.0, platform-tools, compatible JDK (17+; this checkout verified with JDK 25.0.2). Gradle 9.3.1 and AGP 9.1.1 are pinned. An existing task-local SDK is available on this machine:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\tv-android'
$taskAndroidTools = 'C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879\android-tools'
$env:JAVA_HOME = 'C:\Users\ninte\Java\JDK\oracleJdk-25'
$env:ANDROID_HOME = "$taskAndroidTools\sdk"
$env:GRADLE_USER_HOME = "$taskAndroidTools\gradle-home"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :test-player:assembleDebug :test-player:lintDebug
if ($LASTEXITCODE -ne 0) { throw 'TV verification failed.' }

adb devices -l
$tvSerial = 'YOUR_TV_SERIAL' # Use the authorized USB serial or IP:port from adb devices.
adb -s $tvSerial install -r '.\app\build\outputs\apk\debug\app-debug.apk'
if ($LASTEXITCODE -ne 0) { throw 'TV installation failed.' }
adb -s $tvSerial shell am start -n com.sportsradio.tv.capture/com.sportsradio.tv.MainActivity
# Optional positive/negative control player:
adb -s $tvSerial install -r '.\test-player\build\outputs\apk\debug\test-player-debug.apk'
```

For another machine, install Android Studio/SDK and adjust JAVA_HOME/ANDROID_HOME; remove or correct the **ignored** `local.properties` SDK override. The README's Stage 1 section has developer-options / USB or supported wireless ADB pairing instructions. Do not use uninstall or `pm clear` for a normal update: they remove app ownership/key material. Debug signing must match the installed app; resolve any mismatch deliberately rather than automatically deleting data. Updating/stopping the process requires fresh projection consent afterward.

If the TV is in its screensaver, press Home before opening SportsRadio. On the TV:

1. Connect / Recover Saved Room; if denied/expired, explicitly Create New Room.
2. Check room code and backend connection, then Start Broadcasting.
3. Approve Android recording/projection permissions. RECORD_AUDIO is Android's mandatory playback permission, not microphone input. Only eligible application playback is captured.
4. Press Home, play the Test Player's eligible tone or an unprotected source in another app, then return to SportsRadio to check nonzero RMS.
5. On the real phone open `https://sports-radio-app.vercel.app`, enter the TV room code and tap Start Listening. Adjust phone output volume/routing and **listen**. Save audible pass/fail separately from packet counters.

The portable debug APK is `app/build/outputs/apk/debug/app-debug.apk`, version **0.2.0**, package `com.sportsradio.tv.capture`. Build artifacts, local SDK paths, test receiver profiles and ownership data are ignored and must not be committed.

## Repeatable controlled receiver check (development only)

Requires the existing desktop development dependencies (`npm --prefix desktop ci` from the repository root). This script receives/analyses TV WebRTC; it does not play sound into Windows speakers or certify a phone.

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\tv-android'
$env:SPORTSRADIO_TV_ROOM = 'ROOM_CODE_FROM_TV'
$env:SPORTSRADIO_TV_REPORT_NAME = 'receiver-one'
& '..\desktop\node_modules\.bin\electron.cmd' tools/receiver-smoke.cjs
# Run a second instance in another PowerShell window with report name receiver-two
# to test concurrent listeners. Ignored results: .runtime/<report-name>.json.
```

## Physical TV-to-phone acceptance checklist — pending unless stated above

- [x] User confirms audible TV-to-iPhone playback on the configuration above. Phone/browser version, source app/version and duration remain unspecified; controlled Windows receiver results are separate evidence.
- [ ] Pause/stop source: capture RMS falls and SILENT warning appears; resume source: PCM/native energy grows again. Cumulative energy does not fall during silence; instantaneous RMS does.
- [ ] Two real phones hear audio simultaneously; one leaves/rejoins without interrupting the other. Check count, peer cleanup, native input and each phone's RTP.
- [ ] Repeat Stop/Start three times in the same connected room with fresh projection consent. Stop must end projection/capture/peers and reset live levels; Start reuses the room and restores audible audio.
- [ ] Brief network interruption: media stops safely, saved ownership recovers within server policy, then user Start requests fresh capture consent. Longer outage/expired credentials/backend restart must show an explicit failure, never take over a code.
- [ ] Revoke projection, exit/remove app task and test TV standby. Check resource cleanup and no automatic reuse of consumed consent.
- [ ] Continuous playback for 30 minutes, with TV app backgrounded while source app is foreground. Record dropouts, CPU/thermal behavior, memory and recovery; this is not yet certified.
- [ ] Real target applications are individually tested for capture eligibility. Netflix/protected sources, HDMI/tuner/ARC/eARC and all TV sounds are not promised. Do not bypass source policies or substitute microphone capture.

Known limits: STUN-only networking, no TURN service yet; same-LAN success does not establish cross-network connectivity. Backend rooms remain in memory with default 15-second disconnect grace and 24-hour recovery credential lifetime, not permanent reservations. The custom JNI recording endpoint requires ABI review on SDK upgrades. The app has room-code joining but no TV QR UI in this stage; existing phone QR behavior and Windows QR support are unchanged. Native TV app still uses the existing `desktop` software-host contract; no backend host-type migration is performed.

At the end of verification, temporary playback/capture and the test room are stopped/ended; repeat the creation and consent steps for a phone acceptance run. Results/receiver profiles remain ignored under `.runtime/`; the distributed APK contains no room credential or test-room configuration.

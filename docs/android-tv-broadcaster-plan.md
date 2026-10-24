# Android TV / Google TV broadcaster prototype

Status: researched implementation proposal, 2026-10-24. Windows MVP preserved first in `7a19057`. No Android application, capture feasibility, third-party app compatibility or TV-to-phone playback is claimed implemented or verified.

## Product boundary and feasibility gate

Build a minimal native Kotlin TV application in `tv/android/`: remote-control accessible room name/code/QR, Start, Stop, listener count, connection/capture state and PCM meter. Reuse the current backend and phone listener. No microphone fallback, root requirement, HDMI hardware, paid service or frontend rewrite.

Android 10/API 29 introduced AudioPlaybackCapture. It requires `RECORD_AUDIO`, user-approved MediaProjection and the same user profile as the playing app. Eligible usages are MEDIA, GAME and UNKNOWN; the source must allow capture by other apps. Apps targeting 29+ allow capture by default but can opt out; older targets require opt-in. Manifest, runtime and per-player restrictions combine using the most restrictive policy. Broadcaster permissions cannot override the source application's policy. See [Android playback capture guide](https://developer.android.com/media/platform/av-capture).

Consequently this is **capture of eligible Android application playback**, not a promise of every sound from every TV input. API level alone does not establish that a TV manufacturer exposes a usable projection consent flow. Test the exact physical model/firmware before committing to product support.

| Source | Prototype expectation / required evidence |
| --- | --- |
| Separate test player with explicit capture opt-in and ordinary PCM playback | First positive control; verify nonzero capture and later audible phone reception on physical TV. |
| Third-party media apps, including YouTube | Unknown per app/version/device; measure on hardware, never infer support from API level or Windows success. |
| Netflix and other protected/commercial streams | No support promise. App policy or protected playback may prevent capture; do not attempt to bypass it. |
| Games | Potentially eligible if usage/policy permit; test actual title. |
| System notifications, voice calls, assistant, microphone | Outside the intended capture usage; do not substitute microphone. |
| HDMI input / tuner / ARC or eARC audio | Outside the ordinary-app prototype guarantee; no public generic capture of these inputs is established by this research. Treat unsupported unless vendor-authorized integration is separately proven. A streaming box cannot capture audio produced by unrelated TV inputs merely by being plugged into HDMI. |

Marketing must identify tested device/source combinations. If the consent flow is absent or the target source disallows capture, report unsupported/blocked rather than Live with silent audio.

## Capture and service lifecycle

Use `MediaProjectionManager.createScreenCaptureIntent()` from a visible Activity, then a mediaProjection foreground service and `AudioRecord.Builder.setAudioPlaybackCaptureConfig(...)`. Match the three eligible usages and prefer excluding our own UID so diagnostics never feed back. Capture PCM16, initially mono 48 kHz / 10 ms frames (480 samples); verify support, buffer minimum, read counts and actual rate. A format adapter handles explicit resampling/channel conversion if needed. No video track or video encoder; do not create a virtual display solely to transmit audio. Prove the audio-only permission/service sequence on hardware. The [AudioRecord builder API](https://developer.android.com/reference/android/media/AudioRecord.Builder#setAudioPlaybackCaptureConfig(android.media.AudioPlaybackCaptureConfiguration)) provides the playback capture configuration; [configuration API](https://developer.android.com/reference/android/media/AudioPlaybackCaptureConfiguration) provides usage/UID matching.

Declare INTERNET, RECORD_AUDIO and FOREGROUND_SERVICE, plus FOREGROUND_SERVICE_MEDIA_PROJECTION and service type `mediaProjection` for current targets. Request runtime recording permission even though this adapter never opens a microphone. Start from the user action and follow consent/service ordering; do not auto-start capture at boot. [Foreground service requirements](https://developer.android.com/develop/background-work/services/fgs/service-types#media-projection).

Projection consent is session-scoped: never serialize a token or treat saved room ownership as capture permission. On current Android versions renewed projection sessions require fresh user consent; do not reuse consent results to obtain another projection. Register `MediaProjection.Callback.onStop`, handle revocation immediately, stop/release AudioRecord and peers, clear Live and request a new user action. A permission denial is an explicit state, not a silent microphone fallback. [MediaProjection lifecycle](https://developer.android.com/media/grow/media-projection), [token revocation](https://developer.android.com/media/platform/av-capture).

State model: disconnected → room ready → requesting consent → capturing → broadcasting. Distinct denied, silent, unsupported and failed states. UI may leave the foreground while another app plays; the foreground service owns capture and notification Stop. Serialize Start/Stop with generation cancellation and idempotent cleanup. Stop removes sender tracks/peers, releases AudioRecord, stops projection/service and zeros the meter. Network recovery restores ownership separately; once capture has been stopped, require renewed consent rather than replaying cached permission. Audio routing changes, app switching, Home button, sleep and OEM service termination require physical tests.

## Replaceable capture and WebRTC transport

```text
TV source application
  → AndroidPlaybackCaptureAdapter (AudioRecord, projection)
  → timestamped PCM frames + RMS/peak + format
  → PlaybackAudioDeviceModule / PCM-to-libwebrtc bridge
  → one audio track → one RTCPeerConnection per phone
  → existing SDP/ICE through Render → existing phone listener
```

`CaptureAdapter` exposes capabilities, start(consent), frame subscription, state/level flow and stop/release. `PcmFrame` includes sample rate, channel count, sequence/time and PCM samples. Neither adapter nor frame interface handles room codes, credentials or Socket.IO. `BroadcasterController` coordinates adapter, RoomSession and transport. Future adapters supply frames behind this contract; Android permissions must not leak into the room protocol.

Important implementation risk: creating a default libwebrtc AudioSource does **not** inject AudioPlaybackCapture samples. The normal JavaAudioDeviceModule records from its own AudioRecord path. Its samples-ready callback observes captured data; it is not an external PCM input. See [upstream JavaAudioDeviceModule](https://webrtc.googlesource.com/src/+/refs/heads/main/sdk/android/api/org/webrtc/audio/JavaAudioDeviceModule.java). Proposed integration: pin an audited libwebrtc revision, implement a small custom AudioDeviceModule/native bridge that consumes the adapter's bounded PCM queue and delivers 10 ms frames to libwebrtc's recording callback. Validate the exact JNI/ADM integration before selecting a packaged dependency. Never claim microphone `createAudioTrack` is playback capture.

Use one capture source and shared native audio track for multiple peers, Opus and audio-only SDP. Bound/drop stale PCM on backpressure; do not accumulate seconds of delayed audio. Track captures, underruns, RMS and RTP bytes without samples, full SDP, candidate addresses or secrets in logs. Close a departed peer without stopping capture for others. Preserve offer-before-local-ICE, early remote ICE queue, stale-answer checks and retry behavior from desktop. Verify conversion, encoder input and decoded receiver PCM independently.

Dependencies proposed, not installed: Android SDK/Kotlin/Gradle, AndroidX activity/lifecycle, compatible Socket.IO Java client, pinned/audited native libwebrtc build + NDK/CMake, and a small local QR encoder if needed. Verify Socket.IO Engine.IO compatibility with backend v4. No Electron/WebView capture shortcut; no paid infrastructure required for the initial same-network test. STUN-only remains a cross-network limit; TURN is a separate justified reliability task.

## Room protocol, credentials and persistence gap

For the first prototype use the existing secure software-host contract despite its desktop naming; the server will identify it as hostType `desktop`, which already selects WebRTC in the phone listener. Do not rename events or invent `tv:*` events without coordinated changes. Keep a platform label local initially.

| Operation | Existing contract |
| --- | --- |
| Register | `desktop:register` with optional roomCode/roomName; timed acknowledgement `{ok, roomId, credential, expiresAt, members, graceMs}`. Save ownership only on success. |
| Recover | `desktop:recover` with saved roomCode + credential; require acknowledgement success before capture/broadcast. |
| Presence | `room-updated`, `listener-joined`, `stream-requested`, `room-closed`, disconnect/reconnect. Filter membership/identity as desktop does. |
| Broadcast | `broadcast-started`, `broadcast-stopped`; Stop keeps the room while host remains connected. `end-room` revokes it. |
| Media signaling | `webrtc-offer {target,offer}`, `webrtc-answer {target,answer}`, `webrtc-ice-candidate {target,candidate}`. Server supplies `sender`; validate current member/current peer. |

Store the ownership secret using Android Keystore-backed AES-GCM encryption in app-private storage, scoped to backend URL; exclude it from backup, diagnostics, QR and UI. Persist room code/name separately. HTTPS only in production. On denied/expired recovery, show an explicit create-room action; never automatically register or seize the same code.

**Persistent room code is not fully supplied by today's backend.** Desktop rooms are in memory, default disconnect grace is 15 seconds, credential recovery lifetime is 24 hours, and recovery does not renew it. Backend restart loses rooms. Saved code/credentials do not provide a permanently reserved room. The minimal prototype keeps a code through Stop/Start while connected and recovers within grace; it can remember a preferred code but cannot guarantee it is available later. A durable TV identity, renewable/revocable credentials, persistent room reservation and explicit reprovisioning need a separately reviewed backend design before promising permanent codes across power loss/restarts. Do not silently extend TTL, remove authentication or claim Android persistence fixes server persistence. Existing backend/Windows code stays unchanged in this preparation phase.

QR encodes the existing listener URL and room query format, verified against the current renderer/QR implementation when building. It contains no credential. Room and capture permission lifecycles remain independent.

## Proposed project structure (not yet created)

```text
tv/android/
  settings.gradle.kts, build.gradle.kts, gradle/libs.versions.toml
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/sportsradio/tv/
    ui/MainActivity.kt                 # D-pad controls, QR, level/status
    service/BroadcastService.kt        # foreground/projection lifecycle
    broadcast/BroadcasterController.kt # lifecycle coordinator
    room/RoomSession.kt, RoomProtocol.kt
    security/OwnershipStore.kt
    capture/CaptureAdapter.kt, PcmFrame.kt
    capture/AndroidPlaybackCaptureAdapter.kt
    transport/WebRtcTransport.kt, PlaybackPcmBridge.kt
    diagnostics/AudioLevels.kt
  app/src/main/cpp/PlaybackAudioDeviceModule.*
  app/src/test/                        # lifecycle/protocol/PCM tests
  app/src/androidTest/                 # permission/capture/cleanup on device
  capture-test-player/                 # separate opt-in positive control
```

Use API 29 minimum, current supported target SDK when implementing, TV launcher activity, touchscreen not required and Leanback feature declarations. Keep one UI screen. Follow [TV application requirements](https://developer.android.com/training/tv/get-started/create). One Gradle application with packages is sufficient initially; do not create a cross-platform framework or duplicate backend.

## First implementation task and acceptance gates

**TV-1: physical-device playback capture feasibility spike**, before building full room/transport integration.

1. Record available TV model, Android/API version, firmware, ABI, target playback app/version and developer/ADB access. If no suitable physical TV is available, do not substitute emulator results for acceptance.
2. Create the minimal TV project/service and replaceable adapter, permission/consent flow, Start/Stop, RMS meter and bounded PCM reads. Add a separate opt-in test player and opt-out negative control. Do not add microphone capture or backend changes.
3. On physical TV, leave the broadcaster UI and play the positive-control app. Demonstrate nonzero real application PCM, then zero after pause; test denied consent, projection revocation and three clean Stop/Starts. Record whether the consent dialog works with the TV remote.
4. Test desired real playback apps separately and write a device/app capability matrix. Silence from opt-out content must be reported as no signal/unsupported, not successful broadcasting. Test another app opening while the capture service stays alive.
5. Gate: usable consent + nonzero permitted playback PCM + cleanup on the target device. If blocked, report the hardware/policy limitation before investing in networking. Do not bypass protected-source restrictions.

**TV-2:** prove adapter PCM through the custom WebRTC input bridge to a local decoded receiver; verify positive/negative PCM energy and no video/microphone. Then connect existing secure room/signaling, QR and real iPhone listener. Accept only after audible phone playback; add restart/rejoin/two-listener/network tests.

**TV-3:** extend hardware/source matrix, sustained tests and durable device-room design. Native prototype does not imply Samsung Tizen, LG webOS, Android versions below 29 or non-Android TV support; each platform needs its own feasibility/capture adapter.

## Physical testing requirements

- At least one actual Android TV / Google TV device API 29+, with sideloading/developer access, ADB, working remote and documented firmware/ABI. An integrated TV and a separate Google TV box may have different capabilities; verify each supported category.
- Windows development machine with Android Studio/SDK, matching JDK/Gradle and NDK for the later native bridge; pin versions when creating the project, not speculative package versions here.
- Separate eligible player APK / unprotected audio file and opt-out control, plus the real applications the user intends to broadcast. Record restrictions rather than assuming YouTube/Netflix/HDMI eligibility.
- Real phone/browser, shared LAN for first WebRTC acceptance, accessible existing backend/listener and a second phone for concurrency. Audibly verify with TV and phone output routes known; prevent feedback without muting the captured source.
- Logs limited to state, format, RMS, timing and counts. Check revocation, app switching, TV standby, routing changes, restart and service cleanup. Emulator is useful for UI/protocol tests but cannot certify vendor capture or audible TV-to-phone playback.

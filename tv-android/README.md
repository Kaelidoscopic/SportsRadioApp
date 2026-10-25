# Android TV broadcaster

**Current implementation: Stage 2 / version 0.2.0.** See [STAGE_2.md](STAGE_2.md) for broadcasting, current installation commands, physical sender/receiver results, limitations and user-confirmed audible TV-to-iPhone acceptance. The application now uses Internet access for existing signaling and WebRTC. Capture remains playback-only.

## Archived Stage 1 notes (0.1.0)

The remainder records the original capture-only stage and its verification. Stage 1 is preserved in commit `a5518eb`; statements about no network transmission and APK version 0.1.0 refer to that commit, not the current Stage 2 app. Use the Stage 2 guide to build/update the current APK.

Installable local PCM diagnostic prototype for Android TV / Google TV **API 29+**. No room registration, WebRTC, microphone capture, audio recording to disk or network transmission. Neither APK requests INTERNET permission. Windows, backend, React listener and Pi files are unchanged.

## Physical-device acceptance evidence (user reported)

The user physically tested Stage 1 on a **Hisense HiSmartTV A4, Android TV 11 / API 30** and reported CAPTURING with **RMS 0.057152 (−24.9 dBFS)**, **peak 0.079987**, **1025 measured PCM windows**, PCM16 mono / 48 kHz requested. This establishes nonzero playback PCM on that device. It is user-reported evidence, not an agent-observed measurement. The exact source app/version and denial/revocation/negative-control outcomes were not supplied; those checks remain pending. No TV-to-phone playback is established by this capture-only result. The development-environment verification below describes the earlier build session, before this physical test.

## Build verification (2026-10-24)

- `:app:testDebugUnitTest`: **5 passed**, zero failures/skips. Tests cover signed PCM normalization, RMS/peak/dBFS, silence recovery, repeated start/stop, stale callbacks, duplicate start and initialization failure cleanup.
- `:app:assembleDebug`, `:test-player:assembleDebug`: **passed**. Both APK debug signatures verified with `apksigner`.
- `:app:lintDebug`, `:test-player:lintDebug`: **passed**, zero errors. App has six warnings; test player has five: English-only strings, large vector banner, backup-rule recommendation and/or available dependency/Gradle updates. Versions are pinned; no lint baseline suppresses errors.
- APK inspection confirms min SDK 29, target 36, TV launcher and optional microphone/touchscreen hardware. RECORD_AUDIO is present; INTERNET and microphone foreground-service type are absent.
- Tooling: AGP **9.1.1** (built-in Kotlin), Gradle **9.3.1**, SDK platform **36**, build tools **36.0.0**. Build verified with Windows JDK **25.0.2**, JVM bytecode target 17. Gradle wrapper distribution SHA-256 is pinned. Official task-local SDK/tools were downloaded because none were installed initially.
- No emulator was installed; `adb devices -l` reported **no attached devices**. Launch, remote-control navigation, projection dialogs, foreground operation and native audio capture remain **unverified on a device**. Unit tests do not establish physical capture support.
- Existing suites rerun unchanged: backend **19/19**, Windows desktop **28/28**, React listener **6/6** passed, including backend browser/Pi compatibility integration.

Initial compile identified a nullable MediaProjection result, corrected with a checked failure path. Initial lint identified unescaped drive-colon syntax in ignored local.properties, corrected without weakening lint. Final build/tests/lint passed.

## Project structure

```text
tv-android/
  gradlew / gradlew.bat / gradle/wrapper/  # Standard checksum-pinned wrapper
  settings.gradle.kts / build.gradle.kts / gradle.properties
  app/
    src/main/AndroidManifest.xml
    src/main/java/com/sportsradio/tv/
      MainActivity.kt                    # D-pad buttons, permission flow, status/levels
      CaptureService.kt                  # Foreground service / projection ownership
      CaptureStatus.kt                   # Process-local metadata only
      capture/
        CaptureAdapter.kt                # Replaceable PCM source contract / PcmFrame
        AndroidPlaybackCaptureAdapter.kt # AudioRecord playback configuration only
        CaptureController.kt             # Serialized lifecycle / stale callback guard
        AudioLevels.kt                   # Pure PCM16 RMS, peak, dBFS calculations
    src/test/.../CaptureTests.kt
  test-player/                           # Distinct app/UID; eligible + blocked tone controls
```

## Windows PowerShell build

Install Android Studio (or official command-line tools), then use its SDK Manager to install **Android SDK Platform 36**, **Build-Tools 36.0.0**, and **Platform-Tools**. Use a compatible JDK: AGP requires at least JDK 17; Android Studio's bundled JDK is suitable. [AGP compatibility](https://developer.android.com/build/releases/agp-9-1-0-release-notes).

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\tv-android'
# Adjust these to your actual Android Studio / SDK locations:
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
java -version

# When moving this checkout to another machine, remove the ignored local.properties
# or update sdk.dir to that machine's SDK. ANDROID_HOME is used if no local override.
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :test-player:assembleDebug :test-player:lintDebug
if ($LASTEXITCODE -ne 0) { throw 'Android verification failed.' }

Get-FileHash '.\app\build\outputs\apk\debug\app-debug.apk' -Algorithm SHA256
Get-FileHash '.\test-player\build\outputs\apk\debug\test-player-debug.apk' -Algorithm SHA256
```

APK outputs:

- `app/build/outputs/apk/debug/app-debug.apk` — `com.sportsradio.tv.capture`, version 0.1.0.
- `test-player/build/outputs/apk/debug/test-player-debug.apk` — `com.sportsradio.tv.testplayer`, version 0.1.0.

Debug APKs are installable test builds, not Play Store releases. Generated APKs, SDK paths, Gradle caches and signing keys are ignored. Keep the small standard wrapper JAR with the source. Stage 1 requires no backend or frontend process.

On this development machine the task-local SDK and caches already exist; Android Studio installation is not needed to repeat the verified command:

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\tv-android'
$taskAndroidTools = 'C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879\android-tools'
$env:JAVA_HOME = 'C:\Users\ninte\Java\JDK\oracleJdk-25'
$env:ANDROID_HOME = "$taskAndroidTools\sdk"
$env:GRADLE_USER_HOME = "$taskAndroidTools\gradle-home"
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :test-player:assembleDebug :test-player:lintDebug
```

## Enable developer access and install on a TV

Menu names vary by manufacturer. On Google TV: Settings → System → About → Android TV OS build, press Select about seven times until developer mode is enabled. On older Android TV: Settings → Device Preferences → About → Build. Open Developer options and enable USB debugging (or the vendor's explicit network/wireless debugging option). Do not change device security policies or root the TV. [Official physical-device setup](https://developer.android.com/studio/run/device).

Use USB where the TV supports data/debugging, or the TV's supported network-debugging flow. Authorize this computer on the TV. For Android wireless pairing, use the **pairing port** shown by the pairing dialog; the later **connection port** can differ. [ADB connection instructions](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi).

```powershell
# USB, after accepting the TV authorization dialog:
adb devices -l

# Alternatively, only if the TV exposes Wireless debugging / pairing:
# Replace placeholders with the TV's displayed address/ports; do not include < >.
adb pair TV_IP:PAIRING_PORT
adb connect TV_IP:CONNECTION_PORT

# Older TVs may expose an explicit vendor network-debugging toggle with port 5555.
# Use adb connect TV_IP:5555 only when that TV actually advertises/enables it.
adb devices -l

# Set the serial exactly as shown by adb devices (USB serial or IP:port).
$tvSerial = 'YOUR_TV_SERIAL'
adb -s $tvSerial shell getprop ro.product.model
adb -s $tvSerial shell getprop ro.build.version.sdk
adb -s $tvSerial install -r '.\app\build\outputs\apk\debug\app-debug.apk'
adb -s $tvSerial install -r '.\test-player\build\outputs\apk\debug\test-player-debug.apk'
adb -s $tvSerial shell am start -n com.sportsradio.tv.capture/com.sportsradio.tv.MainActivity
```

If `unauthorized`, accept the TV dialog. If multiple devices are connected, keep using `-s`. If the manufacturer exposes no supported ADB path, do not assume port 5555 is available. Use the trusted local network for debugging and disable debugging after testing. No device was connected or installed during development verification.

## Permission and capture behavior

Android's **RECORD_AUDIO** runtime permission is mandatory for AudioPlaybackCapture, even though the system permission dialog may say “Microphone.” It is requested for this supported playback API, not as a workaround. The adapter never calls `setAudioSource`, opens a microphone, or uses a microphone foreground service. Denying this permission prevents capture. [Android playback capture requirements](https://developer.android.com/media/platform/av-capture).

Start requests fresh MediaProjection consent from the visible activity. On API 34+ the request selects default-display projection to support switching to another player app. The system may describe this as screen sharing; this prototype creates **no virtual display**, reads no video frames and transmits nothing. Service ordering is consent → mediaProjection foreground service → `getMediaProjection()` → registered revocation callback → AudioRecord. Capture requests PCM16 mono at 48 kHz; unsupported initialization fails explicitly rather than falling back to a microphone. The adapter excludes the capture app's own UID and matches MEDIA/GAME/UNKNOWN usages.

The foreground service survives Home / another app opening. Returning to the capture activity shows current metadata; the activity does not own the audio source. Stop, task removal, projection revocation, service destruction or read failure stop the worker, release AudioRecord, unregister the projection callback, stop projection and remove the foreground notification. Process death releases OS resources; `START_NOT_STICKY` prevents replaying a consumed consent Intent. Late PCM/error callbacks are rejected by generation. Activity recreation retains only permission-flow flags, never a saved projection token.

The service creates the mandatory foreground notification with a Stop action. This prototype does not request optional POST_NOTIFICATIONS permission; on newer Android versions the OS may hide drawer notifications while still showing the running service in its foreground-service/task UI. Return to this application's Stop button if the notification is not visible. TV-specific notification access must be checked on hardware.

The app releases **session projection access** on Stop. Android retains the normal RECORD_AUDIO runtime grant until the user revokes it in app permissions; that grant does not permit restarting projection without consent. Every new capture session obtains new projection consent. Home intentionally leaves capture running; Stop or closing/removing the capture task ends it.

Levels are normalized PCM RMS and peak, not a microphone level. dBFS = 20 log10(RMS); digital silence is −∞. UI samples 480-sample windows at most ten times/second; it is not a continuous integrated loudness meter. Signal threshold is RMS 0.0001 (−80 dBFS). After five seconds without threshold-crossing samples, SILENT warns about paused/muted/blocked sources. No PCM buffers for five seconds is an ERROR, not a verified silent measurement. Frames are transient memory only. Android cannot tell this app whether zero PCM means a blocked source or ordinary silence.

## Physical-device acceptance — all pending

Record TV model, firmware/API/ABI, date, audio output (TV speaker/Bluetooth/HDMI), source app/version, permission results, RMS/peak, and pass/fail. Emulator results cannot certify TV capture.

1. [ ] Launch from the TV launcher. Navigate Start/Stop with D-pad/Select; confirm buttons remain visible with TV overscan/text scaling. Deny RECORD_AUDIO and then projection consent on separate attempts; each must show DENIED without active capture/foreground notification.
2. [ ] Grant both permissions. Confirm STARTING becomes CAPTURING or SILENT and the OS reports active projection/foreground service (drawer notification visibility varies as described above). No microphone fallback, video stream or network activity should occur.
3. [ ] Press Home and open **SportsRadio Test Player** (separate package/UID). Select **Play eligible tone** at comfortable volume. Return Home to **SportsRadio Capture**. Confirm RMS and peak become nonzero while the separate app continues playing. This is real Android AudioTrack playback, not an injected capture/transport track.
4. [ ] Return to Test Player and Stop playback. Return to Capture; levels should fall to zero and SILENT appear after five seconds. Restart eligible playback and confirm recovery without restarting capture.
5. [ ] Select **Play capture-blocked tone** in Test Player. Local TV sound should play, while capture shows zero/SILENT after buffers drain. Stop this tone before other tests. This verifies the prototype honors source capture policy; another eligible app playing concurrently could still produce nonzero PCM.
6. [ ] Repeat using an ordinary separate media app and an unprotected audio/video file. Record app/version and actual capture result. A synthetic test tone positive control alone does not establish compatibility with the real target application.
7. [ ] Stop Capture; confirm levels reset, notification disappears, and AudioRecord/projection resources end. Repeat Start/Stop three times; each Start requires fresh projection consent. Repeat while another player is active.
8. [ ] Revoke projection using the OS capture indicator where available, or revoke recording permission in Settings. Capture must stop/error and require a new user action. Test Home/return, activity recreation, removal from recents, TV standby and process termination; no automatic projection restart is expected.
9. [ ] Test the target source applications individually and fill in a capability matrix. Zero capture from an opted-out app is an expected limitation, not permission to bypass its restriction. No phone audio is expected in Stage 1.

Example evidence table (not test results):

| TV / API / firmware | App + version / mode | Local sound | Capture RMS/peak | Denial/revocation/stop | Result |
| --- | --- | --- | --- | --- | --- |
| Pending | Eligible test player | Pending | Pending | Pending | Not tested |
| Pending | Blocked test player | Pending | Expected zero; verify | Pending | Not tested |
| Pending | Actual target media app | Pending | Pending | Pending | Not tested |

If necessary, gather limited Android diagnostics without recording PCM:

```powershell
adb -s $tvSerial shell dumpsys media_projection
adb -s $tvSerial shell dumpsys activity services com.sportsradio.tv.capture
adb -s $tvSerial logcat -d -s AndroidRuntime AudioRecord
# Revoke access / stop both test applications after testing:
adb -s $tvSerial shell am force-stop com.sportsradio.tv.capture
adb -s $tvSerial shell am force-stop com.sportsradio.tv.testplayer
```

Review diagnostic output before sharing; OS logs may include unrelated device information.

## Source restrictions / limitations

Capture requires the same user profile and permitted usage/capture policy in the **playing application**. The most restrictive manifest, AudioManager or per-player policy wins. Commercial streaming/DRM apps can block it; no YouTube/Netflix compatibility is established. Voice calls, assistant/system audio, HDMI input, tuner, ARC/eARC and unrelated TV inputs are not promised. A Google TV dongle cannot capture another TV input simply by being connected. A manufacturer may omit or restrict the projection UI even on API 29+. No hidden permission, privileged system installation or root bypass is used.

The test player is deliberately minimal: a separate foreground-service AudioTrack tone with explicit allowed/blocked policy. It is a diagnostic tool, not a general media player. No audio-focus arbitration or long-duration reliability is certified. All TV behavior, including notification Stop access and remote permission dialog operation, awaits hardware tests.

## Stage 2 gate

First obtain physical positive/negative controls plus nonzero PCM from the desired real source and verified Stop/revocation cleanup. Then implement an audited PCM-to-libwebrtc recording input (custom AudioDeviceModule/native bridge or a proven supported injection API), preserving this CaptureAdapter boundary. The standard WebRTC Java audio source does not automatically consume these PCM frames. Verify decoded receiver samples before adding existing secure room registration, ownership storage, signaling and phone listener. No backend rewrite is required for the prototype, but permanent room reservations remain a separate persistence gap described in `../docs/android-tv-broadcaster-plan.md`.

No real-TV capture or phone streaming is claimed by this Stage 1 implementation.

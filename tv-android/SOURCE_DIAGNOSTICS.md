# Android TV 0.3.0 — source compatibility diagnostics

**Follow-up:** the later 0.3.0 test found background PCM silence despite room persistence. The 0.3.1 fix now has user-confirmed background Test Player-to-iPhone acceptance. See [0.3.1 background investigation and baseline](BACKGROUND_0_3_1.md); the acceptance below records the earlier user report and does not certify continuous background audio.

The user-verified 0.2.0 baseline captures the separate SportsRadio Test Player on Hisense HiSmartTV A4 / Android TV 11 and audibly plays it on an iPhone. YouTube joins but is silent; **its root cause is not established**. Version 0.3.0 adds observation, not a different capture path or a restriction bypass. Version 0.3.0 diagnostics and Back navigation have now passed the user-reported physical acceptance below. YouTube compatibility remains unverified.

## Measurements and lifecycle

Every playback callback is counted before the 10 Hz UI sampling and before PCM enters WebRTC. Session totals reset on Start; a rolling five-second window reports callback count, above-threshold count, sample-weighted RMS and peak. “Nonzero” means RMS >= 0.0001 (−80 dBFS), not merely a nonzero integer; tiny noise is not usable evidence of source audio. Partial AudioRecord reads count as callbacks, not fixed-duration 10 ms windows. The bounded rolling buffer keeps at most 2000 entries. No PCM is stored.

Time since last above-threshold window is monotonic milliseconds; null means no signal this session. Five seconds of continuing silent callbacks means **Capturing silence**. Five seconds without buffers means **Capture interrupted**, not measured silence; the existing adapter also fails and cleans up after its no-buffer timeout. Normal Stop retains diagnostic totals, releases capture and stops reporting. Restarts and interruptions accumulate only while the app process lives; process death resets them and cannot reliably log its own termination. Projection revocation, adapter failure and runtime-forced shutdown count once per active session. Manual Stop and End Room do not count as interruptions.

The existing service still starts only after projection consent, remains a mediaProjection foreground service, and does not stop on Home. A service-owned two-second tick samples native input callbacks/energy and outgoing RTP counters even when another app is foregrounded. The UI reads these cached sender measurements; it no longer drives polling. Interval packet/byte/native-block/energy deltas, connected-peer count and peer state messages distinguish a pending or failed connection, missing native input, no RTP progress and silent PCM. The initial interval, negotiation, listener churn and asynchronous stats can produce transient warnings; compare several consecutive reports. Counters aggregate active peers and decrease when a peer leaves; negative deltas are clamped. Packet progress does not establish audibility. Native energy is cumulative, so use its interval delta.

Audio capture configuration is unchanged: PCM16 mono 48 kHz, MEDIA/GAME/UNKNOWN usages, own UID excluded, no microphone source. Room credentials, contracts and permission flow are unchanged. Android source usage, capture policy, user profile and device routing can affect eligibility: [Android playback capture documentation](https://developer.android.com/media/platform/av-capture). Zero PCM does not identify which restriction or routing issue applies. No commercial-app, DRM or HDMI compatibility claim is made.

## Build and install (PowerShell)

From a checkout with Android SDK 36 / build-tools 36.0.0 and a compatible JDK, set JAVA_HOME and ANDROID_HOME to the installed locations. See STAGE_2.md for this machine's paths and developer-option/ADB setup. Keep the same debug signing key to preserve saved ownership. Do not uninstall or clear data for an update.

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\tv-android'
$env:Path = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug
if ($LASTEXITCODE -ne 0) { throw 'Android verification failed' }
$tvSerial = 'YOUR_TV_SERIAL'
adb devices -l
adb -s $tvSerial install -r '.\app\build\outputs\apk\debug\app-debug.apk'
if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
adb -s $tvSerial shell am start -n com.sportsradio.tv.capture/com.sportsradio.tv.MainActivity
```

Build outputs under OneDrive may be held open by another process. Do not install a stale 0.2.0 APK after a failed build. This development verification redirects generated output using an external Gradle init script; the verified artifact link is supplied with the results.

## Safe diagnostic collection while YouTube is foregrounded

These commands require authorized ADB. Only the dedicated SportsRadioDiag tag contains the aggregate diagnostic records: no credentials, room codes, SDP, ICE addresses, raw audio or titles. Do not export app-private ownership files or collect broad unfiltered logs. Android logcat is a bounded system ring, so collect continuously for long runs. No exported broadcast receiver, HTTP endpoint or persistent recording is added.

In a second PowerShell window, start this **before** starting the TV broadcast. Press Ctrl+C after the test. Reuse the serial from adb devices:

```powershell
$tvSerial = 'YOUR_TV_SERIAL'
$reportFolder = Join-Path $env:TEMP 'SportsRadio-TV-030'
New-Item -ItemType Directory -Force -Path $reportFolder | Out-Null
adb -s $tvSerial logcat -v epoch -s 'SportsRadioDiag:I' '*:S' |
    Tee-Object -FilePath (Join-Path $reportFolder 'source-comparison.log')
```

While the service is running (including with YouTube foregrounded), request an immediate snapshot without opening SportsRadio:

```powershell
adb -s $tvSerial shell dumpsys activity service com.sportsradio.tv.capture/com.sportsradio.tv.CaptureService |
    Out-File -Encoding utf8 (Join-Path $reportFolder 'capture-snapshot.txt')
# After stopping, dump retained logcat entries from the same tag:
adb -s $tvSerial logcat -d -v epoch -s 'SportsRadioDiag:I' '*:S' |
    Out-File -Encoding utf8 (Join-Path $reportFolder 'retained-diagnostics.log')
```

The dumpsys header is Android-generated and can contain process/component information. Review before sharing. If there is no active service, use the final logcat record; Android cannot dump a stopped service. Logs can contain earlier sessions; use timestamps, starts/restarts and windows resetting to separate them. Native/RTP state is sampled asynchronously and may lag one interval. The final service record retains the last sender sample before resources are released.

## Controlled comparison and acceptance checklist

1. Record TV model/OS, source app version, output route, phone/browser version and wall-clock start time locally. Do not include titles, account information or tokens in shared reports.
2. Start capture with fresh consent; join the room on the same iPhone listener. Press Home and play the separate Test Player for 30 seconds. Confirm local TV sound, increasing capture/nonzero windows, positive rolling RMS/peak, increasing native energy, connected peer and outgoing RTP. Listen on the phone and record pass/fail.
3. Pause the Test Player for at least 7 seconds. Windows should continue, rolling nonzero/RMS should expire, and the silence message should appear. Resume and confirm recovery. An increasing total nonzero count from earlier playback is not current audio evidence.
4. Stop the Test Player completely. Without stopping SportsRadio capture, open YouTube and play locally audible content for 30 seconds. Keep logging with YouTube foregrounded. Record switch timestamps. Do not leave the control tone playing alongside it, which would mask YouTube silence.
5. Return to Test Player in the same session and repeat the positive control. Then stop broadcasting and verify the final record; Start again with fresh consent and check restart counters. Revoke projection separately and verify interruption plus cleanup.
6. Compare intervals: continuing buffers with zero rolling energy only during YouTube points to source eligibility/routing rather than signaling; no buffers or an ended service points to capture interruption; nonzero capture but zero native energy points to sender input; nonzero native energy with no RTP progress or failed peers points to transport. Positive capture/native/RTP with silent phone requires listener/output investigation. These are diagnostic inferences, not proof of a particular app policy.

The detailed YouTube comparison and background ADB log retrieval remain separate checks; audible 0.3.0 Test Player playback is user-confirmed below. No restriction is bypassed and no automatic capture restart reuses projection consent.

## Verification results for this change

Android: 29 tests passed (existing 20 plus five navigation regressions and four diagnostics regressions covering rolling expiry, weighted PCM levels, no-buffer interruption, idempotent cleanup/restart, and sender progress classification). Debug APK build, Android lint and APK signature verification passed. Backend: 19/19 passed including browser/Pi compatibility; desktop: 28/28 plus syntax checks passed; listener: 6/6 passed. Existing Android lint warnings remain. No backend, listener, desktop or deployment configuration changes were made. Physical 0.3.0 Test Player playback and navigation are user-confirmed below. YouTube comparison and ADB output remain unverified.

The initial build attempts were blocked by Windows locks in existing generated package/test-output folders under OneDrive. Verification succeeded with all generated outputs redirected outside OneDrive using a task-local Gradle init script; no capture or signing configuration was weakened.

To install the verified artifact on this development machine (replace the serial):

```powershell
$artifactRoot = 'C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879'
$adb = Join-Path $artifactRoot 'android-tools\sdk\platform-tools\adb.exe'
$tvSerial = 'YOUR_TV_SERIAL'
& $adb devices -l
& $adb -s $tvSerial install -r (Join-Path $artifactRoot 'SportsRadio-TV-Broadcaster-0.3.0-back-fix-debug.apk')
if ($LASTEXITCODE -ne 0) { throw 'Install failed; do not clear app data automatically' }
& $adb -s $tvSerial shell am start -n com.sportsradio.tv.capture/com.sportsradio.tv.MainActivity
# In collection commands above, use & $adb in place of adb if it is not on PATH.
```

## Back navigation preservation fix (user-confirmed Hisense acceptance)

Cause: default Back finished MainActivity. Its isFinishing/onDestroy branch stopped CaptureService and shut down BroadcastRuntime, whereas Home only paused UI refresh in onStop. The activity now handles Back through AndroidX OnBackPressedDispatcher and moves its task to the background. Activity stop/destruction only pause UI work, never stop capture or close the room. Returning starts UI refresh and ensures a room session exists without replacing an existing/reconnecting session. Explicit Stop Broadcasting still stops capture/peers and retains the room; End Room remains an explicit room-ending action.

The service still owns MediaProjection, capture cleanup, native peers, foreground status and diagnostic polling. Projection revocation, adapter failure, task removal and genuine service destruction retain cleanup. Unexpected service destruction counts as an interruption when metrics are active. Explicit Stop marks metrics stopped first. No consumed consent is replayed; START_NOT_STICKY remains in effect. Process death can bypass callbacks; Android releases process resources and a subsequent app start must securely recover its room and obtain fresh projection consent.

Five unit regressions exercise the activity lifecycle coordinator with a real CaptureController and simulated platform/media resources: Back, Home, return/recreation, explicit Stop and independent service termination cleanup. These tests do not drive Android remote events or prove physical MediaProjection/WebRTC behavior. Android 29/29 tests, APK build and lint pass after the fix; signature verification is recorded with the delivered artifact. Source diagnostics and credential storage are preserved.

Hisense acceptance: update with matching debug signature, start eligible Test Player capture and hear it on iPhone. Record room code and PCM/RTP counters. Press Back, wait 15 seconds, confirm phone audio and background logs continue. Reopen SportsRadio through Apps: same room, continuing counters, no new projection prompt and no new registration. Repeat Home and Back several times, including reopening the activity. Explicit Stop must end audio/projection and peers; Start must request fresh consent. Separately revoke projection and confirm clean termination without automatic restart. Do not use YouTube silence as the navigation positive control. Capture logs using the commands above, and record audible pass/fail separately from counters.

## User-confirmed physical acceptance — 0.3.0

On Hisense HiSmartTV A4 running Android TV 11, the user confirms that Back backgrounds the app without ending broadcasting, the iPhone remains connected and hears the separate SportsRadio Test Player, and reopening the TV app preserves the room. Explicit Stop Broadcasting ends the active capture/media session. Starting again requests fresh Android capture consent and restores broadcasting. Stop retains room ownership by design; End Room is the separate explicit room-ending action.

This is user-reported acceptance evidence, not an agent-observed listening test. The exact iPhone/browser version, duration and detailed diagnostic readings were not supplied. YouTube previously produced silence and is **not verified compatible**; the cause remains undetermined. No commercial streaming, protected-content or HDMI compatibility is established. Long-duration, two-physical-phone and network-outage checks remain separate acceptance work.

# Android TV 0.3.1 — background playback capture

## Cause and scope

The later 0.3.0 physical report supersedes the earlier assumption of background continuity: Back preserved the room but did not preserve nonzero captured PCM. Code inspection finds no remaining activity onStop/onDestroy capture shutdown; the service drives capture and diagnostics, and the custom WebRTC recorder drains PCM on its own audio thread. No audio-focus request, activity-dependent mute or receive-side video exists.

On the attached Hisense HiSmartTV A4 / Android TV 11, 0.3.0 produced continuing PCM callbacks with RMS/peak zero while backgrounded. Native callbacks and RTP also continued, with zero native-energy delta. Returning SportsRadio to the foreground immediately restored RMS about 0.05655 without recreating projection or peers. The separate Test Player's foreground AudioTrack service continued across activity navigation. Therefore this reproduction was capture-side silencing, not a stopped source, missing callbacks, or stalled WebRTC.

The capture service declared/started only mediaProjection. Version 0.3.1 adds the microphone **foreground-service type** for Android 11+ AudioRecord background eligibility, alongside mediaProjection, and declares FOREGROUND_SERVICE_MICROPHONE for newer Android versions. Existing RECORD_AUDIO permission is still required. These service types describe recording eligibility: actual input remains AudioPlaybackCaptureConfiguration / REMOTE_SUBMIX, never a microphone AudioSource. API 29 retains the projection-only runtime type. The service is started from the visible activity after permission/projection consent, before AudioRecord creation. No background permission bypass, app-op override, root, source policy override or automatic consent reuse is used.

Adding the recording type resolved the measured background silencing on this TV. The precise vendor-internal policy decision was not traced; do not generalize to all Android TVs. [Android 11 foreground-service rules](https://developer.android.com/about/versions/11/privacy/foreground-services) describe recording eligibility, and [playback capture policy](https://developer.android.com/media/platform/av-capture) still controls which sources are available.

## Changes and ownership

- CaptureService owns projection, capture adapter, transport preparation/announcement, diagnostic tick and cleanup. MainActivity retains only commands/display and Back-background navigation. No activity lifecycle callback pauses capture, source or track. Reopening reuses the existing or reconnecting room.
- AudioRecord diagnostics now include recording state, worker activity, sample rate and Android clientSilenced when available; null means unavailable, not false. The observed Hisense reports null. Diagnostic lookup failure cannot terminate recording. Foreground-service type mask is also logged (160 / 0xa0 means mediaProjection + microphone).
- Test Player logs playing, advancing playback-head position and capture-eligibility control under SportsRadioPlayer. Its looping AudioTrack runs in PlayerService until Stop; PlayerActivity has no pause/stop playback hook. Neither app requests audio focus in this prototype.
- Version code 4 / version 0.3.1. No backend, phone listener, Windows, credential storage, room recovery or signaling contracts changed. No capture restart is triggered by navigation.

## Verification

Android **32/32** unit tests passed: existing navigation, lifecycle, room/recovery, PCM queue and signaling regressions plus three data-flow tests using the actual capture controller and PCM queue with simulated platform resources. These exercise visible → background → visible, Back/Home/Apps, continuing nonzero PCM consumption, explicit Stop, projection revocation and no implicit capture restart. They do not emulate Android's permission enforcement or encode real RTP.

App and Test Player debug APK builds/lint passed; broadcaster signature verification passed. Backend **19/19** including browser/Pi integration, desktop **28/28** plus syntax checks, and listener **6/6** passed. Existing lint/JDK warnings remain. Build outputs were redirected outside OneDrive with the existing task-local init script to avoid generated-file locks.

Physical checks on the attached Hisense established nonzero background PCM and native input/RTP progress after the service-type change, including Test Player foreground, Home/launcher and Back navigation. The controlled Windows receiver decoded peak RMS **0.056739**, **960 packets / 70574 bytes**, connected ICE/peer, one audio/zero video and no playback errors while Test Player was foregrounded. This is decoded PCM evidence, not audible iPhone verification. Android totalAudioEnergy remained zero at that receiver despite decoded audio; use decoded RMS and real listening.

The delivered final APK was installed with saved ownership preserved. The user subsequently confirmed audible background TV-to-iPhone playback and lifecycle acceptance below, establishing the known-good 0.3.1 baseline. YouTube previously produced silence and remains unverified.

## Exact Windows PowerShell commands

This machine's verified APKs and SDK are outside the repository:

```powershell
$artifacts = 'C:\Users\ninte\.codex\visualizations\2026\10\24\01a16f71-c4ce-7d01-b58b-fdc604544879'
$adb = Join-Path $artifacts 'android-tools\sdk\platform-tools\adb.exe'
$tvSerial = 'YOUR_TV_SERIAL' # from the authorized adb devices output
& $adb devices -l
& $adb -s $tvSerial install -r (Join-Path $artifacts 'SportsRadio-TV-Broadcaster-0.3.1-debug.apk')
if ($LASTEXITCODE -ne 0) { throw 'Install failed; do not clear ownership data automatically' }
& $adb -s $tvSerial install -r (Join-Path $artifacts 'SportsRadio-Test-Player-0.3.1-debug.apk')
& $adb -s $tvSerial shell am start -n com.sportsradio.tv.capture/com.sportsradio.tv.MainActivity
```

Updating replaces the running process and therefore requires recovery and fresh capture consent. Reopening an already running session does not. Same signing key is required; never automatically uninstall or clear app data. For a standard SDK build from tv-android, use `.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :test-player:assembleDebug :test-player:lintDebug`; configure JAVA_HOME/ANDROID_HOME as in STAGE_2.md. APK output normally resides under each module's build/outputs/apk/debug directory.

Collect continuously in another terminal before navigating away (Ctrl+C ends collection):

```powershell
$reports = Join-Path $env:TEMP 'SportsRadio-031'
New-Item -ItemType Directory -Force -Path $reports | Out-Null
& $adb -s $tvSerial logcat -v epoch -s 'SportsRadioDiag:I' 'SportsRadioPlayer:I' '*:S' |
    Tee-Object -FilePath (Join-Path $reports 'background.log')
```

Without bringing SportsRadio forward, take a snapshot:

```powershell
& $adb -s $tvSerial shell dumpsys activity service com.sportsradio.tv.capture/com.sportsradio.tv.CaptureService |
    Out-File -Encoding utf8 (Join-Path $reports 'capture.txt')
& $adb -s $tvSerial shell dumpsys activity services com.sportsradio.tv.testplayer |
    Select-String 'ServiceRecord|isForeground' |
    Out-File -Encoding utf8 (Join-Path $reports 'player-service.txt')
& $adb -s $tvSerial logcat -d -v epoch -s 'SportsRadioDiag:I' 'SportsRadioPlayer:I' '*:S' |
    Out-File -Encoding utf8 (Join-Path $reports 'retained.log')
```

Logs contain aggregate levels/counters only; no PCM, ownership, SDP, ICE addresses or tokens. Review Android-generated dumpsys headers before sharing. Do not export app-private files or change app-ops. Logcat is a bounded ring and process death can bypass callbacks.

## Physical acceptance checklist

1. Open SportsRadio, recover/create a room, Start and approve fresh projection consent. Join on iPhone. Start the Test Player's eligible tone through its UI; keep volume comfortable.
2. With Test Player foregrounded, wait at least 20 seconds. Confirm local playback head advances and eligible=true. Capture windows/nonzero counts must grow, rolling RMS stay positive, native-energy delta be positive, and RTP increase. **Listen on iPhone** and record pass/fail.
3. Press Home; keep tone service playing. Wait 20 seconds, collect without opening SportsRadio, and listen. Reopen SportsRadio through Apps: same room, no consent prompt, counters continue.
4. Press Back from SportsRadio. Wait/listen/collect again. Repeat Apps switching, then reenter and confirm no registration or capture restart occurred. Restarts should remain unchanged.
5. Stop Test Player: silence is expected. Explicit Stop Broadcasting must release projection/AudioRecord/peers. Start again must ask fresh consent and restore background audible playback. Revoke projection separately: clean stop, no automatic restart. Room/network recovery remains subject to backend grace and requires explicit Start after capture ends.
6. Test YouTube separately with Test Player stopped. Zero PCM with a running capture indicates source/routing/platform eligibility, not necessarily a defect in signaling. Do not infer YouTube support from the Test Player result.

Interpretation: no fresh windows = interrupted/stalled AudioRecord; continuing zero-energy PCM = capture silence; positive capture but zero native input = sender path; positive native input but stalled RTP/failed peer = transport; RTP + decoded audio but no phone sound = receiver/output investigation. Observe multiple intervals because sender stats are asynchronous.

Android can revoke projection, kill the process, restrict source capture, or enforce vendor routing policies. This fix does not establish DRM/commercial/HDMI support, standby continuity, cross-network STUN reliability or 30-minute endurance. APKs and test reports remain outside version control.

## Final packaged APK check

The final delivered APK was installed and retested on the same physical TV. With Test Player foregrounded, the controlled receiver passed again: peak decoded RMS **0.0566234**, **965 packets / 70861 bytes**, 916320 decoded samples, connected ICE/peer, one audio/zero video and no playback errors. After returning to SportsRadio, Back and Home, the same service remained alive with `foregroundTypes=160`, recording=true, RMS **0.056554**, peak **0.079987**, restarts=0, interruptions=0. Test Player playback head advanced while backgrounded. The receiver then exited; the temporary Test Player tone was stopped through its UI. This controlled receiver result is separate from the subsequent user-confirmed phone acceptance; silent capture after stopping the source is expected.

Broadcaster APK SHA-256: `1b95beda96ff9fd7910ff4d730c604c86a9cb0b17092bbdb0f5e44a2f92ee0dd`. The controlled measurement does not itself certify audibility; the subsequent user listening result below establishes phone acceptance. YouTube eligibility remains unverified.

## Known-good 0.3.1 baseline — user-confirmed physical acceptance

The user confirms SportsRadio TV Broadcaster **0.3.1** on **Hisense HiSmartTV A4 / Android TV 11**, with the existing web listener on an **iPhone**:

- Eligible SportsRadio Test Player audio is audible on the iPhone while Test Player is foregrounded and SportsRadio is backgrounded.
- Home and Back do not terminate broadcasting; reopening SportsRadio preserves the existing room.
- Explicit Stop closes the active capture/media session. Starting again obtains fresh Android capture consent and restores broadcasting. Room ownership remains available; End Room is the separate room-ending action.
- Foreground-service recording and mediaProjection types are enabled while actual input remains playback-only.

This is user-reported physical listening evidence, separate from agent-observed PCM/RTP measurements. Phone/browser versions and test duration were not supplied. This establishes the known-good **0.3.1 baseline for the tested configuration**, preserving the 0.3.0 diagnostics/navigation work committed in `321cd48`.

**Unverified:** YouTube (previously silent), Netflix, HDMI sources, other TV models and endurance testing. Source policies, protected content and vendor routing restrictions still apply; no bypass or compatibility claim is made. Two-phone, standby and cross-network reliability remain separate tests.

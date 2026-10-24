# Windows loopback silence investigation — desktop 0.1.2

## Findings and limits

The reported iPhone connection establishes signaling, ICE and RTP delivery. Packet counters and a live track do not establish that the captured samples contain sound. The affected PC's root cause is **not established**. Default endpoint / per-application output routing, application mute/volume and endpoint changes during capture are the first checks. Driver-specific behavior remains possible; no driver or endpoint mismatch was reproduced here.

`main.cjs` grants `audio: 'loopback'` with an internal screen video source. The screen choice does not choose an audio output. Chromium's Windows `SetCaptureDevice()` selects `GetDefaultAudioEndpoint(eRender, eConsole)` for this loopback device. This captures the default playback endpoint, not every output concurrently. An application routed to another HDMI, Bluetooth or USB endpoint can be missed. Electron's handler does not offer an arbitrary Windows output endpoint argument. We have not added a misleading device selector or microphone fallback.

Sources: [Electron handler](https://www.electronjs.org/docs/latest/api/session#sessetdisplaymediarequesthandlerhandler-opts), [Chromium Windows capture source](https://github.com/chromium/chromium/blob/main/media/audio/win/audio_low_latency_input_win.cc), [Windows loopback recording](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording).

The captured audio-only MediaStream contains the original native loopback tracks. Every listener receives those same tracks through `addTrack`; video remains internal. There is no intermediate gain, synthesizer, mute or replacement of sender audio. The prior test-tone harness likewise used a WAV played by a separate SoundPlayer process through Windows playback, rather than a synthetic WebRTC track.

Confirmed diagnostic defect: missing RTC source-energy fields were converted to zero. They now remain `null` (unknown); actual measured zero stays zero. `sourceEnergy` is cumulative: it should increase during playback and remain constant during silence, not decrease. `audioLevel` is a current level. A direct PCM window RMS should rise during sound and fall after it stops. Small received energy can represent near silence, and RTP alone proves no audibility.

## Changes

- `desktop/src/capture/audio-level.mjs`: direct PCM RMS, peak and dBFS observer of the exact capture stream passed to the sender. Stereo channels are measured separately to avoid opposite-phase cancellation. The analysis graph has a zero-gain sink and never plays the capture into the speakers. No samples are recorded or logged.
- `desktop/src/capture/windows-loopback.mjs`: starts/stops the observer with native capture; the observer does not replace or alter outgoing tracks.
- `desktop/renderer.mjs`, `desktop/index.html`: playback meter, signal/waiting/silent/unavailable states, five-second silence warning with routing instructions. A suspended or frozen analysis clock is unavailable, not falsely reported as silence. Signal threshold is RMS 0.0001 (-80 dBFS); signal detection does not establish useful loudness or phone playback.
- `desktop/main.cjs`: disables background throttling for the broadcaster so meter sampling continues when its window is hidden/minimized; authentication, permissions and signaling unchanged.
- `desktop/src/peer-diagnostics.mjs`: preserves unknown RTC fields.
- Capture/PCM regression tests and both runtime harnesses updated for descriptive Live states. Smoke harness supports an external short WAV and asserts signal rise and post-playback silence.
- Desktop package and lock version 0.1.2. No new dependencies or backend/frontend changes.

## Verification on this Windows development environment

All backend tests: 19 passed. Desktop: 25 passed, plus syntax checks. Frontend: 6 passed, production build passed, lint passed with two existing hook dependency warnings. Existing bundle-size warning remains.

A restricted-sandbox desktop run reproduced the known `EPERM` during atomic credential-file rename in the sandbox's temporary directory (24 passed, 1 failed). The full identical suite passed 25/25 with normal Windows temporary-file access; production encrypted-store save/reload also passed both native runtime checks. No security fallback was introduced. Portable 0.1.2 packaging passed; executable is unsigned and kept outside the repository.

Native playback checks used Electron 45 on Windows, the production capture/transport modules, temporary local backend port 5057, and a local WebRTC receiver:

| Separate Windows playback | Peak capture RMS | Peak decoded receiver RMS | Sender cumulative energy |
| --- | ---: | ---: | ---: |
| Five-second SoundPlayer WAV tone | 0.02840 | 0.02857 | 0.008288 after playback |
| Windows `C:\Windows\Media\chimes.wav` through SoundPlayer | 0.008750 | 0.012409 | 0.0009155 after playback |

Chimes started from zero PCM, produced nonzero source and receiver PCM, and returned to RMS zero / `silent` after stopping. One audio track and zero video tracks reached the receiver. Stop released capture. Encrypted ownership save/reload passed.

Notably, the local receiver's `totalAudioEnergy` remained zero even when its analyser measured nonzero decoded PCM. Do not use that single counter as conclusive evidence of silence. Capture measurements are sampled 2048-frame windows at 100 ms intervals, not a recording or continuous integrated energy measurement. No real-phone audible playback, YouTube playback on the affected PC, or alternate endpoint routing was verified here.

## Run and manual acceptance on the affected PC

Use the new desktop build; 0.1.1 cannot display these diagnostics. No Render or Vercel redeployment is required for these desktop-only changes. Do not change deployment settings.

```powershell
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\desktop'
npm ci
$env:SPORTSRADIO_BACKEND_URL = 'https://sportsradioapp.onrender.com'
npm start
# Optional portable build (close running packaged copies first):
npm run dist
```

1. In Windows Settings > System > Sound select the output through which you can actually hear the source. Set it as the default playback device (not only the communications default). Open Volume Mixer and route Chrome/Edge/media player to **Default** or that same device. Check both system and application mute/volume. Do not mute the source to avoid feedback; use headphones if necessary.
2. Create/recover a room, click Start Broadcasting, and play ordinary unprotected audio/video in a separate application. Confirm you hear it locally and the **Captured playback level** meter rises / status says `signal detected`. Inspect `capturedPcm` in Audio diagnostics; RMS/peak must be nonzero. A live track or packets without this evidence is insufficient.
3. Pause playback for at least seven seconds. Meter must fall; `Live · capture silent` and routing instructions must appear. Resume playback; warning must clear automatically. No phone is needed for these checks.
4. Join the existing listener website on the iPhone using the room code or QR, tap Start Listening, and adjust phone volume. Confirm connected ICE/peer state, increasing outgoing/incoming RTP counters, and sender sourceEnergy growth when available. **Listen and explicitly verify audible source audio on the phone.** Do not mark this accepted based on diagnostics alone.
5. Stop broadcasting. Confirm capture tracks end, meter stops, peers close. Restart, rejoin, test with two listeners and minimize the desktop window. Check nonzero capture before and after listeners join.
6. To isolate routing, repeat with Windows chimes and then the original application. If chimes works but that application does not, inspect its per-app output/mute and try an unprotected local media file. If both stay silent despite audible local output, stop capture, align default/per-app outputs and restart. Test another available output; record output type, Windows version and whether audio enhancements/exclusive mode are enabled. Change one setting at a time; restore it if ineffective. Do not weaken backend permissions or add TURN as a remedy for measured silent source PCM.
7. Changing HDMI/Bluetooth/headphone/default outputs during an active session requires Stop then Start for this test. The application does not identify the endpoint's friendly name or promise automatic rerouting.
8. If capture PCM is nonzero but source stats/receiver remain silent, compare the same playback interval (cumulative values across different times are misleading). Save only the allowlisted diagnostics and describe the playback/output device. A positive PCM meter does not establish the final phone output route; check iPhone Bluetooth/AirPlay/headphone routing if received sound remains inaudible.

Optional repeatable local runtime check, in two PowerShell windows (requires this checkout and installed server/desktop dependencies):

```powershell
# Window 1
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\server'
$env:PORT = '5057'
$env:SPORTSYNC_DB_PATH = ':memory:'
node index.js
```

```powershell
# Window 2 (short WAV must finish within six seconds)
Set-Location 'C:\Users\ninte\OneDrive\Desktop\SportsRadioApp\desktop'
$env:SPORTSRADIO_BACKEND_URL = 'http://localhost:5057'
$env:SPORTSRADIO_SMOKE_WAV = 'C:\Windows\Media\chimes.wav'
npm run smoke
# Ignored local results: desktop/.smoke/result.json. This is not a phone test.
```

## User-reported real-phone acceptance (2026-10-24)

The user reports successful audible Windows-to-iPhone playback with SportsRadio Broadcaster **0.1.2**, Electron Windows system capture, **Arctis Nova Pro Wireless headphones** as the physical output, and the browser output set to **Windows Default**. Backend: `https://sportsradioapp.onrender.com`; listener: `https://sports-radio-app.vercel.app`. The iPhone received and audibly played the WebRTC audio.

This is user-reported acceptance evidence, not an agent-observed listening test. It confirms this configuration works. It supports output routing as a likely contributor to the earlier silence, but does not prove the exact prior mismatch. The earlier unverified statements in this report describe the development checks before this acceptance report.

Next task: complete the extended reliability checklist in `windows-mvp-acceptance.md`. If another output yields zero PCM, check default and per-application routing before investigating drivers or replacing transport.

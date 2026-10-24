# Windows MVP preservation and reliability

## Accepted configuration

On 2026-10-24 the user reported audible Windows-to-iPhone playback using Broadcaster 0.1.2, Arctis Nova Pro Wireless headphones, browser output **Windows Default**, Render backend `https://sportsradioapp.onrender.com`, and Vercel listener `https://sports-radio-app.vercel.app`. This is user-reported acceptance; no independent agent listening test is claimed. See `windows-loopback-silence.md` for capture measurements, troubleshooting and exact run commands.

The prior negotiation/playback fixes in commit `3a73b1f` remain intact: early ICE buffering, stale-answer/offer protection, negotiation retry, streamless audio track attachment and autoplay recovery. This preservation change does not alter frontend, backend, room codes, QR joining, encrypted credentials or Pi PCM transport. The desktop capture meter observes the original tracks without modifying sender audio. Electron remains 45.0.0; desktop version is 0.1.2.

## Automated reliability verification

- Backend suite covers secure room creation, valid/invalid/expired recovery, grace cleanup, signaling permissions and real Socket.IO integration for desktop/browser/Pi compatibility.
- Desktop suite covers repeated Stop/Start, asynchronous cancellation, capture end/cleanup, two concurrent listener peers, leave/rejoin with replacement peer, peer cleanup, fresh native capture acquisition after explicit output-change Stop/Start, reconnect intent and authenticated room recovery.
- Frontend suite preserves negotiation races, early ICE, stale work cancellation, stream attachment, autoplay recovery and safe diagnostics.
- Mocked output-change tests establish fresh acquisition and release behavior, **not actual Windows endpoint migration**. Physical routing and sustained listening still require the checklist below.
- Tests: backend 19, desktop 28, frontend 6; run `npm test` in each directory. Run `npm run check` in desktop, and `npm run lint` / `npm run build` in client. Frontend lint has two existing hook warnings; build has an existing chunk-size warning.
- Restricted sandbox temporary-file rename can produce `EPERM` in credential tests. Run with normal Windows file/process access; do not remove atomic persistence or security checks to bypass it.

## Manual reliability acceptance — pending

None of the following extended tests is claimed passed. Record device/browser versions, duration, outputs, observed PCM/peer counters, and pass/fail for each.

- [ ] **30 minutes:** Play ordinary audio continuously; lock neither Windows nor iPhone initially. Hear stable phone audio throughout; capture meter and packet counters continue. Repeat with broadcaster minimized. Record interruptions and recovery time. Sleep, app termination and screen locking are separate tests.
- [ ] **Two phones:** Join two phones simultaneously. Both hear the same source, desktop count is two, each peer receives RTP. Disconnect one; other continues. No synchronized playback guarantee.
- [ ] **Stop/Start:** Repeat three times with phones joined. Stop releases capture and peers; Start reacquires capture and restores audible audio. Record whether phone Start Listening is needed.
- [ ] **Phone leave/rejoin:** Leave/reload and join the same room three times. Count drops/recovers, old peers disappear, replacement peers play audio, remaining listener is unaffected.
- [ ] **Output switching:** Begin on known working default headphones. Stop, change default output and browser output to the same alternate device, then Start. Confirm local playback, nonzero capture and phone audio. Switch back and repeat. Automatic migration during live capture is not promised.
- [ ] **Network interruption:** Briefly disconnect/reconnect broadcaster network within configured recovery grace. Room recovers with saved ownership; capture restarts only after authentication; phone reconnects/rejoins and hears audio. Repeat after grace expiry: denied recovery should be explicit, without silent room takeover.

Known limits: STUN-only connectivity may fail on other networks; this acceptance does not establish TURN coverage. Endpoint routing must match. 0.1.2 portable is unsigned. Desktop-only source changes need a new executable; Render/Vercel settings need no changes.

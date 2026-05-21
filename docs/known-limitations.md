# Known Limitations

## Mobile Autoplay

Mobile browsers may block automatic audio playback after page refresh, tab restore, phone unlock, or backend reconnect. The app restores the room automatically, but the listener may need to tap `Tap to Start Listening`.

This is expected browser behavior and does not mean the Pi or backend is offline.

## Browser Background Behavior

Browsers can throttle JavaScript, timers, sockets, and audio playback while a tab is backgrounded or the phone is locked. Returning to the app may require the listener to resume or reconnect audio.

## Render Free Tier

If the backend runs on Render free-tier infrastructure, it may sleep after inactivity or take time to wake. During that window:

- The Pi may log backend retry messages.
- The room may briefly appear offline.
- Listeners may need to wait for the backend to become reachable.

For production venues, a non-sleeping backend plan is recommended.

## HDMI Extractor Recommendation

The MVP works with TV AUX output, but an HDMI audio extractor is recommended for production venues. It gives a more reliable and repeatable audio source, especially when TVs have variable headphone output levels, muted outputs, or inconsistent analog audio behavior.

## Local Network Assumptions

The local MVP assumes the Pi, backend, and listener devices can reach each other on the same network. Production deployment should point the Pi and web client at the deployed backend URL.

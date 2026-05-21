# Raspberry Pi Appliance MVP v1 Release Notes

## Summary

The Raspberry Pi appliance audio system has reached a stable MVP milestone. A Raspberry Pi Zero 2 W can run as a dedicated physical host appliance, capture real TV audio, publish it into the SportsRadioApp room model, and recover from common local network/backend interruptions.

## Confirmed Capabilities

- Pi appliance auto-start: the Pi runs `pi-host.js` under the `sports-sync-pi` systemd service on boot.
- TV AUX capture: real TV AUX output into the Sabrent USB audio adapter has been verified.
- Automatic audio device detection: `SPORTSYNC_AUDIO_DEVICE=auto` detects the current ALSA USB capture device, avoiding card-number changes after reboot.
- Fixed room appliance hosting: room `SPORTS` can be hosted by the Pi appliance.
- Automatic backend recovery: the Pi retries backend registration, re-registers its appliance room after backend restart, and falls back to systemd restart on sustained room recovery failure.
- Listener auto-reconnect: desktop and phone listeners can restore the room after refresh/backend recovery.
- Production deployment readiness: production env examples are available for the Vercel frontend, Render backend, and Pi appliance.

## Production Environment

Client production env:

```env
VITE_BACKEND_URL=https://sportsradioapp.onrender.com
VITE_FRONTEND_URL=https://sports-radio-app.vercel.app
```

Pi production env:

```env
SPORTSYNC_SERVER_URL=https://sportsradioapp.onrender.com
SPORTSYNC_ROOM_CODE=SPORTS
SPORTSYNC_AUDIO_DEVICE=auto
```

## Known Limitation

Mobile browsers may block automatic audio playback after refresh, reconnect, or page restoration. In that case, the room restores successfully and the listener is shown a `Tap to Start Listening` button. This is expected browser autoplay behavior, not a Pi/backend failure.

## Validation Checklist

- Pi boots and starts `sports-sync-pi.service`.
- Logs show the detected USB audio capture device.
- Room `SPORTS` appears online.
- Desktop listener can join and hear TV AUX audio.
- Phone listener can join and hear TV AUX audio.
- Page refresh restores the listener room.
- Backend restart causes the Pi to re-register and listeners to recover.
- Production env values point to the Render backend and Vercel frontend.

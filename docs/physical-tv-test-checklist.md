# Physical TV Test Checklist

Use this checklist before considering the Raspberry Pi appliance flow stable for a venue-style demo.

## Local TV AUX Test

1. Connect the TV or source audio output to the Sabrent USB sound card input.
2. Confirm the Sabrent adapter is connected to the Raspberry Pi through USB OTG.
3. Start the local backend at `http://10.0.0.138:5000`.
4. Confirm the Pi service is running:

```bash
sudo systemctl status sports-sync-pi.service
```

5. Watch Pi logs and confirm room `HOME` is online:

```bash
journalctl -u sports-sync-pi.service -f
```

6. Join room `HOME` from a listener browser and confirm TV AUX audio is audible.

## Reboot Test

1. Reboot the Raspberry Pi:

```bash
sudo reboot
```

2. Wait for the Pi to come back online.
3. Confirm `sports-sync-pi.service` auto-started.
4. Confirm logs show `SPORTSYNC_AUDIO_DEVICE=auto` resolved to a `plughw:X,Y` device.
5. Confirm room `HOME` appears again without manually starting `pi-host`.
6. Confirm listener audio works.

## Backend Restart Test

1. Start listening to room `HOME`.
2. Stop the backend server.
3. Confirm Pi logs show backend unavailable and retrying.
4. Restart the backend server.
5. Confirm Pi logs show room re-registration.
6. Confirm listener audio resumes without leaving and rejoining.

## Listener Phone Test

1. Open the app from a phone on the same network.
2. Join room `HOME`.
3. Confirm audio starts after the user gesture required by the browser.
4. Lock/unlock the phone or switch apps briefly.
5. Return to the browser and confirm Reconnect Audio restores playback if needed.

## HDMI Extractor Future Test

1. Connect the HDMI source through an HDMI audio extractor.
2. Route extractor analog output into the Sabrent USB sound card input.
3. Confirm `arecord -l` still detects the USB Audio Device.
4. Confirm room `HOME` streams extractor audio to listeners.
5. Compare sync and level against the direct TV AUX setup.

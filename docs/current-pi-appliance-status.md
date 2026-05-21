# Current Pi Appliance Status

This reflects the confirmed Raspberry Pi appliance prototype status for SportsRadioApp.

## Confirmed Working

- Raspberry Pi Zero 2 W boots and auto-starts the `sports-sync-pi` systemd service.
- `pi-host.js` runs from `/home/kael/sports-sync-pi`.
- Room code `HOME` is used for the appliance room.
- Local backend target is `http://10.0.0.138:5000`.
- USB audio capture works through the Sabrent USB External Stereo Sound Adapter.
- Real TV AUX output into the USB sound card has been tested successfully.
- Browser listeners can join room `HOME` and hear the appliance audio.
- Backend restart recovery works: the Pi can re-register the appliance room after the backend returns.
- Listener auto-reconnect works after backend restart and Pi room recovery.

## Current Runtime Assumptions

- The Pi is on the same local network as the backend and listeners.
- The backend is reachable at `10.0.0.138:5000`.
- The Pi service is managed by `systemd` as `sports-sync-pi.service`.
- `SPORTSYNC_AUDIO_DEVICE=auto` should be used so ALSA card number changes after reboot do not require editing `.env`.

## Useful Pi Commands

```bash
sudo systemctl status sports-sync-pi.service
journalctl -u sports-sync-pi.service -f
sudo systemctl restart sports-sync-pi.service
arecord -l
```

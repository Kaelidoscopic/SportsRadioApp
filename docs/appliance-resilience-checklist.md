# Appliance Resilience Checklist

Use this checklist after changes to the Raspberry Pi appliance host flow.

1. Start the backend server.
2. Start the client app.
3. Start `pi-host` on the Raspberry Pi with `SPORTSYNC_ROOM_CODE=HOME`.
4. Join room `HOME` from a listener browser.
5. Confirm Pi appliance audio is playing.
6. Stop the backend server.
7. Confirm `pi-host` keeps running and logs that the backend is down.
8. Restart the backend server.
9. Confirm `pi-host` re-registers room `HOME` automatically.
10. Confirm the listener reconnects and audio resumes without leaving the room.
11. Press Reconnect Audio and confirm appliance playback restarts without leaving or rejoining.

## Running pi-host under systemd

Install the Pi host as a restartable service so sustained room recovery failures can restart the process automatically.

Create `/etc/systemd/system/sports-sync-pi-host.service` on the Raspberry Pi:

```ini
[Unit]
Description=Sports Audio Sync Pi Host
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/kael/sports-sync-pi
ExecStart=/usr/bin/node /home/kael/sports-sync-pi/pi-host.js
Restart=on-failure
RestartSec=3
User=kael
Environment=SPORTSYNC_SERVER_URL=http://10.0.0.138:5000
Environment=SPORTSYNC_ROOM_CODE=HOME
Environment=SPORTSYNC_AUDIO_DEVICE=plughw:1,0
Environment=SPORTSYNC_SAMPLE_RATE=44100
Environment=SPORTSYNC_CHANNELS=2

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sports-sync-pi-host.service
```

Useful service commands:

```bash
sudo systemctl status sports-sync-pi-host.service
journalctl -u sports-sync-pi-host.service -f
sudo systemctl restart sports-sync-pi-host.service
```

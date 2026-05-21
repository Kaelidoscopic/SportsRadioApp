# Raspberry Pi systemd Setup

These commands install the Pi appliance host in `/home/kael/sports-sync-pi` and run it automatically on boot.

## 1. Copy App Files To The Pi

From Windows PowerShell, run this from the repository root:

```powershell
ssh kael@sportsyncpi.local "mkdir -p /home/kael/sports-sync-pi"
scp server/package.json server/package-lock.json server/pi-host.js server/.env.pi.example kael@sportsyncpi.local:/home/kael/sports-sync-pi/
ssh kael@sportsyncpi.local "cd /home/kael/sports-sync-pi && npm install --omit=dev --prefix server"
```

## 2. Create The Pi Environment File

SSH into the Pi:

```bash
ssh kael@sportsyncpi.local
```

Create `/home/kael/sports-sync-pi/.env`:

```bash
cat >/home/kael/sports-sync-pi/.env <<'EOF'
SPORTSYNC_SERVER_URL=http://10.0.0.138:5000
SPORTSYNC_ROOM_CODE=HOME
SPORTSYNC_AUDIO_DEVICE=auto
EOF
```

`SPORTSYNC_AUDIO_DEVICE=auto` tells `pi-host` to run `arecord -l`, find the USB Audio Device, and build the current `plughw:<card>,<device>` value automatically. You can still set a fixed value like `plughw:1,0` if needed for debugging.

Optional quick manual test:

```bash
cd /home/kael/sports-sync-pi
npm run pi-host
```

Stop the manual test with `Ctrl+C` before enabling the service.

## 3. Create The systemd Service

Create `/etc/systemd/system/sports-sync-pi.service`:

```bash
sudo tee /etc/systemd/system/sports-sync-pi.service >/dev/null <<'EOF'
[Unit]
Description=Sports Audio Sync Pi Appliance Host
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/home/kael/sports-sync-pi/server
ExecStart=/usr/bin/npm run pi-host
Restart=always
RestartSec=5
EnvironmentFile=/home/kael/sports-sync-pi/.env
User=kael

[Install]
WantedBy=multi-user.target
EOF
```

## 4. Enable And Start The Service

```bash
sudo systemctl daemon-reload
sudo systemctl enable sports-sync-pi.service
sudo systemctl start sports-sync-pi.service
```

## 5. Check Status And Logs

```bash
sudo systemctl status sports-sync-pi.service
journalctl -u sports-sync-pi.service -f
```

Expected startup logs include the configured server, room, audio-device setting, and detected device:

```text
Pi host server URL: http://10.0.0.138:5000
Pi host room code: HOME
Pi host audio device setting: auto
Detected USB audio capture device: plughw:0,0
```

## 6. Restart Or Stop The Service

```bash
sudo systemctl restart sports-sync-pi.service
sudo systemctl stop sports-sync-pi.service
```

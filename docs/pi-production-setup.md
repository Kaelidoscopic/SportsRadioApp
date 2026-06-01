# Raspberry Pi Production Setup

This guide configures the Raspberry Pi appliance to auto-start on boot and stream to the production backend.

## Pi Directory

The production Pi app directory is:

```bash
/home/kael/sports-sync-pi
```

This directory should be a git clone of the repo, not copied server files:

```bash
git clone https://github.com/Kaelidoscopic/SportsRadioApp.git /home/kael/sports-sync-pi
cd /home/kael/sports-sync-pi
npm install --omit=dev --prefix server
```

## `.env` Example

Create `/home/kael/sports-sync-pi/.env`:

```bash
cat >/home/kael/sports-sync-pi/.env <<'EOF'
SPORTSYNC_SERVER_URL=https://sportsradioapp.onrender.com
SPORTSYNC_APPLIANCE_ID=HOUSE_BOX_1
SPORTSYNC_APPLIANCE_NAME=House Box 1
SPORTSYNC_ROOM_CODE=HOME
SPORTSYNC_ROOM_NAME=Home Audio
SPORTSYNC_AUDIO_DEVICE=auto
EOF
```

For local testing, use the local backend URL instead:

```env
SPORTSYNC_SERVER_URL=http://10.0.0.138:5000
SPORTSYNC_APPLIANCE_ID=HOUSE_BOX_1
SPORTSYNC_APPLIANCE_NAME=House Box 1
SPORTSYNC_ROOM_CODE=HOME
SPORTSYNC_ROOM_NAME=Home Audio
SPORTSYNC_AUDIO_DEVICE=auto
```

`SPORTSYNC_APPLIANCE_ID` should be stable for each physical box. Admin controls use it to identify which Pi should receive room-code, audio, and restart commands.

The Pi also maintains a local JSON config at `/home/kael/sports-sync-pi/appliance-config.json`. Admin room-code and audio on/off commands are written there so the appliance keeps the setting after a service restart.

## systemd Service

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

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable sports-sync-pi.service
sudo systemctl start sports-sync-pi.service
```

## Restart Commands

```bash
sudo systemctl restart sports-sync-pi.service
sudo systemctl stop sports-sync-pi.service
sudo systemctl start sports-sync-pi.service
```

## Status And Logs

```bash
sudo systemctl status sports-sync-pi.service
journalctl -u sports-sync-pi.service -f
```

Expected logs include:

```text
Pi host server URL: https://sportsradioapp.onrender.com
Pi host room code: HOME
Pi host audio device setting: auto
Detected USB audio capture device: plughw:X,Y
Room re-registered. HOME is online at https://sportsradioapp.onrender.com.
```

## Reboot Recovery Behavior

- On boot, systemd starts `sports-sync-pi.service`.
- `pi-host.js` receives `/home/kael/sports-sync-pi/.env` through systemd.
- With `SPORTSYNC_AUDIO_DEVICE=auto`, the Pi runs `arecord -l` and detects the USB audio adapter.
- If the USB audio adapter is not ready yet, detection retries every 3 seconds.
- If the backend is unavailable, the Pi keeps retrying registration.
- If room recovery gets stuck after sustained 404 responses, `pi-host.js` exits and systemd restarts it.

## Updating From GitHub

After Codex pushes changes, update the Pi with:

```bash
cd /home/kael/sports-sync-pi
./scripts/update-pi.sh
```

See [Pi update workflow](pi-update-workflow.md) for the full update and migration process.

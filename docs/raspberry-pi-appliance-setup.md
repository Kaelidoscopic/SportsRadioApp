# Raspberry Pi Appliance Setup

This guide installs the existing Node.js box host as a boot-time appliance. Replace values such as `pi`, `/opt/venue-audio`, the backend URL, room details, and audio device with values for the box being installed.

## Prerequisites

- Raspberry Pi OS Lite with working Wi-Fi or Ethernet and time synchronization
- A normal, non-root Linux user that will own and run the application
- Node.js 22 or newer, npm, Git, ALSA utilities (`arecord`), and the USB audio adapter
- A repository checkout and backend URL reachable from the Pi

On Raspberry Pi OS, install the non-Node prerequisites with:

```bash
sudo apt update
sudo apt install -y git alsa-utils
```

Install a currently supported Node.js release using the method appropriate for your Raspberry Pi OS release, then verify:

```bash
node --version
npm --version
arecord --version
```

## Initial project installation

The path and user are examples, not application requirements:

```bash
sudo mkdir -p /opt/venue-audio
sudo chown "$USER":"$(id -gn)" /opt/venue-audio
git clone https://github.com/Kaelidoscopic/SportsRadioApp.git /opt/venue-audio
cd /opt/venue-audio
npm ci --omit=dev --prefix server
```

If the repository is already cloned elsewhere, use that absolute path when running the installer.

## Environment configuration

Create an untracked environment file and restrict it to the service account:

```bash
cd /opt/venue-audio
cp server/.env.pi.example .env
chmod 600 .env
nano .env
```

Required local value:

```env
SPORTSYNC_SERVER_URL=https://your-backend.example.com
```

Common optional values:

```env
SPORTSYNC_APPLIANCE_NAME=Venue Audio Box
SPORTSYNC_PAIRING_CODE=BOX-EXAMPLE
SPORTSYNC_ROOM_CODE=MAIN
SPORTSYNC_ROOM_NAME=Main TV
SPORTSYNC_ROOM_ACTIVE=true
SPORTSYNC_AUDIO_ENABLED=true
SPORTSYNC_ROOM_PUBLIC=true
SPORTSYNC_AUDIO_DEVICE=auto
```

`PI_HOST_TOKEN` is required only when the backend has the same `PI_HOST_TOKEN` configured. Never commit this token. `SPORTSYNC_DEVICE_ID` is normally omitted: the application generates and persists a UUID on first start. Set it only when deliberately migrating an existing box identity. Legacy `SPORTSYNC_APPLIANCE_ID` remains supported.

Advanced settings include `SPORTSYNC_CONFIG_PATH`, `SPORTSYNC_SAMPLE_RATE`, `SPORTSYNC_CHANNELS`, `SPORTSYNC_CHUNK_BYTES`, `SPORTSYNC_HTTP_TIMEOUT_MS`, `SPORTSYNC_RETRY_BASE_DELAY_MS`, `SPORTSYNC_RETRY_MAX_DELAY_MS`, and `SPORTSYNC_ROOM_404_EXIT_AFTER_MS`.

## Audio-device configuration

List capture devices:

```bash
arecord -l
```

`SPORTSYNC_AUDIO_DEVICE=auto` searches for a device reported as `USB Audio Device`. If detection does not match the adapter, set the ALSA address shown by `arecord -l`, for example:

```env
SPORTSYNC_AUDIO_DEVICE=plughw:1,0
```

Verify capture independently before installing the service:

```bash
arecord -D plughw:1,0 -f S16_LE -r 44100 -c 2 -d 5 /tmp/venue-audio-test.wav
aplay /tmp/venue-audio-test.wav
```

## Local box configuration

The default persistent file is:

```text
~/.config/venue-audio/box-config.json
```

It is created with user-only permissions on the first run. It stores the permanent `deviceId`, device and room names, pairing code, room code, active/audio state, and audio-device choice. Writes use a temporary file plus atomic rename. An example is in `server/appliance-config.example.json`.

Environment values seed a missing file. After creation, the local JSON file preserves identity and settings across service restarts and software updates. Remote appliance commands also update this file. If it becomes invalid, the application exits rather than silently generating a new identity; fix or restore the file and restart the service.

On upgrade, a legacy `appliance-config.json` in the repository root (or the parent of the old `server` working directory) is copied into the new default location without changing its `applianceId`; that value becomes `deviceId`. The legacy file is left in place as a rollback copy.

Do not copy the example's placeholder device ID onto multiple boxes. To let a new box generate its identity, leave `SPORTSYNC_DEVICE_ID` unset and do not pre-create the JSON file.

## Manual first run

Run once as the future service user:

```bash
cd /opt/venue-audio
set -a
. ./.env
set +a
node server/pi-host.js
```

Confirm the configuration path/device identity, backend connection, registration, room activation, and audio-capture logs. Stop with `Ctrl+C` and confirm the shutdown log.

## Install the systemd service

The installer generates `/etc/systemd/system/venue-audio-box.service` from the tracked template. It will not overwrite an unrelated service, and updating a service previously created by it requires `--force`.

```bash
cd /opt/venue-audio
chmod +x scripts/install-pi-service.sh scripts/update-pi.sh
sudo ./scripts/install-pi-service.sh \
  --user "$USER" \
  --app-dir /opt/venue-audio \
  --env-file /opt/venue-audio/.env
```

For a non-default Node path, add `--node "$(command -v node)"`. For a custom unit name, add `--service-name NAME` and use that name in every command below.

The unit waits for `network-online.target`, runs Node as the configured normal user, uses the repository as its working directory, loads the protected environment file, logs to journald, sends `SIGTERM` on stop, and restarts after process failure.

## Service operations and logs

```bash
sudo systemctl status venue-audio-box.service
sudo journalctl -u venue-audio-box.service -f
sudo journalctl -u venue-audio-box.service -b --no-pager
sudo systemctl restart venue-audio-box.service
sudo systemctl stop venue-audio-box.service
sudo systemctl start venue-audio-box.service
sudo systemctl disable --now venue-audio-box.service
sudo systemctl enable --now venue-audio-box.service
```

Update the generated unit after changing its user, path, environment file, or Node path:

```bash
sudo ./scripts/install-pi-service.sh --force --user "$USER" --app-dir /opt/venue-audio --env-file /opt/venue-audio/.env
```

Uninstall only the managed service (application, `.env`, and box config are preserved):

```bash
sudo ./scripts/install-pi-service.sh --service-name venue-audio-box --uninstall
```

## Appliance recovery test checklist

Record the permanent device ID before testing:

```bash
journalctl -u venue-audio-box.service -b | grep "Device identity"
```

1. Backend available: start the service and confirm connected, registered, room activated, and audio capture started.
2. Backend unavailable at startup: stop the backend, restart the service, observe bounded reconnection scheduling, then start the backend and confirm successful recovery without restarting the Pi process manually.
3. Backend restart: keep the Pi powered, restart the backend, and confirm disconnect, reconnect, registration, room activation, and listener audio recovery.
4. Internet loss: disconnect Wi-Fi/Ethernet temporarily, restore it, and confirm the same recovery sequence without duplicate Pi processes or Socket.IO sessions.
5. Process crash: run `sudo systemctl kill --signal=SIGKILL venue-audio-box.service`, then confirm systemd starts a new process with `systemctl status`.
6. Reboot: run `sudo reboot`, reconnect after boot, and confirm the unit is active and has boot logs.
7. Identity persistence: compare the post-reboot `Device identity` log and JSON `deviceId` with the value recorded earlier.
8. Automatic room: join its configured room after boot and confirm live appliance audio.
9. Browser host regression: create a separate browser-hosted room and confirm a listener can join and hear it.
10. Listener/QR regression: join the Pi room both by typing its room code and through its `/?room=CODE` QR URL.

The repository's focused configuration tests run with:

```bash
npm --prefix server test
```

## Safe software updates

Before updating, note the known-good revision and back up local state outside the repository:

```bash
cd /opt/venue-audio
git rev-parse HEAD
cp .env "$HOME/venue-audio.env.backup"
cp "$HOME/.config/venue-audio/box-config.json" "$HOME/venue-audio-box-config.backup.json"
./scripts/update-pi.sh
```

The updater derives the repository path from its own location, uses a fast-forward-only pull, installs locked production dependencies, restarts the service, and displays status. Override its defaults with `SPORTSYNC_APP_DIR`, `SPORTSYNC_SERVICE_NAME`, or `SPORTSYNC_GIT_BRANCH`.

To roll back after a failed release, use the previously recorded commit without deleting local configuration:

```bash
cd /opt/venue-audio
sudo systemctl stop venue-audio-box.service
git switch --detach PREVIOUS_COMMIT_SHA
npm ci --omit=dev --prefix server
sudo systemctl start venue-audio-box.service
sudo journalctl -u venue-audio-box.service -n 100 --no-pager
```

Return to the tracked release branch after the issue is fixed with `git switch main` and the normal updater. Do not use `git reset --hard`; `.env` and box configuration should remain outside tracked files.

## Troubleshooting

- `USB audio capture device not found`: run `arecord -l`, verify power/cabling and group access, or configure an explicit `plughw:CARD,DEVICE`.
- `Invalid appliance token`: make `PI_HOST_TOKEN` identical on the Pi and backend, or remove it from both while developing.
- `Room registration conflict`: another browser or box currently owns that room code; choose a unique code or stop the other host.
- Repeated HTTP timeouts: verify DNS, Wi-Fi, backend health, URL scheme, and firewall access from the Pi.
- Service exits on config load: validate the JSON and restore the last known device ID; do not delete it casually because deletion creates a new box identity.
- Service runs manually but not under systemd: inspect `systemctl cat venue-audio-box.service`, file ownership, the configured Node path, environment-file permissions, and the journal.
- Wi-Fi is slow to become ready: ensure the OS network manager provides a working `network-online.target`; the application still tolerates the backend being unavailable after systemd starts it.

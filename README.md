# SportsRadioApp

SportsRadioApp is a real-time sports audio sync app. It supports browser-hosted audio rooms and a Raspberry Pi appliance mode for capturing physical TV or venue audio and streaming it to listener phones.

## Appliance Mode Overview

The Raspberry Pi appliance mode turns a Raspberry Pi Zero 2 W into a dedicated room host.

Current MVP appliance flow:

```text
TV / HDMI source
  -> AUX or HDMI extractor audio output
  -> USB audio adapter
  -> Raspberry Pi Zero 2 W
  -> SportsRadioApp backend
  -> listener phones / browsers
```

The Pi runs `server/pi-host.js` under systemd, captures audio with `arecord`, registers a fixed room code such as `HOME`, and streams audio chunks to the backend. Listeners join the room from the web app.

Key appliance docs:

- [Hardware list](docs/hardware-list.md)
- [Wiring diagram](docs/wiring-diagram.md)
- [Pi production setup](docs/pi-production-setup.md)
- [Appliance admin control](docs/appliance-admin-control.md)
- [Product appliance dashboard plan](docs/product-appliance-dashboard-plan.md)
- [Pi update workflow](docs/pi-update-workflow.md)
- [Physical TV test checklist](docs/physical-tv-test-checklist.md)
- [Known limitations](docs/known-limitations.md)
- [MVP v1 release notes](docs/mvp-v1-release-notes.md)

## Local Testing

Start the backend:

```bash
cd server
npm install
node index.js
```

Start the frontend:

```bash
cd client
npm install
npm run dev
```

Example local client env:

```env
VITE_BACKEND_URL=http://localhost:5000
VITE_FRONTEND_URL=http://localhost:5173
```

Example local Pi env:

```env
SPORTSYNC_SERVER_URL=http://10.0.0.138:5000
SPORTSYNC_APPLIANCE_ID=HOUSE_BOX_1
SPORTSYNC_APPLIANCE_NAME=House Box 1
SPORTSYNC_ROOM_CODE=HOME
SPORTSYNC_ROOM_NAME=Home Audio
SPORTSYNC_ROOM_PUBLIC=true
SPORTSYNC_AUDIO_DEVICE=auto
```

Run the Pi host manually during testing:

```bash
cd /home/kael/sports-sync-pi
npm --prefix server run pi-host
```

For installed Pi appliances, use systemd:

```bash
sudo systemctl status sports-sync-pi.service
journalctl -u sports-sync-pi.service -f
sudo systemctl restart sports-sync-pi.service
```

## Production Deployment Flow

Frontend production env:

```env
VITE_BACKEND_URL=https://sportsradioapp.onrender.com
VITE_FRONTEND_URL=https://sports-radio-app.vercel.app
```

Pi production env:

```env
SPORTSYNC_SERVER_URL=https://sportsradioapp.onrender.com
SPORTSYNC_APPLIANCE_ID=HOUSE_BOX_1
SPORTSYNC_APPLIANCE_NAME=House Box 1
SPORTSYNC_ROOM_CODE=HOME
SPORTSYNC_ROOM_NAME=Home Audio
SPORTSYNC_ROOM_PUBLIC=true
SPORTSYNC_AUDIO_DEVICE=auto
```

Backend admin env:

```env
ADMIN_PIN=5235
```

Production flow:

1. Deploy the backend.
2. Configure and deploy the frontend with the production backend URL.
3. Clone the repository to `/home/kael/sports-sync-pi` on the Pi.
4. Create `/home/kael/sports-sync-pi/.env` with the production Pi env values.
5. Enable the `sports-sync-pi.service` systemd service.
6. Confirm room `HOME` appears online and listener phones can hear appliance audio.

Owners can open `/admin`, enter the backend admin PIN, and control registered Pi appliances from a phone.

## Mobile Audio Note

Mobile browsers may require one tap after refresh, phone unlock, or reconnect before audio playback can resume. The app restores the room automatically and shows `Tap to Resume Audio` when a browser gesture is required.

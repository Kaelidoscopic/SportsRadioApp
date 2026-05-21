# Appliance Account Linking

This is the first managed-box flow for physical Raspberry Pi audio appliances.

## Current Account Model

The app uses a lightweight browser-local account id for now. On the Host screen, tap **Create Host Account**. The browser stores an owner id locally and sends it to the backend as `X-User-Id`.

This is enough for Phase 1 ownership checks, but it is not a replacement for real login. A future auth provider should issue the user id and session token.

## Pi Setup Values

Each physical box should have stable values in `/home/kael/sports-sync-pi/.env`:

```env
SPORTSYNC_SERVER_URL=https://sportsradioapp.onrender.com
SPORTSYNC_APPLIANCE_ID=HOUSE_BOX_1
SPORTSYNC_APPLIANCE_NAME=House Box 1
SPORTSYNC_PAIRING_CODE=HOUSE-5235
SPORTSYNC_ROOM_CODE=HOME
SPORTSYNC_ROOM_NAME=Home Audio
SPORTSYNC_AUDIO_DEVICE=auto
```

The Pi also persists app-driven changes in:

```text
/home/kael/sports-sync-pi/appliance-config.json
```

## Linking Flow

1. Start the Pi appliance service.
2. Open the web app.
3. Choose **Host Audio**.
4. Create a host account if the browser does not have one.
5. Enter the Pi pairing code.
6. Tap **Link Box**.

After linking, the box appears in the Host menu. Only that owner id can edit or control it through the new appliance API routes.

## Host Dashboard Flow

The Host menu now prioritizes linked physical boxes:

- view online/offline status
- edit box display name
- edit listener-facing room name
- edit room code
- activate/deactivate the room
- start/stop audio
- see listener count

Browser-host mode remains available below the managed-box section for manual testing.

## Listener Flow

Listeners can still enter a room code directly. The Join Audio screen also lists active public rooms from the backend, including appliance room names when available.

## Backend Routes

Managed appliance routes require `X-User-Id`:

- `GET /api/appliances/mine`
- `POST /api/appliances/link`
- `PATCH /api/appliances/:id/settings`
- `POST /api/appliances/:id/start-room`
- `POST /api/appliances/:id/stop-room`
- `POST /api/appliances/:id/start-audio`
- `POST /api/appliances/:id/stop-audio`

## Current Limitations

- Appliance ownership is in-memory until a database is added.
- The browser-local account id is a placeholder for real authentication.
- Pairing codes are static values configured on the Pi.
- Nearby-room discovery is not implemented yet; the room list is backend-wide active rooms.

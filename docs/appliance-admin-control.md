# Appliance Admin Control

Appliance admin mode lets an admin control Raspberry Pi audio boxes from a phone without SSHing into the Pi.

## Backend Security

Set an admin PIN on the backend environment:

```env
ADMIN_PIN=5235
```

`SPORTSYNC_ADMIN_PIN` is also supported. If neither value is configured, the admin page will stay locked.

The admin page is available at:

```text
https://sports-radio-app.vercel.app/admin
```

For local testing:

```text
http://localhost:5173/admin
```

## Pi Appliance Identity

Each Pi should have a stable appliance ID:

```env
SPORTSYNC_SERVER_URL=https://sportsradioapp.onrender.com
SPORTSYNC_APPLIANCE_ID=HOUSE_BOX_1
SPORTSYNC_APPLIANCE_NAME=House Box 1
SPORTSYNC_ROOM_CODE=HOME
SPORTSYNC_ROOM_NAME=Home Audio
SPORTSYNC_AUDIO_DEVICE=auto
```

The Pi reports:

- appliance ID/name
- room code
- room name
- online status
- audio on/off status
- room active/inactive status
- listener count
- last heartbeat

## Persistent Pi Config

The Pi stores runtime admin changes in:

```text
/home/kael/sports-sync-pi/appliance-config.json
```

Example:

```json
{
  "applianceId": "HOUSE_BOX_1",
  "displayName": "House Box 1",
  "roomCode": "HOME",
  "roomName": "Home Audio",
  "audioDevice": "auto",
  "enabled": true,
  "roomActive": true
}
```

When the admin changes settings or toggles audio/room state, `pi-host.js` updates this JSON file and re-registers the room when needed.

## Admin Controls

Phase 2 has two control paths:

- Host Audio -> Login / Sign Up -> My Audio Boxes for user-owned boxes
- `/admin` for ADMIN_PIN fallback control

Users can link boxes by pairing code. The `/admin` page remains available when account ownership is not set up yet or a box needs fallback service control.

After entering the admin PIN, each appliance card shows:

- appliance name/id
- current room code
- room name
- online/offline state
- audio on/off
- room active/inactive
- listener count
- last heartbeat

Available commands:

- Save Settings
- Start Audio
- Stop Audio
- Activate Room
- Deactivate Room

The admin page calls PIN-protected backend API routes. The backend sends commands to the connected Pi over Socket.IO.

## Phase 1 API

All routes require the admin PIN in `x-admin-pin` or `Authorization: Bearer <pin>`.

- `GET /api/appliances`
- `GET /api/appliances/:applianceId`
- `PATCH /api/appliances/:applianceId/settings`
- `POST /api/appliances/:applianceId/start-audio`
- `POST /api/appliances/:applianceId/stop-audio`
- `POST /api/appliances/:applianceId/activate-room`
- `POST /api/appliances/:applianceId/deactivate-room`

## User-Owned Box API

Account routes:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `GET /api/auth/me`

Owner routes require `Authorization: Bearer <token>`:

- `GET /api/my/appliances`
- `POST /api/my/appliances/link`
- `GET /api/my/appliances/:applianceId`
- `PATCH /api/my/appliances/:applianceId/settings`
- `POST /api/my/appliances/:applianceId/start-audio`
- `POST /api/my/appliances/:applianceId/stop-audio`
- `POST /api/my/appliances/:applianceId/activate-room`
- `POST /api/my/appliances/:applianceId/deactivate-room`

## Persistent Models

The backend persists Phase 2 data in SQLite. Configure the file location with:

```env
SPORTSYNC_DB_PATH=./data/sports-sync.sqlite
```

Models:

- User: account email, display name, and password hash
- Appliance: box name, room settings, online/audio/room status, heartbeat, listener count
- Ownership: which user owns which appliance
- Pairing: pairing code assigned to an appliance

The admin PIN fallback still reads from `ADMIN_PIN` and can control registered boxes even before they are linked to a user.

## Expected Behavior

Room-code changes stop the old appliance room, save the new room code, re-register the new room, and resume audio uploads if audio is enabled.

Stop Audio turns off `arecord`, marks the appliance room as not broadcasting, and leaves the Pi online for future commands.

Start Audio restarts capture, re-registers the appliance room, and resumes listener playback.

Deactivate Room stops audio and removes the appliance room from the listener room list. Activate Room brings the room back using the saved room code and room name.

# Appliance Admin Control

Appliance admin mode lets the owner control Raspberry Pi audio boxes from a phone without SSHing into the Pi.

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
SPORTSYNC_ROOM_CODE=HOME
SPORTSYNC_AUDIO_DEVICE=auto
```

The Pi reports:

- appliance ID/name
- room code
- online status
- audio status
- uptime
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
  "roomCode": "HOME",
  "audioDevice": "auto",
  "enabled": true
}
```

When the admin changes the room code or toggles audio, `pi-host.js` updates this JSON file and re-registers the room.

## Admin Controls

After entering the admin PIN, each appliance card shows:

- appliance name/id
- current room code
- online/offline state
- broadcasting on/off
- listener count
- last heartbeat
- uptime

Available commands:

- Change Room Code
- Start Audio
- Stop Audio
- Restart Appliance

Commands are sent from the browser to the backend over Socket.IO, then from the backend to the Pi appliance Socket.IO client.

## Expected Behavior

Room-code changes stop the old appliance room, save the new room code, re-register the new room, and resume audio uploads if audio is enabled.

Stop Audio turns off `arecord`, marks the appliance room as not broadcasting, and leaves the Pi online for future commands.

Start Audio restarts capture, re-registers the appliance room, and resumes listener playback.

Restart Appliance exits `pi-host.js` with a non-zero status. The systemd service should restart it automatically.

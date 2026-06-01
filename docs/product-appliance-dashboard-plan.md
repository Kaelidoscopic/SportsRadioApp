# Product Appliance Dashboard Plan

The product direction is a managed physical-box experience similar to smart-light apps. The app has two public paths:

- Join Audio
- Host / Manage Boxes

## Listener Model

Listeners do not need accounts. They can:

- enter a room code manually
- scan a QR code
- choose an available public room when the backend lists one
- tap a room and start listening

The existing HOME room-code listener flow remains the compatibility baseline.

## Host Model

Hosts eventually create an account, link purchased boxes, and manage those boxes from a dashboard.

Phase 1 uses a placeholder login/sign-up screen and the existing admin PIN fallback. This keeps appliance control private while the real account system is not ready yet.

## Box Dashboard

The dashboard should feel like a smart-device app:

- all boxes appear as cards
- each card shows box name, room code, online/offline, audio state, listener count, and last heartbeat
- quick actions turn audio on/off and activate/deactivate the room
- tapping a card opens box settings

## Box Settings

Settings include:

- box display name
- room name
- room code
- public room listing

Controls include:

- start audio
- stop audio
- activate room
- deactivate room
- restart box later, when supported in the user-owned flow

Diagnostics include:

- online/offline
- last heartbeat
- audio device
- uptime
- backend connection status

## Phase 1

Implemented as UI structure plus admin PIN controls:

- landing page shows Join Audio, Host Audio, Login / Sign Up, and My Audio Boxes when the placeholder host session exists
- Login / Sign Up is a placeholder
- My Audio Boxes uses the admin PIN-protected appliance registry APIs
- existing `/admin` fallback remains
- existing HOME appliance flow remains unchanged
- browser host mode remains separate from physical box hosting

## Phase 2

Phase 2 adds the first real account and ownership layer:

- sign up/log in with email and password
- session token stored by the browser
- user-owned boxes
- pairing-code box linking
- owner-scoped appliance settings and controls
- admin PIN remains available as a fallback

The current implementation persists these models in SQLite:

- `users`
- `sessions`
- `appliances`
- `ownerships`
- `pairing_codes`

Set `SPORTSYNC_DB_PATH` to choose the database file. By default the backend uses `server/data/sports-sync.sqlite`.

## Phase 3

Add room discovery:

- public room listings
- nearby or same-WiFi room hints
- richer venue/customer join flows

## Current Safety Rules

- do not remove room-code join
- do not break HOME appliance audio
- keep admin PIN controls available until account ownership is production-ready
- keep browser host mode available as a separate fallback

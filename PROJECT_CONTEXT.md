# Sports Audio Sync App — Combined Project Context Summary

## Project Overview

The project is a real-time audio synchronization and live listening web application focused on allowing one user (the host) to broadcast audio while other users (listeners) join through room codes or QR codes.

The current development priority is reliability, reconnection handling, and room lifecycle stability before expanding into more advanced venue or event-based features.

---

# Core Concept

## Intended User Flow

### Host Flow

1. User opens the application.
2. User selects Host.
3. User either:

   * Generates a random room code
   * Uses a previously used room code
   * Types a custom room code
4. Host begins broadcasting audio.
5. Listeners join using:

   * Room code
   * QR code
6. Host can stop broadcasting or close the room.

### Listener Flow

1. User selects Listener.
2. User enters a room code OR scans a QR code.
3. User joins room and hears synchronized audio.
4. User can disconnect/reconnect without breaking host session.

---

# Current Technical Direction

## Frontend

* React
* QR code support
* Camera-based QR scanner
* Multi-screen host/listener navigation
* Persistent room code support

## Backend

* Socket.IO
* Real-time room management
* Reconnect grace periods
* Host/listener role tracking
* Room cleanup logic

---

# Major Development Decisions

## Persistent Room Code Support

The app moved toward supporting persistent room codes.

### Intended Behavior

* Previously used room codes should be reusable.
* “Use Previous Code” should appear after EVERY successful room creation.
* Randomly generated codes should also be eligible for persistence.
* Users should not need to manually type a room code to reuse it later.

### UI Decisions

* The “Save as Host Device” button on the host broadcast screen was considered redundant and removed from the intended UX flow.
* Persistent room handling should happen earlier in the flow.

---

# Grace Period / Reconnection Logic

## Purpose

Grace periods were introduced so temporary disconnects would not instantly destroy active rooms.

### Intended Benefits

* Hosts can briefly disconnect/reconnect.
* Listeners do not immediately lose the stream.
* Mobile/browser interruptions become more forgiving.

---

# Important Bugs and Stability Problems

## 1. Auto-Reopen Host Loop Bug

### Issue

When a host closes a room:

* The room immediately recreates itself.
* The user cannot return to the room entry screen.
* The app gets stuck reopening the same room repeatedly.

### Intended Behavior

* Closing the room should:

  * Fully close the room
  * Return user to landing/join screen
  * NOT automatically recreate the room

### Status

Partially addressed, but remains a major area requiring validation.

---

## 2. Ghost Room / Grace Period Conflict

### Issue

After disabling host device mode or closing a room:

* The room code remains reserved due to grace period logic.
* Users cannot immediately recreate the same room.
* Listeners can sometimes still join supposedly closed rooms.

### Intended Behavior

When a room is intentionally closed:

* The room should immediately become invalid.
* Listeners should no longer join.
* The room code should immediately become reusable.
* Grace period should ONLY apply to unexpected disconnects.

### Important Architectural Note

Intentional room closure and accidental disconnects need separate logic paths.

---

## 3. QR Scanner Black Screen

### Issue

If user:

1. Opens QR scanner
2. Cancels/closes scanner

The app sometimes transitions to a black screen.

### Intended Behavior

* Scanner close should safely return user to previous join screen.
* Camera cleanup should occur correctly.
* Navigation state should reset properly.

### Suspected Cause

Likely related to:

* Scanner component cleanup
* Route transition timing
* Camera stream not stopping correctly
* Invalid navigation state after cancel

---

## 4. Mouse/UI Navigation State Issues

Observed issues included:

* Screens reopening unexpectedly
* Previous room state lingering
* Navigation stack inconsistencies
* Old session state surviving room closure

The project direction shifted toward stricter cleanup of:

* room state
* socket state
* navigation state
* local persistence state

---

# UX and Flow Refinements

## Landing Page Improvements

The landing page was identified as needing cleanup.

### Goals

* Simplify host flow
* Reduce redundant buttons
* Clarify room lifecycle
* Make reconnect behavior understandable
* Reduce user confusion around host persistence

### Desired UX Principles

* Minimal friction
* Clear transitions
* Predictable room closure behavior
* No hidden persistent state

---

# Audio Broadcast System Notes

## Host Audio

The host broadcast system currently supports:

* Starting broadcasts
* Stopping broadcasts
* Audio input selection
* Muting
* Device selection

### Long-Term Possibilities

Potential future additions discussed conceptually:

* Venue mode
* TV synchronization
* Sports broadcast support
* Multi-room environments
* Better latency handling

However:

* Venue usage is currently deferred.
* Reliability takes priority over advanced features.

---

# Current Priority Order

## Highest Priority

1. Reconnect stability
2. Proper room cleanup
3. Prevent ghost rooms
4. Stop auto-room recreation loops
5. QR scanner stability
6. Predictable host state handling

---

# Recommended Next Features

After stability is improved, likely next steps include:

## Connection Visibility

* Listener count
* Listener join/leave indicators
* Connection quality indicators
* Host online/offline state

## Reliability Improvements

* Better reconnect detection
* Heartbeat systems
* Explicit room expiration
* Safer socket cleanup

## Audio Improvements

* Latency monitoring
* Audio buffering improvements
* Broadcast quality controls
* Device switching while live

## Mobile Improvements

* Better mobile navigation
* More resilient background behavior
* Cleaner camera permission handling

---

# Important Architectural Insights

## Key Separation Needed

The project repeatedly exposed the need to distinguish between:

### Intentional Actions

* Host explicitly closes room
* User manually exits
* User disables persistent hosting

VERSUS

### Unintentional Disconnects

* Browser refresh
* Mobile tab suspension
* Internet interruption
* Socket reconnect

These must NOT share the same cleanup logic.

---

# Current Overall Project State

The app has moved beyond basic proof-of-concept functionality and now primarily needs:

* lifecycle stabilization
* cleanup consistency
* reconnect robustness
* state management refinement
* UX polishing

Core room creation and joining functionality exists.
Most current work revolves around making the experience reliable and production-safe.

---

# Suggested Immediate Development Focus

## Recommended Order

### Phase 1 — Stability

* Fix intentional room closure flow
* Eliminate room recreation loops
* Separate reconnect vs close behavior
* Fix QR scanner cleanup

### Phase 2 — Reliability

* Harden reconnect logic
* Improve room expiration handling
* Add heartbeat validation
* Improve socket cleanup

### Phase 3 — UX

* Refine landing page
* Improve status indicators
* Simplify room persistence flow
* Add connection feedback

### Phase 4 — Advanced Features

* Venue support
* Enhanced synchronization
* Broadcast analytics
* Multi-device improvements

---

# Important Context For Future Development

The project intentionally shifted away from overcomplicated features temporarily.

Current philosophy:

* Reliability first
* Predictability first
* Stability before feature expansion
* Minimize hidden persistent behavior
* Avoid automatic room recreation unless explicitly desired

The current codebase already contains many interconnected room state systems, meaning future changes should be made carefully to avoid:

* stale socket state
* duplicated reconnect timers
* room lifecycle desynchronization
* accidental persistence loops
* invalid navigation states

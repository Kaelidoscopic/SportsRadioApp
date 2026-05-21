# QR Venue Setup

Use QR room links to make appliance rooms easy for customers to join.

## Room Link Format

The listener link format is:

```text
https://sports-radio-app.vercel.app/?room=HOME
```

Replace `HOME` with the venue room code, such as `SPORTS`.

When a customer opens the link, the app detects `?room=`, prefills the room code, and attempts to join automatically.

## Printing QR Codes

1. Start or confirm the appliance room code for the venue.
2. Generate a QR code for the full room link.
3. Print the QR code with the room code shown in large text nearby.
4. Include a short label such as `Scan to hear the game audio`.

## Placement

Good QR placement options:

- Tables
- Bar tops
- Host stand
- Near TVs
- Event signage
- Receipts or table tents

Use enough contrast and size that phones can scan the code quickly in dim lighting.

## Customer Flow

```text
scan QR code
  -> room opens in browser
  -> app joins room automatically
  -> customer taps Start Listening if needed
  -> customer hears venue audio
```

## Mobile Note

Some mobile browsers block audio playback until the customer taps the page. If this happens, the room still joins successfully and the app shows `Tap to Start Listening`.

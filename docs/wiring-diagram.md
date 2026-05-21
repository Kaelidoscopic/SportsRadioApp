# Wiring Diagram

## Current TV AUX Flow

```text
TV / HDMI source audio
  -> TV AUX / headphone output
  -> 3.5 mm AUX cable
  -> USB audio adapter line input
  -> microUSB OTG adapter
  -> Raspberry Pi Zero 2 W
  -> pi-host.js
  -> SportsRadioApp backend
  -> listener phones / browsers
```

## Preferred Venue Flow With HDMI Extractor

```text
HDMI source
  -> HDMI audio extractor
  -> HDMI display output to TV
  -> extractor analog audio output
  -> 3.5 mm AUX cable
  -> USB audio adapter line input
  -> Raspberry Pi Zero 2 W
  -> pi-host.js
  -> SportsRadioApp backend
  -> listener phones / browsers
```

## Signal Path Notes

- The Pi does not need a microphone. It captures line-level audio through the USB audio adapter.
- The Pi publishes audio to the backend as a fixed appliance room, currently `SPORTS`.
- Listeners join the room from the web app and receive the appliance audio stream.
- Mobile browsers may require one tap to resume audio after refresh or reconnect because of autoplay rules.

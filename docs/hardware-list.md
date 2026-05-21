# Hardware List

This is the current Raspberry Pi appliance hardware set for SportsRadioApp.

## Required MVP Hardware

- Raspberry Pi Zero 2 W
- microSD card with Raspberry Pi OS Lite 64-bit
- Reliable Raspberry Pi power supply
- USB audio adapter, currently tested with a Sabrent USB External Stereo Sound Adapter
- microUSB OTG adapter for connecting the USB audio adapter to the Pi Zero 2 W
- 3.5 mm AUX cable from the TV/source audio output into the USB audio adapter

## Preferred Production Hardware

- HDMI audio extractor for production venue setups
- HDMI source device, such as a cable box, streaming device, scoreboard feed, or AV receiver output
- HDMI cable from source to extractor
- HDMI cable from extractor to TV/display
- 3.5 mm AUX cable from extractor audio out to the USB audio adapter input

## Notes

- The MVP has been validated with real TV AUX output.
- `SPORTSYNC_AUDIO_DEVICE=auto` is recommended so the Pi can recover if ALSA changes the USB sound card number after reboot.
- For venue installs, an HDMI extractor is preferred because it gives a more predictable audio source than relying on a TV headphone/AUX output.

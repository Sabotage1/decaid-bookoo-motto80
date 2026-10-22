# BooKoo Motto 80 driver for Decaid — v0.1.0 testing release

I’m sharing an open-source community driver for connecting the BooKoo Motto 80
(MT80) grinder to Decaid 0.9.0 through the new JavaScript device-driver runtime.
It installs as a plugin; no Decaid core changes are needed.

This is an initial testing release. I don’t have a Motto 80 available myself,
so physical hardware validation is still pending. Owners willing to test it
and share their results would be very welcome.

Repository and documentation:
https://github.com/Sabotage1/decaid-bookoo-motto80

Release and installable ZIP:
https://github.com/Sabotage1/decaid-bookoo-motto80/releases/tag/v0.1.0

What’s implemented

- Read-only burr-gap reporting in micrometres, grinding RPM and operating state.
- Grinding RPM control from 500 to 1500 and feeder speed from 10 to 65 RPM.
- A device settings page for cup detection, automatic stop, fast residual
  clearing, brightness, standby delay and selecting existing presets.
- Humidity, lifetime grind count and firmware version readouts.
- Handshake, bounded message reassembly, firmware checks, settings
  acknowledgements and disconnect/reconnect handling through Decaid.

A couple of important limits

The physical burr gap is adjusted by hand on the grinder. BooKoo’s published
bladeGap write only updates a stored setting; it does not physically move the
burrs, so the driver deliberately exposes the gap as read-only.

The published BLE protocol does not provide remote grinding start/stop. This
driver therefore does not start/stop the motor or implement grind-by-weight.
Use the grinder’s own controls. It also does not perform firmware updates or
edit/import/delete presets.

Installation

1. Open the release link above and download bookoo-motto80-0.1.0.zip from Assets
   (not the automatically generated Source code ZIP).
2. Transfer that ZIP to the tablet running Decaid 0.9.0.
3. In Decaid, open Plugins → cogwheel → Install plugin → ZIP file and select it.
4. Load/enable “BooKoo Motto 80 Grinder”. Turn the grinder on and disconnect the
   BOOKOO app or another Bluetooth client before connecting from Decaid.
5. Scan for devices and connect to “BOOKOO MT80 xxxxxxxx” as a grinder. Check
   the suffix against your own grinder.
6. Open the grinder’s Settings action. Compare its readouts with the grinder
   screen, then try a small settings change while the grinder is idle.

Alternatively, use Install plugin → GitHub Branch with repository
Sabotage1/decaid-bookoo-motto80 and branch main. Branch installs track ongoing
commits. The release is marked as a prerelease, which Decaid 0.9.0’s native
GitHub Release dialog skips, so ZIP installation is recommended for this build.

Firmware and testing

BooKoo documents v1.2.19.0820 as the minimum compatible firmware. The automated
tests also cover the v1.3.1.1020 release number, but that is a simulated protocol
check, not confirmation from a physical grinder on that firmware.

All 46 driver tests pass, using Decaid v0.9.0’s unmodified JavaScript BLE bridge
with a simulated Dart/GATT boundary. The actual Flutter host, operating-system
Bluetooth stack and physical grinder are not exercised by those tests.

For a first test, please check discovery/connection, matching readouts, a small
idle RPM change, a grind started/stopped on the grinder, and reconnect after a
power-cycle. A complete checklist and results template are here:
https://github.com/Sabotage1/decaid-bookoo-motto80/blob/main/docs/HARDWARE_TESTING.md

If your skin only reads the writable grind-setting field, it may not show the
read-only burr-gap observation yet. Shot-history capture also depends on Decaid
and the skin; this driver does not add a separate recording integration.

Please share your Decaid version, tablet/OS, grinder firmware and observed
results here, or open an issue:
https://github.com/Sabotage1/decaid-bookoo-motto80/issues

The source is GPL-3.0-or-later, with protocol references and Decaid attribution
included. This is an independent community plugin, not an official BooKoo or
Decent release.

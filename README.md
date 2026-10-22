# BooKoo Motto 80 driver for Decaid

An open-source community Bluetooth driver that connects the **BooKoo Motto 80
(MT80) grinder** to **Decaid 0.9.0** without changing the Decaid application.

**Initial testing release: physical hardware validation is pending.** Automated
tests exercise Decaid's real JavaScript BLE bridge with simulated GATT. They do
not prove that a physical grinder, tablet or firmware behaves correctly.

## What it does

- Reports the burr gap in micrometres, grinding RPM and operating state.
- Sets grinding RPM (500–1500) and feeder RPM (10–65).
- Provides a device settings page for cup detection, automatic stop, fast
  residual clearing, brightness, standby delay and existing preset selection.
- Shows humidity, lifetime grind count and firmware version.
- Leaves Bluetooth discovery, connection, reconnect and teardown to Decaid.

**Burr-gap adjustment is physical/manual.** The manufacturer's BLE `bladeGap`
write updates a stored value; it does not move the burrs. This driver reports
the gap as a read-only observation and does not offer a motorized adjustment.
**Remote grinding start/stop and grind-by-weight are not implemented.** The
published protocol has no BLE start/stop interface; use the grinder's controls.

## Requirements

- Decaid **0.9.0**, using its dynamic BLE Grinder driver runtime.
- Motto 80 firmware **v1.2.19.0820 or later** according to the manufacturer.
  Firmware **v1.3.1.1020** is covered by simulated protocol tests; real-device
  compatibility with that version remains unverified.
- The grinder must be on and available for a Bluetooth connection. Disconnect
  the BOOKOO app or another client before connecting from Decaid.

## Install the ZIP (recommended for v0.1.0)

1. Download **[bookoo-motto80-0.1.0.zip](https://github.com/Sabotage1/decaid-bookoo-motto80/releases/download/v0.1.0/bookoo-motto80-0.1.0.zip)**
   from the **[v0.1.0 release](https://github.com/Sabotage1/decaid-bookoo-motto80/releases/tag/v0.1.0)**.
   Choose this asset, not GitHub's automatically generated Source code archive.
2. Transfer the ZIP to your Decaid tablet.
3. Open **Plugins → cogwheel → Install plugin → ZIP file** and select the ZIP.
4. Load/enable **BooKoo Motto 80 Grinder**. Turn the grinder on and disconnect
   the BOOKOO app or another client that is using its Bluetooth connection.
5. Scan for devices and connect to **BOOKOO MT80 xxxxxxxx** as a grinder.
   Check the name suffix against your grinder.
6. Open the grinder's **Settings** action. Compare the readings with its screen
   before trying a settings change while idle.

ZIP installs are snapshots: download and install a newer ZIP to update. GitHub
installs track their configured release or branch. Do not enable another driver
that claims the same grinder. A separate scale driver can remain enabled.

## Optional GitHub branch installation

In Decaid, choose **Install plugin → GitHub Branch**, enter repository
`Sabotage1/decaid-bookoo-motto80` and branch `main`, then load and connect as
above. This repository contains exactly one plugin root. Branch installs
follow commits on `main`, so they may receive changes beyond the tagged build.

The v0.1.0 release is deliberately marked as a **prerelease** while hardware
validation is pending. Decaid 0.9.0's native **GitHub Release** install dialog
excludes prereleases, so use the ZIP or branch method for this build.

## First hardware test

Start with discovery, connection and readouts. Then, while idle, apply a small
RPM change and verify it on the grinder. Finally check disconnect/reconnect and
a grind started and stopped on the grinder itself.

The **[hardware test checklist](docs/HARDWARE_TESTING.md)** includes a results
template. Please report the exact Decaid version, tablet/OS, grinder firmware,
which step failed and any relevant plugin error. Avoid posting serial numbers,
Wi-Fi names or other private information. Report issues in
**[GitHub Issues](https://github.com/Sabotage1/decaid-bookoo-motto80/issues)**.

## Design and limitations

The driver subscribes to TX notifications, sends the manufacturer's explicit
`appHello` handshake, reassembles bounded UTF-8 JSON frames and waits for an
accepted periodic observation before becoming ready. Discovery uses the device
name because the Custom GATT Service is not present in advertisements.

Settings changes require supported firmware and an idle device. A successful
Bluetooth write alone does not prove a setting was accepted: each request waits
for the corresponding manufacturer response. Because the protocol has no
request IDs, only one settings operation may be in flight per grinder. An
ambiguous timeout retires the session before another request can be attempted.

The read-only gap uses Decaid's `observedSetting` field. A skin that only reads
the writable `setting` field may leave its grind tile empty. Automatic capture
in shot history depends on Decaid and skin support; this driver does not add a
separate shot-recording integration.

The plugin does not update firmware, start/stop the motor, power off the grinder,
edit/delete/import presets, configure Wi-Fi or edit grinding sections. It does
not implement grind-by-weight. See the **[full driver reference](bookoo-motto80.reaplugin/README.md)**
for protocol details, settings, HTTP endpoints, timeout behavior and sources.

## Development

Node.js **20 or later**, plus `zip` and `unzip`, are required. There are no npm
dependencies.

```sh
npm test
npm run build
```

The build checks JavaScript syntax, runs the automated tests, creates
`dist/bookoo-motto80-0.1.0.zip`, verifies its contents against the sources and
writes `dist/SHA256SUMS`. The ZIP contains exactly one `.reaplugin` directory.

Tests cover framing/UTF-8, handshake/readiness, settings validation and responses,
timeouts, disconnect/reconnect, stale callbacks, firmware gating and four
independent simulated grinder sessions. The unmodified Decaid v0.9.0 JavaScript
BLE bridge is included as a test fixture. The Flutter/Dart host and physical
Bluetooth stack are not executed by this suite.

## License and sources

GPL-3.0-or-later. See [LICENSE](LICENSE), [COPYING](COPYING) and
[THIRD_PARTY.md](THIRD_PARTY.md).

- [BooKoo MT80 public BLE protocol](https://github.com/BooKooCode/OpenSource/blob/main/bookoo_motto80/README.md)
- [Decaid v0.9.0 plugin development guide](https://github.com/decentespresso/decaid/blob/v0.9.0/doc/Plugins.md)
- [Decaid v0.9.0 Grinder adapter](https://github.com/decentespresso/decaid/blob/v0.9.0/lib/src/plugins/plugin_grinder.dart)

This is an independent community plugin, not an official BooKoo or Decent release.

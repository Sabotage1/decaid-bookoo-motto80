# BooKoo Motto 80 grinder for Decaid

Installable JavaScript BLE grinder driver for **Decaid 0.9.0** and Motto 80
firmware **v1.2.19.0820 or later** (`releaseVer >= 102190820`).

Firmware **v1.3.1.1020** is above that minimum (expected encoded release value
`103011020`). Automated tests exercise that release number against the published
protocol. Physical compatibility still requires the hardware acceptance test below.

## Install

1. Download `bookoo-motto80-0.1.0.zip` from the [v0.1.0 release](https://github.com/Sabotage1/decaid-bookoo-motto80/releases/tag/v0.1.0) and transfer it to your Decaid tablet.
2. Open **Plugins → cogwheel → Install plugin → ZIP file** and select the ZIP.
   You can also install this `bookoo-motto80.reaplugin` folder as a Folder snapshot.
3. Load/enable **BooKoo Motto 80 Grinder**. Turn the grinder on and disconnect
   the BOOKOO app or any other client using it.
4. Scan in Decaid and select **BOOKOO MT80 xxxxxxxx** under grinders. Confirm
   the suffix matches your grinder. Use Decaid's normal preferred-device setting
   for automatic connection, where available.
5. Open the grinder's **Settings** action to view live readings and edit its
   supported settings. Wait for idle before applying changes.

This is a separate grinder driver; the Mini scale and R2 sensor can remain
enabled. Do not enable another plugin claiming the same Motto 80 advertisement.
Decaid owns discovery, Bluetooth connection, reconnect and teardown. The plugin
does not run its own scanner or reconnect loop. Local ZIP installs are snapshots;
install a newer ZIP to update.

## Supported features

| Feature | Behavior |
| --- | --- |
| Burr gap | Read-only `observedSetting`, numeric string in **µm**, 0–999. |
| Grinding RPM | `rpm` and `observedRpm`; set integer RPM 500–1500 using Decaid or the settings page. |
| Operating state | `idle`, `grinding`, `error` (warning), or `unknown`. High-speed clearing maps to grinding. |
| Feeder RPM | Set integer 10–65 in the device settings page. |
| Cup detection, automatic stop, fast clearing | Device settings page toggles. |
| Brightness, standby delay | Brightness 1–5; standby delay 60–900 seconds. |
| Mode / preset selection | N mode (`-1`) or an existing slot 0–9. UI shows preset slots 1–10. |
| Diagnostics | Current humidity, lifetime grind count, firmware release number and settings. |

**The Motto 80's physical burr adjustment is manual.** The public `bladeGap`
write changes only a stored setting, not the physical gap. This plugin therefore
does not expose `grindSetting` control or send `bladeGap` writes. Generic skins
must consume `observedSetting` for the read-only gap; older skins that read only
the writable `setting` field may leave their grind tile empty. Recording these
observations into shot history depends on Decaid/the skin's observation support.

**The published BLE protocol provides no remote grinding start/stop interface.**
Use the grinder's controls. Dose-by-weight, remote power, Wi-Fi credentials, OTA
updates, preset editing/import/deletion and grinding-section editing are not
implemented. Selecting a preset can change several settings on the device;
refresh the page after selection to read the current values. Start/stop and
future firmware interfaces are not inferred or sent speculatively.

Writes require a supported firmware version from this connection's `baseInfo`
broadcast and a current idle `periodInfo`. Missing firmware still permits
telemetry but disables settings. An explicitly older firmware fails connection.
Manufacturer business acknowledgement is required: a GATT acknowledgement alone
does not count as settings acceptance. Live values come from broadcasts, so an
accepted setting is not presented as a fabricated measurement.

## Settings and HTTP API

Plugin-global `PacketTimeoutMs` defaults to **5000**, with allowed integer range
1000–10000 ms. The official periodic message rate is 5 Hz. The eight-second
initialization deadline includes GATT discovery, subscription, handshake and the
first accepted snapshot. An incomplete fragment expires after two seconds.
Settings responses have a 6500 ms deadline. These budgets need hardware checks
on your tablet; the host uses a ten-second Grinder invocation budget.

Decaid provides the device settings page through the manifest's `settings`
surface. It passes the exact public `deviceId` in the URL. This ID selects only
an active instance created by this plugin; a name, raw MAC or another plugin ID
does not select a grinder.

The plugin also exposes the following endpoints under
`/api/v1/plugins/bookoo-motto80.reaplugin/`:

- `GET device-settings?deviceId=<encoded-public-id>` — settings page.
- `GET status?deviceId=<encoded-public-id>` — current session diagnostics.
- `POST configure?deviceId=<encoded-public-id>` — body
  `{"settings":{"grindRpm":900,"feedingRpm":40}}`; returns `{"applied":{...}}`
  only after the corresponding successful device response.

Use standard Decaid `PUT /api/v1/grinder/rpm` with `{"rpm":900}` for the selected
grinder. Read `GET /api/v1/grinder/state` or `/ws/v1/grinder/snapshot` for live
typed observations. This plugin does not modify Decaid's native API.

Only one settings request is allowed at a time per device. Invalid values are
rejected before any BLE write. A device rejection is surfaced without retrying.
Partial writes, ambiguous response timeouts and a silent stream report a failure
to Decaid and retire the session. Reconnect is necessary before another write;
the protocol has no request IDs, so delayed responses cannot safely be reused.
Disconnect/unload cancels timers and pending work without sending device commands.
Serial numbers and Wi-Fi names are neither retained nor returned in diagnostics.

## Protocol

- Discovery matches the case-insensitive name prefix `BOOKOO MT80 `.
  The Custom Service is **not advertised**, so it must not be a scan filter.
- Service `4d543830-0001-4b80-8f00-424f4f4b4f4f`.
- RX writes `4d543830-0002-4b80-8f00-424f4f4b4f4f`.
- TX notifications `4d543830-0003-4b80-8f00-424f4f4b4f4f`.
- Subscribe before sending `{"request":{"appHello":{"op":"handshake"}}}`.
  Reconnect requires a fresh handshake and fresh readiness observation.
- v1 fragment header: magic `A5`, version `01`, uint16 little-endian sequence,
  complete UTF-8 length and offset. At most 4096 bytes per JSON message.
- Outgoing fragments use acknowledged writes, at most 20 bytes including the
  eight-byte header; no increased MTU is required. Receive reassembly enforces
  sequence, total length, contiguous offsets, bounds, expiry and strict UTF-8.
- New offset-zero fragments replace incomplete messages. Sequence is a fragment
  grouping key, not a request ID; repeated or nonconsecutive sequences are valid.
- Readiness requires accepted `periodInfo` (state, gap and RPM) published to
  Decaid. Malformed messages do not refresh the silence deadline. Unknown
  nonempty device states remain valid and map to `unknown`.

## Validation

From the project directory, with Node.js 20 or later and system zip/unzip:

```sh
npm test
npm run build
```

The Motto tests use Decaid v0.9.0's **unmodified JavaScript BLE bridge**, with
a simulated Dart/GATT boundary and Grinder snapshot validation. They cover
handshake/fragmentation, UTF-8, settings ranges/acknowledgements, timeouts,
concurrent requests, reconnect, stale callbacks, four independent devices,
firmware checks, settings-page script parsing and API identity checks.
The build tests this driver and verifies archive entries and checksums.
These tests do not run the real Flutter/Dart host, operating-system Bluetooth
stack, motor or physical grinder. **No physical hardware validation has been
performed.**

### Hardware acceptance

1. Record tablet/OS, Decaid version and grinder firmware. Verify discovery by
   name and successful connection without using a Custom Service scan filter.
2. Compare gap, RPM, humidity and count with the grinder screen. Manually turn
   the gap dial and confirm the observation changes in Decaid.
3. With the grinder idle, set RPM to 500, 900 and 1500, and feeder speed to 10,
   40 and 65. Verify device acknowledgement and subsequent screen/readout values.
4. Check brightness, standby delay, cup detection, automatic stop, clearing,
   and selection of a known existing preset; restore your desired settings.
5. Start/stop a supervised grind on the grinder. Confirm Decaid reports the
   state and refuses settings writes while grinding or clearing.
6. Test power-cycle, manual disconnect/reconnect, plugin reload, tablet restart,
   browser background/foreground changes and loss of the BLE link. Confirm fresh
   observations after each reconnect and no stale settings are displayed.
7. If you use a scale or refractometer, keep it connected alongside the grinder
   and confirm independent readings. Check your skin and a saved shot for support of read-only grinder
   observations; this may require a separate skin integration.

BooKoo reports an Android connection-related firmware fix in its October 2026
update. If the grinder restarts during connection, update through the supported
BOOKOO N app workflow before retesting.

## Sources and license

- [Manufacturer protocol, September 2, 2026](https://github.com/BooKooCode/OpenSource/blob/main/bookoo_motto80/README.md),
  inspected October 22, 2026, blob `405ee24abaef7b6b5bb9ecaa2d797b4a3462b2b7`.
- [Manufacturer October firmware update](https://bookoocoffee.com/blogs/blog/motto80-october-2026-overseas-batch-2-production-update).
- [Decaid v0.9.0 plugin contract](https://github.com/decentespresso/decaid/blob/v0.9.0/doc/Plugins.md).
- [Decaid v0.9.0 Grinder adapter](https://github.com/decentespresso/decaid/blob/v0.9.0/lib/src/plugins/plugin_grinder.dart).

GPL-3.0-or-later. See LICENSE, COPYING and the parent project's THIRD_PARTY.md.

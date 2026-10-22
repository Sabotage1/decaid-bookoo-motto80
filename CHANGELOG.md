# Changelog

## 0.1.0 — 2026-10-23

Initial public testing release. Physical hardware validation is pending.

- Dynamic BLE Grinder driver for Decaid 0.9.0.
- Read-only burr-gap observations, RPM observations and operating state.
- Grinding RPM control plus documented general settings through a device page.
- Manufacturer handshake, bounded fragmentation/UTF-8 decoding, response
  acknowledgement, firmware checks and session cleanup.
- Automated tests through Decaid's actual JavaScript BLE bridge with simulated
  GATT, including firmware version v1.3.1.1020.
- Installable ZIP, checksum, installation guide and hardware test checklist.

Physical burr adjustment, remote start/stop and grind-by-weight are not provided.

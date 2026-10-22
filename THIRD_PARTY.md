# Source attribution

## Decaid

The plugin's session lifecycle and test approach originated in the GPL-licensed
Decaid device-driver work. Decaid is Copyright (C) 2025-2026 Decent Espresso,
GPL-3.0-or-later.

`test/fixtures/decaid-v0.9.0-ble-bridge.js` is the JavaScript string extracted
without modification from `lib/src/plugins/plugin_ble_bridge.dart` at Decaid
tag **v0.9.0**, commit **b9f9d0559106809a70dea2023f6bce34b5bdd3ca**:
[pinned source](https://github.com/decentespresso/decaid/blob/b9f9d0559106809a70dea2023f6bce34b5bdd3ca/lib/src/plugins/plugin_ble_bridge.dart).
The fixture is used only in tests and is excluded from the installable ZIP.

## BooKoo protocol

Protocol facts (UUIDs, handshake, fragmentation, settings ranges and broadcasts)
were checked against
[BooKooCode/OpenSource, bookoo_motto80/README.md](https://github.com/BooKooCode/OpenSource/blob/main/bookoo_motto80/README.md),
last updated September 2, 2026, blob SHA
`405ee24abaef7b6b5bb9ecaa2d797b4a3462b2b7`, inspected October 22, 2026.
That repository uses the MIT license. No BooKoo Python SDK implementation or
copied protocol document is included in this repository or the installable ZIP.

# Motto 80 hardware test checklist

This is a community testing release. The automated suite uses simulated GATT;
physical behavior is not yet verified. Please record actual observations and
mark a step as not tested if you cannot complete it.

## Setup

- Decaid version:
- Tablet/computer model and OS:
- Motto 80 firmware (including the final four digits):
- Plugin version:
- Skin and version:

The manufacturer's minimum documented firmware is v1.2.19.0820. Firmware
v1.3.1.1020 has been exercised in simulated protocol tests only.

## Install

1. Download `bookoo-motto80-0.1.0.zip` from the
   [release](https://github.com/Sabotage1/decaid-bookoo-motto80/releases/tag/v0.1.0).
2. Transfer the ZIP to the tablet. In Decaid, open **Plugins → cogwheel →
   Install plugin → ZIP file**, then load **BooKoo Motto 80 Grinder**.
3. Turn the grinder on and disconnect the BOOKOO app or another Bluetooth client.
4. Scan in Decaid, select **BOOKOO MT80 xxxxxxxx**, and connect it as a grinder.

## Test

| Check | Expected behavior | Result / notes |
| --- | --- | --- |
| Discovery | Correct grinder appears by name; check its suffix. | |
| Connection | Connects and shows current readings. | |
| Firmware | Settings page matches the device firmware. | |
| Burr gap | Matches the grinder; changes when its dial is adjusted by hand. | |
| RPM | Matches the device setting/readout. | |
| RPM change while idle | Apply a small change; device accepts and reports the new value. | |
| Feeder speed | An idle change is accepted and shown on the grinder. | |
| Other settings | Check cup detection, auto-stop, clearing, brightness and standby delay as needed. Restore your preferred values. | |
| Existing preset | A known preset can be selected; refresh to verify resulting settings. | |
| Physical start/stop | A grind started/stopped on the grinder changes Decaid's state. | |
| Busy settings | Settings changes are refused while grinding or clearing. | |
| Disconnect/reconnect | Fresh readings return after deliberate reconnect. | |
| Grinder power-cycle | Decaid can connect again when the grinder is on. | |
| Reload/restart | Plugin reload and Decaid restart recover with fresh readings. | |
| Browser foreground/background | Leaving and returning to the skin does not leave stale readings. | |
| Other devices, if used | Scale/refractometer remains independent. | |
| Skin/history, if used | Record whether read-only grinder observations appear. | |

Use the grinder's own controls to start/stop it and adjust the physical burr gap.
The plugin has no remote start/stop or physical gap adjustment command.

## Report

Post a result in [GitHub Issues](https://github.com/Sabotage1/decaid-bookoo-motto80/issues)
or the Decent community discussion. Include the setup above, the failing step,
expected/observed behavior and relevant plugin errors. A successful BLE write is
not proof of a physical setting change; compare the grinder display/readout.

Do not include serial numbers, Wi-Fi names, credentials or unrelated logs.

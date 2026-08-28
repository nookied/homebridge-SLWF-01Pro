# homebridge-SLWF-01Pro

[Homebridge](https://homebridge.io) plugin for the **[SLWF-01Pro Wi-Fi dongle](https://smartlight.me/smart-home-devices/wifi-devices/wifi-dongle-air-conditioners-midea-idea-electrolux-for-home-assistant)** flashed with ESPHome — exposes the AC it's plugged into as a HomeKit `HeaterCooler` accessory with full mode, fan-speed and swing control.

The SLWF-01Pro is a Wi-Fi dongle from **[SMLIGHT](https://smartlight.me)** (Ukraine) that drops into the proprietary serial Wi-Fi port on Midea-protocol air conditioners — replacing the OEM Tuya/SmartLife stick. Hardware revisions in the wild: **v1.1**, **v1.2** and **v2.1** — all ESP8266 (`esp12e`) boards; the UART pinout and the flashing method differ between them, not the chip. Once flashed with [ESPHome](https://esphome.io) (typically the [`midea_ac`](https://esphome.io/components/climate/midea.html) component) the dongle exposes the AC as a `Climate` entity over the ESPHome native API — this plugin bridges that entity into HomeKit.

This is a **maintained fork** of [`homebridge-esphome-ac`](https://github.com/nitaybz/homebridge-esphome-ac) by nitaybz, focused on the SLWF-01Pro use case: bug fixes, cleanup, and longer-term polish around multi-device reliability.

## Why this fork exists

The upstream plugin works for single-device setups but has a few sharp edges that bite multi-AC households (the typical SLWF-01Pro buyer often has multiple Midea/Electrolux units). The fork addresses correctness *and* expands HomeKit coverage:

- **HEAT_COOL devices got no AUTO button.** Many SLWF-01Pro / Midea ACs advertise mode `HEAT_COOL` (1) instead of `AUTO` (6). The original plugin only checked for mode 6 → HomeKit AUTO didn't appear. The fork picks whichever mode the device supports.
- **Wire-format payload was leaky.** The original sent the *entire* climate-state object with every command, including stale `target_temperature_low/high = 0`. On HEAT_COOL devices this overwrites the heat/cool band on every interaction. The fork builds a clean payload of only the fields you actually changed.
- **Multi-device command coalescing.** A module-level send timeout meant changing one AC could cancel a pending command on another. Each AC now owns its own debouncer.
- **Crash on disconnected device.** The upstream `device disconnected` error path referenced an undefined `log` symbol → `ReferenceError` instead of a clean HomeKit error. Fixed.
- **Auto-discovery via mDNS** — listed `_esphomelib._tcp` services are picked up automatically; you don't need to type six IP addresses for six ACs.
- **Multi-entity bundling** — humidity, outdoor temperature, power consumption, beeper, display toggle, DRY, and FAN_ONLY can be exposed when the device supports them; fresh installs hide the extras by default for a clean Apple Home pairing.

See [CHANGELOG.md](CHANGELOG.md) for the full restoration story.

## Supported devices

Anything that publishes a `Climate` entity over the ESPHome native API will work. The intended target is the SLWF-01Pro itself, but the plugin is hardware-agnostic — any ESPHome `climate:` component (e.g. an ESP32 with [`midea_ac`](https://esphome.io/components/climate/midea.html) directly soldered) will be picked up.

| AC brand families known to work with SLWF-01Pro | Notes |
|---|---|
| **Midea**, Idea, Electrolux, Bosch, Beko, Neoclima | Manufacturer's primary tested set; all Midea-protocol mini-splits |
| Senville (Leto), Yitahome, Mr. Cool, AUX | Other Midea-platform rebadges |
| Alpine, Pioneer, Samsung, Toshiba, Zanussi | ~30 brands total — see [smartlight.me](https://smartlight.me/smart-home-devices/wifi-devices/wifi-dongle-air-conditioners-midea-idea-electrolux-for-home-assistant) for the full list |
| Newer 2024+ AC firmwares with proprietary protocols | May not work — check the manufacturer's compatibility notes before buying |

DRY and FAN_ONLY ESPHome modes can be surfaced as **companion `Switch` services** ("AC Dry", "AC Fan Only") next to the main `HeaterCooler` tile. Set `disableDryMode: false` / `disableFanOnlyMode: false` to opt in. Toggling one ON puts the AC into that mode; toggling OFF restores the previous primary mode (HEAT/COOL/AUTO).

ESPHome's **custom fan modes** (`silent`, `turbo` on Midea) and **presets** (`eco`, `boost`, `sleep`, `away`) are not yet surfaced — the plugin only handles the standard fan-modes list. See [ROADMAP.md](ROADMAP.md).

## Install

```bash
sudo npm install -g homebridge-slwf-01pro
```

Or from the Homebridge UI: search for **homebridge-slwf-01pro** in the plugin browser.

To install straight from git instead of npm (e.g. to pin a specific commit):

```bash
sudo npm install -g github:nookied/homebridge-SLWF-01Pro#<sha>
```

## Configuration

The simplest config — auto-discover everything on the local network:

```jsonc
{
  "platforms": [
    {
      "platform": "SLWFOnePro",
      "name": "SLWFOnePro",
      "autoDiscover": true
    }
  ]
}
```

Or fully manual (required for encrypted devices and any device not on the same broadcast domain):

```jsonc
{
  "platforms": [
    {
      "platform": "SLWFOnePro",
      "name": "SLWFOnePro",
      "debug": false,
      "devices": [
        {
          "name": "Living Room AC",
          "host": "192.168.1.120",
          "port": 6053,
          "encryptionKey": "",
          "disableHumiditySensor": true
        }
      ]
    }
  ]
}
```

You can mix both — listed devices in `devices[]` take precedence; auto-discovered devices are added on top. Since 0.5.7, previously registered auto-discovered devices are also retried from Homebridge's cached accessory data while `autoDiscover` stays enabled, so a missed mDNS scan does not leave an existing HomeKit tile without a reconnecting ESPHome client. First-time discovery still requires mDNS or a manual `devices[]` entry.

### Platform-level keys

| Key | Required | Default | Notes |
|---|---|---|---|
| `platform` | yes | — | Must be exactly `"SLWFOnePro"` (the platform identifier — distinct from upstream `homebridge-esphome-ac`'s `"ESPHomeAC"` to guarantee no namespace collision when both plugins are installed). Pre-0.2.0 configs using `"ESPHomeAC"` need a one-line edit. |
| `name` | no | `SLWFOnePro` | Display name in Homebridge logs |
| `debug` | no | `false` | Surface ESPHome state-change chatter to the main log instead of `log.debug` |
| `autoDiscover` | no | **`true`** | mDNS-browse for ESPHome devices on the local network and create accessories automatically. Encrypted devices still need a manual `devices[]` entry — the Noise key is not broadcast. Cached auto-discovered devices are retried on later starts while this stays enabled. ⚠️ Turning this off after it has run will *unregister* any device that wasn't also added to `devices[]` — copy your discovered devices into the list before disabling. |
| `discoveryTimeout` | no | `5` | Seconds to wait for mDNS responses before continuing. |
| `disableHumiditySensor` | no | **`true`** | Hide the HumiditySensor service for **every** device (e.g. ACs that report a fake `0 %` because no probe is fitted). |
| `disableOutdoorTempSensor` | no | **`true`** | Hide the outdoor TemperatureSensor service. |
| `disablePowerSensor` | no | **`true`** | Hide the linked Outlet service carrying Eve.Energy CurrentPowerConsumption. |
| `disablePresets` | no | **`true`** | Hide the per-preset switches (Eco / Boost / Sleep / any custom presets). |
| `disableBeeperSwitch` | no | **`true`** | Hide the Beeper Switch service. |
| `disableDisplaySwitch` | no | **`true`** | Hide the Display Toggle Switch service. |
| `disableDryMode` | no | **`true`** | Hide the DRY mode Switch service. |
| `disableFanOnlyMode` | no | **`true`** | Hide the FAN_ONLY mode Switch service. |
| `devices` | no | `[]` | Manual list of ESPHome devices. Required for encrypted devices; optional otherwise if `autoDiscover: true`. |

The companion services default to **hidden** so a fresh install gives you a clean Apple Home view: just the AC tile per device. Flip any `disable*` flag to `false` to opt back in.

### Per-device keys (under `devices[]`)

| Key | Required | Default | Notes |
|---|---|---|---|
| `name` | yes | — | Display name in HomeKit |
| `host` | yes | — | IP address or hostname of the SLWF-01Pro / ESPHome device |
| `port` | no | `6053` | ESPHome native API port |
| `encryptionKey` | no | `""` | Base64 ESPHome `api: encryption` key, if set in the device's YAML |
| `disableHumiditySensor` | no | inherit | Per-device override (either direction). Set `false` to enable for this device when the platform default is `true`, or `true` to hide for this device when the platform default is `false`. |
| `disableOutdoorTempSensor` | no | inherit | Per-device override |
| `disablePowerSensor` | no | inherit | Per-device override |
| `disablePresets` | no | inherit | Per-device override |
| `disableBeeperSwitch` | no | inherit | Per-device override |
| `disableDisplaySwitch` | no | inherit | Per-device override |
| `disableDryMode` | no | inherit | Per-device override |
| `disableFanOnlyMode` | no | inherit | Per-device override |

Per-device disable flags **override the platform-wide flag in either direction**. If a per-device flag is set explicitly (to `true` or `false`), it wins; otherwise the device inherits the platform default. So you can keep the global "hide all extras" defaults and still enable specific services for a single AC.

The plugin auto-discovers the climate entity's capabilities (supported modes, fan modes, swing modes, visual min/max temperatures, target step) directly from ESPHome — no model-specific config required.

`config.schema.json` provides a form-based editor in the Homebridge UI.

## Recommended: enable Child Bridge

If you have **two or more** SLWF-01Pro dongles, run this plugin in a Homebridge **Child Bridge**. ESPHome devices on Wi-Fi can blip out for a few seconds during router restarts; isolating the plugin means a hung reconnect can't block your other accessories.

In the Homebridge UI: **Plugins** tab → click the gear icon on the plugin → **Bridge Settings** → enable **Child Bridge**. Restart when prompted.

## What ends up in HomeKit

Per ESPHome device, all of these services land on a single HomeKit accessory if the device exposes the matching entity (and the corresponding `disable*` flag is `false`):

| HomeKit service | Source ESPHome entity | Disable flag |
|---|---|---|
| `Service.HeaterCooler` (mandatory) | `Climate` entity | — |
| `Service.HumiditySensor` | Sensor matching `*humidity*` | `disableHumiditySensor` |
| `Service.TemperatureSensor` (outdoor) | Sensor matching `*outdoor*temp*` | `disableOutdoorTempSensor` |
| `Service.Outlet` "Power" with Eve.Energy `CurrentPowerConsumption` (W) | Sensor matching `*power*` | `disablePowerSensor` |
| `Service.Switch` "Beeper" | Switch matching `*beeper*` | `disableBeeperSwitch` |
| `Service.Switch` "Display" | Button matching `*display*` (auto-resets after press) | `disableDisplaySwitch` |
| `Service.Switch` "Dry" | Climate device's `DRY` mode | `disableDryMode` |
| `Service.Switch` "Fan Only" | Climate device's `FAN_ONLY` mode | `disableFanOnlyMode` |
| `Service.Switch` per preset (e.g. "Eco", "Boost", "Sleep", "Freeze Protection") | `supportedPresetsList` + `supportedCustomPresetsList` | `disablePresets` |

Entities the plugin deliberately ignores: Wi-Fi RSSI, Uptime, Factory Reset, and anything ESPHome marks as a config or diagnostic entity — a Factory Reset tile one tap away from your AC controls is not worth the convenience.

**Eve history is optional and not installed by default.** Live wattage works out of the box. The historical graph in Eve.app needs [`fakegato-history`](https://github.com/simont77/fakegato-history), which is declared as an *optional peer dependency* because it hard-depends on `googleapis` (~194 MB) for a storage backend this plugin never uses. To enable history, install it alongside the plugin and restart Homebridge:

```bash
npm install -g fakegato-history
```

The plugin logs a one-time notice if power monitoring is enabled without it.

Power monitoring is intentionally isolated in a linked, hidden Outlet service rather than attached directly to the HeaterCooler service. The Outlet doesn't render as a separate tile in Apple Home (it's marked hidden, so Home skips it), but Eve.app and other HAP-direct clients still see the service in the database and can read `CurrentPowerConsumption`. This keeps the primary AC tile limited to standard HeaterCooler characteristics, which is friendlier to Apple Home during bridge pairing.

ESPHome connection loss is handled at command time: while the native API client is disconnected, HomeKit writes fail with a standard communication error and normal control resumes on reconnect. The plugin deliberately does not expose the optional HAP `StatusFault` transport-health characteristic because Apple Home can cache that value aggressively and keep showing a stale warning after the device is healthy again.

## Presets

If your AC advertises presets, each one becomes its own switch — `Eco`, `Boost`, `Sleep`, and any **custom** presets the firmware defines (Midea units often ship a `Freeze Protection`). They are mutually exclusive: switching one on turns the others off, and switching one off returns the AC to no preset.

Hidden by default. Enable with `"disablePresets": false`, globally or per device.

> **Check yours actually work.** Some firmware lists presets it does not implement. A real SLWF-01Pro on ESPHome 2024.4.2 advertises `Boost`, `Eco`, `Sleep` and `Freeze Protection`, accepts the command without complaint, and then stays on no preset at all. When that happens the switch snaps back off — which is honest, but looks like a bug — so the plugin logs a one-time warning naming the preset and your ESPHome version. Updating the dongle firmware is the usual fix; `"disablePresets": true` hides them if your device is one of the ones that won't.

## Behaviour

### Modes

The HomeKit `HeaterCooler` accessory uses three modes; this plugin maps them as follows:

| HomeKit | ESPHome `ClimateMode` | What happens |
|---|---|---|
| **Off** (Active=0) | `OFF` (0) | AC turns off; HomeKit remembers the previous mode for the next "On" tap |
| **Heat** | `HEAT` (3) | AC switches to heating mode |
| **Cool** | `COOL` (2) | AC switches to cooling mode |
| **Auto** | `AUTO` (6) | AC switches to auto / heat-cool mode |

The mode-list shown to HomeKit is filtered to the modes ESPHome actually advertises (`supportedModesList`), so a cooling-only AC won't show a Heat button.

### Temperature

HomeKit sends one of two temperature characteristics depending on mode: `CoolingThresholdTemperature` (in Cool / Auto) or `HeatingThresholdTemperature` (in Heat / Auto). Both currently set the same single `target_temperature` ESPHome field — the plugin doesn't yet use the device's two-point `target_temperature_low`/`target_temperature_high` even when supported. See [ROADMAP.md](ROADMAP.md).

Slider drags are debounced — the plugin sends one ESPHome command 600 ms after you stop, not one per tick.

### Fan speed

HomeKit's `RotationSpeed` is a 0-100 % slider; ESPHome exposes a discrete list of fan modes, plus an optional list of **custom** fan modes in a separate field — Midea units typically advertise `silent` and `turbo` there.

Both kinds share one ladder, slowest at 0 % and fastest at 100 %, and the slider's step is the coarsest value that lands exactly on every rung. A device reporting `[AUTO, LOW, MEDIUM, HIGH]` plus `silent`/`turbo` gets six rungs:

| % | Fan mode |
|---|---|
| 0 | AUTO |
| 20 | silent |
| 40 | LOW |
| 60 | MEDIUM |
| 80 | HIGH |
| 100 | turbo |

**0 % selects AUTO**, not "off" — HomeKit has no separate anchor for it. Custom modes are placed by name: `silent`/`quiet`/`mute`/`night` sit below the standard speeds, `turbo`/`boost`/`powerful`/`strong`/`jet`/`max` above them. ESPHome provides no ordering information, so a custom mode whose name isn't recognised is appended after the known rungs — still selectable, but never claiming a speed it might not have.

If the AC is put into a mode the plugin can't place (an unrecognised custom mode set from the remote), the slider keeps its last value rather than reporting a misleading number.

As with presets, older firmware may accept a custom fan mode and report something else back — ESPHome 2024.4.2 on the SLWF-01Pro answers `silent` with plain `LOW`. The slider then settles on what the device actually reports.

### Swing

If the device advertises any swing mode beyond OFF, a HomeKit Swing toggle is exposed. The plugin chooses the most useful swing direction at startup (BOTH > VERTICAL > HORIZONTAL) and the toggle flips between that direction and OFF.

## Migration

### From upstream `homebridge-esphome-ac`

Both the npm package name AND the Homebridge platform identifier are different from upstream — that's deliberate, and it means the two plugins never share cache or namespace. Migration is two short steps:

1. **Replace the package**:
   ```bash
   sudo npm uninstall -g homebridge-esphome-ac
   sudo npm install -g homebridge-slwf-01pro
   ```

2. **Edit `config.json`** — change `"platform": "ESPHomeAC"` to `"platform": "SLWFOnePro"`:
   ```jsonc
   {
     "platforms": [
       {
         "platform": "SLWFOnePro",   // ← was "ESPHomeAC"
         "name": "SLWFOnePro",       // ← rename to match (or keep your custom name)
         "autoDiscover": true,
         "devices": [ /* ...same as before... */ ]
       }
     ]
   }
   ```

3. **Restart Homebridge**: `sudo systemctl restart homebridge` (or via UI).

The plugin will detect any cached accessories left over from upstream and **log a warning** with cleanup instructions on startup. Clean them via Homebridge UI → Settings → Remove Single Cached Accessory, or stop the (child) bridge and delete the relevant `cachedAccessories.<bridgeId>` file. The new accessories from this plugin will re-pair automatically on the next restart with stable UUIDs derived from each device's ESPHome `unique_id` (or from the MAC + `object_id` when `unique_id` isn't set).

### From a pre-0.2.0 release of this plugin

If you upgraded from `homebridge-slwf-01pro@0.1.x`, the platform identifier rename is the only change you need to apply (step 2 above). The plugin will detect old `"ESPHomeAC"` cached entries and log a warning the same way.

## Known SLWF-01Pro quirks

These are device-side issues, not plugin bugs — listed here so you know what to expect:

- **Intake-mounted temperature sensor reads warm/cold air, not room temp.** HomeKit will show a value that's a few degrees off the actual room. Mitigation: ESPHome's [`midea_ac.follow_me`](https://esphome.io/components/climate/midea.html) action pushes an external Home Assistant sensor reading into the AC, but it's a Home-Assistant-only feature and (on some Senville/Midea units) requires a small hardware mod soldering IO13 to the display board's "Rec 1 OUT" pin.
- **Pinout differs between v1.1, v1.2 and v2.1** of the dongle. Wrong YAML for your hardware revision means no UART communication — the dongle will join Wi-Fi and appear in Homebridge, but the AC won't respond. See [Dongle firmware](#dongle-firmware) below.
- **Outdoor temperature and humidity setpoint** are model-specific (e.g. Midea Mission II doesn't expose them); expect them to be missing on most installs.
- **Newer Midea firmwares** with proprietary key exchange may refuse to talk to the dongle. SMLIGHT's compatibility list is the source of truth.

## Dongle firmware

**This plugin does not flash firmware, and deliberately so.** Picking the wrong build for your hardware revision leaves the dongle on Wi-Fi but unable to talk to the AC, and recovering from that can mean opening the unit up. Flashing is also nothing to do with bridging an existing device into HomeKit — the ESPHome native API this plugin speaks has no firmware-upload mechanism at all. Use SMLIGHT's own tools:

- **[SMLIGHT's web flasher](https://smlight.tech/flasher/#slwf01proV2)** — hold the button on the dongle, connect over USB Type-C, pick your revision. v2.1 has the Type-C port; v1.1/v1.2 are flashed over their serial header.
- **[The official ESPHome configs](https://github.com/smlight-tech/slwf-01pro-esphome)** — `slwf01pro_v1.1.yaml` covers v1.1 and v1.2, `slwf01pro_v2.1.yaml` covers v2.1. Compile and flash with ESPHome if you want to customise entity names or add the IR "Follow me" action.
- **[SMLIGHT's update manual](https://smlight.tech/support/manuals/books/slwf-01pro/page/device-update)**.

Current SMLIGHT firmware (project version **2.4**) adds ESPHome's `update: http_request` component, which checks SMLIGHT's manifest every six hours and can update **itself** over the air. If your dongles are on that firmware they keep themselves current with no help from this plugin — which is the other reason the plugin has no business doing it.

Two things worth knowing:

- **Check what you're running.** The plugin reports the dongle's ESPHome version as the accessory's **Firmware Revision** in the Home app (Settings → the accessory → scroll down). The dongle's own web page at `http://<device-ip>/` shows its project version.
- **Updating is usually optional.** The plugin talks to any ESPHome version that exposes a `Climate` entity; there's no minimum. Newer firmware mainly buys you self-updating and any fixes SMLIGHT has made to the Midea protocol handling. If your AC responds correctly today, there is no plugin-side reason to reflash.

If a device is running firmware that exposes an ESPHome `Update` entity, the plugin ignores it rather than surfacing it in HomeKit — a tap-to-flash tile sitting next to your AC controls is not a good idea.

## Troubleshooting

### Apple Home "Connecting..." spinner hangs / "Out of compliance" / accessories invisible after pairing

The 0.4.x intermittent pairing issue was addressed across 0.4.4 → 0.5.1 (Eve power off the standard `HeaterCooler` service, companion services hidden by default, schema-version eviction forcing a clean accessory recreation, ConfiguredName not clobbered on restart). 0.5.7 removes the optional HAP transport fault characteristics that newer Apple Home versions could cache as stale warnings. Fresh installs from 0.5.0+ already get the bare-bones config below as the default. The current diagnostic flow lives in [QA_TESTS.md §7](QA_TESTS.md); the workaround config below is still the right starting point if you hit a similar symptom.

**First-line workaround**: pair with all optional services disabled (this is now the default since 0.5.0):

```jsonc
{
  "platforms": [
    {
      "platform": "SLWFOnePro",
      "name": "SLWF-01Pro",
      "autoDiscover": true,
      "disableHumiditySensor": true,
      "disableOutdoorTempSensor": true,
      "disablePowerSensor": true,
      "disableBeeperSwitch": true,
      "disableDisplaySwitch": true,
      "disableDryMode": true,
      "disableFanOnlyMode": true
    }
  ]
}
```

This reduces each AC to `AccessoryInformation + HeaterCooler` only (heat/cool/fan/swing on the main AC tile). Pair the bridge first; once the bridge is paired in Apple Home, re-enable the optional services one at a time (set the relevant `disable*` flag to `false` either globally or per-device), restarting between each.

If pairing still hangs even with this minimal config, the issue is at a different layer — see the **Pairing diagnostic flow** in [QA_TESTS.md §7](QA_TESTS.md). Most likely:
- Bridge HAP pairing state is stale → reset by deleting `AccessoryInfo.<bridgeId>.json` and `IdentifierCache.<bridgeId>.json` under your Homebridge `persist/` directory, then restart.
- iCloud HomeKit data is corrupt → on iPhone: Settings → Home → toggle iCloud HomeKit off/on, restart device.
- Bridge port not reachable from iPhone → check firewall (`ufw status`, macOS Application Firewall, Docker port mapping).

### Plugin starts but the AC tile in HomeKit is "Not Responding"
Check that the SLWF-01Pro is reachable from the Homebridge host (`ping <host>` and `nc -vz <host> 6053`). The plugin connects on `didFinishLaunching` and reconnects every 5 s if the device drops; if you see no `<name> client connected` line followed by `Initialized "<name>" with N mapped entit(y|ies)` in the log within a minute, ESPHome isn't accepting the connection. Common causes: wrong `encryptionKey`, firewall, ESPHome `api:` block missing.

### "ESPHome device" appears but no temperature shown
ESPHome may not have published the initial `state` event yet. Wait 30 s; if still empty, restart the SLWF-01Pro.

### Multi-AC: changing one AC's setting cancels another's
This was a real bug in upstream `homebridge-esphome-ac@0.0.4` (module-level send timeout, shared across all devices). Fixed in this fork's first release.

### My AC has no humidity probe but HomeKit shows 0 %
Set `disableHumiditySensor: true` (either platform-wide or just under that device's `devices[]` entry). The HumiditySensor service will be removed on the next restart.

### Auto-discovery doesn't see one of my ACs
Likely causes: (1) the device has `api: encryption: key:` set in its ESPHome YAML, in which case mDNS doesn't broadcast the Noise key — add it manually to `devices[]`. (2) The device is on a different VLAN/subnet that blocks mDNS. (3) ESPHome's `mdns:` block is disabled. If the device was already registered while `autoDiscover` remains enabled, 0.5.7+ will retry the cached host on later starts; first-time discovery still needs working mDNS or a manual `devices[]` entry. Quickest fix: list it manually in `devices[]`.

### HomeKit AUTO button missing on a device that supports auto mode
Your device probably advertises `HEAT_COOL` (mode 1) instead of `AUTO` (mode 6). Both are now handled equivalently as of this fork's first release; if you're on upstream `homebridge-esphome-ac@0.0.4`, this was the bug.

### Debug logs
Set `"debug": true` in the platform config — every state change and outgoing command will surface in the main log.

## Development

```bash
git clone https://github.com/nookied/homebridge-SLWF-01Pro.git
cd homebridge-SLWF-01Pro
npm install
npm run lint                                  # ESLint
npm test                                      # Jest unit tests
node -e "require('./index.js')"               # smoke test (loads cleanly)
```

See [DOCS.md](DOCS.md) for the documentation map, [QA_TESTS.md](QA_TESTS.md) for the manual pre-release checklist, and [ROADMAP.md](ROADMAP.md) for what's planned next.

## Releasing

After the pre-release checklist in [QA_TESTS.md](QA_TESTS.md) passes:

```bash
npm run lint
npm test
node -e "require('./index.js')"                 # smoke test
npm pack --dry-run                              # sanity-check tarball contents
npm version patch                               # or: npm version minor / npm version 1.0.1
git push --follow-tags                          # release.yml publishes npm + GitHub Release
```

`package.json` has a `files` array, so `npm publish` ships only `index.js`, `lib/`, `config.schema.json`, `config-sample.json`, `LICENSE`, `README.md`, `CHANGELOG.md`. Internal docs (`DOCS.md`, `CLAUDE.md`, `ROADMAP.md`, `QA_TESTS.md`, `test/`) stay out of the published tarball. The tag-driven GitHub Actions release workflow publishes to npm — authenticated by GitHub OIDC [trusted publishing](https://docs.npmjs.com/trusted-publishers), so no npm token is stored anywhere and the provenance attestation is generated automatically — and creates the GitHub Release from the matching `CHANGELOG.md` section.

## License

[MIT](LICENSE). Copyright 2020 Nitay Ben Zvi (original) + 2026 Karol Nowacki (this fork). The MIT license is preserved from the original.

## Credits

- **[nitaybz](https://github.com/nitaybz)** — original `homebridge-esphome-ac` plugin (2020), the basis for this fork.
- **[smartlight.me](https://smartlight.me)** — designs and ships the SLWF-01Pro hardware + ESPHome firmware.
- **[ESPHome](https://esphome.io)** — the firmware and native-API protocol the plugin speaks.
- **[@2colors/esphome-native-api](https://github.com/2colors/esphome-native-api)** — Node.js client for the ESPHome native API.

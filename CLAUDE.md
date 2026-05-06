# CLAUDE.md — homebridge-SLWF-01Pro

This file is the canonical persistent memory for this project. Any assistant/agent should update this file only; `AGENTS.md` is intentionally just a pointer here to avoid maintaining duplicate project memory.

---

## Project Overview

**npm name:** `homebridge-esphome-ac` *(inherited from upstream; will be renamed to `homebridge-slwf-01pro` once the rewrite stabilises — see ROADMAP M2)*
**Type:** Homebridge plugin (Node.js, CommonJS)
**Purpose:** Expose ESPHome climate entities — primarily the **[SMLIGHT SLWF-01Pro](https://smartlight.me/smart-home-devices/wifi-devices/wifi-dongle-air-conditioners-midea-idea-electrolux-for-home-assistant)** Wi-Fi dongle flashed with ESPHome — as HomeKit `HeaterCooler` accessories. Hardware-agnostic: any ESPHome `climate:` component (e.g. ESP32 with [`midea_ac`](https://esphome.io/components/climate/midea.html) directly soldered) is also picked up.
**Repo:** [`https://github.com/nookied/homebridge-SLWF-01Pro`](https://github.com/nookied/homebridge-SLWF-01Pro) — **maintained fork**
**Original (upstream):** [`nitaybz/homebridge-esphome-ac`](https://github.com/nitaybz/homebridge-esphome-ac) — last release 0.0.4, low maintenance velocity. Kept as a git remote (`upstream`) for occasional cherry-picks.
**License:** MIT (preserved from original)
**Current version:** **0.0.4** (inherited; first fork release will bump to **0.1.0**, see ROADMAP)
**Engines:** Homebridge `^1.8.0 || ^2.0.0`; Node `^18.20.4 || ^20.15.1 || ^22.0.0 || ^24.0.0`

### What "SLWF-01Pro" is

The **SLWF-01Pro** is a small Wi-Fi control module from **SMLIGHT** (smartlight.me, Ukraine) that plugs into the proprietary serial Wi-Fi port found inside Midea-protocol mini-split air conditioners. It replaces the OEM Tuya/SmartLife stick; once flashed with ESPHome (typically the [`midea_ac`](https://esphome.io/components/climate/midea.html) component) the AC becomes a local-network climate entity instead of a Tuya-cloud-only device.

Hardware revisions in the wild:
- **v1.1** — ESP8266, original pinout
- **v1.2** — ESP8266, TX/RX swapped vs v1.1
- **v2.1** — ESP32, different again

Wrong YAML for the hardware revision = no UART communication; this is a common support question on the SMLIGHT forum but not the plugin's problem to solve.

Compatible AC brands (per SMLIGHT): Midea, Idea, Electrolux, Beko, Neoclima, Bosch, Senville (Leto), Yitahome, Mr. Cool, AUX, Alpine, Pioneer, Samsung, Toshiba, Zanussi, and ~15 others — all Midea-platform mini-splits. Newer 2024+ Midea firmwares with proprietary key exchange may refuse the dongle.

### Fork rules

- This is a **maintained fork**. The upstream (`nitaybz/homebridge-esphome-ac`) is still on npm at 0.0.4; we have not yet republished under a fork-specific npm name (deferred until the rewrite stabilises).
- The HomeKit *platform identifier* in users' `config.json` stays `"platform": "ESPHomeAC"` for migration compatibility — even after the npm rename.
- The `upstream` git remote IS configured (`https://github.com/nitaybz/homebridge-esphome-ac.git`) — fine to fetch/cherry-pick from, but **do not push** to it; we are not contributing back.
- `package.json` `repository.url` MUST exactly match the GitHub repo URL (`https://github.com/nookied/homebridge-SLWF-01Pro.git`). npm sigstore provenance is strict — a mismatch causes `npm publish` to fail with HTTP 422 (warmup4ie hit this once).

### What it does

The plugin opens an ESPHome native-API connection (TCP, default port 6053) to each configured device, listens for `Climate` entity announcements, and creates a HomeKit `Service.HeaterCooler` per entity. State changes from the device push into HomeKit; HomeKit `.onSet` writes are coalesced and forwarded to ESPHome via `climateCommandService`. Transport is the [`@2colors/esphome-native-api`](https://github.com/2colors/esphome-native-api) Node client — protobuf over TCP with optional [Noise](https://noiseprotocol.org/) encryption when `encryptionKey` is set.

## Architecture

```
homebridge-SLWF-01Pro/
├── index.js                              Homebridge entry; registerPlatform(.., true) — dynamic
│   ├── module.exports(api)                  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ESPHomeAC, true)
│   └── ESPHomeAC                            Dynamic platform class
│       ├── constructor(log, config, api)        Reads config (devices[], debug, autoDiscover, disable* flags);
│       │                                          sets up log.easyDebug; on 'didFinishLaunching' → ESPHome.init()
│       └── configureAccessory(accessory)        Stash cached PlatformAccessory in this.accessories[]
│
├── lib/
│   ├── esphome.js                        Async orchestrator: manual + discovered devices → Client per device → DeviceAccessory
│   │   ├── init()                              Build device list (manual + autoDiscover), spawn one Client per device,
│   │   │                                          prune orphaned cached accessories
│   │   ├── spawnClient(platform, device)       Per-device: connect, attach connected/disconnected/error/initialized,
│   │   │                                          call setConnectedStatus on the bound DeviceAccessory
│   │   └── pruneOrphanedAccessories(...)       Unregister cached accessories whose host isn't in the live list
│   │
│   ├── discovery.js                      mDNS browse helper
│   │   ├── discoverDevices({timeout, log})     Promise<DiscoveredDevice[]>; calls @2colors Discovery proxy
│   │   ├── prettyNameFromHostname(hostname)    'air-conditioner-fae810' → 'Air Conditioner Fae810'
│   │   └── dedupeDevices(list)                 Deduped by host (case-insensitive), falls back to address
│   │
│   ├── classifyEntity.js                 Pure entity → HomeKit-service-slot classifier
│   │   ├── classifyEntity(entity)              ESPHome entity → 'climate' | 'humiditySensor' | 'outdoorTempSensor'
│   │   │                                          | 'powerSensor' | 'beeperSwitch' | 'displayButton' | null
│   │   └── bundleEntities(entities[])          Returns {climate?, humiditySensor?, ...} (first match wins)
│   │
│   ├── DeviceAccessory.js                Multi-service HomeKit accessory builder (per ESPHome device)
│   │   ├── constructor({device, deviceInfo, entities, platform})
│   │   ├── setupAccessoryInformation()         Manufacturer/Model/SerialNumber/FirmwareRevision
│   │   ├── addClimateService()                 Service.HeaterCooler with all primary mode characteristics
│   │   ├── addOptionalSensorServices()         HumiditySensor / TemperatureSensor (outdoor) / Eve.Energy power
│   │   ├── addOptionalSwitchServices()         Service.Switch for Beeper + Display Toggle
│   │   ├── addModeSwitchServices()             Service.Switch for DRY + FAN_ONLY (mutually exclusive with primary mode)
│   │   ├── removeDisabledServices()            Honour disable* flags AND missing entities (cached cleanup)
│   │   ├── attachOptionalEntityListeners()     Bind ESPHome 'state' events for sensors / switches / power
│   │   ├── attachPowerCharacteristic()         Eve.Energy CurrentPowerConsumption + optional fakegato-history
│   │   ├── handleModeSwitch(targetMode, on)    DRY/FAN_ONLY toggle handler — sets/restores mode via stateManager.sendState
│   │   ├── syncModeSwitches(currentMode)       Reflect device's actual mode back into the supplementary switches
│   │   ├── setConnectedStatus(connected)       Push StatusActive + StatusFault to climate service
│   │   ├── clampTargetTemperature(value)       Non-mutating clamp to [visualMin, visualMax]
│   │   └── updateClimateState(state)           ESPHome 'state' event → all HAP characteristics
│   │
│   ├── stateManager.js                   HomeKit .onSet handlers (per-instance debouncer)
│   │   ├── sendState(that)                     Per-device debounced send (600 ms) via that.esphome.connection.climateCommandService
│   │   ├── set.Active                          ON/OFF; restores previous mode from accessory.context.lastTargetState
│   │   ├── set.TargetHeaterCoolerState         AUTO/HEAT/COOL → ESPHome mode (uses pickAutoMode for HEAT_COOL vs AUTO)
│   │   ├── set.CoolingThresholdTemperature     Sets state.targetTemperature (single-point), debounced
│   │   ├── set.HeatingThresholdTemperature     Sets state.targetTemperature (single-point), debounced
│   │   ├── set.SwingMode                       Toggles between OFF and pickDefaultSwingValue(list)
│   │   └── set.RotationSpeed                   0–100% → fanSpeedToFanMode → ESPHome fan mode
│   │
│   ├── state.js                          Pure mode-mapping helpers (no HAP types — fully unit-tested)
│   │   ├── ESP_MODE / HK_TARGET / HK_CURRENT   Frozen enum constants
│   │   ├── deriveCurrentHeaterCoolerState(state)  → INACTIVE/IDLE/HEATING/COOLING
│   │   ├── espModeToHkTargetState(espMode)         AUTO+HEAT_COOL → AUTO; COOL → COOL; HEAT → HEAT
│   │   ├── hkTargetStateToEspMode(hkTarget)        Inverse of above
│   │   ├── pickAutoMode(list)                      AUTO if available, else HEAT_COOL, else null
│   │   ├── supportsCool(list) / supportsHeat(list) Treats HEAT_COOL & AUTO as supporting both
│   │   ├── pickDefaultSwingValue(list)             BOTH > VERTICAL > HORIZONTAL
│   │   ├── fanSpeedToFanMode(speed, list)          0–100% → discrete fan-modes index
│   │   ├── fanModeToSpeed(fanMode, list)           Discrete fan mode → 0–100%
│   │   └── chooseInitialTargetMode(stateMode)      Initial cached state for new accessories
│   │
│   └── eve.js                            Eve.app custom characteristic factory
│       ├── makeEveClasses(api)                 Returns { CurrentPowerConsumption, TotalConsumption } classes,
│       │                                          with Formats/Perms fallback for HAP-NodeJS 2.x
│       ├── EVE_POWER_UUID                      'E863F10D-...'
│       └── EVE_TOTAL_CONSUMPTION_UUID           'E863F10C-...'
│
├── test/
│   └── unit/
│       ├── state.test.js                 Truth tables for all mappers + capability checks (52 tests)
│       ├── classifyEntity.test.js        Entity classification + bundling (17 tests)
│       └── discovery.test.js             prettyNameFromHostname + dedupeDevices (9 tests)
│
├── package.json                          scripts: lint / lint:fix / test / test:all
├── config.schema.json                    Homebridge UI form-based config editor (autoDiscover + per-device disable flags)
├── config-sample.json                    Reference config with autoDiscover + one manual device with per-device override
├── README.md                             User docs
├── CHANGELOG.md                          Keep-a-Changelog format
├── ROADMAP.md                            Development plan
├── QA_TESTS.md                           Manual pre-release checklist
├── CLAUDE.md                             This file — project memory
├── AGENTS.md                             Pointer → CLAUDE.md
├── LICENSE                               MIT
└── .eslintrc.json                        ESLint legacy-config (eslint:recommended; tabs; jest env)
```

## How it runs

1. Homebridge calls `module.exports(api)` → `api.registerPlatform("homebridge-esphome-ac", "ESPHomeAC", ESPHomeAC, true)` (4th arg `true` = dynamic platform).
2. Homebridge instantiates `ESPHomeAC(log, config, api)`. The constructor reads config (`name`, `debug`, `devices[]`, `autoDiscover`, `discoveryTimeout`, all `disable*` flags), sets up `this.accessories = []` and `this.esphomeDevices = {}` (keyed by `device.host`), then registers `api.on('didFinishLaunching', ...)`.
3. For each accessory in Homebridge's on-disk cache, `configureAccessory(accessory)` is called synchronously — we stash it in `this.accessories[]`. Service handlers are NOT bound here.
4. After all `configureAccessory` calls, `didFinishLaunching` fires → `await esphome.init()`:
   - Build the **device list**: manual `this.devices[]` first, then if `autoDiscover` is true, call `discovery.discoverDevices({ timeout })` to mDNS-browse `_esphomelib._tcp` and append any discovered devices not already present (deduped by host, case-insensitive).
   - For each device, call `spawnClient(platform, device)`:
     - Construct `new Client({ host, port: device.port||6053, encryptionKey, clearSession:false, reconnectInterval:5000 })`.
     - Attach `'connected'` / `'disconnected'` / `'error'` / `'deviceInfo'` / `'initialized'` listeners (platform-scoped, attached once per Client).
     - `client.connect()` — non-blocking; the underlying TCP/Noise handshake runs async. The client lib auto-reconnects every 5 s on drop.
   - **`'initialized'` event** (fires after the lib finishes deviceInfo + listEntities + subscribeStates):
     - Read `client.entities` (a map of all discovered entities, populated by listEntities).
     - Pass the array to `bundleEntities()` → returns `{ climate?, humiditySensor?, outdoorTempSensor?, powerSensor?, beeperSwitch?, displayButton? }`.
     - If no climate entity, log + skip. Otherwise instantiate `new DeviceAccessory({ device, deviceInfo, entities: bundle, platform })` and store in `platform.esphomeDevices[device.host]`.
   - `pruneOrphanedAccessories(platform, liveHosts)` — unregister any cached accessory whose `context.host` is not in the live device list.
5. `DeviceAccessory` constructor:
   - Computes `UUID = api.hap.uuid.generate(entities.climate.config.uniqueId)` — keeps the same UUID derivation as v0.0.4 so existing cached accessories still match.
   - Looks up cached accessory by UUID; if found, reuse it (refresh `context.host`). If not, `new api.platformAccessory(name, uuid)` → `api.registerPlatformAccessories`.
   - Calls `setupAccessoryInformation()` → `addClimateService()` → `addOptionalSensorServices()` → `addOptionalSwitchServices()` → `addModeSwitchServices()` → `removeDisabledServices()` → `attachOptionalEntityListeners()`.
   - `removeDisabledServices` is idempotent — both "disabled by config flag" and "missing entity on device" trigger removal.
6. **Writes** (HomeKit → ESPHome):
   - HomeKit `.onSet(handler)` → `stateManager.set.<X>` mutates `that.state.<field>` and calls `sendState(that)`.
   - `sendState` debounces 600 ms per-device (`that._sendTimeout`), then calls `that.esphome.connection.climateCommandService(that.state)`.
   - Pending callers all resolve when the send completes; if `that.connected === false`, all reject with `HapStatusError(-70402)` (SERVICE_COMMUNICATION_FAILURE).
   - **Mode-switch handlers** (DRY/FAN_ONLY) call `stateManager.sendState(this)` directly after mutating `state.mode` (no debounce skip — each toggle queues its own send).
   - **Beeper switch** calls `entity.setState(true/false)` directly via the @2colors Switch entity API.
   - **Display button** calls `entity.push()` directly via the Button entity API; service auto-resets to off 250 ms later.
7. **State pushes** (ESPHome → HomeKit):
   - `entities.climate.on('state', updateClimateState)` — main path. Updates Active / CurrentTemperature / Target/CurrentHeaterCoolerState / SwingMode / RotationSpeed and `syncModeSwitches()` for DRY/FAN_ONLY tile state.
   - Each optional entity (`humiditySensor`, `outdoorTempSensor`, `powerSensor`, `beeperSwitch`) has its own `'state'` listener pushing to its respective characteristic.
   - On disconnect, `setConnectedStatus(false)` flips StatusFault to GENERAL_FAULT (red badge in HomeKit) and StatusActive to false. Reconnect → reverts.
8. **Cleanup at startup**: After spawning all clients, `pruneOrphanedAccessories` unregisters any cached accessory whose `context.host` is not in the current live host list.

## ESPHome Climate cheat sheet

The `@2colors/esphome-native-api` exposes ESPHome's protobuf API. Climate entities have `config` (capabilities) and `state` (current values).

| Field | Type | Notes |
|---|---|---|
| `config.uniqueId` | string | Stable per-entity id; we hash to HomeKit UUID |
| `config.supportedModesList` | int[] | Subset of `[0=OFF, 1=HEAT_COOL, 2=COOL, 3=HEAT, 4=FAN_ONLY, 5=DRY, 6=AUTO]` |
| `config.supportedFanModesList` | int[] | Subset of `[0=ON, 1=OFF, 2=AUTO, 3=LOW, 4=MEDIUM, 5=HIGH, 6=MIDDLE, 7=FOCUS, 8=DIFFUSE, 9=QUIET]` |
| `config.supportedSwingModesList` | int[] | Subset of `[0=OFF, 1=BOTH, 2=VERTICAL, 3=HORIZONTAL]` |
| `config.supportedCustomFanModesList` | string[] | E.g. Midea's `silent`/`turbo` — **not currently exposed** |
| `config.supportedPresetsList` | int[] | E.g. `eco/boost/sleep/away` — **not currently exposed** |
| `config.supportsTwoPointTargetTemperature` | bool | If true, device accepts `target_temperature_low/high` instead of `target_temperature` — **not currently used** |
| `config.visualMinTemperature` / `MaxTemperature` / `TargetTemperatureStep` | float | UI bounds; we forward to HomeKit setProps |
| `state.mode` | int | Current `ClimateMode` |
| `state.targetTemperature` | float | Single-point target |
| `state.currentTemperature` | float | Sensor reading (intake-mounted on SLWF-01Pro — drift expected) |
| `state.fanMode` | int | Current fan mode |
| `state.swingMode` | int | Current swing mode |

`setMode/setFanMode/setSwingMode` etc. on the entity object are typed wrappers; we use the lower-level `connection.climateCommandService(state)` to send all fields atomically (matters when changing multiple characteristics in the same HomeKit batch).

## HomeKit mapping

| HomeKit characteristic | Source | Notes |
|---|---|---|
| `Active` | `state.mode !== 0` | 0 (OFF) → Inactive, anything else → Active |
| `CurrentHeaterCoolerState` | `deriveCurrentHeaterCoolerState(state)` | OFF → INACTIVE, COOL → COOLING, HEAT → HEATING, AUTO/HEAT_COOL → derived from current vs target temp delta, fallback IDLE |
| `TargetHeaterCoolerState` | `espModeToHkTargetState(state.mode)` | COOL → COOL, HEAT → HEAT, AUTO/HEAT_COOL → AUTO. validValues filtered by `supportedModesList`. |
| `CurrentTemperature` | `state.currentTemperature` | Range -100 to 100, step 0.1 (defensive) |
| `HeatingThresholdTemperature` | `clampTargetTemperature(state.targetTemperature)` | Bounds from `visualMinTemperature`/`visualMaxTemperature`. Only added if HEAT or AUTO supported. |
| `CoolingThresholdTemperature` | same | Only added if COOL or AUTO supported. |
| `SwingMode` | `state.swingMode ? 1 : 0` | Only added if `supportedSwingModesList.length > 1`. Picks first available direction (BOTH > VERT > HORIZ). |
| `RotationSpeed` | `fanModeToSpeed(state.fanMode, list)` | Only added if more than one fan mode supported. 0–100% split evenly across the modes list. |

### Mode write semantics (`stateManager.set.TargetHeaterCoolerState`)

| HomeKit value | ESPHome action |
|---|---|
| `0` (Auto) | `state.mode = 6` (AUTO); cache as `lastTargetState` |
| `1` (Heat) | `state.mode = 3` (HEAT); cache as `lastTargetState` |
| `2` (Cool) | `state.mode = 2` (COOL); cache as `lastTargetState` |

`Active` toggles between `OFF (0)` and `accessory.context.lastTargetState` (which defaults to COOL for a fresh accessory). All writes are debounced 600 ms via `sendState`; `Active` and temperature setters additionally have a small 50–100 ms `setTimeout` to give HomeKit's batched .set calls time to land before evaluation.

## Configuration

```jsonc
{
  "platforms": [{
    "platform": "ESPHomeAC",            // identifier — never change for migration compat
    "name": "ESPHomeAC",                // optional log prefix
    "debug": false,                     // optional; route easyDebug to log() instead of log.debug()
    "autoDiscover": false,              // optional; mDNS-browse for ESPHome devices on the local network
    "discoveryTimeout": 5,              // optional; seconds to wait for mDNS responses (default 5)

    // Optional global service toggles — apply to every device that doesn't override
    "disableHumiditySensor": false,
    "disableOutdoorTempSensor": false,
    "disablePowerSensor": false,
    "disableBeeperSwitch": false,
    "disableDisplaySwitch": false,
    "disableDryMode": false,
    "disableFanOnlyMode": false,

    "devices": [
      {
        "name": "Living Room AC",
        "host": "192.168.1.120",
        "port": 6053,                   // optional; default 6053
        "encryptionKey": "",            // optional; ESPHome `api: encryption` Noise key
        "disableHumiditySensor": true   // optional per-device override (e.g. AC has no humidity probe)
      }
    ]
  }]
}
```

Per-device disable flags override the platform-wide flag — each is checked via `device[key] || platform[key]`. The platform-wide flag turns the service off for every device; the per-device flag turns it off for just that one. There's no way to enable a service that's globally disabled.

When `autoDiscover` is on, discovered devices that aren't in `devices[]` get a name derived from the mDNS hostname (e.g. `air-conditioner-fae810` → `Air Conditioner Fae810`); rename them in HomeKit if you want a friendlier label. Encrypted ESPHome devices (`api: encryption: key:`) need a manual `devices[]` entry — the Noise key isn't broadcast over mDNS.

`config.schema.json` provides the form-based UI. Each device's HomeKit accessory name comes from `devices[].name`; capabilities (modes, fan modes, swing, temperature step) are auto-discovered from ESPHome — no model-specific config required.

## Development workflow

```bash
npm install                  # install deps
npm run lint                 # ESLint
npm run lint:fix             # ESLint with --fix
npm test                     # Jest — unit tests in test/unit
node -e "require('./index.js')"  # smoke test (loads cleanly)
```

The unit-test suite covers `lib/state.js` (mode mappers + capability checks), `lib/classifyEntity.js` (entity classification + bundling), and `lib/discovery.js` (hostname formatting + dedupe). Add new unit tests under `test/unit/`.

## Versioning

Pre-1.0 tracking: PATCH bumps for fixes, MINOR (`0.X.0`) bumps for behaviour changes during the rewrite. Once stable enough to call 1.0.0, switch to strict [SemVer](https://semver.org/):

| Bump | When | Examples |
|------|------|---|
| **MAJOR** (`X.0.0`) | Breaking config / HomeKit shape change | Custom-fan-modes that change the RotationSpeed mapping |
| **MINOR** (`X.Y.0`) | New feature (new HomeKit service, presets, two-point temp) | Surfacing presets as Switch services |
| **PATCH** (`X.Y.Z`) | Bug fix, dep bump, doc-only change | (current bug-fix release) |

## Known issues / tech debt

### Open
1. **Custom fan modes (`silent`, `turbo`) and presets (`eco`, `boost`, `sleep`, `away`) are not exposed.** Midea-platform devices commonly advertise these via `supportedCustomFanModesList`/`supportedPresetsList`. Roadmap M3.
2. **Two-point target temperature is not used.** Even when `config.supportsTwoPointTargetTemperature === true`, the plugin sends only single `target_temperature`. AUTO mode in HomeKit uses both `HeatingThresholdTemperature` and `CoolingThresholdTemperature` — currently both write to the same single field. Roadmap M4.
3. **Intake-mounted sensor inaccuracy.** Device-side issue (the SLWF-01Pro reads cold-air-blast not room temp). Mitigated by ESPHome's `midea_ac.follow_me` action — Home-Assistant-only and needs a hardware mod. Out of scope for this plugin.
4. **Encrypted ESPHome devices skip auto-discovery.** mDNS doesn't broadcast the Noise encryption key, so encrypted devices need a manual `devices[]` entry. Documented in README.
5. **No CI yet.** GitHub Actions workflow for lint + tests + smoke is queued for M2.
6. **npm package not yet renamed.** Still uses upstream's `homebridge-esphome-ac` name. Renaming is gated on user testing in real households.
7. **Heuristic entity classification.** Beeper/humidity/etc. are matched by name pattern. If a user customizes their ESPHome YAML to use unusual entity names, the entity won't be classified. Could add explicit `entityMap` config option later.

### Resolved (in fork v0.1.0, unreleased)
- **Module-level `sendTimeout` shared across devices.** Multi-AC users could lose commands when changing one AC then another within 600 ms. Now a per-device `that._sendTimeout`.
- **Undefined `log` ReferenceError on disconnect.** `stateManager.js` referenced bare `log` in the device-disconnected error path; would crash the call instead of returning a clean HAP error. Fixed to `that.log.error` and rejection now uses `HapStatusError`.
- **Stacked `connected`/`disconnected` listeners.** Original code attached them inside the `entity.once('state')` callback — every Climate entity (and every reconnect) added another pair. Moved to platform scope, attached once per Client.
- **Lint errors in the original `HeaterCooler.js`.** Indentation mismatches at lines 86 and 123 (caught by `eslint:recommended` indent rule). Resolved by extracting mode logic to `lib/state.js`; the file itself was retired in favour of `lib/DeviceAccessory.js`.
- **`registerPlatform` missing dynamic flag.** `registerPlatform(name, alias, Class)` registered as a static platform; should be `registerPlatform(name, alias, Class, true)`. Cached accessories were being unregistered every restart.
- **`package.json` `repository.url` pointed to upstream.** Would break sigstore provenance on `npm publish`. Now points at the fork.
- **HeaterCooler.js mutated `state.targetTemperature` for clamping.** Plugin-side clamp leaked into the live state object; means the next outgoing command could carry the clamped value even if the device had a different target. Replaced with `clampTargetTemperature(value)` that returns a new value without mutating.

### By design (won't fix)
- **No upstream PR-back.** The fork is intentionally divergent and the upstream's release cadence (last release ~2 years ago) doesn't justify the round-trip.
- **AUTO fan mode == 0 % rotation speed.** HomeKit's `RotationSpeed` characteristic has no separate "auto" anchor, so the plugin maps 0 % to ESPHome's AUTO fan mode (when supported). Documented; users wanting a strict "off" semantics can hide the fan slider via `disableFanOnlyMode` and the dry/fan_only switches.

## Working rules (for this repo)

1. **Don't change the wire-format.** `@2colors/esphome-native-api` is a thin protobuf wrapper; we trust it to handle the protocol. Our job is mode mapping and HomeKit service composition.
2. **Prefer minimum-diff fixes.** This is a small plugin — most things are 1–2 file changes. Don't refactor end-to-end while fixing a one-line bug.
3. **Touch the README and this file together** when adding/changing config keys or behaviour.
4. **Walk `QA_TESTS.md` before tagging a release.** Jest covers the pure helpers; the manual checklist catches HomeKit + ESPHome wire-format drift.
5. **Keep mode logic in `lib/state.js` and entity classification in `lib/classifyEntity.js`.** Pure functions, no HAP types — these are where new unit tests should land.
6. **`package.json` `repository.url` must match the GitHub repo URL exactly.** Sigstore provenance is strict; this trips up forks.

## Quick reference

| Want to… | Look at |
|----------|---------|
| Add a new config option | `index.js` constructor + `config.schema.json` + README + this file |
| Tweak HomeKit characteristic mapping | `lib/DeviceAccessory.js` `addClimateService()` and `updateClimateState()` |
| Tweak ESPHome ↔ HomeKit mode mapping | `lib/state.js` (pure helpers) |
| Tweak debounce timings | `lib/DeviceAccessory.js` `SET_DEBOUNCE_MS` and `lib/stateManager.js` `ACTIVE_BATCH_MS` / `TEMP_BATCH_MS` |
| Tweak entity-to-service classification | `lib/classifyEntity.js` (pure helpers) |
| Tweak the wire payload sent to ESPHome | `lib/stateManager.js` `buildCommandPayload()` |
| Run locally with debug | Set `"debug": true` in platform config |
| See what's been released | `CHANGELOG.md` |
| See what's planned | `ROADMAP.md` |
| Pre-release manual QA | `QA_TESTS.md` |
| Reference the ESPHome native-API client | [`@2colors/esphome-native-api`](https://github.com/2colors/esphome-native-api) |
| Reference SLWF-01Pro hardware/firmware | [SMLIGHT product page](https://smartlight.me/smart-home-devices/wifi-devices/wifi-dongle-air-conditioners-midea-idea-electrolux-for-home-assistant) |
| Reference Homebridge plugin patterns | [developers.homebridge.io](https://developers.homebridge.io/) |
| Reference Verified-plugin requirements | [`homebridge/verified`](https://github.com/homebridge/verified) |

## File reference

| File | Purpose |
|------|---------|
| `index.js` | Homebridge platform entry — registers dynamic platform |
| `lib/esphome.js` | Async orchestrator: manual + discovered devices, Client lifecycle, prune logic |
| `lib/discovery.js` | mDNS browse helper for `_esphomelib._tcp` |
| `lib/classifyEntity.js` | Pure entity → HomeKit-service-slot classifier |
| `lib/DeviceAccessory.js` | Per-device multi-service HomeKit accessory composer |
| `lib/stateManager.js` | HomeKit `.onSet` handlers + per-device debounced send (clean-payload builder) |
| `lib/state.js` | Pure ESPHome ↔ HomeKit mode/fan/swing mappers |
| `lib/eve.js` | Eve.Energy `CurrentPowerConsumption` custom characteristic factory |
| `package.json` | Package metadata, scripts, deps |
| `config.schema.json` | Homebridge UI form-based config editor |
| `config-sample.json` | Reference config with one device entry |
| `LICENSE` | MIT |
| `README.md` | User-facing docs |
| `CHANGELOG.md` | Release history (Keep a Changelog) |
| `ROADMAP.md` | Development plan (M1–M5) |
| `test/unit/*.test.js` | Jest unit tests (78 currently) |
| `QA_TESTS.md` | Manual pre-release checklist |
| `AGENTS.md` | Pointer to this file |
| `CLAUDE.md` | This file — project memory |
| `.eslintrc.json` | ESLint legacy config (eslint:recommended; tabs) |
| `.eslintignore` | ESLint ignore patterns |
| `.gitignore` | Standard Node/Xcode ignore (Xcode bits inherited from upstream) |

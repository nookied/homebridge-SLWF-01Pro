# CLAUDE.md — homebridge-SLWF-01Pro

This file is the canonical persistent memory for this project. Use [DOCS.md](DOCS.md) as the documentation routing table; `AGENTS.md` is intentionally just a pointer here to avoid maintaining duplicate project memory.

---

## Project Overview

**npm name:** `homebridge-slwf-01pro` *(renamed from upstream's `homebridge-esphome-ac`)*
**Platform identifier:** `SLWFOnePro` *(renamed from upstream's `ESPHomeAC` in v0.2.0 to guarantee no namespace collision when both plugins are installed)*
**Type:** Homebridge plugin (Node.js, CommonJS)
**Purpose:** Expose ESPHome climate entities — primarily the **[SMLIGHT SLWF-01Pro](https://smartlight.me/smart-home-devices/wifi-devices/wifi-dongle-air-conditioners-midea-idea-electrolux-for-home-assistant)** Wi-Fi dongle flashed with ESPHome — as HomeKit `HeaterCooler` accessories. Hardware-agnostic: any ESPHome `climate:` component (e.g. ESP32 with [`midea_ac`](https://esphome.io/components/climate/midea.html) directly soldered) is also picked up.
**Repo:** [`https://github.com/nookied/homebridge-SLWF-01Pro`](https://github.com/nookied/homebridge-SLWF-01Pro) — **maintained fork**
**Original (upstream):** [`nitaybz/homebridge-esphome-ac`](https://github.com/nitaybz/homebridge-esphome-ac) — last release 0.0.4. The fork is fully independent; an `upstream` git remote is not required for normal work and should only be used temporarily for reference.
**License:** MIT (preserved from original)
**Current version:** **0.5.7** — published to npm on 2026-05-24. Further fixes are staged unreleased on `master`; see the `[Unreleased]` section of `CHANGELOG.md`. 181 unit tests passing across 10 suites. CI on Node 22 / 24 / 26. Tag-driven release pipeline publishing via npm trusted publishing (OIDC, no token). `ACCESSORY_SCHEMA_VERSION = 6`.
**Engines:** Homebridge `^1.8.0 || ^2.0.0`; Node `^22.0.0 || ^24.0.0 || ^26.0.0` (Node 18 and 20 are EOL and were dropped alongside the eslint 10 upgrade, which requires Node >= 20.19)

> **Pairing status (resolved enough to use):** The child-bridge pairing issue from the 0.4.x audit was addressed across 0.4.4 → 0.5.1. The user successfully paired and sees devices. The fix bundle: Eve power moved off the `HeaterCooler` service onto a linked, hidden `Service.Outlet` (0.4.4); companion services hidden by default to keep visible service count down (0.5.0); ConfiguredName preserved across restarts so Apple Home renames stick (0.5.1); auto-discovered offline devices no longer pruned so Apple Home identity survives reboots (0.5.1). 0.5.2 removed empty Homebridge UI row log noise. 0.5.3 added capability-aware restore mode, ConfiguredName seeding for newly-enabled cached companion services, current-temperature clamping, and a non-destructive prune guard for invalid hostless manual entries. 0.5.4–0.5.6 attempted progressively stronger forced clears for sticky `StatusFault` warnings. 0.5.7 changes strategy: the plugin no longer exposes optional `StatusActive` / `StatusFault` transport-health characteristics, because Apple Home can cache them too aggressively; writes still return clean communication errors while disconnected. 0.5.7 also uses cached auto-discovered hosts as fallback connection targets when mDNS misses a scan. Per-device disable flags now override platform defaults *bidirectionally* (0.5.0). The maintained pairing/network diagnostic flow lives in `QA_TESTS.md` section 7.

### What "SLWF-01Pro" is

The **SLWF-01Pro** is a small Wi-Fi control module from **SMLIGHT** (smartlight.me, Ukraine) that plugs into the proprietary serial Wi-Fi port found inside Midea-protocol mini-split air conditioners. It replaces the OEM Tuya/SmartLife stick; once flashed with ESPHome (typically the [`midea_ac`](https://esphome.io/components/climate/midea.html) component) the AC becomes a local-network climate entity instead of a Tuya-cloud-only device.

Hardware revisions in the wild:
- **v1.1** — ESP8266, original pinout
- **v1.2** — ESP8266, TX/RX swapped vs v1.1
- **v2.1** — ESP32, different again

Wrong YAML for the hardware revision = no UART communication; this is a common support question on the SMLIGHT forum but not the plugin's problem to solve.

Compatible AC brands (per SMLIGHT): Midea, Idea, Electrolux, Beko, Neoclima, Bosch, Senville (Leto), Yitahome, Mr. Cool, AUX, Alpine, Pioneer, Samsung, Toshiba, Zanussi, and ~15 others — all Midea-platform mini-splits. Newer 2024+ Midea firmwares with proprietary key exchange may refuse the dongle.

### Fork rules

- This is a **maintained fork published to npm under a distinct name** (`homebridge-slwf-01pro`). The upstream (`homebridge-esphome-ac`) is unaffected and still on npm at 0.0.4.
- **Three layers of independence from upstream** (`homebridge-esphome-ac`):
  1. **npm name**: `homebridge-slwf-01pro` (distinct package on npm).
  2. **Platform identifier**: `SLWFOnePro` (since v0.2.0; users' `config.json` `"platform"` key).
  3. **HomeKit UUID namespace**: UUIDs are derived from `homebridge-slwf-01pro:<deviceId>` (since v0.3.0), so even when both plugins discover the same physical AC, they produce distinct UUIDs and HomeKit doesn't collide.
  All three together mean the two plugins can run **alongside each other** on the same Homebridge with full auto-discovery, no interference.
- The `upstream` git remote was **removed as project policy** in v0.2.0. The fork is intentionally divergent; the upstream's release cadence (last release ~2 years ago) doesn't justify the round-trip. If a local checkout temporarily has an `upstream` remote for reference, do not treat it as part of the release state.
- `package.json` `repository.url` MUST point at this fork (`git+https://github.com/nookied/homebridge-SLWF-01Pro.git`). npm sigstore provenance is strict — a mismatch causes `npm publish` to fail with HTTP 422 (warmup4ie hit this once).
- CI runs lint + tests + smoke on Node 22/24/26 for every push (`.github/workflows/ci.yml`). Releases are tag-driven: `npm version patch|minor|major && git push --follow-tags` triggers `release.yml`, which publishes to npm and creates a GitHub Release. See [Release & npm publishing](#release--npm-publishing) below.

### Release & npm publishing

- `.github/workflows/ci.yml` — lint + tests + smoke on Node 22 / 24 / 26, every push and PR.
- `.github/workflows/release.yml` — tag-driven (`v*`). Verifies the tag matches `package.json` version, runs lint + tests + smoke, publishes to npm, then creates a GitHub Release from the matching `CHANGELOG.md` section.
- **No npm secret is required.** Publishing uses npm **trusted publishing** (GitHub OIDC), configured on npmjs.com under the package's *Trusted Publisher* settings: org `nookied`, repo `homebridge-SLWF-01Pro`, workflow filename `release.yml`, environment blank. The workflow's `id-token: write` permission is the only credential in the path. Provenance is generated automatically — **do not re-add `--provenance`**.
  - This replaced a long-lived Granular Access Token. The repo's `NPM_TOKEN` secret was last written 2026-05-24 and Granular Access Tokens cap at 90 days, putting expiry around **2026-08-22** — already past, so the next tagged release would have failed with **`404 Not Found - PUT`**. npm reports a dead or unauthorized token as a missing package, so a 404 on publish means *auth*, not a missing package. (`homebridge-warmup-v2` hit exactly this on its v3.12.0 release.) Trusted publishing has no expiry, so this cannot recur. The dead `NPM_TOKEN` secret is left in the repo but is no longer read by anything.
  - **Two traps that both produce that same misleading 404:**
    1. **Never set `registry-url` on `actions/setup-node`.** It writes `//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}` into `.npmrc`; with no token that expands to empty, npm decides auth is already configured, and never starts the OIDC exchange. (`actions/setup-node#1551`, `npm/documentation#1960`.) The workflow carries a comment saying so, plus a defensive step that strips any `_authToken` line.
    2. **Never rename `release.yml`.** npm matches the trusted publisher on the workflow *filename* alone; renaming it silently breaks publishing until the npmjs.com config is updated to match.
  - Requires npm >= 11.5.1 and Node >= 22.14 on the runner. The release job uses `node-version: lts/*` — **not** a pinned `22.x`, because Node 22 ships npm 10 — and asserts the npm version explicitly rather than letting an old npm surface as an opaque 404.

### What it does

The plugin opens an ESPHome native-API connection (TCP, default port 6053) to each configured device, listens for `Climate` entity announcements, and creates a HomeKit `Service.HeaterCooler` per entity. State changes from the device push into HomeKit; HomeKit `.onSet` writes are coalesced and forwarded to ESPHome via `climateCommandService`. Transport is the [`@2colors/esphome-native-api`](https://github.com/2colors/esphome-native-api) Node client — protobuf over TCP with optional [Noise](https://noiseprotocol.org/) encryption when `encryptionKey` is set.

## Architecture

```
homebridge-SLWF-01Pro/
├── index.js                              Homebridge entry; registerPlatform(.., true) — dynamic
│   ├── module.exports(api)                  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SLWFOnePro, true)
│   └── SLWFOnePro                           Dynamic platform class (renamed from ESPHomeAC in v0.4.0)
│       ├── constructor(log, config, api)        Reads config (devices[], debug, autoDiscover, disable* flags);
│       │                                          applies clean-install defaults (autoDiscover/disable* default true);
│       │                                          sets up log.easyDebug; on 'didFinishLaunching' → ESPHome.init()
│       └── configureAccessory(accessory)        Stash cached PlatformAccessory; route schemaVersion mismatches to staleAccessories
│
├── lib/
│   ├── esphome.js                        Async orchestrator: manual + discovered devices → Client per device → DeviceAccessory
│   │   ├── init()                              Build device list (manual + autoDiscover), spawn one Client per device,
│   │   │                                          prune orphaned cached accessories
│   │   ├── evictStaleSchemaAccessories()       Unregister accessories whose schemaVersion < ACCESSORY_SCHEMA_VERSION
│   │   ├── spawnClient(platform, device)       Per-device: connect, attach connected/disconnected/error/initialized,
│   │   │                                          call setConnectedStatus on the bound DeviceAccessory
│   │   └── pruneOrphanedAccessories(platform, liveHosts)
│   │                                            Unregister cached accessories not in liveHosts. Early-returns when
│   │                                            autoDiscover is on so transient-offline devices keep their identity.
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
│   │   ├── addOptionalSensorServices()         HumiditySensor / TemperatureSensor (outdoor) / linked Outlet for Eve.Energy power
│   │   ├── addOptionalSwitchServices()         Service.Switch for Beeper + Display Toggle
│   │   ├── addModeSwitchServices()             Service.Switch for DRY + FAN_ONLY (mutually exclusive with primary mode)
│   │   ├── removeDisabledServices()            Honour disable* flags AND missing entities (cached cleanup)
│   │   ├── attachOptionalEntityListeners()     Bind ESPHome 'state' events for sensors / switches / power
│   │   ├── attachPowerService()                Linked Outlet service with Eve.Energy CurrentPowerConsumption + optional fakegato-history (optional peer dep; warns once if absent)
│   │   ├── handleModeSwitch(targetMode, on)    DRY/FAN_ONLY toggle handler — sets/restores mode via stateManager.sendState
│   │   ├── syncModeSwitches(currentMode)       Reflect device's actual mode back into the supplementary switches
│   │   ├── setConnectedStatus(connected)       Track ESPHome client reachability for clean HomeKit write failures
│   │   ├── removeConnectionStatusCharacteristics()
│   │   │                                      Remove cached StatusActive/StatusFault from HeaterCooler (schema v6)
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
│   ├── eve.js                            Eve.app custom characteristic factory
│   │   ├── makeEveClasses(api)                 Returns { CurrentPowerConsumption } class with HAP-NodeJS 2.x fallbacks
│   │   └── EVE_POWER_UUID                      'E863F10D-...'
│   │
│   └── constants.js                      Single source of truth for plugin-wide constants
│       ├── PLUGIN_NAME / PLATFORM_NAME         npm + Homebridge identifiers
│       ├── DEFAULT_ESPHOME_PORT                ESPHome native API default port (6053)
│       ├── ACCESSORY_SCHEMA_VERSION            Bumped on accessory-shape changes (currently 6)
│       └── UUID_NAMESPACE                      Prefix for the HomeKit UUID hash
│
├── test/
│   └── unit/
│       ├── state.test.js                 Truth tables for all mappers + capability checks + deriveDeviceId (65 tests)
│       ├── classifyEntity.test.js        Entity classification + bundling (17 tests)
│       ├── discovery.test.js             prettyNameFromHostname + dedupeDevices (9 tests)
│       ├── configSchema.test.js          Structural schema audit + drift checks vs. lib/constants.js (15 tests)
│       ├── configSchemaValidation.test.js  ajv-based config-schema validation (20 tests)
│       ├── hapCompliance.test.js         Mock HAP shim: AccessoryCategory, setPrimaryService, addLinkedService,
│       │                                   ConfiguredName seeding + persistence, Identify handler, NaN-safe setProps,
│       │                                   Eve power on hidden Outlet, current-temperature clamp,
│       │                                   capability-aware initial mode, RotationSpeed.minStep, schema-version
│       │                                   single-sourcing, bidirectional per-device override
│       ├── pruning.test.js               pruneOrphanedAccessories: skip when autoDiscover on, prune when off (4 tests)
│       ├── looksLikeRealEntry.test.js    Empty UI-row filtering + invalid manual config prune guard (10 tests)
│       ├── modeSwitch.test.js            handleModeSwitch: DRY/FAN_ONLY restore targets, incl. returning to OFF (9 tests)
│       └── clientOptions.test.js         Pins the ESPHome Client options — above all clearSession: false (5 tests)
│
├── .github/workflows/
│   ├── ci.yml                            Lint + tests + smoke on Node 22 / 24 / 26, every push + PR
│   └── release.yml                       Tag-driven (`v*`) + manual auth probe; npm publish via OIDC trusted publishing + GitHub Release
│
├── package.json                          scripts: lint / lint:fix / test / test:all
├── config.schema.json                    Homebridge UI form-based config editor (autoDiscover + per-device disable flags)
├── config-sample.json                    Reference config with autoDiscover + one manual device with per-device override
├── README.md                             User docs
├── DOCS.md                               Documentation index + update process
├── CHANGELOG.md                          Keep-a-Changelog format
├── ROADMAP.md                            Development plan
├── QA_TESTS.md                           Manual pre-release checklist + pairing-issue diagnostic flow
├── CLAUDE.md                             This file — project memory
├── AGENTS.md                             Pointer → CLAUDE.md
├── LICENSE                               MIT
└── eslint.config.mjs                     ESLint 10 flat config (eslint:recommended; tabs; jest globals scoped to test/)
```

## How it runs

1. Homebridge calls `module.exports(api)` → `api.registerPlatform("homebridge-slwf-01pro", "SLWFOnePro", SLWFOnePro, true)` (4th arg `true` = dynamic platform). The class and the user-facing platform identifier are both `SLWFOnePro` since 0.4.0; pre-0.4.0 the class was `ESPHomeAC`.
2. Homebridge instantiates `SLWFOnePro(log, config, api)`. The constructor reads config (`name`, `debug`, `devices[]`, `autoDiscover`, `discoveryTimeout`, all `disable*` flags), applies clean-install defaults via `??` (since 0.5.0 `autoDiscover` and every `disable*` flag default to `true` when the user hasn't set them), sets up `this.accessories = []`, `this.staleAccessories = []`, `this.cachedAccessoryFallbacks = []`, `this.esphomeDevices = {}` (keyed by `device.host`), then registers `api.on('didFinishLaunching', ...)`. On `didFinishLaunching`, `lib/esphome.js init()` runs `evictStaleSchemaAccessories()` first to unregister cached accessories whose `context.schemaVersion < ACCESSORY_SCHEMA_VERSION`, then `detectOrphanedAccessories()` (best-effort scan of the bridge's `cachedAccessories.*` for upstream/legacy entries — logs warnings, never throws). Since 0.5.7, stale accessories are also copied into `cachedAccessoryFallbacks` before eviction so their hosts can seed reconnect clients during schema rebuilds when mDNS is flaky.
3. For each accessory in Homebridge's on-disk cache, `configureAccessory(accessory)` is called synchronously — we stash it in `this.accessories[]`. Service handlers are NOT bound here.
4. After all `configureAccessory` calls, `didFinishLaunching` fires → `await esphome.init()`:
   - Build the **device list**: manual `this.devices[]` first, then if `autoDiscover` is true, call `discovery.discoverDevices({ timeout })` to mDNS-browse `_esphomelib._tcp` and append any discovered devices not already present (deduped by host, case-insensitive). Since 0.5.7, cached accessory hosts that were not rediscovered are also appended as fallback connection targets so mDNS misses do not leave cached HomeKit accessories without reconnecting ESPHome clients.
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
   - Computes `UUID = api.hap.uuid.generate(UUID_NAMESPACE + ':' + deriveDeviceId(...))` so this fork never collides with upstream for the same physical AC.
   - Looks up cached accessory by UUID; if found, reuse it (refresh `context.host`). If not, `new api.platformAccessory(name, uuid)` → `api.registerPlatformAccessories`.
   - Calls `setupAccessoryInformation()` → `addClimateService()` → `removeLegacyPowerCharacteristic()` → `addOptionalSensorServices()` → `addOptionalSwitchServices()` → `addModeSwitchServices()` → `removeDisabledServices()` → `linkOptionalServices()` → `attachOptionalEntityListeners()`.
   - `removeDisabledServices` is idempotent — both "disabled by config flag" and "missing entity on device" trigger removal.
6. **Writes** (HomeKit → ESPHome):
   - HomeKit `.onSet(handler)` → `stateManager.set.<X>` mutates `that.state.<field>` and calls `sendState(that)`.
   - `sendState` debounces 600 ms per-device (`that._sendTimeout`), then sends a clean `climateCommandService(payload)` containing only dirty command fields plus the ESPHome entity key.
   - Pending callers all resolve when the send completes; if `that.connected === false`, all reject with `HapStatusError(-70402)` (SERVICE_COMMUNICATION_FAILURE).
   - **Mode-switch handlers** (DRY/FAN_ONLY) call `stateManager.sendState(this)` directly after mutating `state.mode` (no debounce skip — each toggle queues its own send).
   - **Beeper switch** calls `entity.setState(true/false)` directly via the @2colors Switch entity API.
   - **Display button** calls `entity.push()` directly via the Button entity API; service auto-resets to off 250 ms later.
7. **State pushes** (ESPHome → HomeKit):
   - `entities.climate.on('state', updateClimateState)` — main path. Updates Active / CurrentTemperature / Target/CurrentHeaterCoolerState / SwingMode / RotationSpeed and `syncModeSwitches()` for DRY/FAN_ONLY tile state.
   - Each optional entity (`humiditySensor`, `outdoorTempSensor`, `powerSensor`, `beeperSwitch`) has its own `'state'` listener pushing to its respective service/characteristic. Power updates the linked Outlet's Eve `CurrentPowerConsumption` and `OutletInUse`.
   - On disconnect, `setConnectedStatus(false)` only flips the internal `connected` flag used by `stateManager.sendState`. HomeKit writes reject with `HapStatusError(-70402)` while disconnected. The plugin deliberately no longer exposes optional HAP `StatusActive` / `StatusFault` transport-health characteristics; those proved too sticky in Apple Home caches.
8. **Cleanup at startup**: After spawning all clients, `pruneOrphanedAccessories(platform, liveHosts)` runs. With `autoDiscover` on (default) it early-returns — transient-offline auto-discovered devices keep their HomeKit identity. With `autoDiscover` off it unregisters any cached accessory whose `context.host` isn't in `liveHosts` (= manual `devices[]`).

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
    "platform": "SLWFOnePro",           // identifier — must match config.schema.json's pluginAlias
    "name": "SLWFOnePro",               // optional log prefix
    "debug": false,                     // optional; route easyDebug to log() instead of log.debug()
    "autoDiscover": true,               // default true since 0.5.0; mDNS-browses for ESPHome devices
    "discoveryTimeout": 5,              // optional; seconds to wait for mDNS responses (default 5)

    // Global service toggles — default true (hide everything) since 0.5.0
    // Flip to false to opt back in. Per-device override wins in either direction.
    "disableHumiditySensor": true,
    "disableOutdoorTempSensor": true,
    "disablePowerSensor": true,
    "disableBeeperSwitch": true,
    "disableDisplaySwitch": true,
    "disableDryMode": true,
    "disableFanOnlyMode": true,

    "devices": [
      {
        "name": "Living Room AC",
        "host": "192.168.1.120",
        "port": 6053,                   // optional; default 6053
        "encryptionKey": "",            // optional; ESPHome `api: encryption` Noise key
        "disableBeeperSwitch": false    // per-device override — enables a service the platform hid
      }
    ]
  }]
}
```

Per-device disable flags override the platform-wide flag **in either direction**. If a per-device flag is set explicitly (true OR false), it wins; otherwise the device inherits the platform default. This is what `lib/DeviceAccessory.js settingDisabled(key)` implements: `device[key] !== undefined ? Boolean(device[key]) : Boolean(platform[key])`. Since 0.5.0 the platform defaults are all `true` (everything hidden), so the symmetric override is the only way to opt a single AC back into a service.

Heads-up about `autoDiscover`: when it's on (the default since 0.5.0) and a device is discovered, the device is registered with a stable UUID and cached on disk. While `autoDiscover` stays on, transient-offline devices are kept (the prune step early-returns) so a power-cycled AC doesn't lose its HomeKit identity. When the user later turns `autoDiscover` **off**, `liveHosts` reduces to manual `devices[]` only and `pruneOrphanedAccessories` unregisters anything not in that list. **To preserve auto-discovered devices when disabling discovery, copy them into `devices[]` first** (or accept that they'll be removed). Permanent removal while `autoDiscover` is on is via Homebridge UI → Remove Single Cached Accessory.

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

The unit-test suite covers pure mode/entity/discovery helpers, config-schema drift, HAP shape/compliance, cache pruning, Homebridge UI-row filtering, cached-host fallback, and connection-status behavior. Add new unit tests under `test/unit/`.

## Versioning

Pre-1.0 tracking: PATCH bumps for fixes, MINOR (`0.X.0`) bumps for behaviour changes during the rewrite. Once stable enough to call 1.0.0, switch to strict [SemVer](https://semver.org/):

| Bump | When | Examples |
|------|------|---|
| **MAJOR** (`X.0.0`) | Breaking config / HomeKit shape change | Custom-fan-modes that change the RotationSpeed mapping |
| **MINOR** (`X.Y.0`) | New feature (new HomeKit service, presets, two-point temp) | Surfacing presets as Switch services |
| **PATCH** (`X.Y.Z`) | Bug fix, dep bump, doc-only change | (current bug-fix release) |

## Known issues / tech debt

### Open — feature gaps
1. **Custom fan modes (`silent`, `turbo`) and presets (`eco`, `boost`, `sleep`, `away`) are not exposed.** Midea-platform devices commonly advertise these via `supportedCustomFanModesList`/`supportedPresetsList`. Roadmap M4.
2. **Two-point target temperature is not used.** Even when `config.supportsTwoPointTargetTemperature === true`, the plugin sends only single `target_temperature`. AUTO mode in HomeKit uses both `HeatingThresholdTemperature` and `CoolingThresholdTemperature` — currently both write to the same single field. Roadmap M5.
3. **Intake-mounted sensor inaccuracy.** Device-side issue (the SLWF-01Pro reads cold-air-blast not room temp). Mitigated by ESPHome's `midea_ac.follow_me` action — Home-Assistant-only and needs a hardware mod. Out of scope for this plugin.
4. **Encrypted ESPHome devices skip auto-discovery.** mDNS doesn't broadcast the Noise encryption key, so encrypted devices need a manual `devices[]` entry. Documented in README.
5. **Heuristic entity classification.** Beeper/humidity/etc. are matched by name pattern. If a user customizes their ESPHome YAML to use unusual entity names, the entity won't be classified. Could add explicit `entityMap` config option later.

### Resolved across 0.1.0 → 0.5.7
- **Module-level `sendTimeout` shared across devices.** Multi-AC users could lose commands when changing one AC then another within 600 ms. Now a per-device `that._sendTimeout`.
- **Undefined `log` ReferenceError on disconnect.** `stateManager.js` referenced bare `log` in the device-disconnected error path; would crash the call instead of returning a clean HAP error. Fixed to `that.log.error` and rejection now uses `HapStatusError`.
- **Stacked `connected`/`disconnected` listeners.** Original code attached them inside the `entity.once('state')` callback — every Climate entity (and every reconnect) added another pair. Moved to platform scope, attached once per Client.
- **Lint errors in the original `HeaterCooler.js`.** Indentation mismatches at lines 86 and 123 (caught by `eslint:recommended` indent rule). Resolved by extracting mode logic to `lib/state.js`; the file itself was retired in favour of `lib/DeviceAccessory.js`.
- **`registerPlatform` missing dynamic flag.** `registerPlatform(name, alias, Class)` registered as a static platform; should be `registerPlatform(name, alias, Class, true)`. Cached accessories were being unregistered every restart.
- **`package.json` `repository.url` pointed to upstream.** Would break sigstore provenance on `npm publish`. Now points at the fork.
- **HeaterCooler.js mutated `state.targetTemperature` for clamping.** Plugin-side clamp leaked into the live state object; means the next outgoing command could carry the clamped value even if the device had a different target. Replaced with `clampTargetTemperature(value)` that returns a new value without mutating.
- **All accessories failed to construct on devices without `unique_id` set in YAML** *(0.1.0/0.1.1 → 0.1.2)*. `api.hap.uuid.generate(undefined)` threw the cryptic `data argument must be a Buffer/string/...` error. `deriveDeviceId(...)` fallback chain in `lib/state.js` now handles it: `uniqueId → mac+objectId → mac+climate → host+...`.
- **Platform identifier rename `ESPHomeAC` → `SLWFOnePro`** *(0.2.0)*. Eliminates namespace collision with upstream when both plugins are installed. `lib/esphome.js` `detectOrphanedAccessories()` warns about cached entries from upstream OR from the legacy identifier.
- **Same physical AC produced colliding HomeKit UUIDs** if both plugins discovered it *(0.3.0)*. UUIDs are now derived from `homebridge-slwf-01pro:<deviceId>` so the two plugins can run side-by-side. `accessory.context.schemaVersion` evicts cached accessories from earlier UUID schemes.
- **"Out of compliance" pairing error for devices that hadn't sent state yet** *(0.3.1)*. Three layers: wait for first `state` event before construction (5 s timeout fallback); safe defaults for `CurrentTemperature`/threshold characteristics; `safeUpdate()` skips updates of `null`/`undefined`/`NaN`. `FirmwareRevision` validated against HAP's SemVer-ish format.
- **Config UI "validation failed" warning** *(0.3.2/0.3.3)*. `config.schema.json` modernized to canonical JSON Schema (`required: [...]` arrays at parent level, no per-property `required: false`). ajv-based test suite with 20 sample configs.
- **`Categories.AIR_CONDITIONER` was never set on accessories** *(0.4.1)*. Defaulting to `OTHER (1)` could cause Apple Home iOS 16+ to silently hide accessories. Companion services (sensors + switches) are now `addLinkedService`-linked to the primary HeaterCooler.
- **HAP-compliance audit fixes** *(0.4.3)*. `setProps NaN`-guard with default visual temp bounds; mode-fallthrough uses `validValues[0]` instead of hardcoded AUTO; `ConfiguredName` on every companion service; `Identify` handler bound; `RotationSpeed.minStep` sized to fan-mode count; `ACCESSORY_SCHEMA_VERSION` consolidated to `lib/constants.js` (single source). Mock-HAP-shim test suite (`test/unit/hapCompliance.test.js`, 9 tests) prevents regression.
- **Eve power characteristic attached directly to HeaterCooler** *(0.4.4)*. Power monitoring now uses a linked `Service.Outlet` named `<AC> Power`, marked hidden via `setHiddenService(true)` so Apple Home doesn't render it as a separate tile while Eve.app and other HAP-direct clients still read `CurrentPowerConsumption`. Startup also removes the legacy Eve characteristic from cached `HeaterCooler` services. `ACCESSORY_SCHEMA_VERSION` is bumped to 5 so users get the corrected service shape on upgrade. Snap-back `On` handler retained as a fallback for HAP-NodeJS versions predating `setHiddenService`.
- **Apple Home pairing was intermittently failing** *(0.4.4 + 0.5.0; user-confirmed paired)*. Multi-pronged fix: Eve power off the standard `HeaterCooler` service (0.4.4), companion services hidden by default to keep accessory service count down (0.5.0), schema bump 4 → 5 forcing a clean accessory recreation. The maintained pairing diagnostic flow now lives in `QA_TESTS.md` section 7.
- **Default-config UX overhaul** *(0.5.0)*. `autoDiscover` defaults to `true` and every `disable*` flag defaults to `true`, so a fresh install gives a clean Apple Home with just one HeaterCooler tile per AC. `index.js` switched from `||` to `??` so explicit `false` is honoured. Per-device override semantics now symmetric: `device[key] !== undefined ? Boolean(device[key]) : Boolean(platform[key])` — required so users can keep the global hide and selectively enable a service for a single AC.
- **Apple Home rename clobbered on every restart** *(0.5.1)*. `setConfiguredName` now early-returns when `!this.isNewAccessory`, so a cached accessory keeps whatever HAP/Apple Home has stored. Room assignment was always safe (Apple Home stores it server-side, keyed by stable accessory UUID).
- **Auto-discovered offline devices were unregistered on restart** *(0.5.1)*. `pruneOrphanedAccessories` now early-returns when `platform.autoDiscover` is on. An offline AC stays in the cache as "Not Responding" instead of being dropped (which would have lost the user's name/room/automations). With `autoDiscover` off, manual `devices[]` is the source of truth and the legacy prune behaviour is preserved (devices removed from config are unregistered).
- **Empty Homebridge UI rows logged noisy warnings** *(0.5.2)*. `looksLikeRealEntry(device)` filters form scaffolding rows before client orchestration while still warning for real hostless entries.
- **Heat-only devices could restore unsupported COOL on Active=ON** *(0.5.3)*. `chooseInitialTargetMode(stateMode, supportedModesList)` now respects advertised capabilities, and `stateManager.set.Active` uses it for cached restore modes too. Stale or external unsupported HEAT/COOL target writes are ignored.
- **New companion services on cached accessories could miss `ConfiguredName`** *(0.5.3)*. `setConfiguredName` now preserves non-empty cached values but seeds the characteristic when the service is newly created after a config toggle.
- **Invalid hostless manual entries could allow destructive pruning** *(0.5.3)*. Real hostless manual entries now keep cached accessories until fixed instead of letting `autoDiscover: false` prune with an incomplete config. Empty UI scaffolding remains silently dropped.
- **Main `CurrentTemperature` was not clamped on state updates** *(0.5.3)*. Values are now constrained to the HAP-safe `-100..100` range before updating the primary HeaterCooler service.
- **⚠️ fault indicator persisted after Homebridge restart, on transient standby disconnects, and after reconnect** *(0.5.4–0.5.7)*. 0.5.4–0.5.6 tried to fix progressively narrower timing races with delayed `sendEventNotification` clears, but Apple Home can still miss or cache optional `StatusFault` values too aggressively. 0.5.7 removes optional `StatusActive` / `StatusFault` transport-health characteristics from the HeaterCooler service entirely and bumps `ACCESSORY_SCHEMA_VERSION` to 6 so cached v5 accessories are rebuilt without them. Disconnected devices still fail HomeKit writes cleanly through `HapStatusError(-70402)`.
- **Auto-discovered cached devices could be kept in HomeKit but left without reconnecting clients when mDNS missed a scan** *(0.5.7)*. With `autoDiscover` on, cached accessory hosts are now appended as fallback connection targets after discovery, and `DeviceAccessory` stores `context.port` for future fallback attempts.
- **Supplementary DRY/FAN_ONLY state pushes could leave HomeKit Active stale after OFF** *(0.5.7)*. The non-primary mode update path now sets `Active = 1` before writing the fallback target/current state.

### By design (won't fix)
- **No upstream PR-back.** The fork is intentionally divergent and the upstream's release cadence (last release ~2 years ago) doesn't justify the round-trip.
- **AUTO fan mode == 0 % rotation speed.** HomeKit's `RotationSpeed` characteristic has no separate "auto" anchor, so the plugin maps 0 % to ESPHome's AUTO fan mode (when supported). Documented; users wanting a strict "off" semantics can hide the fan slider via `disableFanOnlyMode` and the dry/fan_only switches.

## Dependency notes

- **`clearSession: false` on the ESPHome `Client` is load-bearing.** The client destroys and recreates its entity objects on reconnect *only* when `clearSession` is true. `DeviceAccessory` binds its `'state'` listeners to those objects exactly once, and `esphome.js`'s `'initialized'` handler deliberately early-returns on reconnect — so flipping the flag would leave the plugin holding destroyed entities, and HomeKit would silently stop receiving updates after the first reconnect. Pinned by `test/unit/clientOptions.test.js`.
- **`fakegato-history` is an optional peer dependency, not a dependency.** It hard-depends on `googleapis` (~194 MB) for a Google Drive storage backend this plugin never uses, and that tree carried the package's only production advisory. It is declared under `peerDependencies` with `peerDependenciesMeta.optional: true`, so npm does **not** install it automatically. Live power readings work without it; only the Eve history graph needs it. `lib/DeviceAccessory.js` `try/catch`-wraps the `require` and warns once per Homebridge run when power monitoring is enabled but the module is missing.
- **The declared floor for `@2colors/esphome-native-api` is `^1.3.6`.** It was `^1.2.3` while the lockfile pinned 1.2.3, so CI tested a client three years older than the one users resolved to. The API surface the plugin touches (`climateCommandService`, `Discovery`, and the `deviceInfo` fields) is unchanged between the two.

## Working rules (for this repo)

1. **Don't change the wire-format.** `@2colors/esphome-native-api` is a thin protobuf wrapper; we trust it to handle the protocol. Our job is mode mapping and HomeKit service composition.
2. **Prefer minimum-diff fixes.** This is a small plugin — most things are 1–2 file changes. Don't refactor end-to-end while fixing a one-line bug.
3. **Use `DOCS.md` before updating docs.** It defines which file owns each kind of truth and prevents parallel handoff notes from drifting.
4. **Touch README/config/schema/project memory together** when adding or changing config keys or user-visible behaviour.
5. **Walk `QA_TESTS.md` before tagging a release.** Jest covers the pure helpers; the manual checklist catches HomeKit + ESPHome wire-format drift.
6. **Keep mode logic in `lib/state.js` and entity classification in `lib/classifyEntity.js`.** Pure functions, no HAP types — these are where new unit tests should land.
7. **`package.json` `repository.url` must point at this fork.** Sigstore provenance is strict; this trips up forks.

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
| Decide which docs to update | `DOCS.md` |
| Reference the ESPHome native-API client | [`@2colors/esphome-native-api`](https://github.com/2colors/esphome-native-api) |
| Reference SLWF-01Pro hardware/firmware | [SMLIGHT product page](https://smartlight.me/smart-home-devices/wifi-devices/wifi-dongle-air-conditioners-midea-idea-electrolux-for-home-assistant) |
| Reference Homebridge plugin patterns | [developers.homebridge.io](https://developers.homebridge.io/) |
| Reference Verified-plugin requirements | [`homebridge/plugins`](https://github.com/homebridge/plugins) |

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
| `lib/constants.js` | Single source of truth: `PLUGIN_NAME`, `PLATFORM_NAME`, `ACCESSORY_SCHEMA_VERSION`, `UUID_NAMESPACE` |
| `.github/workflows/ci.yml` | Lint + tests + smoke on Node 22 / 24 / 26 |
| `.github/workflows/release.yml` | Tag-driven npm publish (OIDC trusted publishing, no token) + GitHub Release |
| `package.json` | Package metadata, scripts, deps |
| `config.schema.json` | Homebridge UI form-based config editor |
| `config-sample.json` | Reference config with one device entry |
| `LICENSE` | MIT |
| `README.md` | User-facing docs |
| `DOCS.md` | Documentation index and update process |
| `CHANGELOG.md` | Release history (Keep a Changelog) |
| `ROADMAP.md` | Development plan (M1–M5) |
| `test/unit/*.test.js` | Jest unit tests (181 currently across 10 suites) |
| `QA_TESTS.md` | Manual pre-release checklist |
| `AGENTS.md` | Pointer to this file |
| `CLAUDE.md` | This file — project memory |
| `eslint.config.mjs` | ESLint 10 flat config (eslint:recommended; tabs; jest globals scoped to `test/`) |
| `.gitignore` | Standard Node/IDE/local-artifact ignore |

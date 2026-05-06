# Changelog

All notable changes to `homebridge-SLWF-01Pro` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This package is a maintained fork of [`homebridge-esphome-ac`](https://github.com/nitaybz/homebridge-esphome-ac). Pre-fork history below is the upstream history, kept for context.

---

## [0.1.0] — Unreleased

First fork release — bug fixes, full multi-entity rewrite, and a substantial feature expansion. Adds mDNS auto-discovery, multi-entity HomeKit composition (humidity / outdoor temperature / power / beeper / display switches), DRY + FAN_ONLY mode tiles, Eve.Energy power graphs, and HEAT_COOL-mode AC support. Three independent code-review passes drove a follow-up cleanup.

### Added

- **mDNS auto-discovery.** New `autoDiscover` (and optional `discoveryTimeout`) config flag. When enabled, the plugin browses `_esphomelib._tcp` and creates accessories for any discovered ESPHome device that exposes a `Climate` entity. Manually configured devices in `devices[]` continue to work and are required for encrypted devices (the Noise key is not broadcast over mDNS).
- **Multi-entity per accessory.** A single ESPHome device's `Climate` + `Sensor` + `Switch` + `Button` entities are now bundled into one HomeKit accessory with multiple services. Previously only the climate entity was used; everything else from the device was silently dropped.
- **`Service.HumiditySensor`** when the ESPHome device exposes a `*humidity*` sensor entity. Hide with `disableHumiditySensor` (global) or `devices[].disableHumiditySensor` (per device) — useful for ACs that report a fake `0 %` because no probe is fitted.
- **`Service.TemperatureSensor` (outdoor)** when an `*outdoor*temp*` sensor is exposed. Hide with `disableOutdoorTempSensor`.
- **Eve.Energy power consumption** characteristic (`E863F10D-...`) on the climate accessory when a `*power*` sensor is exposed. Includes optional `fakegato-history` integration for Eve.app graphs. Hide with `disablePowerSensor`.
- **Beeper Switch** when the device exposes a `Switch` entity matching `*beeper*`. Hide with `disableBeeperSwitch`.
- **Display Toggle Switch** when the device exposes a `Button` entity matching `*display*`. Auto-resets to off after each tap (the underlying ESPHome entity is a stateless Button). Hide with `disableDisplaySwitch`.
- **DRY-mode Switch.** Companion `Service.Switch` on devices that advertise `ESP_MODE.DRY (5)`. Toggling ON sets the AC to DRY mode; toggling OFF restores the previous primary mode (HEAT/COOL/AUTO), or OFF if the device had no prior primary mode. Hide with `disableDryMode`.
- **FAN_ONLY-mode Switch.** Same pattern as DRY for `ESP_MODE.FAN_ONLY (4)`. Hide with `disableFanOnlyMode`.
- **`StatusActive` and `StatusFault` characteristics** on the climate service. Mirror the ESPHome client's connected/disconnected events: `StatusFault` flips to `GENERAL_FAULT` (red badge in HomeKit) when the device drops, and back to `NO_FAULT` on reconnect.
- **`FirmwareRevision` accessory characteristic** populated from the ESPHome `deviceInfo.esphomeVersion` field.
- **`lib/discovery.js`** — wraps the upstream `Discovery` class with a Promise-based API plus `prettyNameFromHostname` helper for naming auto-discovered devices.
- **`lib/classifyEntity.js`** — pure helper that maps ESPHome entities to HomeKit-service slots by name/objectId pattern. Unit-tested.
- **`lib/eve.js`** — Eve.Energy custom characteristic factory with HAP-NodeJS Formats/Perms fallback chain (handles HB 2.0 / HAP-NodeJS 2.x removal of static accessors).
- **`fakegato-history` dependency** at `^0.6.7`. Best-effort at runtime — `lib/DeviceAccessory.js` `try/catch`-wraps the `require` and disables history quietly if the module is unavailable.
- **`jest` test suite (78 tests).** Covers `lib/state.js` (mode mappers, fan conversions, swing defaults, capability checks), `lib/classifyEntity.js` (entity classification + bundling), and `lib/discovery.js` (hostname formatting + dedupe). `npm test` runs them.
- **`pickAutoMode`, `supportsCool`, `supportsHeat`** helpers in `lib/state.js` — encode the rule "AUTO and HEAT_COOL are interchangeable for HomeKit's AUTO target state".
- **`CLAUDE.md`, `AGENTS.md`, `ROADMAP.md`, `QA_TESTS.md`, this `CHANGELOG.md`** — full warmup-style doc set covering project memory, milestone plan, manual pre-release checklist.

### Fixed

- **`HEAT_COOL (1)` vs `AUTO (6)` confusion.** The original code only handled ESPHome mode 6 (`AUTO`) when filtering valid HomeKit target states and when sending the AUTO command. Many AC devices (visible in real SLWF-01Pro web UIs) advertise `HEAT_COOL` (1) instead — so the HomeKit AUTO button would either not appear or send a mode the device couldn't honor. `pickAutoMode(supportedModesList)` now picks `AUTO` when supported, falling back to `HEAT_COOL`. `supportsCool/Heat` also recognize `HEAT_COOL` as implying both directions.
- **Multi-device commands could be lost.** `stateManager.js` used a module-level `sendTimeout` shared across every configured ESPHome device. The debounce timer is now per-device (`that._sendTimeout`).
- **Crash on disconnected device.** `stateManager.sendState` referenced an undefined `log` symbol — every send to a disconnected device threw `ReferenceError: log is not defined` instead of returning a clean HomeKit "Not Responding". Now uses `that.log.error` and rejects with `HapStatusError(SERVICE_COMMUNICATION_FAILURE)`.
- **Stacked `connected`/`disconnected` listeners.** Listeners were attached *inside* the `entity.once('state', …)` callback in `esphome.js`. Now attached at platform scope, exactly once per `Client`. Initialization is gated on the `Client` `initialized` event so the entire entity bundle is available, not just whatever happened to arrive first.
- **Plugin registered as a static platform instead of dynamic.** `api.registerPlatform(name, alias, Class)` was missing the trailing `true` flag. Added.
- **`package.json` `repository.url` pointed to upstream.** Would break npm sigstore provenance on publish (HTTP 422). Now points to the fork's GitHub URL.
- **`HeaterCooler.updateState` mutated incoming state** when clamping `targetTemperature`. Replaced with a non-mutating `clampTargetTemperature(value)` helper.
- **Lint errors.** Two indentation mismatches in the original `lib/HeaterCooler.js` resolved; the file itself was retired in favour of `lib/DeviceAccessory.js`.

### Fixed (post-review cleanup)

Three independent code-review passes (general bug-hunt, HomeKit/ESPHome semantics, docs/handoff) surfaced the following correctness issues that were addressed before tagging 0.1.0:

- **`climateCommandService(that.state)` was sending all state fields including stale `target_temperature_low/high = 0` and `legacy_away = false` on every command.** Critical for HEAT_COOL-mode devices, where this would actively overwrite the device's heat/cool band to `[0, 0]` on each user interaction. `lib/stateManager.js` now builds a clean payload with only the fields actually mutated by the current `.onSet` cycle (tracked via `markDirty`), plus the entity `key`.
- **`pruneOrphanedAccessories` ran with an empty live-host set when auto-discovery returned zero devices.** A transient mDNS failure (Wi-Fi blip, router reboot) would silently unregister every cached HomeKit accessory — losing room assignments and automations. The plugin now keeps cached accessories when discovery fails (with a clear error log) and only prunes when it has positive evidence the device list is genuinely empty.
- **`Active` characteristic initialised to ON for a freshly-loaded OFF device** because `state.mode === undefined` made `state.mode !== 0` evaluate to `true`. Replaced with an explicit `isModeActive(mode)` helper.
- **Empty `validValues` array for HeaterCooler `TargetHeaterCoolerState`** when a device's `supportedModesList` had no HEAT/COOL/AUTO/HEAT_COOL primary modes (e.g. DRY+FAN_ONLY-only). HAP-NodeJS rejects empty validValues. Now falls back to `[AUTO]` so the accessory still serializes.
- **`client.once('initialized')` skipped re-initialization** if the user added a new ESPHome entity (fresh YAML flash) and the device reconnected. Switched to `client.on('initialized')` with a per-client `initialized` flag.
- **ESPHome's `missingState` flag was ignored** — a sensor reporting `missingState: true` (no reading available) decoded to `state.state = 0` and the plugin published `0%`/`0°C`/`0W`. New `readSensorValue` helper checks `missingState` and `Number.isFinite` before returning a value.
- **DRY/FAN_ONLY OFF-toggle defaulted to COOL** even on a fresh device that had never been in a primary mode. Now snapshots `accessory.context.preSupplementaryMode` when entering DRY/FAN_ONLY and falls back to OFF if no prior primary mode was recorded.
- **Display Toggle Switch fired on both ON and OFF taps.** The HomeKit Switch's `.onSet(value)` handler ignored `value` and called `Button.push()` unconditionally. Now: if `!value`, return early; the toggle is one-way (auto-resets to off after 250 ms).
- **HumiditySensor add/remove subtype mismatch.** `addService(..., 'humidity')` used a subtype, but `getService(...)` lookup didn't — could match the wrong service if multiple were ever present. Now uses `getServiceById(..., 'humidity')` consistently with the other optional services.
- **`fakegato-history`'s reaction to NaN sensor data.** Same `readSensorValue` guard prevents NaN from making it into Eve.app's history series.
- **`getCharacteristic(eve.CurrentPowerConsumption)` already auto-adds.** The `existing || addCharacteristic(...)` ternary in `attachPowerCharacteristic` was dead code (the second branch could never run). Cleaned up.
- **`SwingMode` and `RotationSpeed` setters** now dedupe identical values (early-resolve when target equals current) — matches the existing pattern used by `Active`/`TargetHeaterCoolerState`/temperature thresholds, avoids spurious roundtrips.
- **`setConnectedStatus` race during accessory construction.** Wrapped in try/catch + service-presence guard, so a disconnect during the brief window between `'initialized'` and the constructor finishing won't crash the platform.
- **Unused `TotalConsumption` Eve characteristic** removed from `lib/eve.js` — kWh totalisation isn't implemented and the dead export was misleading.

### Changed

- **`lib/HeaterCooler.js` retired; replaced by `lib/DeviceAccessory.js`.** The class is now a multi-service composer rather than a climate-only wrapper. Service-binding methods are split: `addClimateService`, `addOptionalSensorServices`, `addOptionalSwitchServices`, `addModeSwitchServices`, `removeDisabledServices`. Cached service cleanup is honored — disabling a flag on a previously-enabled service unregisters the service on next launch.
- **`lib/esphome.js` rewritten async.** Orchestrates manual `devices[]` + auto-discovered devices (deduped by host); spawns a `Client` per device; waits for the Client's `initialized` event; routes connected/disconnected events into `setConnectedStatus(bool)` on the accessory.
- **`fanSpeedToFanMode` / `fanModeToSpeed` are inverses.** Previously the conversion only existed for HomeKit-set → ESPHome direction; the reverse was inlined ad-hoc and inconsistent. Both directions live in `lib/state.js` now.
- **`engines.node` raised to `^18.20.4 || ^20.15.1 || ^22.0.0 || ^24.0.0`.** Old `>=18.0.0` allowed long-EOL Node 18 patch releases.
- **`engines.homebridge` widened to `^1.8.0 || ^2.0.0`.**
- **`displayName` added to `package.json`** as "Homebridge SLWF-01Pro / ESPHome AC".
- **`package.json` `description`** updated from inherited upstream wording to mention SLWF-01Pro and the multi-entity feature set.
- **`package.json` `funding`** block (PayPal / Patreon / Ko-fi pointing at the original author) removed; donations should not flow to a maintainer who isn't shipping the fork.
- **`package.json` `files`** array added to scope what `npm publish` ships — prevents `test/`, `CLAUDE.md`, `ROADMAP.md`, `QA_TESTS.md`, and `.claude/` from leaking into the published tarball.
- **`.gitignore`** replaced with a minimal Node-only ignore set; the inherited Xcode/iOS boilerplate from upstream is gone.
- **README rewritten** with SLWF-01Pro device context (hardware revisions, supported AC brands, ESPHome-specific quirks like intake-mounted sensor inaccuracy and `midea_ac.follow_me`), full configuration reference, troubleshooting, and child-bridge recommendation.

### Internal

- `Service` and `Characteristic` lookups hoisted to module scope in `DeviceAccessory.js` (set once on first construction).
- `index.js` `log.easyDebug` now uses `Array#map` + `Array#join` instead of `Array#reduce` string concatenation; mixed string + object arguments stringify cleanly.
- `SET_DEBOUNCE_MS` / `ACTIVE_BATCH_MS` / `TEMP_BATCH_MS` are named constants instead of magic numbers.

---

## [0.0.4] — pre-fork (upstream `nitaybz/homebridge-esphome-ac`)

The point at which this fork was taken. Upstream history below is preserved for context.

### Fixed (in upstream)

- Bug fixes (commit `7ce4654`).
- `set` commands changed to return promises (commit `5a1930d`) — switched from `.on('set', cb)` to `.onSet(async)`.
- Removed stray `%` from swing log line (commit `0cf6d7d`).
- Stable per-entity unique id used for HomeKit UUID instead of host (commit `f4461f0`).

### Initial release (upstream)

- ESPHome native-API integration via `@2colors/esphome-native-api`.
- HomeKit `Service.HeaterCooler` exposing Active, Current/TargetHeaterCoolerState, CurrentTemperature, Heating/CoolingThresholdTemperature, SwingMode, RotationSpeed.
- Auto-discovery of climate-entity capabilities (modes/fan modes/swing modes/visual temp range).
- `config.schema.json` for the Homebridge UI.
- One platform-level `debug` flag.

# Changelog

All notable changes to `homebridge-SLWF-01Pro` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This package is a maintained fork of [`homebridge-esphome-ac`](https://github.com/nitaybz/homebridge-esphome-ac). Pre-fork history below is the upstream history, kept for context.

---

## [0.3.1] — 2026-05-06

Hotfix for "Out of compliance" error when adding the bridge to Apple Home.

### Fixed

- **Apple Home flagged the child bridge as "Out of compliance" during pairing.** Root cause: `DeviceAccessory` was constructed immediately on the ESPHome client's `'initialized'` event, but ESPHome state messages may not have arrived yet at that moment. Required HomeKit characteristics like `CurrentTemperature`, `CoolingThresholdTemperature`, and `HeatingThresholdTemperature` got `.updateValue(undefined)` calls. When Apple Home read the accessory tree during pairing, those characteristics returned `null` instead of valid floats — Apple's HAP validator rejects this as malformed metadata and refuses to pair.

  Three layers of defense applied:
  1. **Wait for first state event** — `lib/esphome.js` now defers `DeviceAccessory` construction until the climate entity has emitted at least one `'state'` event (5 s timeout fallback). For most devices this adds < 100 ms to startup; for slow-responding devices the warning logs and we proceed with safe defaults.
  2. **Safe defaults at construction** — `addClimateService()` substitutes the visual-min/max-temperature midpoint for `CurrentTemperature` and `visualMinTemperature` for the threshold characteristics if state is still missing (defense in depth).
  3. **`safeUpdate(characteristic, value)` helper** — wraps every characteristic update; skips the call entirely when value is `null` / `undefined` / `NaN` / `Infinity`.

- **`FirmwareRevision` validation.** HAP requires the format `\d+(\.\d+){0,2}` (e.g. `2024.7.3`). ESPHome's `esphomeVersion` sometimes carries suffixes like `-dev` or `-beta`, which would have produced an invalid characteristic value. New `sanitizeFirmwareRevision(raw)` helper strips anything past the SemVer prefix; if the prefix doesn't match, the characteristic is omitted (Apple Home falls back to the plugin version).

- **Primary service marked explicitly.** `addClimateService()` now calls `setPrimaryService(true)` on the `Service.HeaterCooler`. With companion DRY/FAN_ONLY/Beeper/Display Switch services on the same accessory, the absence of an explicit primary previously left the choice up to HAP-NodeJS — Apple Home iOS 16+ is stricter about this and could pick a Switch as primary, leading to a confusing accessory tile in Home.

### Internal

- New constants: `FIRST_STATE_TIMEOUT_MS = 5000` in `lib/esphome.js`.
- New helpers: `isPresent(value)`, `safeUpdate(characteristic, value)`, `sanitizeFirmwareRevision(raw)` in `lib/DeviceAccessory.js`.

---

## [0.3.0] — 2026-05-06

Final piece of the "fully independent plugin" story: HomeKit UUIDs are now namespaced so this plugin can run **alongside** upstream `homebridge-esphome-ac` (or any other plugin that hashes from the same ESPHome `unique_id`) on the same Homebridge bridge without UUID collisions.

### ⚠️ Breaking — accessories will re-pair

The UUID input is now `homebridge-slwf-01pro:<deviceId>` instead of bare `<deviceId>`. The same device gets a new UUID under this plugin → Apple Home treats it as a new accessory. **You'll lose room assignments, scenes, and automations** wired to the old accessory tiles. They need to be re-set up in Apple Home after the upgrade.

The plugin **automatically evicts** old-schema cached accessories on startup (no manual cleanup required) and registers fresh ones with the new UUIDs.

### Why

Before 0.3.0, both upstream and this fork derived HomeKit UUIDs from `entity.config.uniqueId` (or its fallback). For a user with both plugins running in the **same** Homebridge bridge (not child-bridged) and both auto-discovering the same physical AC:

- Upstream registers UUID `abc-123` for "Air Conditioner"
- Our fork tries to register UUID `abc-123` too
- HomeKit rejects the second one (UUID collision within a bridge)

Child bridges (which the user is using) insulate against this — each child bridge is its own HomeKit instance — so the bug is theoretical for child-bridge users. But for users who run plugins on the main Homebridge bridge, the fix is mandatory. And it costs nothing to apply universally.

After 0.3.0, the two plugins produce **deterministically different UUIDs** for the same device. Both can be installed on the same Homebridge with full auto-discovery enabled and no interaction.

### Added

- **`accessory.context.schemaVersion`** — stamped on every accessory created or restored. Currently `2` (1 was the unstamped pre-0.3.0 schema). Future schema breakages bump this number.
- **`evictStaleSchemaAccessories(platform)`** in `lib/esphome.js` — runs first thing in `init()`. Walks `platform.staleAccessories` (populated by `configureAccessory` for entries with the wrong schema version) and unregisters them in one batch via `api.unregisterPlatformAccessories`. Clean cache transition with no manual user action.
- **`UUID_NAMESPACE = 'homebridge-slwf-01pro'`** constant in `lib/DeviceAccessory.js`. Prefixed onto the device id before hashing.

### Changed

- **HomeKit UUID input format**: `homebridge-slwf-01pro:<deviceId>` (was bare `<deviceId>`). For devices with `unique_id` set in YAML, the old UUID was the same as upstream's; now ours is distinct. For devices without `unique_id` (the SLWF-01Pro/Midea default), the old UUID was already MAC-based via `deriveDeviceId` (added in 0.1.2); the prefix makes it distinct from upstream regardless.
- **`configureAccessory` in `index.js`** now diverts schema-mismatched cached entries to `this.staleAccessories` and emits a warning. The init flow evicts them before doing anything else.

### Migration

For anyone on `homebridge-slwf-01pro@0.2.x` or earlier:
1. `sudo npm install -g homebridge-slwf-01pro@latest`
2. Restart Homebridge.
3. The log shows `Evicting N cached accessor… from an older plugin schema. They will be re-registered fresh with stable UUIDs.` Old accessories disappear from Apple Home; new ones appear with the same names but no automations attached.
4. Re-add the new accessories to your Apple Home rooms / scenes / automations.

For anyone migrating from upstream: same as 0.2.0 (config.json edit `"ESPHomeAC"` → `"SLWFOnePro"`), plus the same UUID-driven re-pairing.

---

## [0.2.0] — 2026-05-06

Clean separation from upstream `homebridge-esphome-ac`. Breaking config change (one-line edit) but eliminates all namespace collision risk.

### ⚠️ Breaking — config.json edit required

The Homebridge platform identifier has been renamed from `"ESPHomeAC"` (shared with upstream) to **`"SLWFOnePro"`** (ours alone). Update your `config.json`:

```diff
- "platform": "ESPHomeAC",
+ "platform": "SLWFOnePro",
```

Restart Homebridge after the edit. The plugin detects orphaned cached accessories from the old identifier and logs a clear warning with cleanup instructions on first start.

### Why

Before 0.2.0, the platform identifier was shared with upstream `homebridge-esphome-ac` for "drop-in migration" compatibility. In practice this caused two real problems:

1. **Cache collisions** — when both plugins were ever installed in the same Homebridge (even temporarily during a migration), accessories cached under upstream's plugin name became orphans that no live plugin claims, but the platform identifier overlap made it ambiguous which plugin "owned" them.
2. **Confusing logs** — Homebridge's startup log lists all installed platforms by `<plugin>.<platformName>`. Both plugins claiming `ESPHomeAC` made the dependency graph unreadable.

After 0.2.0, the two plugins are completely independent: separate npm names, separate platform identifiers, no shared state. Both can coexist on the same Homebridge without interfering.

### Added

- **`detectOrphanedAccessories(platform)` in `lib/esphome.js`.** Best-effort scan of the bridge's `cachedAccessories.<bridgeId>` files at startup. Warns about:
  - Accessories cached under upstream `homebridge-esphome-ac`
  - Accessories cached under our plugin name but the **legacy** `ESPHomeAC` platform identifier (i.e. pre-0.2.0 entries left after the rename)
  Both warnings include explicit cleanup paths (Homebridge UI step + filesystem path). Best-effort — wrapped in try/catch, never throws, falls through silently if the cache directory doesn't exist or files are malformed.

### Changed

- **Platform identifier `ESPHomeAC` → `SLWFOnePro`** in `index.js` `PLATFORM_NAME`, `config.schema.json` `pluginAlias`, `config-sample.json`, README, CLAUDE.md, QA_TESTS.md.
- **Upstream git remote removed** (`git remote remove upstream`). The fork is intentionally divergent. CLAUDE.md fork rules updated; if anyone needs upstream history they can re-add the remote ad-hoc.

### Migration

For anyone on `homebridge-slwf-01pro@0.1.x`:
1. `sudo npm install -g homebridge-slwf-01pro@latest`
2. Edit `config.json`: `"platform": "ESPHomeAC"` → `"platform": "SLWFOnePro"` (and the `name` field if you used the default).
3. Restart Homebridge.
4. Log will warn about the orphaned 0.1.x cached accessories. Clean via Homebridge UI → Settings → Remove Single Cached Accessory.

For anyone migrating from upstream `homebridge-esphome-ac`:
1. `sudo npm uninstall -g homebridge-esphome-ac && sudo npm install -g homebridge-slwf-01pro`
2. Same `config.json` edit as above.
3. Restart. Log warns about upstream's orphaned cache entries. Clean via UI.

---

## [0.1.2] — 2026-05-06

Critical bug fix surfaced by the first real-hardware test of 0.1.0/0.1.1.

### Fixed

- **All accessories failed to initialize** with `The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received undefined`. Root cause: `lib/DeviceAccessory.js` derived its accessory UUID from `climate.config.uniqueId`, but ESPHome doesn't auto-populate `unique_id` on the `midea_ac` climate component when the YAML doesn't set it explicitly — `config.uniqueId` came through as `undefined`, and `api.hap.uuid.generate(undefined)` threw the cryptic Buffer error. The plugin now uses a fallback chain: `uniqueId` → `<macAddress>-<objectId>` → `<macAddress>-climate` → `<host>-<objectId>` → `<host>-climate` → `esphome-climate-<key>`. For users with `unique_id` set in YAML, the UUID is unchanged (no re-pairing). For users without it (the 0.1.0 failure mode), the UUID becomes stable per-device via the MAC address.
- Reproduction: 6 SLWF-01Pro dongles flashed with stock ESPHome `midea_ac` YAML (no manual `unique_id`), all six failed identically. Verified fixed against the same setup.

### Added

- `deriveDeviceId(...)` pure helper in `lib/state.js` — fully unit-tested (9 new test cases covering each branch of the fallback chain).

### Internal

- 87 unit tests now pass (up from 78).

---

## [0.1.1] — 2026-05-06

Workflow-only patch.

### Fixed

- **`release.yml` `Create GitHub Release` step crashed on multi-line CHANGELOG content.** The 0.1.0 release workflow successfully published to npm but the GitHub Release step failed because the extracted release notes were inlined into the bash command via `--notes "${{ ... }}"`, where the shell parsed `*` (glob), `[…]` (bracket expansion), backticks (command substitution), `/` (path lookup) etc. as commands — producing dozens of `command not found` errors and exiting non-zero. (The 0.1.0 GitHub Release was created manually as a recovery.) The step now writes the extracted notes to `release-notes.md` and passes `--notes-file release-notes.md` to `gh release create`. No shell interpolation, no metacharacter risk. This release is the end-to-end validation that the fix works.

### Internal

- No code or config changes for users — `homebridge-slwf-01pro@0.1.1` and `@0.1.0` are functionally identical. Patch bump documents the workflow fix and gives the next release a clean release-notes path.

---

## [0.1.0] — 2026-05-06

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
- **GitHub Actions CI workflow** (`.github/workflows/ci.yml`) — lint + unit tests + smoke on Node 18.20.4, 20.15.1, 22.x, 24.x for every push and PR.
- **GitHub Actions release workflow** (`.github/workflows/release.yml`) — tag-driven (`v*`); verifies the tag matches `package.json` version, runs lint + tests, publishes to npm with `--provenance`, extracts release notes from CHANGELOG and creates a GitHub Release.

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
- **npm package renamed** from inherited `homebridge-esphome-ac` to **`homebridge-slwf-01pro`** to avoid colliding with the upstream package on the npm registry. The Homebridge platform identifier in users' `config.json` (`"platform": "ESPHomeAC"`) is unchanged for migration compatibility — only the install command differs (`sudo npm uninstall -g homebridge-esphome-ac && sudo npm install -g homebridge-slwf-01pro`).
- **`PLUGIN_NAME` constant in `index.js`** updated to match the new npm name. Existing users of upstream `homebridge-esphome-ac@0.0.4` will see their cached accessories re-pair on first launch (the HomeKit UUIDs are still derived from `entity.config.uniqueId` so they reattach to the same Home app tile).
- **LICENSE** preserves the original 2020 Nitay Ben Zvi MIT copyright + adds the 2026 Karol Nowacki fork copyright.
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

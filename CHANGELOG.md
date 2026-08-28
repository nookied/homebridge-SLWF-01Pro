# Changelog

All notable changes to `homebridge-SLWF-01Pro` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This package is a maintained fork of [`homebridge-esphome-ac`](https://github.com/nitaybz/homebridge-esphome-ac). Pre-fork history below is the upstream history, kept for context.

---

## [1.0.0] — 2026-08-28

First stable release. The public API — the `SLWFOnePro` platform identifier, every config key, and the HomeKit accessory shape — is what 0.5.x already shipped, so upgrading needs no config changes. From here the project follows strict [SemVer](https://semver.org/).

This release is also the cleanup pass done in preparation for a [Homebridge Verified](https://github.com/homebridge/plugins/wiki/Verified-Plugins) application: unhandled exceptions are contained, config and diagnostic entities can no longer reach HomeKit, history is written under the Homebridge storage directory, and the repository now has issues enabled with templates.

**Node 18 and 20 are no longer supported** — see Changed below.

### Fixed

- **Turning the Dry or Fan Only switch on and back off no longer starts an AC that was off.** The mode to restore was only recorded when leaving a primary mode (COOL/HEAT/AUTO/HEAT_COOL), so an AC that was **off** had nothing recorded and fell through to the cached `lastTargetState` — typically `COOL`. Toggling the switch twice therefore left the AC cooling instead of off. `OFF` is now recorded as a restore target, and the restore reads it with an explicit null check rather than a truthiness test (`ESP_MODE.OFF` is `0`, which the old `||` treated as "nothing recorded"). A stale restore target left in the accessory cache by an earlier session is also cleared at startup unless the device really did come back up in DRY or FAN_ONLY.
- **Eve energy history now actually works.** `fakegato-history` exports a *factory* that must be called with the Homebridge api; the plugin was calling `new` on the factory itself, which set fakegato's internal homebridge reference to the string `'energy'` and then threw on `homebridge.hap`. The throw was caught and logged at debug level, so the history service was never created and no one was told — Eve showed live wattage but never a graph. The factory is now invoked correctly, and a failure here logs a warning instead of disappearing. History is written under `homebridge.user.storagePath()`, as Homebridge requires of plugins that persist to disk.
- **The fan-speed slider no longer reports values HomeKit can't select.** Each fan mode now sits on an evenly spaced anchor with the slowest at 0% and the fastest at 100%, and `RotationSpeed.minStep` is the coarsest step that lands on every one of them. Previously a mode was reported at the *top* of its band (computed with `ceil`) while `minStep` was sized with `floor`, so on a device advertising `[LOW, MEDIUM, HIGH]` every reachable slider position snapped somewhere else (0→34, 33→34, 66→67, 99→100) and 100% could not be selected at all. On the common `[AUTO, LOW, MEDIUM, HIGH]` list, 0% now means AUTO in both directions instead of jumping to 25%.
- **A custom fan mode no longer resets the fan speed.** Midea devices report `silent`/`turbo` outside `supportedFanModesList`; the plugin mapped anything unrecognised to 0%, which read back as the first mode. Unknown modes now leave the HomeKit value untouched.
- **Config and diagnostic entities can no longer reach HomeKit.** Companion entities are now refused unless ESPHome reports `entityCategory: 0`, and refused outright for the `restart`/`reboot`/`update`/`identify` device classes or when the ESPHome config marks them `disabledByDefault`. Real SLWF-01Pro firmware exposes a `Factory reset` button (config category, `restart` class) right next to the `Display Toggle` button the plugin does map; previously only the absence of the word "display" in its name kept it out of the Home app.
- **A failure inside an ESPHome state listener can no longer escape.** Those events arrive outside any HomeKit call stack, so a throw became an unhandled exception. Every listener the accessory attaches is now wrapped, logged and contained. `updateClimateState` also ignores a malformed payload rather than adopting it — `state` is what outgoing commands are built from, so assigning `null` would have poisoned the next write too.
- **One unreachable device no longer floods the log.** The client retries a dropped connection every few seconds, and each failure was logged at error level — an AC that leaves the network for ten minutes produced around sixty identical `getaddrinfo ENOTFOUND` lines, and one offline overnight would produce thousands. The first failure is still logged; identical repeats drop to debug level until the error changes or the device returns, and the reconnect message then reports how many attempts failed.
- **Fan speed and swing now track the device in DRY and FAN_ONLY.** The supplementary-mode update path refreshed only Active / Target / Current state, so a fan-speed change made at the AC itself never reached HomeKit while in FAN_ONLY — the one mode where fan speed is the entire function.

### Changed

- **`fakegato-history` is now an optional peer dependency rather than a dependency.** It hard-depends on `googleapis` (~194 MB) for a Google Drive storage backend this plugin never uses, and that tree was the source of the package's only production security advisory. npm no longer installs it automatically. Live power readings are unaffected; only Eve.app's history graph needs it, and the plugin now logs a one-time notice explaining how to install it when power monitoring is enabled without it. Since `disablePowerSensor` defaults to `true`, this changes nothing for the large majority of installs.
- **Node 18 and 20 are no longer supported.** `engines.node` is now `^22.0.0 || ^24.0.0 || ^26.0.0`. Both dropped versions reached end-of-life (April 2025 and April 2026), and eslint 10 requires Node >= 20.19 in any case. CI now covers Node 22 / 24 / 26.
- **Minimum `@2colors/esphome-native-api` raised to `^1.3.6`.** The declared floor was `^1.2.3` while the lockfile pinned 1.2.3, so CI had been testing a client three years older than the one users actually resolved to. The API surface this plugin uses is unchanged between the two.

### Internal

- **Releases now publish to npm via GitHub OIDC [trusted publishing](https://docs.npmjs.com/trusted-publishers) instead of a long-lived `NPM_TOKEN`.** The stored token was last written 2026-05-24 and Granular Access Tokens cap at 90 days, so it had already expired; the next tagged release would have failed with a misleading `404 Not Found - PUT` (npm reports dead auth as a missing package). Trusted publishing has no expiry and no stored secret, and emits the provenance attestation itself, so `--provenance` was dropped. The release job also moved from a pinned Node `22.x` to `lts/*`, since trusted publishing needs npm >= 11.5.1 and Node 22 ships npm 10. No change to the published package.
- **`release.yml` gained a manual auth probe.** `workflow_dispatch` re-publishes the already-published version so npm runs the full OIDC exchange and then rejects the upload as a duplicate, proving the release path works without releasing anything. A guard refuses to run unless that version is already on the registry.
- **Tooling refresh:** eslint 8 → 10 (with the `.eslintrc.json` + `.eslintignore` pair replaced by a flat `eslint.config.mjs`), jest 29 → 30, and GitHub Actions `checkout`/`setup-node` v4 → v7 (v4 targets the deprecated Node 20 runtime). `npm audit` now reports **0 vulnerabilities**, down from 5 (3 high, 1 moderate, 1 low).
- Declared the `supports-hap` keyword, enabled GitHub Issues (they had been disabled, which on its own would have blocked verification) and added bug-report/feature-request templates.
- Corrected a long-standing hardware claim in the docs: **all three SLWF-01Pro revisions are ESP8266 `esp12e` boards**, not just v1.1/v1.2. Verified against SMLIGHT's official ESPHome configs, where both YAMLs declare `esp8266: board: esp12e`. README gains a *Dongle firmware* section covering flashing, the self-updating `update: http_request` component in current SMLIGHT firmware (project 2.4), and why this plugin does not and will not flash firmware itself.
- Added `test/unit/modeSwitch.test.js` and `test/unit/clientOptions.test.js`; the latter pins `clearSession: false`, which is load-bearing for reconnect behaviour and was previously uncovered. 206 tests across 12 suites, with the fake HAP shim extracted to `test/helpers/hapShim.js` and `classifyEntity` checked against an entity list captured from live hardware.

---

## [0.5.7] — 2026-05-24

### Fixed

- **Apple Home ⚠️ warning no longer depends on fragile `StatusFault` cache clearing.** Versions 0.5.4–0.5.6 tried to clear stale `StatusFault` values with delayed forced HAP events, but Apple Home can still miss those events when a HomePod/iPhone subscribes later or keeps an older characteristic cache. The plugin now stops exposing optional `StatusActive` / `StatusFault` transport-health characteristics on the HeaterCooler service and removes them from cached accessories. Disconnected ESPHome clients still return a clean HomeKit communication error on writes; reconnect resumes normal control without leaving Apple Home stuck with a cached general fault.
- **Auto-discovered cached devices are no longer stranded when mDNS misses a scan.** With `autoDiscover` on, cached accessory hosts are now used as fallback connection targets when current mDNS discovery does not rediscover them, so the plugin still creates reconnecting ESPHome clients instead of keeping Apple Home identity while leaving the runtime unbound. The cached native API port is stored from this version onward.
- **Supplementary DRY/FAN_ONLY state pushes now keep HomeKit `Active` in sync.** If a device moved from OFF into a non-primary mode outside HomeKit, the fallback update path could leave `Active = 0` while the AC was actually running.

### Internal

- Bumped `ACCESSORY_SCHEMA_VERSION` to 6 so v5 cached accessories are rebuilt without the sticky transport status characteristics.
- Refactored ESPHome device-list merging around shared host/address identifiers and a single default native API port constant.
- Added regression coverage for status-characteristic removal, cached-host fallback discovery, missing mode capability lists, and supplementary-mode state pushes. 167 tests total.
- Reviewed and refreshed project documentation for the 0.5.7 behavior: schema v6, cached-host fallback, release workflow, and Homebridge Verified requirements.
- Consolidated the old pairing handoff into the maintained docs: added `DOCS.md` as the documentation index/update process, deleted `HANDOFF.md`, and kept live pairing diagnostics in `QA_TESTS.md`.

---

## [0.5.6] — 2026-05-24

### Fixed

- **Fault indicator (⚠️) could persist after reconnect.** The 0.5.5 reconnect path cleared `StatusFault` via `updateValue`, which only notifies currently-subscribed HAP controllers. A HomePod or iPhone that re-established its HAP session after the immediate notification window (e.g. during the same brief outage that dropped the SLWF-01Pro) would keep the stale `GENERAL_FAULT` in its cache and continue showing ⚠️ even after the device was healthy. The reconnect clear now also schedules a delayed `sendEventNotification` — the same 3-second forced-push already used by the startup clear — so late-subscribing controllers receive the cleared state. A rapid disconnect-reconnect-disconnect cycle is safe: the pending timer is cancelled when the subsequent disconnect fires.

### Internal

- Added regression coverage for the reconnect forced-event clear and the guard that prevents a false-healthy push when the device disconnects again before the timer fires. 162 tests total.

---

## [0.5.5] — 2026-05-13

### Fixed

- **Startup fault clear now uses a forced HAP event.** The 0.5.4 delayed startup clear used `updateValue(NO_FAULT)`, but HAP-NodeJS only notifies HomeKit subscribers when `updateValue` changes the stored value. Because the service had already been initialized as healthy, the delayed same-value clear could still be silent. The delayed startup clear now calls `sendEventNotification` when available, falling back to `updateValue` for older HAP surfaces.
- **`package-lock.json` version is synced with `package.json`.** The 0.5.4 version bump updated `package.json` but left the lockfile root metadata at 0.5.3.

### Internal

- Added regression coverage proving the delayed startup fault clear forces an event even when `StatusFault` is already `NO_FAULT`. 160 tests total.

---

## [0.5.4] — 2026-05-13

### Fixed

- **Fault indicator (⚠️) no longer persists after a Homebridge restart.** Apple Home subscribes to HAP events asynchronously after the bridge starts; when a device had a fault from the previous session, the startup `StatusFault = NO_FAULT` push arrived before Apple Home subscribed and was silently missed, leaving the ⚠️ visible until the user manually interacted with the tile. A 3-second delayed re-push (`STARTUP_FAULT_CLEAR_DELAY_MS`) after accessory construction ensures the cleared state reaches Apple Home once it has subscribed.
- **Fault indicator no longer flashes on transient standby disconnects.** ESPHome dongles that briefly lose their TCP connection when the AC unit enters standby would immediately set `StatusFault = GENERAL_FAULT`. A 15-second grace period (`DISCONNECT_FAULT_DELAY_MS`) now absorbs brief drops: if the device reconnects within the window, no fault is ever shown. Persistent disconnects (> 15 s) still correctly surface the fault. Both new timers call `.unref()` so they don't prevent clean process exit.

---

## [0.5.3] — 2026-05-06

### Fixed

- **Heat-only / auto-only devices no longer restore an unsupported COOL mode when turned back on.** `chooseInitialTargetMode` now considers `supportedModesList`, and `Active` uses that helper for cached restore modes too.
- **External or stale HomeKit writes for unsupported HEAT/COOL target states are ignored** instead of sending unsupported ESPHome modes.
- **Newly-enabled companion services on cached accessories now get `ConfiguredName` seeded.** Existing Apple Home renames are still preserved, but services that did not exist in the cache yet no longer start with a blank ConfiguredName.
- **Hostless manual device entries are non-destructive.** Empty Homebridge UI form scaffolding is dropped before orchestration, and real but invalid manual entries now keep cached accessories instead of allowing orphan pruning while the config is incomplete.
- **Main current-temperature updates are clamped to the HAP-safe range** before writing to `CurrentTemperature`.
- **Linked services are not re-linked redundantly** when the service is already present in HAP-NodeJS's `linkedServices` list.

### Internal

- Added regression coverage for capability-aware restore modes, cached-service `ConfiguredName` seeding, current-temperature clamping, manual-device filtering, and invalid-config prune protection. 159 tests total.

---

## [0.5.2] — 2026-05-06

### Fixed

- **Phantom "Skipping device without host" warnings on every restart.** The Homebridge UI form, under the 0.4.x schema that defaulted every per-device `disable*` flag to `false`, would persist empty device rows containing those defaults whenever a user opened the Settings page without filling in a row. The plugin then logged each such row as `error` on every restart (e.g. 68 noise lines in a real user log). Empty form-template rows (no `host`, no `name`, no `encryptionKey`) are now silently dropped. Real misconfigurations — a named device or one with an encryption key but no host — still log a `warn` (downgraded from `error`).

### Internal

- New `lib/esphome.js looksLikeRealEntry(device)` helper distinguishes form scaffolding from genuine misconfigurations; covered by `test/unit/looksLikeRealEntry.test.js` (5 tests). 149 tests total.

---

## [0.5.1] — 2026-05-06

### Fixed

- **User-chosen device names in Apple Home now persist across Homebridge restarts.** Previously, `setConfiguredName` ran for every service on every accessory build (cache-loaded or fresh), so renaming "Living Room AC" → "Bedroom AC" in Apple Home reverted to the config name on the next restart. Now `ConfiguredName` is only seeded for newly-created accessories; cached ones keep whatever value HAP/Apple Home has stored. Room assignment was already persistent — that's stored entirely on Apple Home's side, keyed by accessory UUID.
- **Auto-discovered devices that are temporarily offline at restart no longer get unregistered.** Previously, `pruneOrphanedAccessories` removed any cached accessory whose host wasn't in the live list (manual devices + current discovery). With `autoDiscover` on, an offline device would disappear from Apple Home along with the user's name/room/automations. Now: with `autoDiscover` on, cached accessories are kept regardless — Apple Home shows them as "Not Responding" until they reconnect, preserving identity. To remove an accessory permanently, use the Homebridge UI → Remove Single Cached Accessory action. With `autoDiscover` off, the legacy prune behaviour is preserved (accessories not in `devices[]` are unregistered, since manual config is then the source of truth).

### Internal

- New `test/unit/pruning.test.js` covers both prune branches; new ConfiguredName regression test in `hapCompliance.test.js`. 144 tests total.
- `pruneOrphanedAccessories` is now exported from `lib/esphome.js` for direct unit testing.

---

## [0.5.0] — 2026-05-06

### Changed (default UX — affects fresh installs and any config that doesn't set the relevant flag explicitly)

- **`autoDiscover` now defaults to `true`.** New installs immediately mDNS-browse the local network and register any unencrypted ESPHome AC they find. Encrypted devices still need a manual `devices[]` entry — the Noise key isn't broadcast.
- **All companion services default to hidden.** `disableHumiditySensor`, `disableOutdoorTempSensor`, `disablePowerSensor`, `disableBeeperSwitch`, `disableDisplaySwitch`, `disableDryMode`, and `disableFanOnlyMode` now default to `true`. A fresh install gets a clean Apple Home view: just one HeaterCooler tile per AC. Flip any flag to `false` (globally or per-device) to opt back into a specific extra. This also reduces the per-accessory service count, which addresses the secondary "service-count tolerance" pairing hypothesis from the 0.4.x audit work.
- **Per-device disable flags now override platform defaults in either direction.** Previously the override was a logical OR — meaning once a service was globally disabled, no per-device entry could re-enable it. Now an explicitly-set per-device flag (`true` *or* `false`) wins; otherwise the device inherits the platform default. Required for the new "hide all by default" world to be usable: you can keep the global hides and selectively re-enable a service for a single AC.

### Heads-up

- **Existing users who never set the `disable*` flags will see those companion services disappear on upgrade.** If you relied on Humidity / Outdoor Temp / Power / Beeper / Display / DRY / FAN_ONLY tiles, add the corresponding `disable*: false` entries to your platform config (or per-device).
- **Auto-discovered devices don't persist if you later turn `autoDiscover` off.** The startup pruner unregisters any cached accessory whose host isn't in the live device list, and that list comes from `devices[]` + the current discovery scan. Copy your discovered devices into `devices[]` *before* disabling discovery if you want them to stick around.

---

## [0.4.4] — 2026-05-06

### Fixed

- **Moved Eve power monitoring off the standard `HeaterCooler` service.** `CurrentPowerConsumption` now lives on a linked `Service.Outlet` named `<AC> Power` instead of being added as a custom characteristic directly to the AC's primary HeaterCooler service. This keeps the primary service shape closer to HomeKit's standard HeaterCooler definition and removes one suspected Apple Home pairing/non-compliance trigger.
- **The linked Outlet is hidden from Apple Home.** It carries `CurrentPowerConsumption` for Eve.app and other HAP-direct clients but doesn't render as a separate (toggle-only) tile in Apple Home, keeping the visible service count down — which also addresses the secondary "service-count tolerance" pairing hypothesis. The snap-back `On` handler is retained as a fallback for HAP-NodeJS versions that predate `setHiddenService`.
- **Cached legacy Eve power characteristics are removed from HeaterCooler.** `ACCESSORY_SCHEMA_VERSION` is bumped to 5 so existing accessories are evicted and rebuilt cleanly on upgrade; the runtime also removes the legacy characteristic defensively if encountered.
- **Power service state is more explicit.** The linked Outlet stays logically on, reports `OutletInUse` based on positive power draw, and continues to feed `fakegato-history` entries when available.
- **Target-temperature clamping now uses default visual bounds** when ESPHome omits `visualMinTemperature` / `visualMaxTemperature`, matching the safe bounds already used for HAP `setProps`.

### Internal

- Added HAP regression tests proving Eve power is attached to a linked Outlet service (not HeaterCooler), the Outlet is marked hidden, and stale HeaterCooler power characteristics are removed from cached accessories.

---

## [0.4.3] — 2026-05-06

(Tag `v0.4.2` exists but was never published — its release workflow failed at the lint step on a leftover unused-import in the new test file. `0.4.3` is the same content + that lint fix.)

Driven by an independent HAP-compliance audit triggered by the missing-AccessoryCategory bug. Six findings addressed with code changes plus a regression-prevention test suite specifically for the HAP integration surface.

### Fixed (high-priority HAP correctness)

- **`setProps` could receive `NaN`** if an ESPHome firmware doesn't advertise `visualMinTemperature` / `visualMaxTemperature` / `visualTargetTemperatureStep`. The plugin tried `(undefined + undefined) / 2 = NaN` for `CurrentTemperature` initial value, and `setProps({ minValue: undefined, ... })` for the threshold characteristics. HAP-NodeJS rejects `NaN` and `setProps` validates finite numbers — accessory init would silently throw inside the `try/catch` in `esphome.js`, leaving the device invisible. New defaults: `visualMinTemperature = 16`, `visualMaxTemperature = 30`, `visualTargetTemperatureStep = 0.5` if any are missing.
- **`updateClimateState` fallthrough wrote `TargetHeaterCoolerState.AUTO`** even when AUTO wasn't in the validValues array. If a device's state arrived with mode = `null` or an unrecognized value after creation, this hardcoded write violated `setProps({ validValues })` and HAP threw — silently breaking subsequent state pushes. Now reads `validValues` from the characteristic's props and uses the first valid entry as the fallback (or `AUTO` only if the array somehow comes back empty).

### Fixed (UX / log hygiene)

- **No `Identify` handler was bound on `AccessoryInformation`.** HAP-NodeJS 0.11+ logs `[HAP] Service ... has no Identify handler` at every accessory init. Apple Home's "Identify" button silently no-op'd. Now binds a logging handler so taps are visible in the log.
- **Companion Switch + Sensor services had no `ConfiguredName`.** Apple Home iOS 16+ uses `ConfiguredName` (HAP R12) for the user-rename UI. Without it, users see Apple's auto-generated names like "Switch 1", "Switch 2" instead of "Beeper", "Display". Now set on every companion service (Beeper, Display, Dry, Fan Only, Humidity, Outdoor, plus the primary HeaterCooler) using HAP's `addOptionalCharacteristic` mechanism with a `testCharacteristic` guard.
- **`Characteristic.Name` on `AccessoryInformation`** was relying on HAP-NodeJS's auto-seeding from displayName. Now set explicitly for defensive correctness.
- **`RotationSpeed` had no `minStep`** so the fan slider snapped on each percentage. Now sets `minStep = floor(100 / fanModesCount)` so the slider lands cleanly on each discrete fan-mode position.

### Internal

- **`ACCESSORY_SCHEMA_VERSION` consolidated** into `lib/constants.js` as a single source of truth. Previously declared in both `index.js` and `lib/DeviceAccessory.js` — easy to forget to bump one of them. Now one constant, imported from both. Bumped to 4 to evict 0.4.1 cached accessories on first 0.4.2 launch (so users get the ConfiguredName + Identify-handler updates without manual cleanup).
- **`PLUGIN_NAME` and `PLATFORM_NAME` also moved to `lib/constants.js`** (single source).
- **`UUID_NAMESPACE` moved to `lib/constants.js`.**
- **`test/unit/hapCompliance.test.js` (9 new tests, 130 total)** — exercises `DeviceAccessory` against a mock HAP shim. Asserts:
  - `Categories.AIR_CONDITIONER` is set on `platformAccessory` creation
  - `setPrimaryService(true)` is called on `HeaterCoolerService`
  - `addLinkedService` is called for every companion service
  - `ConfiguredName` is set on each Switch service
  - `Identify` characteristic has an `onSet` handler
  - `setProps` doesn't NaN out when ESPHome omits visual temp bounds
  - `RotationSpeed.minStep` matches the count of supported fan modes
  - `lib/constants.js` is the single source for the schema version
  - `index.js` and `lib/DeviceAccessory.js` import from constants (no inline duplicate)

### Migration

After upgrading to 0.4.3:
1. `sudo npm install -g homebridge-slwf-01pro@latest`
2. `sudo hb-service restart`
3. The log shows `Evicting N cached accessories from an older plugin schema` (schema bump from 3 → 4).
4. Apple Home: force-quit and reopen on iPhone. ConfiguredName updates appear (Switch tiles now labeled "Beeper", "Display", "Dry", "Fan Only" instead of generic "Switch N").
5. No re-pairing needed — the bridge identity is preserved.

---

## [0.4.1] — 2026-05-06

HAP-level fixes for "accessories visible in Homebridge but not in Apple Home" after a successful bridge pairing.

### Fixed

- **No `AccessoryCategory` was set on accessories**, so HAP defaulted to `OTHER (1)`. Apple Home iOS 16+ uses the category to pick the accessory icon AND to group it correctly in the Home app. Without an explicit category, accessories can sometimes be silently grouped under "Other" and hidden from the main rooms grid.
  - Now sets `Categories.AIR_CONDITIONER (21)` on every SLWF-01Pro accessory at creation time, with a numeric fallback `21` if the HAP-NodeJS Categories enum isn't exposed.
- **Optional services were not linked to the primary HeaterCooler service.** Apple Home expects sensors and companion switches to be `addLinkedService`-linked to the parent service so they're grouped in the accessory's UI panel rather than appearing as orphaned services. Now linked: HumiditySensor, OutdoorTempSensor, Beeper Switch, Display Switch, DRY-mode Switch, FAN_ONLY-mode Switch — all linked to the HeaterCooler primary.

### Internal

- **`ACCESSORY_SCHEMA_VERSION` bumped to 3.** This forces Homebridge to evict any 0.3.x/0.4.0 cached accessories that were created without the category and without linked services. They get re-registered cleanly on first start with the new metadata. Users will see one `Evicting N cached accessories from an older plugin schema` line in the log.
- 120 unit tests still pass.

### Migration

After upgrading to 0.4.1:
1. `sudo npm install -g homebridge-slwf-01pro@latest`
2. `sudo hb-service restart`
3. The log will show the schema-eviction warning + 6 fresh `Initialized "..." with N mapped entities` lines.
4. **In Apple Home on your iPhone**: force-quit Apple Home (swipe up → swipe Home away), then reopen — Apple Home re-fetches the accessory list from the bridge and the 6 ACs should now appear under the "Homebridge SLWF01Pro" bridge tile.
5. If they still don't appear: in Apple Home, long-press the bridge tile → ⓘ → **Remove Bridge from Home**, then re-pair using the PIN from the Homebridge log (or the Bridge Settings panel). The fresh pairing will pick up the new metadata cleanly.

---

## [0.4.0] — 2026-05-06

Naming cleanup. User-visible "ESPHome AC" / "ESPHomeAC" branding is now consistently **SLWF-01Pro**; technical references to the underlying ESPHome protocol (native API, mDNS service, Climate entity type) remain accurate where they describe the wire format the plugin speaks.

### Breaking

- **No config breakage.** Platform identifier (`SLWFOnePro`) and npm name (`homebridge-slwf-01pro`) are unchanged from 0.3.x. Existing configs and HomeKit pairings continue to work.
- Internal class `ESPHomeAC` in `index.js` renamed to `SLWFOnePro`. Visible only in stack traces.

### Changed

- **`package.json` `displayName`** simplified from "Homebridge SLWF-01Pro / ESPHome AC" to **"Homebridge SLWF-01Pro"**. Cleaner in the Homebridge UI plugin browser and matches the npm package name.
- **`package.json` `description`** rewritten to lead with SLWF-01Pro and the SMLIGHT brand; ESPHome native API mentioned as the underlying protocol, not the headline product.
- **`package.json` `keywords`** pruned: dropped `homebridge-esphome`, `homebridge-esphome-ac`, `esphome-ac` (upstream-related, not relevant for this fork's npm discoverability); kept `slwf`, `slwf-01pro`, `smlight`, AC-brand names; added `air-conditioner`.
- **`config.schema.json`** copy refreshed:
  - `headerDisplay` linked to the SMLIGHT product page; dropped "ESPHome `Climate` entities" framing in favour of "SLWF-01Pro Wi-Fi AC dongle"
  - `footerDisplay` mentions ESPHome native API as the underlying protocol (correct framing for users who want to use the plugin with non-SLWF ESPHome devices)
  - `debug.description` simplified: "device state-change chatter" instead of "ESPHome state-change chatter"
  - `autoDiscover.title` changed to "Auto-discover SLWF-01Pro devices via mDNS"; description still references the actual `_esphomelib._tcp` mDNS service since that's the literal technical fact
  - `port` and `encryptionKey` titles simplified ("Native API port", "API encryption key (base64)")
  - Per-device toggles unchanged
- **Log strings**:
  - "Creating new ESPHome AC accessory" → "Creating new SLWF-01Pro accessory"
  - "ESPHome device …reconnected" → "Device …reconnected"
  - "No ESPHome devices configured…" → "No SLWF-01Pro / ESPHome devices configured…"
  - "Browsing mDNS for ESPHome devices" / "Discovered N ESPHome devices" — kept (factually accurate; the mDNS service is `_esphomelib._tcp`).
- **Accessory metadata** (Apple Home → ⓘ on each AC):
  - Manufacturer fallback: `'ESPHome'` → `'SMLIGHT'` (only used when the device doesn't report its own manufacturer; SMLIGHT is the actual hardware vendor)
  - Model fallback: `'ESPHome AC'` → `'SLWF-01Pro'`
  - Real `deviceInfo.manufacturer` / `deviceInfo.model` from ESPHome still take precedence — these are only fallbacks when the device YAML doesn't provide them.
- **`config-sample.json`** `name` field updated from `"ESPHomeAC"` to `"SLWF-01Pro"`.

### Internal

- All `[ESPHomeAC]` log prefixes will become `[SLWF-01Pro]` (or whatever you set in the `name` config field) once your `config.json`'s `name` is updated. Existing `name: "ESPHomeAC"` configs continue to work — the prefix just keeps the legacy value until you change it.
- 120 unit tests still pass.

---

## [0.3.3] — 2026-05-06

Fix the "config validation failed, you can still save your changes" warning shown by the Homebridge UI when editing the plugin's settings.

### Fixed

- **`config.schema.json` used the legacy per-property `"required": true/false` Homebridge convention**, which modern ajv (used by recent `homebridge-config-ui-x` versions) reports as a non-standard JSON Schema construct. Migrated to canonical JSON Schema:
  - Removed all `"required": false` annotations (redundant — JSON Schema treats unlisted properties as optional by default).
  - Replaced per-device `"required": true` on `name`/`host` with the parent-level `"required": ["name", "host"]` array on the device item schema.
  - Added `minLength: 1` on required string fields so empty values are explicitly rejected (matches what the form validator was already enforcing).
- **The `Devices` array's items had `"title": "Devices"` (plural)**, which the UI rendered as the same title for every entry; changed to `"Device"` (singular).

### Added

- **`test/unit/configSchemaValidation.test.js`** — runs the live `config.schema.json` through ajv against 20 sample configs, including the bundled `config-sample.json`, common partial configs, and explicit error cases (missing required fields, out-of-range numerics, wrong types). Catches schema regressions that would surface as validation warnings in the UI.
  - 120 unit tests now pass (up from 100).
- **`ajv` and `ajv-formats` as devDependencies** — vendored only for the test suite, not shipped in the runtime tarball.

### Why the warning matters

`homebridge-config-ui-x` validates saved config against the plugin's `config.schema.json` after every form save. When the schema is well-formed but uses non-standard JSON Schema constructs, ajv flags them and the UI shows the "config validation failed" warning even though the actual saved config is fine. The user could still save their changes, but the warning is alarming and obscures real validation problems (like a forgotten required field).

This release modernizes the schema to canonical JSON Schema syntax, eliminating the false-positive warning. The ajv-based test suite ensures we don't regress.

---

## [0.3.2] — 2026-05-06

Config-schema polish + a regression-prevention test suite for the Homebridge UI form.

### Fixed

- **`config.schema.json` `name` default was stale** — `"ESPHomeAC"` left over from before the 0.2.0 platform rename to `SLWFOnePro`. New users adding the plugin via the Homebridge UI got a confusing log prefix that didn't match the platform identifier. Now defaults to `"SLWFOnePro"`.
- **`headerDisplay` and `footerDisplay`** rewritten to mention the SLWF brand explicitly and link to the maintainer + upstream.

### Added

- **`test/unit/configSchema.test.js`** — 12 new tests (100 total now, up from 87) that automatically catch any future drift between the schema and the plugin code:
  - Schema parses as valid JSON
  - `pluginAlias` matches `PLATFORM_NAME` in `index.js` (won't silently rebrand the UI alias without rebranding the actual plugin)
  - Every property in `schema.properties` is read by `index.js` (no dead schema fields the UI exposes but the plugin ignores)
  - Per-device disable flags match platform-level disable flags 1:1 (so toggling a flag in the UI maps to a real code path)
  - Layout references resolve to actual property keys (no typo'd field references in the form definition)
  - `discoveryTimeout` condition references `autoDiscover` (so the field correctly hides when auto-discovery is off)
  - All boolean disable flags default to `false`
  - `name` default matches the platform identifier
  - `discoveryTimeout` and `port` numeric constraints are sane

### Why this matters

The Homebridge UI form is rendered directly from `config.schema.json` by `homebridge-config-ui-x`. A typo, stale default, or unreferenced field shows up as a confused user not as a runtime error — the plugin still works, but the user's clicks don't end up where they think. The new tests fail CI if the schema drifts from the code, eliminating that whole class of silent UI bugs.

### Verifying the UI is writing your config correctly

After saving in the Homebridge UI, run:
```bash
sudo cat /var/lib/homebridge/config.json | jq '.platforms[] | select(.platform == "SLWFOnePro")'
```
You should see the JSON block matching what you toggled in the UI. If you toggled `disableHumiditySensor` ON for one device, expect `"disableHumiditySensor": true` under that device's block. If a UI toggle doesn't appear in this output, the UI didn't persist it.

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

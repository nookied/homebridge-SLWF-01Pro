# Roadmap — homebridge-SLWF-01Pro

Living development plan for a Homebridge plugin that bridges **ESPHome `Climate` entities** — primarily the **[SMLIGHT SLWF-01Pro](https://smartlight.me/smart-home-devices/wifi-devices/wifi-dongle-air-conditioners-midea-idea-electrolux-for-home-assistant)** Wi-Fi dongle on Midea-protocol mini-splits — into HomeKit `HeaterCooler` accessories.

The fork was taken at upstream 0.0.4 because the upstream's release cadence (last release ~2 years ago) doesn't justify cherry-pick PRs, and the bug surface in real multi-AC installs needed addressing.

---

## TL;DR — where we're aiming

1. **Stable 0.5.x baseline.** The 0.4.x pairing concerns are resolved (user-confirmed paired); 0.5.x flipped defaults so a fresh install gives a clean Apple Home and per-device overrides became symmetric. Restart-resilience for Apple Home renames + offline auto-discovered devices landed in 0.5.1.
2. **Apply for Homebridge Verified** once 0.5.x has a few stable weeks in the wild. All requirements are already met (dynamic platform ✓, config.schema ✓, no telemetry ✓, errors caught ✓, tests ✓, tag-driven release ✓, npm name correct ✓).
3. **Feature coverage** — custom fan modes (`silent`/`turbo`), presets (`eco`/`boost`/`sleep`/`away`), two-point target temperature. See M4/M5 below.

---

## Where we are today (0.5.1 published)

✅ **Shipped on npm as `homebridge-slwf-01pro@0.5.1` with provenance.** Tag-driven release pipeline via GitHub Actions. CI runs lint + tests + smoke on Node 18.20.4 / 20.15.1 / 22.x / 24.x. **144 unit tests passing** across 7 suites (state, classifyEntity, discovery, configSchema, configSchemaValidation, hapCompliance, pruning).

✅ Dynamic platform, per-device debouncing, mode-mapping refactor with HEAT_COOL handling. **mDNS auto-discovery on by default** (since 0.5.0). **Multi-entity bundling** (Climate + sensors + switches + buttons → one HomeKit accessory) with `HumiditySensor`, outdoor `TemperatureSensor`, hidden-Outlet Eve.Energy power, Beeper switch, Display switch, DRY/FAN_ONLY mode tiles, all hidden by default with bidirectional per-device override. `StatusActive`/`StatusFault` mirror connection state.

✅ **HAP best practices** through 0.5.1: `Categories.AIR_CONDITIONER`, `setPrimaryService(true)`, `addLinkedService` for companion services, `ConfiguredName` seeded on first registration only (Apple-Home renames persist across restarts), no-op `Identify` handler, `setProps` NaN-safety, `RotationSpeed.minStep` sized to fan-mode count, mode-fallthrough uses `validValues[0]`, `FirmwareRevision` SemVer-sanitized, Eve `CurrentPowerConsumption` on a hidden linked Outlet (not on the standard `HeaterCooler` service), `ACCESSORY_SCHEMA_VERSION = 5` evicts older cached accessories on upgrade.

✅ **Restart-resilience** since 0.5.1: Apple Home renames stick across Homebridge restarts; auto-discovered devices that are offline at restart keep their HomeKit identity (name/room/automations) instead of being unregistered.

✅ **Three layers of independence from upstream `homebridge-esphome-ac`**: distinct npm name (`homebridge-slwf-01pro`), distinct platform identifier (`SLWFOnePro`), distinct UUID namespace (`homebridge-slwf-01pro:<deviceId>`). Both plugins can run side-by-side on the same Homebridge.

✅ **Pairing issue from 0.4.x resolved.** User successfully paired the bridge after the 0.4.4 + 0.5.0 fixes landed. [HANDOFF.md](HANDOFF.md) is kept as historical context for the diagnostic flow.

⚠️ Pending feature gaps: custom fan modes (`silent`/`turbo`), presets (`eco`/`boost`/`sleep`/`away`), two-point target temperature. Encrypted ESPHome devices skip auto-discovery (mDNS doesn't broadcast the Noise key).

---

## Verified-Plugin gap analysis

Source: [`homebridge/verified`](https://github.com/homebridge/verified). 11 requirements; status:

| # | Requirement | Met? | Action |
|---|---|---|---|
| 1 | Dynamic platform plugin | ✅ | Fixed in 0.1.0 — `registerPlatform(.., true)` |
| 2 | Doesn't duplicate an existing verified plugin | ✅ | Upstream `homebridge-esphome-ac` is not Verified |
| 3 | Published to npm with source on GitHub, issues enabled | ✅ | npm package `homebridge-slwf-01pro` (after first publish) |
| 4 | A GitHub release per new version with notes | ✅ | `release.yml` workflow auto-creates Releases on `v*` tags |
| 5 | Runs on supported LTS Node versions | ✅ | `engines.node ^18.20.4 \|\| ^20.15.1 \|\| ^22.0.0 \|\| ^24.0.0` |
| 6 | Installs successfully and doesn't start unless configured | ✅ | `devices: []` default → no clients spawned |
| 7 | No TTY / non-standard startup parameters | ✅ | None |
| 8 | Implements Settings GUI via `config.schema.json` | ✅ | Inherited from upstream; will tighten ranges in M2 |
| 9 | No analytics / user-tracking | ✅ | None |
| 10 | Files stored under HB storage dir | ✅ | No disk files |
| 11 | Catches and logs own errors, no unhandled exceptions | ✅ | Fork pass added `HapStatusError` rejections + try/catch around `climateCommandService` |

**All 11 requirements met as of 0.4.3.** Verification application is queued behind the active pairing issue (see HANDOFF.md). Once that's resolved and the plugin has been stable in real-world use for ~2 weeks with at least one external user, file via the `homebridge/verified` issue template.

---

## Milestones

Versioning policy below is pre-1.0; once stable, switch to strict [SemVer](https://semver.org/).

### ✅ Milestone 1 — v0.1.x — Fork bug-fix + multi-feature pass — SHIPPED (0.1.0–0.1.2)

**Goal:** ship the full feature set: bug fixes, mode mapping, multi-entity bundling, all the optional services.

| Item | Description | Status |
|---|---|---|
| Multi-device debounce | Per-device `_sendTimeout` instead of module-level | ✅ Done |
| Disconnected-device crash | Replace bare `log.error` with `that.log.error` + `HapStatusError` | ✅ Done |
| Listener stacking | Move `connected`/`disconnected`/`error`/`initialized` to platform scope | ✅ Done |
| Dynamic platform | `registerPlatform(.., true)` | ✅ Done |
| HEAT_COOL bug fix | `pickAutoMode` selects HEAT_COOL or AUTO based on what the device supports | ✅ Done |
| **Auto-discovery** | mDNS browse for `_esphomelib._tcp` + `autoDiscover` config flag | ✅ Done |
| **Multi-entity bundling** | Climate + sensors + switches + buttons → single accessory | ✅ Done |
| **Humidity sensor** | `Service.HumiditySensor` + `disableHumiditySensor` flag | ✅ Done |
| **Outdoor temperature sensor** | `Service.TemperatureSensor` + `disableOutdoorTempSensor` flag | ✅ Done |
| **Power consumption** | Eve.Energy custom characteristic + fakegato-history + `disablePowerSensor` flag | ✅ Done |
| **Beeper switch** | `Service.Switch` + `disableBeeperSwitch` flag | ✅ Done |
| **Display Toggle switch** | `Service.Switch` (stateless) + `disableDisplaySwitch` flag | ✅ Done |
| **DRY mode switch** | `Service.Switch` + `disableDryMode` flag | ✅ Done |
| **FAN_ONLY mode switch** | `Service.Switch` + `disableFanOnlyMode` flag | ✅ Done |
| **StatusActive + StatusFault** | Mirror ESPHome client connect/disconnect | ✅ Done |
| **Unit tests (78 passing)** | `state.js` + `classifyEntity.js` + `discovery.js` | ✅ Done |
| Lint clean | Indentation fixes via mode-mapping refactor | ✅ Done |
| `repository.url` fix | Point to fork URL (sigstore provenance) | ✅ Done |
| `engines` raised | Node 18.20.4+ / Homebridge ^1.8.0 || ^2.0.0 | ✅ Done |
| `displayName` | "Homebridge SLWF-01Pro / ESPHome AC" | ✅ Done |
| Docs (README + CLAUDE + CHANGELOG + ROADMAP + QA_TESTS + config.schema) | Warmup-style structure | ✅ Done |
| **UUID derivation** | Fallback chain when ESPHome doesn't set `unique_id` | ✅ Done in 0.1.2 |
| **npm publish + GitHub Release** | Tag-driven via `release.yml`; provenance attestation | ✅ Done |

---

### ✅ Milestone 2 — v0.2.x → v0.4.x — Independence + HAP correctness — SHIPPED

**Goal:** make the plugin fully independent of upstream + bring HAP integration up to current best practices.

| Item | Description | Status |
|---|---|---|
| **Platform identifier rename** | `ESPHomeAC` → `SLWFOnePro` so two plugins can coexist | ✅ 0.2.0 |
| **Upstream-orphan detection** | `detectOrphanedAccessories()` reads cache file, warns about leftover entries | ✅ 0.2.0 |
| **Decoupled git remote** | `git remote remove upstream` | ✅ 0.2.0 |
| **UUID namespace prefix** | `homebridge-slwf-01pro:<id>` so the same physical AC gets distinct UUIDs across plugins | ✅ 0.3.0 |
| **Schema-versioned cached accessories** | `accessory.context.schemaVersion` + auto-eviction on bump | ✅ 0.3.0 |
| **"Out of compliance" hardening** | Wait for first `state` event, safe defaults, `safeUpdate` helper, `FirmwareRevision` SemVer-sanitization, `setPrimaryService` | ✅ 0.3.1 |
| **Config schema modernization** | Canonical JSON Schema with `required: [...]` arrays, `minLength: 1` on required strings; ajv test suite | ✅ 0.3.2/0.3.3 |
| **Branding cleanup** | "ESPHome AC" / "ESPHomeAC" → "SLWF-01Pro" in user-visible strings | ✅ 0.4.0 |
| **`Categories.AIR_CONDITIONER`** on accessory creation | Default was `OTHER`; could cause Apple Home iOS 16+ to hide accessories | ✅ 0.4.1 |
| **`addLinkedService`** for companion services | Apple Home groups them in the accessory's UI panel | ✅ 0.4.1 |
| **HAP audit fixes** | `setProps NaN`-safety, mode-fallthrough uses `validValues[0]`, `ConfiguredName`, `Identify` handler, `RotationSpeed.minStep`, constants single-sourced | ✅ 0.4.3 |
| **HAP-compliance test suite** | Mock HAP shim asserting all of the above | ✅ 0.4.3 (10 tests) |

**Total tests:** 130 across 6 suites. All shipped on npm with provenance.

---

### 🔴 Milestone 3 — v0.5.0 — Resolve the active pairing issue

**Goal:** unblock real-world use. The plugin code is HAP-best-practice clean as far as our audit could see, yet pairing the bridge in Apple Home intermittently fails (see [HANDOFF.md](HANDOFF.md)).

**Untested hypotheses, in order of leverage:**

| Item | Description | Effort |
|---|---|---|
| **Bare-bones config test** | User-side: set every `disable*` flag to `true` and try to pair. Confirms whether the issue is service count vs. plugin-shape. | 5 min user time |
| **Eve.Energy on dedicated `Service.Outlet`** | Move `CurrentPowerConsumption` off the standard `HeaterCooler` service. Requires `addLinkedService` + a new subtype. | 2 h |
| **Default companion services to disabled** | Switch from opt-out to opt-in for `disableBeeperSwitch` / `disableDisplaySwitch` / `disableDryMode` / `disableFanOnlyMode` so a fresh install pairs cleanly with minimal services, then user enables what they want. Breaking config-shape change → bumps minor. | 1 h |
| **Bridge HAP state reset documentation** | Surface the `AccessoryInfo.<bridgeId>.json` + `IdentifierCache.<bridgeId>.json` reset path in the troubleshooting section of README. | 30 min |
| **`clientInfo` to ESPHome** | Pass `clientInfo: 'homebridge-slwf-01pro/<version>'` so device-side logs identify the plugin. | 15 min |

**Total estimate:** 4 hours of code + iterations on user feedback. Ships as `0.5.0` (or `0.4.4` if no breaking config change is needed).

---

### ⏭️ Milestone 4 — Custom fan modes + presets

**Goal:** finish ESPHome capability coverage. DRY/FAN_ONLY shipped early in 0.1.0; what remains is custom fan modes and presets.

| Item | Description | Effort | Source |
|---|---|---|---|
| **Custom fan modes** (`silent`, `turbo` on Midea) | Surface as additional levels in `RotationSpeed` mapping. Define a stable ordering: `[AUTO, silent, LOW, MEDIUM, HIGH, turbo]`; preserve user intent across reboots. | 1.5 h | [ESPHome midea_ac](https://esphome.io/components/climate/midea.html) |
| **Presets** (`eco`, `boost`, `sleep`, `away`) | Surface each as a `Service.Switch` on the same accessory. Mutually exclusive — toggling one off the others. | 2 h | — |
| Capability filtering | Only expose switches/presets the device's `config` advertises | 30 min | — |
| Per-preset disable flags | Same pattern as `disableHumiditySensor` etc. | 30 min | — |
| README + CLAUDE update | Document the new switch services | 15 min | — |

**Total effort:** ~5 hours. **Adds new HomeKit services** — bumps minor.

---

### ⏭️ Milestone 5 — Two-point target temperature

**Goal:** when the device advertises `supportsTwoPointTargetTemperature`, use it.

The current code treats `HeatingThresholdTemperature` and `CoolingThresholdTemperature` as two windows onto the same single ESPHome `target_temperature`. This is wrong for AUTO mode, where HomeKit expects "heat below X, cool above Y" with two distinct values.

| Item | Description | Effort |
|---|---|---|
| Detect two-point capability | Branch in `addClimateService` on `config.supportsTwoPointTargetTemperature` | 30 min |
| Send `target_temperature_low/high` | New code path in `stateManager.set.HeatingThresholdTemperature` / `CoolingThresholdTemperature` | 1 h |
| Per-mode mapping | In COOL mode, slider drives `targetTemperature` (single-point); in AUTO with two-point, drives `target_temperature_high`; in HEAT, `target_temperature_low` (when two-point). Document carefully. | 1 h |
| Tests | Truth tables for both paths | 1 h |

**Total effort:** ~3.5 hours. **Behavior change in AUTO mode** — bumps minor.

---

### ⏭️ Milestone 6 — v1.0.0 — Verified Plugin application

**Goal:** apply for [Homebridge Verified](https://github.com/homebridge/verified) once the plugin has been stable in real-world use for several weeks.

Pre-application checklist:
- [ ] Plugin has been at 0.4.x or higher for ≥ 2 weeks with no patch releases
- [ ] At least one user beyond the maintainer running it in production (issues opened + closed counts as evidence)
- [ ] All Verified requirements verified via the [issue template](https://github.com/homebridge/verified/issues/new?template=verified-plugin.md)
- [ ] Bump to `1.0.0` on application; from then on strict SemVer

After acceptance: maintain at the cadence of new ESPHome features and Homebridge LTS Node version bumps. No planned deprecations.

---

## Out of scope (won't fix)

- **Home-Assistant-only ESPHome features** like `midea_ac.follow_me` (which pushes an external sensor reading into the AC). HomeKit doesn't have a clean way to model "use this sensor as my room temperature" at the HeaterCooler level. Document as a workaround in README.
- **Hardware mods** (soldering IO13 to display board for follow-me). Out of plugin scope entirely; SMLIGHT documents these.
- **Pure ESP32 builds without an SLWF dongle** — already supported transparently (any ESPHome `climate:` entity works), but won't be advertised as a primary use case.
- **Tuya/SmartLife protocol passthrough** — the SLWF-01Pro supports both the OEM Tuya firmware and ESPHome; this plugin is **ESPHome-only**. Tuya users have separate plugins.

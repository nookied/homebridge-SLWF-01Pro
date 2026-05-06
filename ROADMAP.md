# Roadmap — homebridge-SLWF-01Pro

Living development plan for a Homebridge plugin that bridges **ESPHome `Climate` entities** — primarily the **[SMLIGHT SLWF-01Pro](https://smartlight.me/smart-home-devices/wifi-devices/wifi-dongle-air-conditioners-midea-idea-electrolux-for-home-assistant)** Wi-Fi dongle on Midea-protocol mini-splits — into HomeKit `HeaterCooler` accessories.

The fork was taken at upstream 0.0.4 because the upstream's release cadence (last release ~2 years ago) doesn't justify cherry-pick PRs, and the bug surface in real multi-AC installs needed addressing.

---

## TL;DR — three bets

1. **Stabilise the multi-feature 0.1.0** (Unreleased → 0.1.0). Auto-discovery, multi-entity bundling, HEAT_COOL fix, supplementary sensors/switches, DRY/FAN_ONLY mode tiles, Eve.Energy + history, StatusFault/Active. 78 unit tests passing. **Ship after manual QA on a real SLWF-01Pro install.**
2. **Add CI + GitHub release workflow.** Tests are in place; just need `.github/workflows/ci.yml` (lint + test on Node 22/24) and `release.yml` (tag-driven npm publish + GitHub Release).
3. **Apply for Homebridge Verified.** Currently meeting most requirements (dynamic platform ✓, config.schema ✓, no telemetry ✓, errors caught ✓, tests ✓). Outstanding: tag-driven release workflow + a few stable weeks in the wild + npm rename to `homebridge-slwf-01pro`.

Everything else is incremental coverage of ESPHome features (custom fan modes, presets, two-point temp).

---

## Where we are today (Unreleased — slated for 0.1.0)

✅ Dynamic platform, per-device debouncing, mode-mapping refactor with HEAT_COOL handling, **mDNS auto-discovery**, **multi-entity bundling** (Climate + sensors + switches + buttons → one HomeKit accessory), **HumiditySensor + outdoor TemperatureSensor + Eve.Energy power + Beeper switch + Display switch + DRY/FAN_ONLY mode tiles**, all with per-device disable flags. `StatusActive`/`StatusFault` mirror connection state. **78 unit tests passing.** README + CLAUDE + CHANGELOG + ROADMAP + QA_TESTS + config.schema all updated.

⚠️ No CI yet. Custom fan modes / presets / two-point temperature not yet exposed. Still publishes (would publish) under upstream's `homebridge-esphome-ac` npm name. Encrypted ESPHome devices skip auto-discovery (mDNS doesn't broadcast the Noise key).

---

## Verified-Plugin gap analysis

Source: [`homebridge/verified`](https://github.com/homebridge/verified). 11 requirements; status:

| # | Requirement | Met? | Action |
|---|---|---|---|
| 1 | Dynamic platform plugin | ✅ | Fixed in unreleased fork pass — `registerPlatform(.., true)` |
| 2 | Doesn't duplicate an existing verified plugin | ✅ | Upstream `homebridge-esphome-ac` is not Verified |
| 3 | Published to npm with source on GitHub, issues enabled | 🟡 | Source on GitHub ✓, issues enabled ✓; **fork not yet on npm under its own name** (M1) |
| 4 | A GitHub release per new version with notes | 🟡 | Set up `release.yml` workflow in M2 |
| 5 | Runs on supported LTS Node versions | ✅ | `engines.node ^18.20.4 \|\| ^20.15.1 \|\| ^22.0.0 \|\| ^24.0.0` |
| 6 | Installs successfully and doesn't start unless configured | ✅ | `devices: []` default → no clients spawned |
| 7 | No TTY / non-standard startup parameters | ✅ | None |
| 8 | Implements Settings GUI via `config.schema.json` | ✅ | Inherited from upstream; will tighten ranges in M2 |
| 9 | No analytics / user-tracking | ✅ | None |
| 10 | Files stored under HB storage dir | ✅ | No disk files |
| 11 | Catches and logs own errors, no unhandled exceptions | ✅ | Fork pass added `HapStatusError` rejections + try/catch around `climateCommandService` |

**Two outstanding blockers for verification:** the npm-rename + GitHub release flow (M1) and the test suite (M2). Application is queued as Milestone 5.

---

## Milestones

Versioning policy below is pre-1.0; once stable, switch to strict [SemVer](https://semver.org/).

### 🟡 Milestone 1 — v0.1.0 — Fork bug-fix + multi-feature pass — IN PROGRESS

**Goal:** ship everything currently in `Unreleased` after manual QA on a real Homebridge host.

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
| Manual QA on real hardware | Walk `QA_TESTS.md` end-to-end | ⏳ User-side |
| Tag `v0.1.0` and create GitHub Release | After QA passes | ⏳ User-side |
| Optional: rename npm package | `homebridge-slwf-01pro` once stable in 0.1.x | Deferred to M2 |

**Total effort remaining:** real-hardware QA + tag.

---

### ⏭️ Milestone 2 — v0.2.0 — CI + npm rename

**Goal:** automate the regression net + ship under the fork's own npm name.

| Item | Description | Effort | Source |
|---|---|---|---|
| GitHub Actions `ci.yml` | lint + test + smoke on Node 22 / 24, every push + PR | 30 min | [warmup4ie's ci.yml as reference](https://github.com/nookied/homebridge-warmup4ie-v2/blob/main/.github/workflows/ci.yml) |
| GitHub Actions `release.yml` | Tag-driven (`v*`) `npm publish --provenance` + GitHub Release | 30 min | warmup4ie's release.yml |
| Integration tests for `DeviceAccessory` | Fake `platform.api` HAP shim + entity stubs; assert services attached when entities present + removed when disable flags set | 2 h | — |
| Integration tests for `stateManager` | Fake `that` + sinon-style spy on `climateCommandService`; assert per-device debounce + connected/disconnected paths | 2 h | — |
| Rename npm package | `homebridge-slwf-01pro` (matching repo). Update README install commands. **First publish** under the new name. | 30 min | — |
| `repository.url` provenance assertion | Already correct; verify before first publish | — | — |
| `NPM_TOKEN` GitHub secret | Create granular access token with bypass-2FA + write on `homebridge-slwf-01pro` | 10 min | npm docs |

**Total effort:** ~5.5 hours. **No HomeKit-visible changes.** Ships as `0.2.0`.

---

### ⏭️ Milestone 3 — v0.3.0 — Custom fan modes + presets

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

### ⏭️ Milestone 4 — v0.4.0 — Two-point target temperature

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

### ⏭️ Milestone 5 — v1.0.0 — Verified Plugin application

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

# Handoff — pairing issue (historical brief)

> This file is **not** shipped to npm (excluded by `package.json` `files`). Originally a live brief for the open pairing problem at v0.4.3; kept as historical context for the diagnostic flow.

---

## ⚠️ UPDATE — 2026-05-06 (post-0.5.1)

**The pairing issue was resolved across 0.4.4 → 0.5.1.** The user successfully paired the SLWF child bridge in Apple Home and sees all devices. The fix bundle:

- **0.4.4** — Eve `CurrentPowerConsumption` moved off the standard `HeaterCooler` service onto a linked `Service.Outlet`, which is then `setHiddenService(true)` so it doesn't render as a separate tile in Apple Home but still feeds Eve.app via the HAP database. Schema bump 4 → 5 forces clean accessory recreation on upgrade.
- **0.5.0** — All companion services (`Humidity`, `OutdoorTemp`, `Power`, `Beeper`, `Display`, `DRY`, `FAN_ONLY`) hidden by default; `autoDiscover` on by default. This drops the per-accessory service count to just `HeaterCooler` for fresh installs, addressing the "service count tolerance" hypothesis. Per-device override semantics flipped to bidirectional so users can selectively re-enable extras.
- **0.5.1** — Apple-Home renames persist across restarts (`setConfiguredName` only seeds new accessories, not cached ones). Auto-discovered offline devices keep their identity instead of being unregistered (`pruneOrphanedAccessories` early-returns when `autoDiscover` is on).

The diagnostic flow below is preserved for reference if a similar symptom returns. Today's `npm view homebridge-slwf-01pro version` is **0.5.1** (144 unit tests across 7 suites).

---

## Quick status (frozen at v0.4.3 — pre-fix)

- **Latest published at the time of writing:** `homebridge-slwf-01pro@0.4.3` (npm + GitHub Release).
- **Test suite:** 130 unit tests passing across 6 suites. CI on Node 18.20.4 / 20.15.1 / 22.x / 24.x. Tag-driven release workflow is in place and working.
- **Plugin runtime:** functional. mDNS auto-discovery finds devices, accessories register correctly in Homebridge, all HAP-best-practices we know of are applied.
- **Open issue (now resolved — see UPDATE above):** the user can't get the SLWF child bridge to **finalize pairing** in Apple Home. Either gets a "Connecting…" spinner that hangs indefinitely, or pairs but Apple Home shows "non-compliant" / "Not Responding" state.

---

## What works

- Plugin loads cleanly; child bridge starts; auto-discovery finds all 6 of the user's ESPHome ACs (`Air Conditioner Fae810`, `Fae28f`, `Fae29f`, `Fae38f`, `Fae457`, `Fae4a0`).
- All 6 accessories are created with `Initialized "..." with N mapped entities`.
- The Homebridge UI shows all 6 ACs in its accessory list.
- The bridge advertises on mDNS as `Homebridge SLWF01Pro`.
- The bridge has been paired in Apple Home at least once (we have a screenshot of "Office Homebridge SLWF01Pro" tile from earlier in the session).
- Upstream `homebridge-esphome-ac` has been **uninstalled** by the user.

## What's broken

The user reports two failure modes when trying to (re-)pair the SLWF bridge in Apple Home:

1. **`Connecting…` spinner hangs indefinitely** — Apple Home accepted the QR/PIN, started the HAP handshake, never completed. (See `screenshots/` for the spinner image the user shared.)
2. **Bridge pairs but says "Not Responding" / "non-compliant"** in Apple Home, OR the 6 AC accessories don't appear under the bridge tile.

These are alternating, not consistent. Suggests intermittent state in either the bridge process, the network, or Apple Home/iOS.

## What's been tried (chronological summary)

| Version | What it added/fixed | Result on the pairing issue |
|---|---|---|
| 0.1.0 | Initial fork: auto-discovery, multi-entity bundling, full feature set | All accessories failed to construct (`Received undefined` from `uuid.generate`) |
| 0.1.2 | `deriveDeviceId(...)` fallback chain when ESPHome doesn't set `unique_id` (the user's case) | Construction succeeded, accessories registered |
| 0.2.0 | Platform identifier rename `ESPHomeAC → SLWFOnePro`, `git remote remove upstream` | Cleaner separation but no Apple Home change |
| 0.3.0 | UUID namespace prefix (`homebridge-slwf-01pro:<id>`) so the plugin can run alongside upstream without UUID collisions; `accessory.context.schemaVersion` for clean cache eviction across breaking changes | OOB (out-of-compliance) error appeared on first user pair attempt |
| 0.3.1 | "Out of compliance" hotfix: wait for first state event before construction; safe defaults for `CurrentTemperature` / threshold characteristics; `setProps` NaN guard; `FirmwareRevision` SemVer sanitization; `setPrimaryService(true)` on HeaterCooler | User reported it paired at least once after this; but the issue resurfaced |
| 0.3.2 / 0.3.3 | `config.schema.json` modernized (legacy `required:false` → array form); ajv-based test suite for schema | Eliminated UI's "Config validation failed" warning |
| 0.4.0 | Branding cleanup (`ESPHome AC` → `SLWF-01Pro` in user-visible strings) | No HAP change |
| 0.4.1 | **`Categories.AIR_CONDITIONER`** on accessory creation (we'd been defaulting to `OTHER`!); `addLinkedService` on companion services to the primary HeaterCooler | The user's most-recent successful pair was after 0.4.1 — but they then tried to re-pair and ran into the current issue |
| 0.4.3 | Independent HAP-compliance audit: 7 fixes — `setProps` NaN-safety with default visual temp bounds; mode-fallthrough uses `validValues[0]` instead of hardcoded AUTO; `ConfiguredName` on every companion service; bound `Identify` handler; explicit `Characteristic.Name` on AccessoryInformation; `RotationSpeed.minStep` sized to fan-mode count; `ACCESSORY_SCHEMA_VERSION` consolidated to `lib/constants.js` (single source). 9 new HAP-compliance tests with mock HAP shim. | User still can't pair after 0.4.3. |

## What's NOT yet been tried — the obvious next experiments

In rough order of likely-leverage:

### 1. Bare-bones accessory shape test ⭐ HIGHEST PRIORITY

The independent audit (see `agent-output` history if recoverable; key finding repeated below) flagged that **each accessory has up to 8 services** (HeaterCooler + AccessoryInformation + HumiditySensor + outdoor TemperatureSensor + Beeper Switch + Display Switch + DRY Switch + FAN_ONLY Switch). Apple Home iOS 17+ has documented behavior of silently dropping bridges with too many secondary services per accessory.

**Test config to give the user:**

```json
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
```

Reduces each accessory to just `AccessoryInformation + HeaterCooler` (2 services). The user has 6 ACs. Total characteristics drops from ~170 to ~70.

If this pairs cleanly: re-enable services one at a time to find the culprit.
If this still fails: not a service-count issue; pursue network/state hypotheses below.

### 2. Eve.Energy custom characteristic (`lib/eve.js`) on a standard HeaterCooler service

Audit finding (severity Medium): `CurrentPowerConsumption` is added directly to `HeaterCoolerService` rather than a dedicated service. Apple Home has been observed to silently hide accessories with unknown UUIDs on standard services.

If the bare-bones test (above) pairs but `disablePowerSensor: false` causes failure → confirmed. Refactor to put Eve.Energy on its own `Service.Outlet` (or a custom Eve service) and `addLinkedService` it.

### 3. Bridge HAP pairing state has not been hard-reset

Even though the user removed the bridge from Apple Home, the Homebridge child bridge keeps its HAP identity in `<persistPath>/AccessoryInfo.<bridgeId>.json` and `IdentifierCache.<bridgeId>.json`. If the bridge thinks it's still paired with the previous Home, a new pair attempt confuses iOS.

Recovery (already documented to user but they may not have done it):
```bash
sudo hb-service stop
# Bridge ID is 0E:30:EE:B6:B6:B7 in their setup → underscore-stripped as 0E30EEB6B6B7
sudo rm /var/lib/homebridge/persist/AccessoryInfo.0E30EEB6B6B7.json
sudo rm /var/lib/homebridge/persist/IdentifierCache.0E30EEB6B6B7.json
sudo rm /var/lib/homebridge/accessories/cachedAccessories.0E30EEB6B6B7
sudo hb-service start
# New pair PIN appears in the log
```

### 4. Network reachability of the bridge HAP port from the iPhone

iOS finds the bridge via mDNS (`_hap._tcp`) but then connects to it on a TCP port. If that connection hangs, "Connecting…" hangs forever. Causes:
- Linux/macOS firewall on the Homebridge host blocking the port
- Docker container networking issues
- VLAN segmentation between Wi-Fi and the host
- IGMP snooping disabled on the switch (mDNS discovery works but TCP doesn't)

Diagnostic: from another device on the same Wi-Fi, `nc -zv <homebridge-host> <port>`. Port comes from log: `Homebridge ... is running on port XXXXX`. If `nc` hangs, network issue.

### 5. iCloud Keychain stale HomeKit data on the iPhone

Apple Home stores pairing state in iCloud Keychain. After many pair/unpair cycles across plugin versions, the local state can corrupt. Nuclear fix: Settings → Home → tap home → tap iPhone in device list → Reset HomeKit Configuration (or toggle iCloud Keychain HomeKit off/on).

### 6. iOS version-specific bug

The user is on iOS [unknown — ask] running Apple Home. iOS 17.0 had pairing issues with certain bridge configurations; 17.4+ improved.

---

## Diagnostic questions for the user

When picking this up, ask:

1. **iOS version on the iPhone** they're using to pair?
2. **Output of `nc -zv <homebridge-ip> <bridge-port>`** from another device on the same network?
3. **Live log during the pair attempt** — do they see `[HAP] Pair Setup ...` lines or is the log silent during "Connecting…"? (`sudo hb-service logs -f | grep -iE "SLWF|HAP|pair"`)
4. **Did they try the bare-bones config** (Section 1 above)? What happened?
5. **How many other Homebridge bridges are currently paired** in their Apple Home? (warmup4ie-v2, irobot-v2, samsung-tizen, lgwebos-tv all visible in earlier logs.)
6. **Has the bridge HAP state been hard-reset** (Section 3 above)?

## Code areas the next instance will likely touch

- `lib/DeviceAccessory.js` — most pairing-relevant code; if Eve.Energy needs to move to a dedicated service, this is where
- `lib/eve.js` — custom characteristic factory; consider adding a dedicated `Service.Outlet` wrapper
- `lib/esphome.js` — `evictStaleSchemaAccessories` + `init` orchestration
- `index.js` — `configureAccessory` schema-version eviction
- `lib/constants.js` — bump `ACCESSORY_SCHEMA_VERSION` if any change forces re-creation of cached accessories

## Code areas to leave alone unless something forces it

- `lib/state.js` — pure mode/fan/swing mappers, fully unit-tested. No HomeKit dependency.
- `lib/classifyEntity.js` — pure entity-to-slot classifier. Unit-tested.
- `lib/discovery.js` — mDNS browse helper. Working.
- `lib/stateManager.js` — clean payload builder. Working.
- The release workflow `.github/workflows/release.yml` — tag-driven publish + GitHub Release. Working as of v0.3.1+.

## How to ship a fix

```bash
# 1. Make changes, run tests
npm run lint && npm test

# 2. Bump version (patch / minor / major)
npm version patch    # 0.4.3 → 0.4.4

# 3. Update CHANGELOG.md (add entry above the previous version)

# 4. Commit + tag + push
git add -A
git commit -m "..."
# (`npm version` already created the tag `v0.4.4`)
git push --follow-tags
```

The release workflow auto-publishes to npm with provenance, then creates the GitHub Release with notes pulled from the matching `## [0.4.4]` section in CHANGELOG.md.

## Hidden gotchas to avoid

- **`ACCESSORY_SCHEMA_VERSION`** must change when accessory shape changes (services, linked services, primary service, or characteristic props). Forgetting this → users keep stale cache after upgrade. Single source of truth is `lib/constants.js`.
- **`package.json` `files` array** — keep `HANDOFF.md`, `CLAUDE.md`, `ROADMAP.md`, `QA_TESTS.md`, `test/`, `.claude/` OUT of the npm tarball. Verify with `npm pack --dry-run`.
- **`repository.url`** in `package.json` — must match GitHub URL exactly; sigstore provenance fails on mismatch with HTTP 422.
- **Don't reuse a tag** — once a tag is pushed and the release attempts publish, even if it fails, bump the patch number and re-tag rather than force-pushing the tag (`v0.4.2` was lost this way; `v0.4.3` is what shipped).
- **Lint clean is a release-workflow precondition** — `eslint .` runs before `npm publish`. A leftover unused-import will block release. Always `npm run lint` before tagging.

## References

- Latest CLAUDE.md (architecture + working rules) — keep as project memory; update when shipping.
- ROADMAP.md — milestone plan; M1+M2 closed in 0.4.x. M3 is now "stabilise pairing UX" pending diagnosis of the current issue.
- QA_TESTS.md — manual pre-release checklist + pairing diagnostic flow.
- CHANGELOG.md — full release history.
- npm: https://www.npmjs.com/package/homebridge-slwf-01pro
- GitHub: https://github.com/nookied/homebridge-SLWF-01Pro
- ESPHome native API: https://github.com/2colors/esphome-native-api (the lib we use)
- Homebridge plugin docs: https://developers.homebridge.io/
- HAP-NodeJS source: https://github.com/homebridge/HAP-NodeJS

Good luck.

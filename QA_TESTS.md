# QA — Manual pre-release checklist

Run this on the real Homebridge host before tagging a release. Jest covers the pure helpers and HAP shape (206 unit tests); this checklist is the line of defence against regressions on real ESPHome hardware that the unit suite can't see.

Budget: ~10 minutes per release.

---

## Last walked

**v1.0.0 — 2026-08-28**, against six SLWF-01Pro dongles on Homebridge 2.4.0 / HAP 2.2.2 / Node 24.20.0.

| Area | Result |
|---|---|
| Home-app control, all six ACs | ✅ passed |
| Fan slider does not jump; 0% = AUTO and stays | ✅ passed |
| No `Factory reset` tile, no diagnostic sensors in HomeKit | ✅ passed (none present) |
| Restart resilience | ✅ passed — all six UUIDs, names, schema versions and service counts identical across a Homebridge restart, all reconnected |
| Disconnect / reconnect badge behaviour | ⏭️ not walked this release |
| Eve history recording a graph | ⏭️ not walked — needs `disablePowerSensor: false` plus `fakegato-history` installed. The fix is covered by unit tests and was verified against the real fakegato module (constructs, `addEntry` works, persists under `homebridge.user.storagePath()`), but no Eve graph was observed. |
| Dry / Fan Only returning an off AC to off | ⏭️ not walked — the test bench hides those tiles. Covered by `test/unit/modeSwitch.test.js` against the real code path. |

Incidentally found while walking this: an AC that dropped off Wi-Fi for ten minutes logged an identical connection error every ten seconds. Fixed in 1.0.0 before release.

## 0. Pre-flight

- [ ] Working from a clean `git status` on the release branch
- [ ] `package.json` `version` matches the planned tag (e.g. `0.1.0` for tag `v0.1.0`)
- [ ] `CHANGELOG.md` has an entry for the new version with date
- [ ] Documentation changes followed [DOCS.md](DOCS.md) ownership rules; no new long-lived incident handoff file was added
- [ ] `package.json` `repository.url` matches the GitHub repo URL exactly (sigstore provenance is strict — see CHANGELOG)
- [ ] `.github/workflows/release.yml` is still named exactly that, and `actions/setup-node` still has **no** `registry-url` — npm matches the trusted publisher on workflow filename, and `registry-url` breaks the OIDC exchange (see CLAUDE.md → Release & npm publishing)
- [ ] `npm run lint` clean
- [ ] `npm test` — all unit tests pass (206 currently; bump this number alongside any test additions)
- [ ] `node -e "require('./index.js')"` smoke test exits 0
- [ ] Working git SHA noted for rollback: `_______________`

## 1. Install on the Homebridge host

```bash
# Latest published from npm (preferred)
sudo npm install -g homebridge-slwf-01pro@<version>

# Or pin to a specific commit (pre-publish testing):
sudo npm install -g github:nookied/homebridge-SLWF-01Pro#<sha>

# Or from a local checkout:
sudo npm install -g <path-to-checkout>

sudo systemctl restart homebridge   # or: hb-service restart
sudo journalctl -u homebridge -f --since '1 minute ago'
```

- [ ] No errors during plugin load (`Loaded plugin: homebridge-slwf-01pro@<version>`)
- [ ] One `<name> client connected` line per configured/discovered device
- [ ] One `Initialized "<name>" with N mapped entit(y|ies)` line per device with a Climate entity
- [ ] No `TypeError`, `ReferenceError`, unhandled promise rejection
- [ ] No "device disconnected" lines unless the AC is actually offline

## 2. Smoke (Home app)

Open the iOS Home app:

- [ ] All N AC tiles appear under the configured platform
- [ ] Each tile shows the current temperature within ±1 °C of the AC's display
- [ ] Each tile shows the correct active/inactive state matching the AC's actual state
- [ ] Tap a tile to open it: target/current temperatures, mode buttons, fan-speed slider, swing toggle (if supported) all visible
- [ ] Accessory info (long-press tile → ⓘ): Manufacturer = `<deviceInfo.manufacturer>` (falls back to `SMLIGHT`), Model = `<deviceInfo.model>` (falls back to entity name, then `SLWF-01Pro`), Serial = `<deviceInfo.macAddress>` (falls back to deriveDeviceId result), Firmware = `<deviceInfo.esphomeVersion>` if present (sanitized to SemVer-ish)

## 3. Control — single AC (do these for ONE AC first)

- [ ] **Tap Off button** → AC turns off (compressor stops, fan stops); HomeKit tile shows "Off"
- [ ] **Tap Heat / Cool / Auto** → AC switches to the requested mode (verify on the AC's own display)
- [ ] **Drag target temperature slider** in Cool mode → AC's set point changes; verify on AC display
- [ ] **Drag target temperature slider** in Heat mode → AC's set point changes
- [ ] **Slider drag-and-drop is debounced** — drag fast across many values; only the *final* value is sent (one network call after ~600 ms, not N) — check the Homebridge log
- [ ] **Fan speed slider** → moves through the discrete fan modes the device supports (LOW/MED/HIGH or AUTO/LOW/...); 0% selects AUTO if available
- [ ] **Swing toggle** → AC louver moves to/from the configured swing direction

## 4. Control — multi-AC (skip if you only have one device)

**Regression sentinel: in upstream 0.0.4, changing one AC then another within 600 ms could lose the first command.** Verify this is fixed:

- [ ] Set AC #1 to 22 °C cool. Within 1 second, set AC #2 to 24 °C cool.
- [ ] Wait 2 seconds. Both ACs should reflect the new set points.
- [ ] Check Homebridge log: TWO `Sending command:` lines, one per AC, NOT one.
- [ ] Repeat with mode changes: AC #1 → Off, AC #2 → Heat. Both should apply.

## 4b. Auto-discovery (skip if `autoDiscover: false`)

- [ ] With `autoDiscover: true` and an empty `devices: []` (or a partial list), restart Homebridge. Log shows `Browsing mDNS for ESPHome devices…` then `Discovered N ESPHome device(s).`
- [ ] All ESPHome devices on the local network with a `Climate` entity appear as HomeKit accessories.
- [ ] An encrypted ESPHome device (`api: encryption: key:` set) does NOT auto-appear — confirm it needs a manual `devices[]` entry.
- [ ] Discovered names follow the pattern derived from mDNS hostname (e.g. `air-conditioner-fae810` → "Air Conditioner Fae810").
- [ ] A device listed in BOTH manual `devices[]` and discovered via mDNS does not appear twice (host-deduped).

## 4c. Multi-entity services

Set the optional service flags you want to test to `false` first; since 0.5.0 they default to hidden. For each AC accessory in HomeKit, verify the optional services match the device's ESPHome dashboard:

- [ ] Tap on the AC tile → ⓘ → all expected services are listed (HumiditySensor / Outdoor Temperature / Beeper / Display / Dry / Fan Only).
- [ ] **Humidity** matches the ESPHome dashboard's "Indoor Humidity" reading (or set `disableHumiditySensor: true` if the AC has no humidity probe and the value reads `0%`).
- [ ] **Outdoor Temperature** matches the ESPHome dashboard's "Outdoor Temperature".
- [ ] **Beeper Switch** ↔ ESPHome dashboard's "Beeper" — toggle in HomeKit, confirm dashboard reflects.
- [ ] **Display Switch** — tapping in HomeKit briefly shows it as ON then auto-resets; the AC's display backlight toggles.
- [ ] **Dry Switch** — toggling ON puts the AC into DRY mode (verify on AC display); main AC tile shows "Off" in primary modes (since DRY is supplementary). Toggling OFF restores the previous primary mode.
- [ ] **Fan Only Switch** — same pattern as Dry, but with FAN_ONLY mode.
- [ ] **Power Usage** appears in Eve.app (third-party HomeKit app required) — main AC tile in Eve shows current W and a history graph that fills over time.
- [ ] **Per-device disable flag** — set `disableHumiditySensor: true` on one device's `devices[]` entry and `false` on another; only the second device shows the humidity service.
- [ ] **Global disable flag** — set `disableBeeperSwitch: true` at platform level; no device shows a Beeper switch unless that device explicitly sets `disableBeeperSwitch: false`.
- [ ] **Hostless manual entry safety** — add a named manual device without `host`, restart with `autoDiscover: false`; Homebridge logs a warning and keeps cached accessories instead of pruning them.
- [ ] **Removed-service cleanup** — toggle a service's disable flag from `false` → `true`, restart Homebridge, the previously-shown service tile disappears (cached cleanup).

## 4d. HEAT_COOL devices (skip if your device only supports AUTO=6)

For devices whose `supportedModesList` includes `HEAT_COOL` (1) but NOT `AUTO` (6):

- [ ] HomeKit AUTO button appears in the mode selector.
- [ ] Tapping AUTO switches the AC to its `HEAT_COOL` mode (verify on AC display).
- [ ] Switching back to HEAT or COOL works.

## 5. Regression sentinels (must verify each release)

These are bugs that broke previous versions. Verify they stay fixed:

- [ ] **Multi-device commands not lost** *(broken in upstream 0.0.4 — see section 4)*
- [ ] **Disconnected device returns clean HomeKit error**, no `ReferenceError: log is not defined` *(broken in upstream 0.0.4)*. Reproduce: physically unplug the SLWF-01Pro / kill power to the AC for 30 seconds, then attempt to change a setting in HomeKit. Tile should show "Not Responding" cleanly; Homebridge log should have a single `ERROR setting status of <name>, device is disconnected` line, no stack trace.
- [ ] **Cached accessory persists across restarts** *(broken before dynamic-platform fix)*. Restart Homebridge: previously-paired AC tiles should NOT need re-pairing.
- [ ] **`lastTargetState` survives restart** *(only works with dynamic platform)*. Set AC to Heat, restart Homebridge, tap Off then On — should resume in Heat, not the default Cool.
- [ ] **Heat-only restore mode stays supported** — on a heat-only device, tap Off then On; the plugin must restore Heat, not send unsupported Cool.
- [ ] **HEAT_COOL devices show AUTO button** *(broken in upstream 0.0.4 — only AUTO=6 was handled)*. If your device's mode dropdown shows `HEAT_COOL` (not `AUTO`), the HomeKit AUTO button must still appear and work.
- [ ] **No sticky warning badge on disconnect/reconnect** — pull the dongle's power for 30 sec, then reconnect it; HomeKit writes should fail cleanly while disconnected and normal control should resume after reconnect without a persistent ⚠️ badge.
- [ ] **Construction succeeds for devices without `unique_id` set in YAML** *(broken in 0.1.0/0.1.1; fixed in 0.1.2)*. Reproduce: an ESPHome device whose `climate:` block doesn't set `unique_id` should still get a stable HomeKit accessory; the log should show `Initialized "<name>" with N mapped entit(y|ies)` not `Failed to initialize ...: Received undefined`.
- [ ] **Dry / Fan Only switch returns an off AC to off** *(broken until the fix after 0.5.7)*. With the AC **off**, enable the Dry (or Fan Only) tile, then turn it off again. The AC must go back to **off** — not start cooling. Repeat with the AC running in Heat: it must return to Heat.
- [ ] **Eve history actually records** *(broken from the first release until 1.0.0)*. Enable `disablePowerSensor: false`, install `fakegato-history`, restart, and confirm Eve.app shows a power graph filling in — not just a live wattage figure. The log must not contain `Eve history unavailable`.
- [ ] **The fan slider doesn't jump** — drag the fan speed to each detent and confirm it stays where you put it after the device reports back. On a `[AUTO, LOW, MEDIUM, HIGH]` device, 0% must mean AUTO and stay at 0%.
- [ ] **No Factory reset tile** — confirm the Home app shows no button that could factory-reset the AC, and that the Wi-Fi Signal diagnostic sensor is absent.
- [ ] **Preset switches** *(1.1.0)* — with `"disablePresets": false`, confirm one switch appears per advertised preset. Turning one on should leave it on **only if the AC actually enters that preset**. If it snaps back, the log must carry the one-time "advertises … but did not apply it" warning rather than leaving you guessing.
- [ ] **Presets are mutually exclusive** — turning on a second preset switches the first off.
- [ ] **Custom fan modes** *(1.1.0)* — on a device advertising `silent`/`turbo`, the fan slider should show six detents (0/20/40/60/80/100). Check 20 % and 100 % actually change the AC, and that the slider settles where the device reports.
- [ ] **Fan speed tracks the device in Fan Only** — put the AC in Fan Only, change the fan speed on the AC's own remote, and confirm the HomeKit fan slider follows.
- [ ] **Upstream-orphan warning fires when applicable** *(0.2.0+)*. If you upgraded from upstream `homebridge-esphome-ac`, the first launch logs `Detected N cached accessor… from upstream "homebridge-esphome-ac"` with cleanup instructions. After cleanup, the warning stops appearing.

## 6. Edge cases

- [ ] **AC reboot mid-session**: power-cycle the AC; ESPHome dongle reconnects within ~10 seconds; HomeKit tile resumes responding without a Homebridge restart.
- [ ] **Wi-Fi blip**: disable Wi-Fi on the dongle's network for 1 minute. Plugin logs `<name> client disconnected!`; after re-enabling, logs `<name> client connected`. No crash.
- [ ] **Homebridge restart**: `sudo systemctl restart homebridge`; all ACs re-appear without re-pairing; their last mode (Heat/Cool/Auto) is preserved.
- [ ] **Rapid taps**: tap Off → Heat → Off → Heat in rapid succession (< 2 sec); each call should succeed or fail gracefully (no double-callback / no orphaned state).
- [ ] **Encrypted ESPHome API**: if your device uses `api: encryption: key:`, set `encryptionKey` in config and verify everything still works.

## 7. Pairing diagnostic flow (use when "Connecting…" hangs or "non-compliant" appears)

This flow narrows down whether a pairing failure is plugin-side, network-side, or Apple-Home-side. Run in order; stop at the first step that resolves.

### 7a. Confirm the bridge process is alive

- [ ] Homebridge UI status bar — SLWF child bridge is **running** (green dot)
- [ ] `sudo hb-service logs --tail 30` — look for the `Setup Payload: X-HM://...` block; the `is running on port XXXXX` line tells you the HAP port
- [ ] `sudo ss -tlnp | grep <bridge-port>` — port should show `LISTEN`. If absent, the child bridge crashed; restart it.

### 7b. Confirm the bridge is reachable from the iPhone's network

- [ ] From a Mac on the same Wi-Fi: `nc -zv <homebridge-host-ip> <bridge-port>` — should succeed within 1 second.
  - If hangs/times out: firewall / network issue. Check `ufw status`, `pf` rules, Docker port mapping, VLAN segmentation.
  - If succeeds: pairing TCP path works; issue is pairing-state or HAP-shape, not network.

### 7c. Check the live log during a pair attempt

- [ ] Tail the log: `sudo hb-service logs -f | grep -iE "SLWF|HAP|pair|connect|error"`
- [ ] In Apple Home, attempt to add the bridge.
  - If the log shows `[HAP] Pair Setup ...` lines: the bridge is processing the request. Look for any error (HAP version, characteristic validation, etc.). If pairing completes log-side but iOS still says "Connecting…", iOS-side cache is stale (see 7e).
  - If the log is **silent** during "Connecting…": packets aren't reaching the bridge. Network issue (back to 7b).

### 7d. Bare-bones config test

This isolates plugin-shape vs. service-count issues.

- [ ] Edit `config.json` to set ALL `disable*` flags to `true` at the platform level.
- [ ] Wipe the bridge's HAP state + cache (so it pairs fresh):
  ```bash
  sudo hb-service stop
  sudo rm /var/lib/homebridge/persist/AccessoryInfo.<bridgeId>.json
  sudo rm /var/lib/homebridge/persist/IdentifierCache.<bridgeId>.json
  sudo rm /var/lib/homebridge/accessories/cachedAccessories.<bridgeId>
  sudo hb-service start
  ```
- [ ] Try to pair the bridge in Apple Home with the new PIN from the log.
  - **If pairs cleanly**: each AC now has just `AccessoryInformation + HeaterCooler`. Re-enable `disable*` flags one at a time (restart between each), verify each step still pairs. The first one that breaks is the culprit.
  - **If still fails**: not a service-count issue. Continue to 7e.

### 7e. Reset HomeKit on the iPhone (nuclear)

- [ ] iOS Settings → [your name] → iCloud → toggle HomeKit data off → confirm → toggle back on.
- [ ] Or: Settings → Home → tap home → tap iPhone → Reset HomeKit Configuration.
- [ ] Restart iPhone.
- [ ] Try pairing again.

### 7f. Try a different iOS device

- [ ] Pair from a different iPhone or iPad on the same network.
- [ ] If it works on the other device: iOS-side cache on the first device is corrupt. The iCloud reset should fix; if not, factory-reset HomeKit on the first device.

## 8. Rollback test (do once per minor version, not per patch)

- [ ] Verify rollback to the previous version works (`sudo npm install -g github:nookied/homebridge-SLWF-01Pro#<previous-sha>`)
- [ ] After rollback, confirm previous version's behaviour returns
- [ ] Document the previous-good version + SHA in the GitHub Release notes

---

## Sign-off

- [ ] All sections passed
- [ ] Date / tester / version: `_____________________________________________`
- [ ] Tag created: `git tag v<version>` and pushed (`git push --follow-tags`)
- [ ] GitHub Release published with notes from CHANGELOG.md
- [ ] `Publish to npm` step succeeded — a `404 Not Found - PUT` here means **auth**, not a missing package; check the trusted publisher config on npmjs.com still matches this repo and `release.yml`

If any item failed, do **not** tag. File an issue in the repo, fix on the branch, re-run the suite, and try again.

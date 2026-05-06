# QA — Manual pre-release checklist

Run this on the real Homebridge host before tagging a release. There are no automated tests yet, so this is the only line of defence against regressions on real ESPHome hardware.

Budget: ~10 minutes per release.

---

## 0. Pre-flight

- [ ] Working from a clean `git status` on the release branch
- [ ] `package.json` `version` matches the planned tag (e.g. `0.1.0` for tag `v0.1.0`)
- [ ] `CHANGELOG.md` has an entry for the new version with date
- [ ] `package.json` `repository.url` matches the GitHub repo URL exactly (sigstore provenance is strict — see CHANGELOG)
- [ ] `npm run lint` clean
- [ ] `npm test` — all unit tests pass (currently 78)
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
- [ ] Accessory info (long-press tile → ⓘ): Manufacturer = `<deviceInfo.manufacturer>` (falls back to "ESPHome"), Model = `<deviceInfo.model>` (falls back to entity name), Serial = `<deviceInfo.macAddress>` (falls back to ESPHome unique id), Firmware = `<deviceInfo.esphomeVersion>` if present

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

For each AC accessory in HomeKit, verify the optional services match the device's ESPHome dashboard:

- [ ] Tap on the AC tile → ⓘ → all expected services are listed (HumiditySensor / Outdoor Temperature / Beeper / Display / Dry / Fan Only).
- [ ] **Humidity** matches the ESPHome dashboard's "Indoor Humidity" reading (or set `disableHumiditySensor: true` if the AC has no humidity probe and the value reads `0%`).
- [ ] **Outdoor Temperature** matches the ESPHome dashboard's "Outdoor Temperature".
- [ ] **Beeper Switch** ↔ ESPHome dashboard's "Beeper" — toggle in HomeKit, confirm dashboard reflects.
- [ ] **Display Switch** — tapping in HomeKit briefly shows it as ON then auto-resets; the AC's display backlight toggles.
- [ ] **Dry Switch** — toggling ON puts the AC into DRY mode (verify on AC display); main AC tile shows "Off" in primary modes (since DRY is supplementary). Toggling OFF restores the previous primary mode.
- [ ] **Fan Only Switch** — same pattern as Dry, but with FAN_ONLY mode.
- [ ] **Power Usage** appears in Eve.app (third-party HomeKit app required) — main AC tile in Eve shows current W and a history graph that fills over time.
- [ ] **Per-device disable flag** — set `disableHumiditySensor: true` on one device's `devices[]` entry and `false` on another; only the second device shows the humidity service.
- [ ] **Global disable flag** — set `disableBeeperSwitch: true` at platform level; no device shows a Beeper switch even if the entity exists.
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
- [ ] **HEAT_COOL devices show AUTO button** *(broken in upstream 0.0.4 — only AUTO=6 was handled)*. If your device's mode dropdown shows `HEAT_COOL` (not `AUTO`), the HomeKit AUTO button must still appear and work.
- [ ] **StatusFault flips on disconnect** — pull the dongle's power for 30 sec; the AC tile in HomeKit shows a red badge / "Not Responding" while disconnected; reverts to normal on reconnect.

## 6. Edge cases

- [ ] **AC reboot mid-session**: power-cycle the AC; ESPHome dongle reconnects within ~10 seconds; HomeKit tile resumes responding without a Homebridge restart.
- [ ] **Wi-Fi blip**: disable Wi-Fi on the dongle's network for 1 minute. Plugin logs `<name> client disconnected!`; after re-enabling, logs `<name> client connected`. No crash.
- [ ] **Homebridge restart**: `sudo systemctl restart homebridge`; all ACs re-appear without re-pairing; their last mode (Heat/Cool/Auto) is preserved.
- [ ] **Rapid taps**: tap Off → Heat → Off → Heat in rapid succession (< 2 sec); each call should succeed or fail gracefully (no double-callback / no orphaned state).
- [ ] **Encrypted ESPHome API**: if your device uses `api: encryption: key:`, set `encryptionKey` in config and verify everything still works.

## 7. Rollback test (do once per minor version, not per patch)

- [ ] Verify rollback to the previous version works (`sudo npm install -g github:nookied/homebridge-SLWF-01Pro#<previous-sha>`)
- [ ] After rollback, confirm previous version's behaviour returns
- [ ] Document the previous-good version + SHA in the GitHub Release notes

---

## Sign-off

- [ ] All sections passed
- [ ] Date / tester / version: `_____________________________________________`
- [ ] Tag created: `git tag v<version>` and pushed (`git push --follow-tags`)
- [ ] GitHub Release published with notes from CHANGELOG.md

If any item failed, do **not** tag. File an issue in the repo, fix on the branch, re-run the suite, and try again.

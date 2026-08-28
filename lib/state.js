const ESP_MODE = Object.freeze({
	OFF: 0,
	HEAT_COOL: 1,
	COOL: 2,
	HEAT: 3,
	FAN_ONLY: 4,
	DRY: 5,
	AUTO: 6,
});

const HK_TARGET = Object.freeze({
	AUTO: 0,
	HEAT: 1,
	COOL: 2,
});

const HK_CURRENT = Object.freeze({
	INACTIVE: 0,
	IDLE: 1,
	HEATING: 2,
	COOLING: 3,
});

function deriveCurrentHeaterCoolerState(state) {
	if (!state || state.mode === ESP_MODE.OFF) return HK_CURRENT.INACTIVE;
	if (state.mode === ESP_MODE.COOL) return HK_CURRENT.COOLING;
	if (state.mode === ESP_MODE.HEAT) return HK_CURRENT.HEATING;
	if (state.mode === ESP_MODE.AUTO || state.mode === ESP_MODE.HEAT_COOL) {
		if (state.targetTemperature == null || state.currentTemperature == null) return HK_CURRENT.IDLE;
		if (state.currentTemperature > state.targetTemperature) return HK_CURRENT.COOLING;
		if (state.currentTemperature < state.targetTemperature) return HK_CURRENT.HEATING;
		return HK_CURRENT.IDLE;
	}
	return HK_CURRENT.IDLE;
}

function espModeToHkTargetState(espMode) {
	switch (espMode) {
		case ESP_MODE.HEAT: return HK_TARGET.HEAT;
		case ESP_MODE.COOL: return HK_TARGET.COOL;
		case ESP_MODE.AUTO:
		case ESP_MODE.HEAT_COOL:
			return HK_TARGET.AUTO;
		default: return HK_TARGET.AUTO;
	}
}

function hkTargetStateToEspMode(hkTarget) {
	switch (hkTarget) {
		case HK_TARGET.HEAT: return ESP_MODE.HEAT;
		case HK_TARGET.COOL: return ESP_MODE.COOL;
		case HK_TARGET.AUTO:
		default: return ESP_MODE.AUTO;
	}
}

function pickDefaultSwingValue(supportedSwingModesList) {
	if (!supportedSwingModesList || supportedSwingModesList.length <= 1) return 0;
	if (supportedSwingModesList.includes(1)) return 1;
	if (supportedSwingModesList.includes(2)) return 2;
	if (supportedSwingModesList.includes(3)) return 3;
	return 0;
}

// --- Fan speed -----------------------------------------------------------
//
// HomeKit's RotationSpeed is a 0-100 percentage; ESPHome has a discrete list of
// fan modes, plus an optional list of *custom* fan modes carried in a separate
// string field. Midea units advertise "silent" and "turbo" there.
//
// Both kinds are laid out on one ladder of evenly spaced anchors, slowest at 0%
// and fastest at 100%, so every value HomeKit can produce maps to a rung and
// every rung maps back to the same percentage.

const FAN_MODE = Object.freeze({ ON: 0, OFF: 1, AUTO: 2 });

// Where a custom fan mode sits relative to the standard speeds. ESPHome gives
// no ordering information — these are names Midea and its rebadges actually
// use. Anything unrecognised is appended after the known rungs rather than
// guessed at, so an unfamiliar mode is still reachable but never silently
// claims to be "slower than LOW".
const SLOWER_THAN_ANY_STANDARD = ['silent', 'quiet', 'mute', 'night'];
const FASTER_THAN_ANY_STANDARD = ['turbo', 'boost', 'powerful', 'strong', 'jet', 'max'];

function customFanRank(name) {
	const n = String(name).toLowerCase().trim();
	if (SLOWER_THAN_ANY_STANDARD.some(k => n.includes(k))) return -1;
	if (FASTER_THAN_ANY_STANDARD.some(k => n.includes(k))) return 1;
	return 0;
}

// One rung per selectable fan setting, in ascending "speed" order:
//   AUTO (kept at 0% — it is not a speed, and 0% has always meant AUTO here)
//   custom modes that are slower than any standard mode
//   the device's standard speeds, in the order it advertised them
//   custom modes that are faster than any standard mode
//   custom modes we have no ordering information for
function buildFanLadder(fanModesList, customFanModesList) {
	const standard = Array.isArray(fanModesList) ? fanModesList : [];
	const custom = Array.isArray(customFanModesList) ? customFanModesList : [];

	const auto = standard.filter(m => m === FAN_MODE.AUTO).map(mode => ({ mode }));
	// ON/OFF are not speeds; OFF in particular would fight the Active characteristic.
	const speeds = standard
		.filter(m => m !== FAN_MODE.AUTO && m !== FAN_MODE.ON && m !== FAN_MODE.OFF)
		.map(mode => ({ mode }));

	const ranked = r => custom.filter(name => customFanRank(name) === r).map(name => ({ custom: name }));

	return [...auto, ...ranked(-1), ...speeds, ...ranked(1), ...ranked(0)];
}

function fanLadderAnchors(ladder) {
	const n = ladder.length;
	if (n === 0) return [];
	if (n === 1) return [100];
	return ladder.map((_rung, idx) => Math.round((idx * 100) / (n - 1)));
}

function gcd(a, b) {
	return b === 0 ? a : gcd(b, a % b);
}

// Coarsest step that still lands exactly on every anchor, so Apple Home gets
// detents where the rung count allows (6 rungs -> 20) and a free slider only
// when it doesn't divide 100 evenly (4 rungs -> 1).
function fanLadderMinStep(ladder) {
	if (!ladder || ladder.length <= 1) return 100;
	return fanLadderAnchors(ladder).filter(v => v > 0).reduce(gcd, 100);
}

// Percentage -> the command fields to send. Returns {fanMode} or
// {customFanMode}; never both, since ESPHome treats them as alternatives.
function speedToFanCommand(speed, ladder) {
	if (!ladder || ladder.length === 0) return undefined;
	const anchors = fanLadderAnchors(ladder);
	let best = 0;
	for (let i = 1; i < anchors.length; i++) {
		if (Math.abs(speed - anchors[i]) < Math.abs(speed - anchors[best])) best = i;
	}
	const rung = ladder[best];
	return rung.custom !== undefined ? { customFanMode: rung.custom } : { fanMode: rung.mode };
}

// Device state -> percentage. A non-empty customFanMode wins: ESPHome leaves
// fanMode at a stale value while a custom mode is active. Returns undefined
// when the reported setting isn't on the ladder, so callers (via safeUpdate)
// leave HomeKit's last known value alone rather than reporting a wrong speed.
function fanStateToSpeed(fanMode, customFanMode, ladder) {
	if (!ladder || ladder.length === 0) return undefined;
	const anchors = fanLadderAnchors(ladder);
	if (typeof customFanMode === 'string' && customFanMode.length > 0) {
		const idx = ladder.findIndex(r => r.custom === customFanMode);
		return idx < 0 ? undefined : anchors[idx];
	}
	const idx = ladder.findIndex(r => r.mode === fanMode);
	return idx < 0 ? undefined : anchors[idx];
}

// --- Standard-only wrappers ----------------------------------------------
// Kept because most devices advertise no custom fan modes at all, and because
// the mapping is easier to reason about (and to test) in terms of the plain
// mode list.

function fanSpeedMinStep(fanModesList) {
	return fanLadderMinStep(buildFanLadder(fanModesList, []));
}

function fanSpeedToFanMode(speed, fanModesList) {
	const command = speedToFanCommand(speed, buildFanLadder(fanModesList, []));
	return command ? command.fanMode : undefined;
}

function fanModeToSpeed(fanMode, fanModesList) {
	return fanStateToSpeed(fanMode, '', buildFanLadder(fanModesList, []));
}


// --- Presets --------------------------------------------------------------
//
// ESPHome carries presets in two places: a standard enum, and a list of custom
// preset names. Real SLWF-01Pro firmware reports both — [NONE, BOOST, ECO,
// SLEEP] alongside a custom "freeze protection" — so anything that reads only
// the enum misses capabilities the device actually has.

const ESP_PRESET = Object.freeze({
	NONE: 0,
	HOME: 1,
	AWAY: 2,
	BOOST: 3,
	COMFORT: 4,
	ECO: 5,
	SLEEP: 6,
	ACTIVITY: 7,
});

const PRESET_LABELS = Object.freeze({
	1: 'Home',
	2: 'Away',
	3: 'Boost',
	4: 'Comfort',
	5: 'Eco',
	6: 'Sleep',
	7: 'Activity',
});

// "freeze protection" -> "Freeze Protection"
function titleCase(text) {
	return String(text)
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
		.join(' ');
}

// A stable, filesystem-and-HAP-safe subtype so a preset's service is found
// again in the accessory cache across restarts.
function presetSubtype(entry) {
	return entry.custom !== undefined
		? `preset-custom-${String(entry.custom).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
		: `preset-${entry.preset}`;
}

// One entry per preset the device can actually be put into. NONE is excluded:
// it is the absence of a preset, and is what gets sent when a switch is
// turned off.
function buildPresetList(supportedPresetsList, supportedCustomPresetsList) {
	const standard = (Array.isArray(supportedPresetsList) ? supportedPresetsList : [])
		.filter(p => p !== ESP_PRESET.NONE && PRESET_LABELS[p])
		.map(preset => ({ preset, label: PRESET_LABELS[preset] }));

	const custom = (Array.isArray(supportedCustomPresetsList) ? supportedCustomPresetsList : [])
		.filter(name => typeof name === 'string' && name.length > 0)
		.map(name => ({ custom: name, label: titleCase(name) }));

	return [...standard, ...custom];
}

// Which preset entry, if any, the device currently reports being in.
function activePresetEntry(preset, customPreset, presetList) {
	if (!Array.isArray(presetList)) return null;
	if (typeof customPreset === 'string' && customPreset.length > 0) {
		return presetList.find(e => e.custom === customPreset) || null;
	}
	if (preset === undefined || preset === null || preset === ESP_PRESET.NONE) return null;
	return presetList.find(e => e.preset === preset) || null;
}

function nonEmpty(value) {
	return typeof value === 'string' && value.length > 0;
}

function deriveDeviceId({ climateConfig, deviceInfo, deviceHost }) {
	const cfg = climateConfig || {};
	const info = deviceInfo || {};
	if (nonEmpty(cfg.uniqueId)) return cfg.uniqueId;
	if (nonEmpty(info.macAddress) && nonEmpty(cfg.objectId)) return `${info.macAddress}-${cfg.objectId}`;
	if (nonEmpty(info.macAddress)) return `${info.macAddress}-climate`;
	if (nonEmpty(deviceHost) && nonEmpty(cfg.objectId)) return `${deviceHost}-${cfg.objectId}`;
	if (nonEmpty(deviceHost)) return `${deviceHost}-climate`;
	if (cfg.key != null) return `esphome-climate-${cfg.key}`;
	return null;
}

function pickAutoMode(supportedModesList) {
	if (!supportedModesList) return null;
	if (supportedModesList.includes(ESP_MODE.AUTO)) return ESP_MODE.AUTO;
	if (supportedModesList.includes(ESP_MODE.HEAT_COOL)) return ESP_MODE.HEAT_COOL;
	return null;
}

function chooseInitialTargetMode(stateMode, supportedModesList) {
	const supported = Array.isArray(supportedModesList) ? supportedModesList : null;
	const isSupported = mode => !supported || supported.includes(mode);

	if ([ESP_MODE.COOL, ESP_MODE.HEAT, ESP_MODE.AUTO, ESP_MODE.HEAT_COOL].includes(stateMode) && isSupported(stateMode)) {
		return stateMode;
	}
	if (supported) {
		if (supported.includes(ESP_MODE.COOL)) return ESP_MODE.COOL;
		if (supported.includes(ESP_MODE.HEAT)) return ESP_MODE.HEAT;
		const autoMode = pickAutoMode(supported);
		if (autoMode !== null) return autoMode;
	}
	return ESP_MODE.COOL;
}

function supportsCool(supportedModesList) {
	if (!supportedModesList) return false;
	return supportedModesList.includes(ESP_MODE.COOL)
		|| supportedModesList.includes(ESP_MODE.AUTO)
		|| supportedModesList.includes(ESP_MODE.HEAT_COOL);
}

function supportsHeat(supportedModesList) {
	if (!supportedModesList) return false;
	return supportedModesList.includes(ESP_MODE.HEAT)
		|| supportedModesList.includes(ESP_MODE.AUTO)
		|| supportedModesList.includes(ESP_MODE.HEAT_COOL);
}

module.exports = {
	ESP_MODE,
	HK_TARGET,
	HK_CURRENT,
	ESP_PRESET,
	deriveCurrentHeaterCoolerState,
	espModeToHkTargetState,
	hkTargetStateToEspMode,
	pickDefaultSwingValue,
	fanSpeedToFanMode,
	fanModeToSpeed,
	fanSpeedMinStep,
	buildFanLadder,
	fanLadderAnchors,
	fanLadderMinStep,
	speedToFanCommand,
	fanStateToSpeed,
	buildPresetList,
	activePresetEntry,
	presetSubtype,
	chooseInitialTargetMode,
	pickAutoMode,
	supportsCool,
	supportsHeat,
	deriveDeviceId,
};

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

function fanSpeedToFanMode(speed, fanModesList) {
	if (!fanModesList || fanModesList.length === 0) return undefined;
	if (speed === 0) return fanModesList.includes(2) ? 2 : fanModesList[0];
	const totalSpeeds = fanModesList.length;
	for (let i = 0; i < totalSpeeds; i++) {
		if (speed <= (100 * (i + 1) / totalSpeeds)) return fanModesList[i];
	}
	return fanModesList[totalSpeeds - 1];
}

function fanModeToSpeed(fanMode, fanModesList) {
	if (!fanModesList || fanModesList.length === 0) return 0;
	const idx = fanModesList.indexOf(fanMode);
	if (idx < 0) return 0;
	return Math.ceil((idx + 1) * (100 / fanModesList.length));
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
	deriveCurrentHeaterCoolerState,
	espModeToHkTargetState,
	hkTargetStateToEspMode,
	pickDefaultSwingValue,
	fanSpeedToFanMode,
	fanModeToSpeed,
	chooseInitialTargetMode,
	pickAutoMode,
	supportsCool,
	supportsHeat,
	deriveDeviceId,
};

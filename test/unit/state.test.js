const {
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
} = require('../../lib/state');

describe('deriveCurrentHeaterCoolerState', () => {
	test('OFF mode → INACTIVE', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.OFF })).toBe(HK_CURRENT.INACTIVE);
	});
	test('null state → INACTIVE', () => {
		expect(deriveCurrentHeaterCoolerState(null)).toBe(HK_CURRENT.INACTIVE);
	});
	test('COOL → COOLING', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.COOL })).toBe(HK_CURRENT.COOLING);
	});
	test('HEAT → HEATING', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.HEAT })).toBe(HK_CURRENT.HEATING);
	});
	test('AUTO with current > target → COOLING', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.AUTO, currentTemperature: 25, targetTemperature: 22 })).toBe(HK_CURRENT.COOLING);
	});
	test('AUTO with current < target → HEATING', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.AUTO, currentTemperature: 18, targetTemperature: 22 })).toBe(HK_CURRENT.HEATING);
	});
	test('AUTO with current == target → IDLE', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.AUTO, currentTemperature: 22, targetTemperature: 22 })).toBe(HK_CURRENT.IDLE);
	});
	test('HEAT_COOL with target>current → HEATING', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.HEAT_COOL, currentTemperature: 18, targetTemperature: 22 })).toBe(HK_CURRENT.HEATING);
	});
	test('AUTO with missing temps → IDLE (fallback)', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.AUTO })).toBe(HK_CURRENT.IDLE);
	});
	test('FAN_ONLY → IDLE', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.FAN_ONLY })).toBe(HK_CURRENT.IDLE);
	});
	test('DRY → IDLE', () => {
		expect(deriveCurrentHeaterCoolerState({ mode: ESP_MODE.DRY })).toBe(HK_CURRENT.IDLE);
	});
});

describe('espModeToHkTargetState', () => {
	test('COOL → COOL', () => expect(espModeToHkTargetState(ESP_MODE.COOL)).toBe(HK_TARGET.COOL));
	test('HEAT → HEAT', () => expect(espModeToHkTargetState(ESP_MODE.HEAT)).toBe(HK_TARGET.HEAT));
	test('AUTO → AUTO', () => expect(espModeToHkTargetState(ESP_MODE.AUTO)).toBe(HK_TARGET.AUTO));
	test('HEAT_COOL → AUTO', () => expect(espModeToHkTargetState(ESP_MODE.HEAT_COOL)).toBe(HK_TARGET.AUTO));
	test('OFF → AUTO (default)', () => expect(espModeToHkTargetState(ESP_MODE.OFF)).toBe(HK_TARGET.AUTO));
	test('DRY → AUTO (default fallback for non-primary modes)', () => expect(espModeToHkTargetState(ESP_MODE.DRY)).toBe(HK_TARGET.AUTO));
});

describe('hkTargetStateToEspMode', () => {
	test('COOL → 2', () => expect(hkTargetStateToEspMode(HK_TARGET.COOL)).toBe(ESP_MODE.COOL));
	test('HEAT → 3', () => expect(hkTargetStateToEspMode(HK_TARGET.HEAT)).toBe(ESP_MODE.HEAT));
	test('AUTO → 6', () => expect(hkTargetStateToEspMode(HK_TARGET.AUTO)).toBe(ESP_MODE.AUTO));
	test('unknown → AUTO (default)', () => expect(hkTargetStateToEspMode(99)).toBe(ESP_MODE.AUTO));
});

describe('pickDefaultSwingValue', () => {
	test('list with BOTH preferred', () => expect(pickDefaultSwingValue([0, 1, 2, 3])).toBe(1));
	test('list without BOTH but with VERTICAL', () => expect(pickDefaultSwingValue([0, 2, 3])).toBe(2));
	test('list with only HORIZONTAL', () => expect(pickDefaultSwingValue([0, 3])).toBe(3));
	test('list with only OFF → 0', () => expect(pickDefaultSwingValue([0])).toBe(0));
	test('empty list → 0', () => expect(pickDefaultSwingValue([])).toBe(0));
	test('null → 0', () => expect(pickDefaultSwingValue(null)).toBe(0));
});

describe('fanSpeedToFanMode + fanModeToSpeed', () => {
	test('0% with AUTO available → AUTO (mode 2)', () => {
		expect(fanSpeedToFanMode(0, [2, 3, 4, 5])).toBe(2);
	});
	test('0% without AUTO → first mode', () => {
		expect(fanSpeedToFanMode(0, [3, 4, 5])).toBe(3);
	});
	test('50% out of [LOW=3, MED=4, HIGH=5] → MED (4)', () => {
		expect(fanSpeedToFanMode(50, [3, 4, 5])).toBe(4);
	});
	test('100% out of [LOW=3, MED=4, HIGH=5] → HIGH (5)', () => {
		expect(fanSpeedToFanMode(100, [3, 4, 5])).toBe(5);
	});
	test('roundtrip MED in [3,4,5] = 67%', () => {
		expect(fanModeToSpeed(4, [3, 4, 5])).toBe(67);
	});
	test('roundtrip HIGH in [3,4,5] = 100%', () => {
		expect(fanModeToSpeed(5, [3, 4, 5])).toBe(100);
	});
	test('mode not in list → 0%', () => {
		expect(fanModeToSpeed(99, [3, 4, 5])).toBe(0);
	});
	test('empty list → undefined', () => {
		expect(fanSpeedToFanMode(50, [])).toBe(undefined);
	});
});

describe('chooseInitialTargetMode', () => {
	test('COOL passthrough', () => expect(chooseInitialTargetMode(ESP_MODE.COOL)).toBe(ESP_MODE.COOL));
	test('HEAT passthrough', () => expect(chooseInitialTargetMode(ESP_MODE.HEAT)).toBe(ESP_MODE.HEAT));
	test('AUTO passthrough', () => expect(chooseInitialTargetMode(ESP_MODE.AUTO)).toBe(ESP_MODE.AUTO));
	test('HEAT_COOL passthrough', () => expect(chooseInitialTargetMode(ESP_MODE.HEAT_COOL)).toBe(ESP_MODE.HEAT_COOL));
	test('OFF → COOL fallback', () => expect(chooseInitialTargetMode(ESP_MODE.OFF)).toBe(ESP_MODE.COOL));
	test('DRY → COOL fallback', () => expect(chooseInitialTargetMode(ESP_MODE.DRY)).toBe(ESP_MODE.COOL));
	test('OFF on heat-only device → HEAT fallback', () => {
		expect(chooseInitialTargetMode(ESP_MODE.OFF, [ESP_MODE.OFF, ESP_MODE.HEAT])).toBe(ESP_MODE.HEAT);
	});
	test('stale COOL context on heat-only device → HEAT fallback', () => {
		expect(chooseInitialTargetMode(ESP_MODE.COOL, [ESP_MODE.OFF, ESP_MODE.HEAT])).toBe(ESP_MODE.HEAT);
	});
	test('OFF on auto-only device → AUTO fallback', () => {
		expect(chooseInitialTargetMode(ESP_MODE.OFF, [ESP_MODE.OFF, ESP_MODE.AUTO])).toBe(ESP_MODE.AUTO);
	});
	test('OFF on HEAT_COOL-only device → HEAT_COOL fallback', () => {
		expect(chooseInitialTargetMode(ESP_MODE.OFF, [ESP_MODE.OFF, ESP_MODE.HEAT_COOL])).toBe(ESP_MODE.HEAT_COOL);
	});
});

describe('pickAutoMode', () => {
	test('list with both AUTO and HEAT_COOL prefers AUTO', () => {
		expect(pickAutoMode([0, 1, 2, 3, 6])).toBe(ESP_MODE.AUTO);
	});
	test('list with only HEAT_COOL', () => {
		expect(pickAutoMode([0, 1, 2, 3, 4, 5])).toBe(ESP_MODE.HEAT_COOL);
	});
	test('list with only AUTO', () => {
		expect(pickAutoMode([0, 2, 3, 6])).toBe(ESP_MODE.AUTO);
	});
	test('list without either → null', () => {
		expect(pickAutoMode([0, 2, 3])).toBe(null);
	});
	test('null list → null', () => {
		expect(pickAutoMode(null)).toBe(null);
	});
});

describe('deriveDeviceId', () => {
	test('uniqueId set → uniqueId (preferred for back-compat)', () => {
		expect(deriveDeviceId({
			climateConfig: { uniqueId: 'air-conditioner-fae810-climate', objectId: 'air_conditioner', key: 1234 },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			deviceHost: 'air-conditioner-fae810.local',
		})).toBe('air-conditioner-fae810-climate');
	});
	test('uniqueId empty → falls back to mac+objectId', () => {
		expect(deriveDeviceId({
			climateConfig: { uniqueId: '', objectId: 'air_conditioner', key: 1234 },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			deviceHost: 'air-conditioner-fae810.local',
		})).toBe('24:D7:EB:FA:E8:10-air_conditioner');
	});
	test('uniqueId undefined → falls back to mac+objectId', () => {
		expect(deriveDeviceId({
			climateConfig: { objectId: 'air_conditioner', key: 1234 },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			deviceHost: 'air-conditioner-fae810.local',
		})).toBe('24:D7:EB:FA:E8:10-air_conditioner');
	});
	test('no uniqueId, no objectId, mac present → mac+climate', () => {
		expect(deriveDeviceId({
			climateConfig: { key: 1234 },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			deviceHost: 'air-conditioner-fae810.local',
		})).toBe('24:D7:EB:FA:E8:10-climate');
	});
	test('no uniqueId, no mac, host+objectId → host+objectId', () => {
		expect(deriveDeviceId({
			climateConfig: { objectId: 'air_conditioner', key: 1234 },
			deviceInfo: {},
			deviceHost: '192.168.1.10',
		})).toBe('192.168.1.10-air_conditioner');
	});
	test('only host present → host+climate', () => {
		expect(deriveDeviceId({
			climateConfig: { key: 1234 },
			deviceInfo: {},
			deviceHost: '192.168.1.10',
		})).toBe('192.168.1.10-climate');
	});
	test('only key present → esphome-climate-<key>', () => {
		expect(deriveDeviceId({
			climateConfig: { key: 1234 },
			deviceInfo: {},
			deviceHost: '',
		})).toBe('esphome-climate-1234');
	});
	test('nothing present → null', () => {
		expect(deriveDeviceId({
			climateConfig: {},
			deviceInfo: {},
			deviceHost: '',
		})).toBe(null);
	});
	test('null inputs → null', () => {
		expect(deriveDeviceId({
			climateConfig: null,
			deviceInfo: null,
			deviceHost: null,
		})).toBe(null);
	});
});

describe('supportsCool / supportsHeat', () => {
	test('COOL alone', () => {
		expect(supportsCool([ESP_MODE.COOL])).toBe(true);
		expect(supportsHeat([ESP_MODE.COOL])).toBe(false);
	});
	test('HEAT alone', () => {
		expect(supportsCool([ESP_MODE.HEAT])).toBe(false);
		expect(supportsHeat([ESP_MODE.HEAT])).toBe(true);
	});
	test('HEAT_COOL implies both', () => {
		expect(supportsCool([ESP_MODE.HEAT_COOL])).toBe(true);
		expect(supportsHeat([ESP_MODE.HEAT_COOL])).toBe(true);
	});
	test('AUTO implies both', () => {
		expect(supportsCool([ESP_MODE.AUTO])).toBe(true);
		expect(supportsHeat([ESP_MODE.AUTO])).toBe(true);
	});
	test('null list', () => {
		expect(supportsCool(null)).toBe(false);
		expect(supportsHeat(null)).toBe(false);
	});
	test('FAN_ONLY only', () => {
		expect(supportsCool([ESP_MODE.FAN_ONLY])).toBe(false);
		expect(supportsHeat([ESP_MODE.FAN_ONLY])).toBe(false);
	});
});

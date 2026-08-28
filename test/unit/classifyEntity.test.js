const { classifyEntity, bundleEntities } = require('../../lib/classifyEntity');

const mk = (type, name, objectId) => ({
	type,
	config: { name, objectId },
});

describe('classifyEntity', () => {
	test('Climate entity → climate', () => {
		expect(classifyEntity(mk('Climate', 'Air Conditioner', 'air_conditioner'))).toBe('climate');
	});
	test('Indoor Humidity Sensor → humiditySensor', () => {
		expect(classifyEntity(mk('Sensor', 'Air Conditioner Indoor Humidity', 'air_conditioner_indoor_humidity'))).toBe('humiditySensor');
	});
	test('Plain humidity sensor → humiditySensor', () => {
		expect(classifyEntity(mk('Sensor', 'Humidity', 'humidity'))).toBe('humiditySensor');
	});
	test('Outdoor Temperature → outdoorTempSensor', () => {
		expect(classifyEntity(mk('Sensor', 'Air Conditioner Outdoor Temperature', 'air_conditioner_outdoor_temperature'))).toBe('outdoorTempSensor');
	});
	test('Power Usage → powerSensor', () => {
		expect(classifyEntity(mk('Sensor', 'Air Conditioner Power Usage', 'air_conditioner_power_usage'))).toBe('powerSensor');
	});
	test('Beeper switch → beeperSwitch', () => {
		expect(classifyEntity(mk('Switch', 'Air Conditioner Beeper', 'air_conditioner_beeper'))).toBe('beeperSwitch');
	});
	test('Display Toggle button → displayButton', () => {
		expect(classifyEntity(mk('Button', 'Air Conditioner Display Toggle', 'air_conditioner_display_toggle'))).toBe('displayButton');
	});
	test('Uptime sensor → null (intentionally unmapped)', () => {
		expect(classifyEntity(mk('Sensor', 'Air Conditioner Uptime Days', 'air_conditioner_uptime_days'))).toBe(null);
	});
	test('Wi-Fi Signal sensor → null', () => {
		expect(classifyEntity(mk('Sensor', 'Air Conditioner Wi-Fi Signal', 'air_conditioner_wifi_signal'))).toBe(null);
	});
	test('Factory reset button → null (deliberately not exposed)', () => {
		expect(classifyEntity(mk('Button', 'Factory reset', 'factory_reset'))).toBe(null);
	});
	test('Swing Step button → null (no specific HK mapping yet)', () => {
		expect(classifyEntity(mk('Button', 'Air Conditioner Swing Step', 'air_conditioner_swing_step'))).toBe(null);
	});
	test('null entity → null', () => {
		expect(classifyEntity(null)).toBe(null);
	});
	test('entity without type → null', () => {
		expect(classifyEntity({ config: { name: 'foo' } })).toBe(null);
	});
});

describe('bundleEntities', () => {
	test('typical SLWF-01Pro device entity list', () => {
		const entities = [
			mk('Climate', 'Air Conditioner', 'air_conditioner'),
			mk('Switch', 'Air Conditioner Beeper', 'air_conditioner_beeper'),
			mk('Button', 'Air Conditioner Display Toggle', 'air_conditioner_display_toggle'),
			mk('Sensor', 'Air Conditioner Indoor Humidity', 'air_conditioner_indoor_humidity'),
			mk('Sensor', 'Air Conditioner Outdoor Temperature', 'air_conditioner_outdoor_temperature'),
			mk('Sensor', 'Air Conditioner Power Usage', 'air_conditioner_power_usage'),
			mk('Button', 'Air Conditioner Swing Step', 'air_conditioner_swing_step'),
			mk('Sensor', 'Air Conditioner Uptime Days', 'air_conditioner_uptime_days'),
			mk('Sensor', 'Air Conditioner Wi-Fi Signal', 'air_conditioner_wifi_signal'),
			mk('Button', 'Factory reset', 'factory_reset'),
		];
		const bundle = bundleEntities(entities);
		expect(bundle.climate).toBeDefined();
		expect(bundle.humiditySensor).toBeDefined();
		expect(bundle.outdoorTempSensor).toBeDefined();
		expect(bundle.powerSensor).toBeDefined();
		expect(bundle.beeperSwitch).toBeDefined();
		expect(bundle.displayButton).toBeDefined();
		expect(Object.keys(bundle).sort()).toEqual([
			'beeperSwitch', 'climate', 'displayButton', 'humiditySensor', 'outdoorTempSensor', 'powerSensor',
		]);
	});

	test('only Climate entity', () => {
		const bundle = bundleEntities([mk('Climate', 'AC', 'ac')]);
		expect(bundle.climate).toBeDefined();
		expect(bundle.humiditySensor).toBeUndefined();
	});

	test('first match wins for duplicates', () => {
		const a = mk('Sensor', 'Indoor Humidity Primary', 'humidity_a');
		const b = mk('Sensor', 'Indoor Humidity Backup', 'humidity_b');
		const bundle = bundleEntities([a, b]);
		expect(bundle.humiditySensor).toBe(a);
	});

	test('empty list', () => {
		expect(bundleEntities([])).toEqual({});
	});
});

// Captured from a live SLWF-01Pro (SMLIGHT.SLWF-01Pro, ESPHome 2024.4.2) so the
// classifier is checked against what the hardware really advertises rather than
// against invented fixtures.
const REAL_DEVICE_ENTITIES = [
	{ type: 'Sensor', config: { objectId: 'air_conditioner_uptime_days', name: 'Air Conditioner Uptime Days', deviceClass: '', entityCategory: 0 } },
	{ type: 'Sensor', config: { objectId: 'air_conditioner_power_usage', name: 'Air Conditioner Power Usage', deviceClass: 'power', entityCategory: 0 } },
	{ type: 'Sensor', config: { objectId: 'air_conditioner_wi-fi_signal', name: 'Air Conditioner Wi-Fi Signal', deviceClass: 'signal_strength', entityCategory: 2 } },
	{ type: 'Climate', config: { objectId: 'air_conditioner', name: 'Air Conditioner', entityCategory: 0 } },
	{ type: 'Button', config: { objectId: 'air_conditioner_swing_step', name: 'Air Conditioner Swing Step', deviceClass: '', entityCategory: 0 } },
	{ type: 'Switch', config: { objectId: 'air_conditioner_beeper', name: 'Air Conditioner Beeper', deviceClass: '', entityCategory: 0 } },
	{ type: 'Sensor', config: { objectId: 'air_conditioner_indoor_humidity', name: 'Air Conditioner Indoor Humidity', deviceClass: 'humidity', entityCategory: 0 } },
	{ type: 'Button', config: { objectId: 'air_conditioner_display_toggle', name: 'Air Conditioner Display Toggle', deviceClass: '', entityCategory: 0 } },
	{ type: 'Button', config: { objectId: 'factory_reset', name: 'Factory reset', deviceClass: 'restart', entityCategory: 1 } },
	{ type: 'Sensor', config: { objectId: 'air_conditioner_outdoor_temperature', name: 'Air Conditioner Outdoor Temperature', deviceClass: 'temperature', entityCategory: 0 } },
];

describe('classification against a real SLWF-01Pro entity list', () => {
	test('every slot is filled from the real device', () => {
		const bundle = bundleEntities(REAL_DEVICE_ENTITIES);

		expect(bundle.climate.config.objectId).toBe('air_conditioner');
		expect(bundle.powerSensor.config.objectId).toBe('air_conditioner_power_usage');
		expect(bundle.humiditySensor.config.objectId).toBe('air_conditioner_indoor_humidity');
		expect(bundle.outdoorTempSensor.config.objectId).toBe('air_conditioner_outdoor_temperature');
		expect(bundle.beeperSwitch.config.objectId).toBe('air_conditioner_beeper');
		expect(bundle.displayButton.config.objectId).toBe('air_conditioner_display_toggle');
	});

	test('the Factory reset button is never exposed', () => {
		const factoryReset = REAL_DEVICE_ENTITIES.find(e => e.config.objectId === 'factory_reset');

		expect(classifyEntity(factoryReset)).toBeNull();
		expect(Object.values(bundleEntities(REAL_DEVICE_ENTITIES))).not.toContain(factoryReset);
	});

	test('diagnostic entities stay out of HomeKit', () => {
		const wifi = REAL_DEVICE_ENTITIES.find(e => e.config.objectId === 'air_conditioner_wi-fi_signal');

		expect(classifyEntity(wifi)).toBeNull();
	});

	test('uptime and swing-step are not mapped to any slot', () => {
		for (const id of ['air_conditioner_uptime_days', 'air_conditioner_swing_step']) {
			expect(classifyEntity(REAL_DEVICE_ENTITIES.find(e => e.config.objectId === id))).toBeNull();
		}
	});
});

describe('safety guards on companion entities', () => {
	test('a config-category entity is refused even when the name matches', () => {
		expect(classifyEntity({ type: 'Button', config: { name: 'Display reset', deviceClass: '', entityCategory: 1 } })).toBeNull();
	});

	test('a restart-class button is refused even when the name matches', () => {
		expect(classifyEntity({ type: 'Button', config: { name: 'Display Toggle', deviceClass: 'restart', entityCategory: 0 } })).toBeNull();
	});

	test('an entity disabled by default in the ESPHome config is refused', () => {
		expect(classifyEntity({ type: 'Switch', config: { name: 'Beeper', disabledByDefault: true, entityCategory: 0 } })).toBeNull();
	});

	test('a Climate entity is still exposed regardless of category', () => {
		expect(classifyEntity({ type: 'Climate', config: { name: 'Air Conditioner', entityCategory: 1 } })).toBe('climate');
	});

	test('entities from firmware that omits entityCategory still classify', () => {
		expect(classifyEntity({ type: 'Switch', config: { name: 'Air Conditioner Beeper' } })).toBe('beeperSwitch');
	});

	test('an ESPHome Update entity (firmware 2.4+) is ignored, not mapped', () => {
		// Current official SLWF-01Pro firmware adds `update: http_request`.
		expect(classifyEntity({ type: 'Update', config: { name: 'Air Conditioner Firmware Update', entityCategory: 0 } })).toBeNull();
	});
});

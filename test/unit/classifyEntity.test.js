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

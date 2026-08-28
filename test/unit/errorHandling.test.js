// Homebridge requires a plugin to catch and log its own errors rather than
// throwing unhandled exceptions. ESPHome 'state' events arrive outside any
// HomeKit call stack, so anything that escapes a listener is unhandled and can
// take the bridge down. These tests pin that every transport listener is
// wrapped.

const DeviceAccessory = require('../../lib/DeviceAccessory');
const { makeFakePlatform, makeFakeClimateEntity } = require('../helpers/hapShim');

jest.mock('fakegato-history', () => null, { virtual: true });

function build() {
	const platform = makeFakePlatform();
	platform.api.registerPlatformAccessories = () => {};
	const errors = [];
	platform.log.error = msg => errors.push(String(msg));
	const climate = makeFakeClimateEntity();
	const accessory = new DeviceAccessory({
		device: { name: 'AC', host: '192.168.1.10' },
		deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
		entities: { climate },
		platform,
	});
	return { platform, accessory, climate, errors };
}

describe('a failure inside a state listener is contained', () => {
	test('a throwing climate update is caught and logged, not propagated', () => {
		const { accessory, climate, errors } = build();
		accessory.HeaterCoolerService.getCharacteristic = () => {
			throw new Error('HAP exploded');
		};

		expect(() => climate.emit('state', { mode: 2, currentTemperature: 21 })).not.toThrow();
		expect(errors.some(e => e.includes('HAP exploded'))).toBe(true);
		expect(errors.some(e => e.includes('climate state update'))).toBe(true);
	});

	test('the listener keeps working after a failed update', () => {
		const { accessory, climate, errors } = build();
		const real = accessory.HeaterCoolerService.getCharacteristic.bind(accessory.HeaterCoolerService);
		accessory.HeaterCoolerService.getCharacteristic = () => { throw new Error('transient'); };

		climate.emit('state', { mode: 2, currentTemperature: 21 });
		expect(errors).toHaveLength(1);

		accessory.HeaterCoolerService.getCharacteristic = real;
		expect(() => climate.emit('state', { mode: 2, currentTemperature: 23 })).not.toThrow();
		expect(errors).toHaveLength(1);
	});

	test('a malformed state payload does not escape, and the last good state survives', () => {
		const { accessory, climate } = build();
		const good = { mode: 2, currentTemperature: 21, targetTemperature: 20, fanMode: 4, swingMode: 0 };
		climate.emit('state', good);
		expect(accessory.state).toEqual(good);

		expect(() => climate.emit('state', null)).not.toThrow();
		expect(() => climate.emit('state', undefined)).not.toThrow();
		expect(() => climate.emit('state', 'garbage')).not.toThrow();

		// stateManager builds outgoing commands from this.state, so a bad
		// payload must not be allowed to replace it.
		expect(accessory.state).toEqual(good);
	});
});

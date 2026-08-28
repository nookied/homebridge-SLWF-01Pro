// fakegato-history exports a FACTORY that must be called with the Homebridge
// api — `require('fakegato-history')(api)` returns the service class.
//
// This plugin used to call `new` on the factory itself, which set fakegato's
// internal homebridge reference to the string 'energy' and then threw on
// `homebridge.hap`. The throw was swallowed at debug log level, so Eve energy
// history never worked and never said so. These tests pin the contract.

const mockAddEntry = jest.fn();
const mockConstructorCalls = [];
const mockFactoryCalls = [];

jest.mock('fakegato-history', () => {
	class FakeGatoHistoryService {
		constructor(...args) {
			mockConstructorCalls.push(args);
			this.addEntry = mockAddEntry;
		}
	}
	return jest.fn((...args) => {
		mockFactoryCalls.push(args);
		return FakeGatoHistoryService;
	});
}, { virtual: true });

const DeviceAccessory = require('../../lib/DeviceAccessory');
const { Characteristic, Service, makeFakePlatform, makeFakeClimateEntity } = require('../helpers/hapShim');

function makePowerSensor(initial = 0) {
	const handlers = {};
	return {
		type: 'Sensor',
		name: 'Air Conditioner Power Usage',
		config: { objectId: 'air_conditioner_power_usage', key: 42, name: 'Air Conditioner Power Usage' },
		state: { state: initial },
		on(event, fn) { handlers[event] = fn; },
		once(event, fn) { handlers[event] = fn; },
		off() {},
		emit(event, payload) { if (handlers[event]) handlers[event](payload); },
	};
}

function build({ storagePath = '/var/lib/homebridge' } = {}) {
	const platform = makeFakePlatform();
	platform.api.registerPlatformAccessories = () => {};
	// The real Homebridge api exposes this; fakegato uses it to decide where to
	// persist history when given storage: 'fs' and no explicit path.
	platform.api.user = { storagePath: () => storagePath };
	const powerSensor = makePowerSensor(0);
	const accessory = new DeviceAccessory({
		device: { name: 'AC', host: '192.168.1.10' },
		deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
		entities: { climate: makeFakeClimateEntity(), powerSensor },
		platform,
	});
	return { platform, accessory, powerSensor };
}

describe('Eve history wiring', () => {
	beforeEach(() => {
		mockAddEntry.mockClear();
		mockConstructorCalls.length = 0;
		mockFactoryCalls.length = 0;
	});

	test('the module is called as a factory, with the Homebridge api', () => {
		build();

		expect(mockFactoryCalls).toHaveLength(1);
		const [apiPassed] = mockFactoryCalls[0];
		expect(typeof apiPassed.user.storagePath).toBe('function');
		expect(apiPassed.hap).toBeDefined();
	});

	test('the class the factory returns is what gets instantiated', () => {
		const { accessory } = build();

		expect(mockConstructorCalls).toHaveLength(1);
		expect(typeof accessory.HistoryService.addEntry).toBe('function');
	});

	test('history is created as an energy service against the accessory', () => {
		const { accessory } = build();
		const [type, target] = mockConstructorCalls[0];

		expect(type).toBe('energy');
		expect(target).toBe(accessory.accessory);
	});

	test('storage is fs with no explicit path, so it lands in the Homebridge storage directory', () => {
		// Homebridge requires plugins to persist files inside its storage dir.
		// fakegato defaults to homebridge.user.storagePath() when given neither
		// `path` nor `folder`, so the plugin must not pass either.
		build();
		const [, , options] = mockConstructorCalls[0];

		expect(options.storage).toBe('fs');
		expect(options.path).toBeUndefined();
		expect(options.folder).toBeUndefined();
	});

	test('power readings reach the history service', () => {
		const { powerSensor } = build();

		powerSensor.emit('state', { state: 123.4 });

		expect(mockAddEntry).toHaveBeenCalledTimes(1);
		expect(mockAddEntry.mock.calls[0][0]).toMatchObject({ power: 123.4 });
		expect(typeof mockAddEntry.mock.calls[0][0].time).toBe('number');
	});

	test('a negative reading is clamped before it is recorded', () => {
		const { powerSensor } = build();

		powerSensor.emit('state', { state: -5 });

		expect(mockAddEntry.mock.calls[0][0].power).toBe(0);
	});

	test('the power characteristic is still updated independently of history', () => {
		const { accessory, powerSensor } = build();

		powerSensor.emit('state', { state: 250 });

		expect(accessory.PowerCharacteristic.value).toBe(250);
		const outlet = accessory.accessory.getServiceById(Service.Outlet, 'power');
		expect(outlet.getCharacteristic(Characteristic.OutletInUse).value).toBe(true);
	});
});

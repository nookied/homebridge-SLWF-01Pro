// Bumping ACCESSORY_SCHEMA_VERSION makes Homebridge unregister and re-register
// every accessory. Apple Home treats that as the accessory being removed and
// re-added, which drops room assignments and any Home-side rename. It is a real
// cost to the user and should only be paid when the accessory genuinely cannot
// be migrated in place.
//
// These tests pin the property that makes most bumps unnecessary: a cached
// accessory picks up newly-enabled services and changed characteristic props on
// the next restart, with no eviction. 1.1.0 bumped the version for presets when
// it did not have to.

const DeviceAccessory = require('../../lib/DeviceAccessory');
const { Characteristic, Service, makeFakePlatform, makeFakeClimateEntity } = require('../helpers/hapShim');

jest.mock('fakegato-history', () => null, { virtual: true });

const CAPS = {
	supportedModes: [0, 1, 2, 3, 4, 5],
	supportedFanModes: [2, 3, 4, 5],
	supportedCustomFanModes: ['silent', 'turbo'],
	supportedPresets: [0, 3, 5, 6],
	supportedCustomPresets: ['freeze protection'],
};

function makeOne(platform, capabilities) {
	return new DeviceAccessory({
		device: { name: 'AC', host: '192.168.1.10' },
		deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
		entities: { climate: makeFakeClimateEntity(capabilities) },
		platform,
	});
}

describe('a cached accessory migrates in place', () => {
	test('preset services appear on restart without re-registering the accessory', () => {
		const platform = makeFakePlatform();
		const registered = [];
		platform.api.registerPlatformAccessories = (_p, _n, accs) => registered.push(...accs);

		// First start: presets off, no custom fan modes — a 1.0.0-shaped accessory.
		platform.disablePresets = true;
		const first = makeOne(platform, { ...CAPS, supportedCustomFanModes: [] });
		const cached = first.accessory;
		expect(registered).toHaveLength(1);
		expect(first.PresetServices.size).toBe(0);

		// Restart with 1.1.0 features enabled. platform.accessories already holds
		// the cached accessory, so the constructor takes the cached path.
		platform.disablePresets = false;
		const second = makeOne(platform, CAPS);

		expect(second.accessory).toBe(cached);
		expect(registered).toHaveLength(1);              // nothing re-registered
		expect(second.PresetServices.size).toBe(4);
		expect(cached.getServiceById(Service.Switch, 'preset-5')).toBeDefined();
		expect(cached.getServiceById(Service.Switch, 'preset-custom-freeze-protection')).toBeDefined();
	});

	test('RotationSpeed props are updated on the cached characteristic', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};

		platform.disablePresets = true;
		const first = makeOne(platform, { ...CAPS, supportedCustomFanModes: [] });
		// Four rungs do not divide 100, so the slider is free.
		expect(first.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed).props.minStep).toBe(1);

		platform.disablePresets = false;
		const second = makeOne(platform, CAPS);

		// Six rungs once silent/turbo join: detents every 20%.
		expect(second.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed).props.minStep).toBe(20);
	});

	test('turning presets back off removes their services from the cached accessory', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};

		platform.disablePresets = false;
		const first = makeOne(platform, CAPS);
		expect(first.PresetServices.size).toBe(4);

		platform.disablePresets = true;
		const second = makeOne(platform, CAPS);

		expect(second.PresetServices.size).toBe(0);
		expect(second.accessory.getServiceById(Service.Switch, 'preset-5')).toBeUndefined();
	});

	test('a preset the device stops advertising is dropped from the cache', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		platform.disablePresets = false;

		makeOne(platform, CAPS);
		// Firmware update removes ECO and the custom preset.
		const second = makeOne(platform, { ...CAPS, supportedPresets: [0, 3], supportedCustomPresets: [] });

		expect(second.accessory.getServiceById(Service.Switch, 'preset-3')).toBeDefined();
		expect(second.accessory.getServiceById(Service.Switch, 'preset-5')).toBeUndefined();
		expect(second.accessory.getServiceById(Service.Switch, 'preset-custom-freeze-protection')).toBeUndefined();
	});
});

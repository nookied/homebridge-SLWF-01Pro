/**
 * HAP-compliance tests: regression net for AccessoryCategory, addLinkedService,
 * setPrimaryService, ConfiguredName, and Identify-handler binding.
 *
 * The fake platform / fake HAP shim lives in test/helpers/hapShim.js so the
 * Eve-history tests can reuse it with a different fakegato-history mock.
 */

const fs = require('fs');
const path = require('path');
const DeviceAccessory = require('../../lib/DeviceAccessory');
const {
	Characteristic,
	Service,
	Categories,
	makeCharCtor,
	makeFakePlatform,
	makeFakeClimateEntity,
	EVE_POWER_UUID,
} = require('../helpers/hapShim');

// This suite never exercises the history path; the Eve-history contract has its
// own suite that mocks the module as the factory it really is.
jest.mock('fakegato-history', () => null, { virtual: true });

// --- Tests ---------------------------------------------------------------

describe('HAP-compliance: AccessoryCategory', () => {
	test('AIR_CONDITIONER category is set on the platformAccessory at creation', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = (plugin, alias, accs) => {
			platform.registerPlatformAccessoriesCalls.push({ plugin, alias, accs });
		};
		const climate = makeFakeClimateEntity();
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate },
			platform,
		});
		expect(platform.registerPlatformAccessoriesCalls).toHaveLength(1);
		const acc = platform.registerPlatformAccessoriesCalls[0].accs[0];
		expect(acc.category).toBe(Categories.AIR_CONDITIONER);
	});
});

describe('HAP-compliance: setPrimaryService', () => {
	test('HeaterCooler is marked as primary service', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity();
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate },
			platform,
		});
		const acc = platform.accessories[0];
		const heaterCooler = acc.getService(Service.HeaterCooler);
		expect(heaterCooler.isPrimaryService).toBe(true);
	});
});

describe('HAP-compliance: addLinkedService', () => {
	test('companion services are linked to the primary HeaterCooler', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity();
		const beeperSwitch = { type: 'Switch', name: 'Beeper', config: { name: 'Beeper', objectId: 'beeper' }, state: { state: false }, on: () => {}, setState: () => {} };
		const humidity = { type: 'Sensor', name: 'Indoor Humidity', config: { name: 'Indoor Humidity', objectId: 'humidity' }, state: { state: 50 }, on: () => {} };
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate, beeperSwitch, humiditySensor: humidity },
			platform,
		});
		const acc = platform.accessories[0];
		const heaterCooler = acc.getService(Service.HeaterCooler);
		// Linked services should include the Beeper switch and Humidity sensor
		expect(heaterCooler.linkedServices.length).toBeGreaterThanOrEqual(2);
		const linkedTypes = heaterCooler.linkedServices.map(s => s.UUID);
		expect(linkedTypes).toContain(Service.HumiditySensor.UUID);
		expect(linkedTypes).toContain(Service.Switch.UUID);
	});
});

describe('HAP-compliance: Eve power service isolation', () => {
	test('power consumption is attached to a linked Outlet service, not HeaterCooler', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity();
		const powerSensor = { type: 'Sensor', name: 'Power', config: { name: 'Power', objectId: 'power' }, state: { state: 42 }, on: () => {} };
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate, powerSensor },
			platform,
		});
		const acc = platform.accessories[0];
		const heaterCooler = acc.getService(Service.HeaterCooler);
		const power = acc.getServiceById(Service.Outlet, 'power');
		const EvePower = makeCharCtor('Current Consumption', EVE_POWER_UUID);

		expect(power).toBeDefined();
		expect(power.testCharacteristic(EvePower)).toBe(true);
		expect(heaterCooler.testCharacteristic(EvePower)).toBe(false);
		expect(heaterCooler.linkedServices).toContain(power);
		expect(power.getCharacteristic(EvePower).value).toBe(42);
	});

	test('the linked Outlet is hidden from Apple Home (data-carrier only)', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity();
		const powerSensor = { type: 'Sensor', name: 'Power', config: { name: 'Power', objectId: 'power' }, state: { state: 42 }, on: () => {} };
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate, powerSensor },
			platform,
		});
		const acc = platform.accessories[0];
		const power = acc.getServiceById(Service.Outlet, 'power');
		expect(power).toBeDefined();
		expect(power.isHiddenService).toBe(true);
	});

	test('legacy Eve power characteristic is removed from cached HeaterCooler service', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity();
		const powerSensor = { type: 'Sensor', name: 'Power', config: { name: 'Power', objectId: 'power' }, state: { state: 42 }, on: () => {} };
		const uuid = platform.api.hap.uuid.generate('homebridge-slwf-01pro:air_conditioner-fae810');
		const cached = new platform.api.platformAccessory('AC', uuid, Categories.AIR_CONDITIONER);
		cached.context.schemaVersion = 6;
		const heaterCooler = cached.addService(Service.HeaterCooler, 'AC');
		const LegacyPower = makeCharCtor('Current Consumption', EVE_POWER_UUID);
		heaterCooler.getCharacteristic(LegacyPower).updateValue(13);
		platform.accessories.push(cached);

		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate, powerSensor },
			platform,
		});

		expect(heaterCooler.testCharacteristic(LegacyPower)).toBe(false);
		expect(cached.getServiceById(Service.Outlet, 'power')).toBeDefined();
	});
});

describe('HAP-compliance: ConfiguredName', () => {
	test('ConfiguredName is set on each companion Switch service', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity({ supportedModes: [0, 2, 3, 4, 5, 6] }); // include DRY + FAN_ONLY
		const beeperSwitch = { type: 'Switch', name: 'Beeper', config: { name: 'Beeper', objectId: 'beeper' }, state: { state: false }, on: () => {}, setState: () => {} };
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate, beeperSwitch },
			platform,
		});
		const acc = platform.accessories[0];
		const switches = acc.services.filter(s => s.UUID === Service.Switch.UUID);
		expect(switches.length).toBeGreaterThan(0);
		// Each Switch service should have ConfiguredName characteristic set
		for (const sw of switches) {
			expect(sw.testCharacteristic(Characteristic.ConfiguredName)).toBe(true);
			const cn = sw.getCharacteristic(Characteristic.ConfiguredName);
			expect(typeof cn.value).toBe('string');
			expect(cn.value.length).toBeGreaterThan(0);
		}
	});
});

describe('HAP-compliance: Identify handler', () => {
	test('Identify characteristic has an onSet handler bound', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity();
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate },
			platform,
		});
		const acc = platform.accessories[0];
		const info = acc.getService(Service.AccessoryInformation);
		const identify = info.getCharacteristic(Characteristic.Identify);
		expect(typeof identify._handlers.set).toBe('function');
	});
});

describe('HAP-compliance: visual temp props sanitization', () => {
	test('handles ESPHome device that omits visualMinTemperature/visualMaxTemperature', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity();
		// Wipe the visual props (simulate an ESPHome firmware that doesn't advertise them)
		delete climate.config.visualMinTemperature;
		delete climate.config.visualMaxTemperature;
		delete climate.config.visualTargetTemperatureStep;
		expect(() => {
			new DeviceAccessory({
				device: { name: 'AC', host: '192.168.1.10' },
				deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
				entities: { climate },
				platform,
			});
		}).not.toThrow();
		const acc = platform.accessories[0];
		const heaterCooler = acc.getService(Service.HeaterCooler);
		const cooling = heaterCooler.getCharacteristic(Characteristic.CoolingThresholdTemperature);
		expect(Number.isFinite(cooling.props.minValue)).toBe(true);
		expect(Number.isFinite(cooling.props.maxValue)).toBe(true);
		expect(Number.isFinite(cooling.props.minStep)).toBe(true);
	});

	test('clamps out-of-range current temperature before writing to HAP', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity({ state: { currentTemperature: 150 } });
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate },
			platform,
		});
		const acc = platform.accessories[0];
		const heaterCooler = acc.getService(Service.HeaterCooler);
		expect(heaterCooler.getCharacteristic(Characteristic.CurrentTemperature).value).toBe(100);
	});
});

describe('HAP-compliance: climate state updates', () => {
	test('supplementary DRY/FAN_ONLY state pushes keep Active set to on', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const acc = new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: {
				climate: makeFakeClimateEntity({
					supportedModes: [0, 2, 3, 4, 5, 6],
					state: { mode: 0 },
				}),
			},
			platform,
		});

		const heaterCooler = platform.accessories[0].getService(Service.HeaterCooler);
		expect(heaterCooler.getCharacteristic(Characteristic.Active).value).toBe(0);

		acc.updateClimateState({
			mode: 5,
			currentTemperature: 22,
			targetTemperature: 21,
			fanMode: 4,
			swingMode: 0,
		});

		expect(heaterCooler.getCharacteristic(Characteristic.Active).value).toBe(1);
		expect(heaterCooler.getCharacteristic(Characteristic.CurrentHeaterCoolerState).value).toBe(Characteristic.CurrentHeaterCoolerState.IDLE);
	});

	test('missing supportedModesList does not crash accessory construction', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity();
		delete climate.config.supportedModesList;

		expect(() => {
			new DeviceAccessory({
				device: { name: 'AC', host: '192.168.1.10' },
				deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
				entities: { climate },
				platform,
			});
		}).not.toThrow();
	});
});

describe('HAP-compliance: connection status characteristics', () => {
	test('new HeaterCooler accessories do not expose sticky transport status characteristics', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate: makeFakeClimateEntity() },
			platform,
		});

		const acc = platform.accessories[0];
		const heaterCooler = acc.getService(Service.HeaterCooler);
		expect(heaterCooler.testCharacteristic(Characteristic.StatusActive)).toBe(false);
		expect(heaterCooler.testCharacteristic(Characteristic.StatusFault)).toBe(false);
	});

	test('cached HeaterCooler status characteristics are removed during rebuild', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const uuid = platform.api.hap.uuid.generate('homebridge-slwf-01pro:air_conditioner-fae810');
		const cached = new platform.api.platformAccessory('AC', uuid, Categories.AIR_CONDITIONER);
		cached.context.schemaVersion = 6;
		const heaterCooler = cached.addService(Service.HeaterCooler, 'AC');
		heaterCooler.getCharacteristic(Characteristic.StatusActive).updateValue(false);
		heaterCooler.getCharacteristic(Characteristic.StatusFault).updateValue(Characteristic.StatusFault.GENERAL_FAULT);
		platform.accessories.push(cached);

		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate: makeFakeClimateEntity() },
			platform,
		});

		expect(heaterCooler.testCharacteristic(Characteristic.StatusActive)).toBe(false);
		expect(heaterCooler.testCharacteristic(Characteristic.StatusFault)).toBe(false);
	});

	test('connectivity changes update only internal reachability used by HomeKit writes', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const acc = new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate: makeFakeClimateEntity() },
			platform,
		});
		const heaterCooler = platform.accessories[0].getService(Service.HeaterCooler);

		acc.setConnectedStatus(false);
		expect(acc.connected).toBe(false);
		expect(heaterCooler.testCharacteristic(Characteristic.StatusFault)).toBe(false);

		acc.setConnectedStatus(true);
		expect(acc.connected).toBe(true);
		expect(heaterCooler.testCharacteristic(Characteristic.StatusFault)).toBe(false);
	});
});

describe('HAP-compliance: schema version constant is single-sourced', () => {
	test('lib/constants.js exports ACCESSORY_SCHEMA_VERSION as a number', () => {
		const { ACCESSORY_SCHEMA_VERSION } = require('../../lib/constants');
		expect(typeof ACCESSORY_SCHEMA_VERSION).toBe('number');
		expect(ACCESSORY_SCHEMA_VERSION).toBeGreaterThan(0);
	});
	test('index.js imports from lib/constants.js (no duplicate constant)', () => {
		const indexSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'index.js'), 'utf8');
		// Should NOT define ACCESSORY_SCHEMA_VERSION literally (only import it)
		expect(indexSrc).not.toMatch(/const\s+ACCESSORY_SCHEMA_VERSION\s*=\s*\d+/);
		expect(indexSrc).toMatch(/require\(['"]\.\/lib\/constants['"]\)/);
	});
	test('lib/DeviceAccessory.js imports from lib/constants.js (no duplicate constant)', () => {
		const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'DeviceAccessory.js'), 'utf8');
		expect(src).not.toMatch(/const\s+ACCESSORY_SCHEMA_VERSION\s*=\s*\d+/);
		expect(src).toMatch(/require\(['"]\.\/constants['"]\)/);
	});
});

describe('HAP-compliance: RotationSpeed minStep follows fan-mode count', () => {
	test('minStep matches the number of supported fan modes', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		const climate = makeFakeClimateEntity({ supportedFanModes: [3, 4, 5] });  // LOW/MED/HIGH = 3 modes
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate },
			platform,
		});
		const acc = platform.accessories[0];
		const heaterCooler = acc.getService(Service.HeaterCooler);
		const rs = heaterCooler.getCharacteristic(Characteristic.RotationSpeed);
		// What matters is not the specific number but that the step lands on
		// every percentage the plugin will report, and that 0 and 100 are both
		// selectable. With LOW/MED/HIGH the anchors are 0/50/100, so step = 50.
		expect(rs.props.minValue).toBe(0);
		expect(rs.props.maxValue).toBe(100);
		expect(100 % rs.props.minStep).toBe(0);
		expect(rs.props.minStep).toBe(50);
	});
});

describe('ConfiguredName persistence across restarts', () => {
	test('user rename in Apple Home is not clobbered when accessory loads from cache', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};

		// First boot: fresh accessory, plugin seeds ConfiguredName from config name
		new DeviceAccessory({
			device: { name: 'Original Name', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate: makeFakeClimateEntity() },
			platform,
		});
		const acc = platform.accessories[0];
		const heaterCooler = acc.getService(Service.HeaterCooler);
		expect(heaterCooler.getCharacteristic(Characteristic.ConfiguredName).value).toBe('Original Name');

		// Simulate the user renaming via Apple Home (Apple Home writes ConfiguredName)
		heaterCooler.getCharacteristic(Characteristic.ConfiguredName).updateValue('User Chosen Name');

		// Second boot (Homebridge restart): same UUID → cached accessory reused.
		// The plugin must NOT overwrite the user-chosen ConfiguredName.
		new DeviceAccessory({
			device: { name: 'Original Name', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate: makeFakeClimateEntity() },
			platform,
		});
		const heaterCooler2 = platform.accessories[0].getService(Service.HeaterCooler);
		expect(heaterCooler2.getCharacteristic(Characteristic.ConfiguredName).value).toBe('User Chosen Name');
	});

	test('newly-enabled companion service on cached accessory still gets ConfiguredName seeded', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};

		new DeviceAccessory({
			device: { name: 'Original Name', host: '192.168.1.10', disableBeeperSwitch: true },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate: makeFakeClimateEntity() },
			platform,
		});
		expect(platform.accessories[0].getServiceById(Service.Switch, 'beeper')).toBeUndefined();

		const beeperSwitch = { type: 'Switch', name: 'Beeper', config: { name: 'Beeper', objectId: 'beeper' }, state: { state: false }, on: () => {}, setState: () => {} };
		new DeviceAccessory({
			device: { name: 'Original Name', host: '192.168.1.10', disableBeeperSwitch: false },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate: makeFakeClimateEntity(), beeperSwitch },
			platform,
		});

		const beeper = platform.accessories[0].getServiceById(Service.Switch, 'beeper');
		expect(beeper).toBeDefined();
		expect(beeper.getCharacteristic(Characteristic.ConfiguredName).value).toBe('Original Name Beeper');
	});
});

describe('Initial target mode follows advertised capabilities', () => {
	test('heat-only device does not cache COOL as the power-on restore mode', () => {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate: makeFakeClimateEntity({ supportedModes: [0, 3], state: { mode: 0 } }) },
			platform,
		});
		expect(platform.accessories[0].context.lastTargetState).toBe(3);
	});
});

describe('Per-device disable flags override platform defaults bidirectionally', () => {
	function buildAccessory({ platformOverrides = {}, deviceOverrides = {} } = {}) {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		Object.assign(platform, platformOverrides);
		// Beeper switch entity present so service creation only depends on the disable flag.
		const beeperSwitch = { type: 'Switch', name: 'Beeper', config: { name: 'Beeper', objectId: 'beeper' }, state: { state: false }, on: () => {}, setState: () => {} };
		const climate = makeFakeClimateEntity();
		new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10', ...deviceOverrides },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
			entities: { climate, beeperSwitch },
			platform,
		});
		return platform.accessories[0];
	}

	test('platform=true, device unset → service hidden', () => {
		const acc = buildAccessory({ platformOverrides: { disableBeeperSwitch: true } });
		expect(acc.getServiceById(Service.Switch, 'beeper')).toBeUndefined();
	});

	test('platform=true, device=false → service shown (re-enabled per-device)', () => {
		const acc = buildAccessory({
			platformOverrides: { disableBeeperSwitch: true },
			deviceOverrides: { disableBeeperSwitch: false },
		});
		expect(acc.getServiceById(Service.Switch, 'beeper')).toBeDefined();
	});

	test('platform=false, device=true → service hidden (disabled per-device)', () => {
		const acc = buildAccessory({
			platformOverrides: { disableBeeperSwitch: false },
			deviceOverrides: { disableBeeperSwitch: true },
		});
		expect(acc.getServiceById(Service.Switch, 'beeper')).toBeUndefined();
	});

	test('platform=false, device unset → service shown (inherits)', () => {
		const acc = buildAccessory({ platformOverrides: { disableBeeperSwitch: false } });
		expect(acc.getServiceById(Service.Switch, 'beeper')).toBeDefined();
	});
});

/**
 * HAP-compliance tests: regression net for AccessoryCategory, addLinkedService,
 * setPrimaryService, ConfiguredName, and Identify-handler binding.
 *
 * Uses a fake platform / fake HAP API shim. We don't import HAP-NodeJS — instead
 * we mock just enough surface for DeviceAccessory's constructor to run, and we
 * inspect what it called on the fake.
 */

const fs = require('fs');
const path = require('path');
const DeviceAccessory = require('../../lib/DeviceAccessory');

// --- Fakes ---------------------------------------------------------------

class FakeCharacteristic {
	constructor(displayName, uuid) {
		this.displayName = displayName;
		this.UUID = uuid;
		this.props = {};
		this.value = null;
		this._handlers = {};
	}
	setProps(p) { Object.assign(this.props, p); return this; }
	onSet(fn) { this._handlers.set = fn; return this; }
	onGet(fn) { this._handlers.get = fn; return this; }
	updateValue(v) { this.value = v; return this; }
	setCharacteristic(/* charCtor, value */) { return this; }
	getCharacteristic() { return this; }
	addOptionalCharacteristic() {}
	getDefaultValue() { return null; }
}

function makeCharCtor(name, uuid) {
	class C extends FakeCharacteristic {
		constructor() { super(name, uuid); }
	}
	C.UUID = uuid;
	return C;
}

const Characteristic = {
	Manufacturer: makeCharCtor('Manufacturer', '00000020-0000-1000-8000-0026BB765291'),
	Model: makeCharCtor('Model', '00000021-0000-1000-8000-0026BB765291'),
	SerialNumber: makeCharCtor('SerialNumber', '00000030-0000-1000-8000-0026BB765291'),
	FirmwareRevision: makeCharCtor('FirmwareRevision', '00000052-0000-1000-8000-0026BB765291'),
	Name: makeCharCtor('Name', '00000023-0000-1000-8000-0026BB765291'),
	Identify: makeCharCtor('Identify', '00000014-0000-1000-8000-0026BB765291'),
	ConfiguredName: makeCharCtor('ConfiguredName', '000000E3-0000-1000-8000-0026BB765291'),
	Active: makeCharCtor('Active', '000000B0-0000-1000-8000-0026BB765291'),
	CurrentHeaterCoolerState: Object.assign(makeCharCtor('CurrentHeaterCoolerState', '000000B1-0000-1000-8000-0026BB765291'), {
		INACTIVE: 0, IDLE: 1, HEATING: 2, COOLING: 3,
	}),
	TargetHeaterCoolerState: Object.assign(makeCharCtor('TargetHeaterCoolerState', '000000B2-0000-1000-8000-0026BB765291'), {
		AUTO: 0, HEAT: 1, COOL: 2,
	}),
	CurrentTemperature: makeCharCtor('CurrentTemperature', '00000011-0000-1000-8000-0026BB765291'),
	CoolingThresholdTemperature: makeCharCtor('CoolingThresholdTemperature', '0000000D-0000-1000-8000-0026BB765291'),
	HeatingThresholdTemperature: makeCharCtor('HeatingThresholdTemperature', '00000012-0000-1000-8000-0026BB765291'),
	SwingMode: makeCharCtor('SwingMode', '000000B6-0000-1000-8000-0026BB765291'),
	RotationSpeed: makeCharCtor('RotationSpeed', '00000029-0000-1000-8000-0026BB765291'),
	On: makeCharCtor('On', '00000025-0000-1000-8000-0026BB765291'),
	StatusActive: makeCharCtor('StatusActive', '00000075-0000-1000-8000-0026BB765291'),
	StatusFault: Object.assign(makeCharCtor('StatusFault', '00000077-0000-1000-8000-0026BB765291'), {
		NO_FAULT: 0, GENERAL_FAULT: 1,
	}),
	CurrentRelativeHumidity: makeCharCtor('CurrentRelativeHumidity', '00000010-0000-1000-8000-0026BB765291'),
};

class FakeService {
	constructor(displayName, uuid, subtype) {
		this.displayName = displayName;
		this.UUID = uuid;
		this.subtype = subtype;
		this.characteristics = new Map();
		this.linkedServices = [];
		this.isPrimaryService = false;
		this._addedOptional = new Set();
	}
	getCharacteristic(charCtor) {
		if (!this.characteristics.has(charCtor.UUID)) {
			this.characteristics.set(charCtor.UUID, new charCtor());
		}
		return this.characteristics.get(charCtor.UUID);
	}
	testCharacteristic(charCtor) {
		return this.characteristics.has(charCtor.UUID) || this._addedOptional.has(charCtor.UUID);
	}
	addOptionalCharacteristic(charCtor) {
		this._addedOptional.add(charCtor.UUID);
	}
	setCharacteristic(charCtor, value) {
		this.getCharacteristic(charCtor).updateValue(value);
		return this;
	}
	updateCharacteristic(charCtor, value) {
		this.getCharacteristic(charCtor).updateValue(value);
		return this;
	}
	setPrimaryService(v) { this.isPrimaryService = !!v; return this; }
	addLinkedService(svc) { this.linkedServices.push(svc); return this; }
}

function makeSvcCtor(name, uuid) {
	class S extends FakeService {
		constructor(displayName, subtype) {
			super(displayName || name, uuid, subtype);
		}
	}
	S.UUID = uuid;
	return S;
}

const Service = {
	AccessoryInformation: makeSvcCtor('AccessoryInformation', '0000003E-0000-1000-8000-0026BB765291'),
	HeaterCooler: makeSvcCtor('HeaterCooler', '000000BC-0000-1000-8000-0026BB765291'),
	HumiditySensor: makeSvcCtor('HumiditySensor', '00000082-0000-1000-8000-0026BB765291'),
	TemperatureSensor: makeSvcCtor('TemperatureSensor', '0000008A-0000-1000-8000-0026BB765291'),
	Switch: makeSvcCtor('Switch', '00000049-0000-1000-8000-0026BB765291'),
};

const Categories = {
	OTHER: 1,
	BRIDGE: 2,
	THERMOSTAT: 9,
	HEATER: 20,
	AIR_CONDITIONER: 21,
};

class FakePlatformAccessory {
	constructor(displayName, uuid, category) {
		this.displayName = displayName;
		this.UUID = uuid;
		this.category = category || Categories.OTHER;
		this.services = [];
		this.context = {};
	}
	getService(serviceCtor) {
		return this.services.find(s => s.UUID === serviceCtor.UUID);
	}
	getServiceById(serviceCtor, subtype) {
		return this.services.find(s => s.UUID === serviceCtor.UUID && s.subtype === subtype);
	}
	addService(serviceCtor, displayName, subtype) {
		const svc = new serviceCtor(displayName, subtype);
		this.services.push(svc);
		return svc;
	}
	removeService(svc) {
		const idx = this.services.indexOf(svc);
		if (idx >= 0) this.services.splice(idx, 1);
	}
}

function makeFakePlatform() {
	return {
		log: Object.assign(function () {}, {
			info: function () {}, warn: function () {}, error: function () {}, debug: function () {},
			easyDebug: function () {},
		}),
		api: {
			hap: {
				Service,
				Characteristic,
				Categories,
				HAPStatus: { SERVICE_COMMUNICATION_FAILURE: -70402 },
				HapStatusError: class extends Error { constructor(s) { super(`HapStatusError ${s}`); } },
				uuid: { generate: input => `uuid:${input}` },
			},
			platformAccessory: FakePlatformAccessory,
		},
		accessories: [],
		PLUGIN_NAME: 'homebridge-slwf-01pro',
		PLATFORM_NAME: 'SLWFOnePro',
		registerPlatformAccessoriesCalls: [],
	};
}

// Stub the fakegato-history require since we don't want to test that path
jest.mock('fakegato-history', () => null, { virtual: true });

function makeFakeClimateEntity({ supportedModes = [0, 2, 3, 6], supportedFanModes = [2, 3, 4, 5], supportedSwingModes = [0, 1] } = {}) {
	const handlers = {};
	return {
		type: 'Climate',
		name: 'Air Conditioner',
		config: {
			uniqueId: 'air_conditioner-fae810',
			objectId: 'air_conditioner',
			key: 1234,
			supportedModesList: supportedModes,
			supportedFanModesList: supportedFanModes,
			supportedSwingModesList: supportedSwingModes,
			visualMinTemperature: 17,
			visualMaxTemperature: 30,
			visualTargetTemperatureStep: 0.5,
		},
		state: {
			mode: 2,                 // COOL
			currentTemperature: 22,
			targetTemperature: 21,
			fanMode: 4,              // MEDIUM
			swingMode: 0,
		},
		on(event, fn) { handlers[event] = fn; },
		once(event, fn) { handlers[event] = fn; },
		off() {},
	};
}

// `buildAccessory` and a `beforeAll` stub were here in earlier drafts; tests inline
// the construction so they can assert different things per case. Removed for clarity.

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
		// 100/3 = 33 → minStep should be 33 (Math.floor)
		expect(rs.props.minStep).toBe(33);
	});
});

/**
 * Shared fake HAP / Homebridge shim for the accessory tests.
 *
 * We deliberately do not import HAP-NodeJS: these fakes implement just enough
 * surface for DeviceAccessory's constructor to run, so the tests can inspect
 * what it called rather than what HAP did with it.
 *
 * Lives outside test/unit so Jest doesn't collect it as a suite.
 */

const { EVE_POWER_UUID } = require('../../lib/eve');
/**
 * HAP-compliance tests: regression net for AccessoryCategory, addLinkedService,
 * setPrimaryService, ConfiguredName, and Identify-handler binding.
 *
 * Uses a fake platform / fake HAP API shim. We don't import HAP-NodeJS — instead
 * we mock just enough surface for DeviceAccessory's constructor to run, and we
 * inspect what it called on the fake.
 */


// --- Fakes ---------------------------------------------------------------

class FakeCharacteristic {
	constructor(displayName, uuid, props = {}) {
		this.displayName = displayName;
		this.UUID = uuid;
		this.props = { ...props };
		this.value = null;
		this._handlers = {};
		this.eventNotifications = [];
	}
	setProps(p) { Object.assign(this.props, p); return this; }
	onSet(fn) { this._handlers.set = fn; return this; }
	onGet(fn) { this._handlers.get = fn; return this; }
	updateValue(v) { this.value = v; return this; }
	sendEventNotification(v) { this.value = v; this.eventNotifications.push(v); return this; }
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

class CharacteristicBase extends FakeCharacteristic {}
CharacteristicBase.Formats = { FLOAT: 'float' };
CharacteristicBase.Perms = { READ: 'pr', WRITE: 'pw', NOTIFY: 'ev' };

const Characteristic = Object.assign(CharacteristicBase, {
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
	OutletInUse: makeCharCtor('OutletInUse', '00000026-0000-1000-8000-0026BB765291'),
});

class FakeService {
	constructor(displayName, uuid, subtype) {
		this.displayName = displayName;
		this.UUID = uuid;
		this.subtype = subtype;
		this.characteristics = new Map();
		this.linkedServices = [];
		this.isPrimaryService = false;
		this.isHiddenService = false;
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
	addCharacteristic(input) {
		const characteristic = typeof input === 'function' ? new input() : input;
		this.characteristics.set(characteristic.UUID, characteristic);
		return characteristic;
	}
	removeCharacteristic(characteristic) {
		if (characteristic) this.characteristics.delete(characteristic.UUID);
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
	setHiddenService(v) { this.isHiddenService = !!v; return this; }
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
	Outlet: makeSvcCtor('Outlet', '00000047-0000-1000-8000-0026BB765291'),
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


function makeFakeClimateEntity({ supportedModes = [0, 2, 3, 6], supportedFanModes = [2, 3, 4, 5], supportedSwingModes = [0, 1], state = {} } = {}) {
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
			...state,
		},
		on(event, fn) { handlers[event] = fn; },
		once(event, fn) { handlers[event] = fn; },
		off() {},
		emit(event, payload) { if (handlers[event]) handlers[event](payload); },
	};
}

// `buildAccessory` and a `beforeAll` stub were here in earlier drafts; tests inline
// the construction so they can assert different things per case. Removed for clarity.

module.exports = {
	FakeCharacteristic,
	CharacteristicBase,
	makeCharCtor,
	Characteristic,
	FakeService,
	makeSvcCtor,
	Service,
	Categories,
	FakePlatformAccessory,
	makeFakePlatform,
	makeFakeClimateEntity,
	EVE_POWER_UUID,
};

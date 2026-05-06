const stateManager = require('./stateManager');
const { makeEveClasses } = require('./eve');
const {
	ESP_MODE,
	deriveCurrentHeaterCoolerState,
	espModeToHkTargetState,
	pickDefaultSwingValue,
	fanModeToSpeed,
	chooseInitialTargetMode,
	pickAutoMode,
	supportsCool,
	supportsHeat,
	deriveDeviceId,
} = require('./state');

let FakeGatoHistoryService = null;
try {
	FakeGatoHistoryService = require('fakegato-history');
} catch (_e) {
	FakeGatoHistoryService = null;
}

let Service;
let Characteristic;

const SET_DEBOUNCE_MS = 600;
const PRIMARY_MODES = [ESP_MODE.COOL, ESP_MODE.HEAT, ESP_MODE.AUTO, ESP_MODE.HEAT_COOL];

const UUID_NAMESPACE = 'homebridge-slwf-01pro';
const ACCESSORY_SCHEMA_VERSION = 2;

function readSensorValue(entity) {
	if (!entity || !entity.state) return null;
	if (entity.state.missingState) return null;
	const v = entity.state.state;
	if (v == null || !Number.isFinite(v)) return null;
	return v;
}

function clampRange(value, min, max) {
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

const SUPPLEMENTARY_SWITCH_KEYS = ['dryMode', 'fanOnlyMode', 'beeperSwitch', 'displaySwitch'];
const OPTIONAL_SENSOR_KEYS = ['humiditySensor', 'outdoorTempSensor', 'powerSensor'];

class DeviceAccessory {
	constructor({ device, deviceInfo, entities, platform }) {
		Service = platform.api.hap.Service;
		Characteristic = platform.api.hap.Characteristic;

		this.platform = platform;
		this.device = device;
		this.deviceInfo = deviceInfo || {};
		this.entities = entities;
		this.log = platform.log;
		this.api = platform.api;

		const climate = entities.climate;
		if (!climate) throw new Error('DeviceAccessory requires a climate entity');

		this.esphome = climate;
		this.config = climate.config;
		this.name = device.name;
		this.displayName = this.name;
		this.id = deriveDeviceId({
			climateConfig: climate.config,
			deviceInfo: this.deviceInfo,
			deviceHost: device.host,
		});
		if (!this.id) {
			throw new Error(`Cannot derive a stable identifier for "${this.name}" — climate entity has no uniqueId/objectId/key, deviceInfo has no MAC, and no host was provided.`);
		}
		this.host = device.host;
		this.serial = this.deviceInfo.macAddress || this.id;
		this.manufacturer = this.deviceInfo.manufacturer || 'ESPHome';
		this.model = this.deviceInfo.model || climate.name || 'ESPHome AC';
		this.firmwareRevision = this.deviceInfo.esphomeVersion || undefined;

		this.state = climate.state || {};
		this.connected = true;
		this.pending = [];
		this.setDelay = SET_DEBOUNCE_MS;
		this._sendTimeout = null;

		this.swingModeValue = pickDefaultSwingValue(this.config.supportedSwingModesList);

		this.UUID = this.api.hap.uuid.generate(`${UUID_NAMESPACE}:${this.id}`);
		this.accessory = platform.accessories.find(acc => acc.UUID === this.UUID);

		if (!this.accessory) {
			this.log(`Creating new ESPHome AC accessory: "${this.name}"`);
			this.accessory = new this.api.platformAccessory(this.name, this.UUID);
			this.accessory.context.schemaVersion = ACCESSORY_SCHEMA_VERSION;
			this.accessory.context.deviceId = this.id;
			this.accessory.context.host = this.host;
			this.accessory.context.lastTargetState = chooseInitialTargetMode(this.state.mode);
			platform.accessories.push(this.accessory);
			this.api.registerPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [this.accessory]);
		} else {
			this.log(`ESPHome device "${this.name}" reconnected.`);
			this.accessory.context.schemaVersion = ACCESSORY_SCHEMA_VERSION;
			this.accessory.context.host = this.host;
			if (PRIMARY_MODES.includes(this.state.mode)) {
				this.accessory.context.lastTargetState = this.state.mode;
			}
		}

		this.setupAccessoryInformation();
		this.addClimateService();

		this.addOptionalSensorServices();
		this.addOptionalSwitchServices();
		this.addModeSwitchServices();

		this.removeDisabledServices();

		this.esphome.on('state', this.updateClimateState.bind(this));
		this.attachOptionalEntityListeners();
	}

	settingDisabled(key) {
		return Boolean(this.device[key] || this.platform[key]);
	}

	setupAccessoryInformation() {
		const info = this.accessory.getService(Service.AccessoryInformation)
			|| this.accessory.addService(Service.AccessoryInformation);
		info.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial);
		if (this.firmwareRevision) {
			info.setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision);
		}
	}

	supportsCooling() {
		return supportsCool(this.config.supportedModesList);
	}

	supportsHeating() {
		return supportsHeat(this.config.supportedModesList);
	}

	supportsAuto() {
		return pickAutoMode(this.config.supportedModesList) !== null;
	}

	supportsFanControl() {
		return this.config.supportedFanModesList && this.config.supportedFanModesList.length > 1;
	}

	isModeActive(mode) {
		return mode != null && mode !== ESP_MODE.OFF;
	}

	addClimateService() {
		this.HeaterCoolerService = this.accessory.getService(Service.HeaterCooler)
			|| this.accessory.addService(Service.HeaterCooler, this.name);

		this.HeaterCoolerService.getCharacteristic(Characteristic.Active)
			.onSet(stateManager.set.Active.bind(this))
			.updateValue(this.isModeActive(this.state.mode) ? 1 : 0);

		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
			.updateValue(deriveCurrentHeaterCoolerState(this.state));

		const validTargetStates = [];
		if (this.config.supportedModesList.includes(ESP_MODE.COOL)) validTargetStates.push(Characteristic.TargetHeaterCoolerState.COOL);
		if (this.config.supportedModesList.includes(ESP_MODE.HEAT)) validTargetStates.push(Characteristic.TargetHeaterCoolerState.HEAT);
		if (this.supportsAuto()) validTargetStates.push(Characteristic.TargetHeaterCoolerState.AUTO);
		if (validTargetStates.length === 0) validTargetStates.push(Characteristic.TargetHeaterCoolerState.AUTO);

		this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.setProps({ validValues: validTargetStates })
			.onSet(stateManager.set.TargetHeaterCoolerState.bind(this))
			.updateValue(espModeToHkTargetState(this.accessory.context.lastTargetState));

		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({ minValue: -100, maxValue: 100, minStep: 0.1 })
			.updateValue(this.state.currentTemperature);

		const tempProps = {
			minValue: this.config.visualMinTemperature,
			maxValue: this.config.visualMaxTemperature,
			minStep: this.config.visualTargetTemperatureStep,
		};

		if (this.supportsCooling()) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
				.setProps(tempProps)
				.onSet(stateManager.set.CoolingThresholdTemperature.bind(this))
				.updateValue(this.clampTargetTemperature(this.state.targetTemperature));
		}
		if (this.supportsHeating()) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
				.setProps(tempProps)
				.onSet(stateManager.set.HeatingThresholdTemperature.bind(this))
				.updateValue(this.clampTargetTemperature(this.state.targetTemperature));
		}

		if (this.swingModeValue) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.SwingMode)
				.onSet(stateManager.set.SwingMode.bind(this))
				.updateValue(this.state.swingMode ? 1 : 0);
		}
		if (this.supportsFanControl()) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed)
				.onSet(stateManager.set.RotationSpeed.bind(this))
				.updateValue(fanModeToSpeed(this.state.fanMode, this.config.supportedFanModesList));
		}

		this.HeaterCoolerService.getCharacteristic(Characteristic.StatusActive).updateValue(true);
		this.HeaterCoolerService.getCharacteristic(Characteristic.StatusFault)
			.updateValue(Characteristic.StatusFault.NO_FAULT);

		this.updateClimateState(this.state);
	}

	setConnectedStatus(connected) {
		this.connected = connected;
		if (!this.HeaterCoolerService || !Characteristic) return;
		try {
			this.HeaterCoolerService.getCharacteristic(Characteristic.StatusActive).updateValue(!!connected);
			this.HeaterCoolerService.getCharacteristic(Characteristic.StatusFault)
				.updateValue(connected ? Characteristic.StatusFault.NO_FAULT : Characteristic.StatusFault.GENERAL_FAULT);
		} catch (err) {
			this.log.easyDebug(`setConnectedStatus failed for ${this.name}: ${err.message || err}`);
		}
	}

	clampTargetTemperature(value) {
		if (value == null) return value;
		const min = this.config.visualMinTemperature;
		const max = this.config.visualMaxTemperature;
		if (value < min) return min;
		if (value > max) return max;
		return value;
	}

	addOptionalSensorServices() {
		if (this.entities.humiditySensor && !this.settingDisabled('disableHumiditySensor')) {
			this.HumidityService = this.accessory.getServiceById(Service.HumiditySensor, 'humidity')
				|| this.accessory.addService(Service.HumiditySensor, `${this.name} Humidity`, 'humidity');
			const initial = readSensorValue(this.entities.humiditySensor);
			if (initial != null) this.HumidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, clampRange(initial, 0, 100));
		}

		if (this.entities.powerSensor && !this.settingDisabled('disablePowerSensor')) {
			this.attachPowerCharacteristic();
		}

		if (this.entities.outdoorTempSensor && !this.settingDisabled('disableOutdoorTempSensor')) {
			this.OutdoorTempService = this.accessory.getServiceById(Service.TemperatureSensor, 'outdoor')
				|| this.accessory.addService(Service.TemperatureSensor, `${this.name} Outdoor`, 'outdoor');
			this.OutdoorTempService.getCharacteristic(Characteristic.CurrentTemperature)
				.setProps({ minValue: -100, maxValue: 100, minStep: 0.1 });
			const initial = readSensorValue(this.entities.outdoorTempSensor);
			if (initial != null) this.OutdoorTempService.updateCharacteristic(Characteristic.CurrentTemperature, clampRange(initial, -100, 100));
		}
	}

	addOptionalSwitchServices() {
		if (this.entities.beeperSwitch && !this.settingDisabled('disableBeeperSwitch')) {
			this.BeeperService = this.accessory.getServiceById(Service.Switch, 'beeper')
				|| this.accessory.addService(Service.Switch, `${this.name} Beeper`, 'beeper');
			this.BeeperService.getCharacteristic(Characteristic.On)
				.onSet(value => {
					try {
						this.entities.beeperSwitch.setState(!!value);
					} catch (err) {
						this.log.error(`${this.name} - Beeper set failed: ${err.message || err}`);
						throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
					}
				})
				.updateValue(Boolean(this.entities.beeperSwitch.state && this.entities.beeperSwitch.state.state));
		}

		if (this.entities.displayButton && !this.settingDisabled('disableDisplaySwitch')) {
			this.DisplayService = this.accessory.getServiceById(Service.Switch, 'display')
				|| this.accessory.addService(Service.Switch, `${this.name} Display`, 'display');
			this.DisplayService.getCharacteristic(Characteristic.On)
				.onSet(value => {
					if (!value) return;
					try {
						this.entities.displayButton.push();
					} catch (err) {
						this.log.error(`${this.name} - Display toggle failed: ${err.message || err}`);
						throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
					}
					setTimeout(() => this.DisplayService.updateCharacteristic(Characteristic.On, false), 250);
				})
				.updateValue(false);
		}
	}

	addModeSwitchServices() {
		if (this.config.supportedModesList.includes(ESP_MODE.DRY) && !this.settingDisabled('disableDryMode')) {
			this.DryService = this.accessory.getServiceById(Service.Switch, 'dry')
				|| this.accessory.addService(Service.Switch, `${this.name} Dry`, 'dry');
			this.DryService.getCharacteristic(Characteristic.On)
				.onSet(value => this.handleModeSwitch(ESP_MODE.DRY, !!value, 'DRY'))
				.updateValue(this.state.mode === ESP_MODE.DRY ? 1 : 0);
		}

		if (this.config.supportedModesList.includes(ESP_MODE.FAN_ONLY) && !this.settingDisabled('disableFanOnlyMode')) {
			this.FanOnlyService = this.accessory.getServiceById(Service.Switch, 'fanOnly')
				|| this.accessory.addService(Service.Switch, `${this.name} Fan Only`, 'fanOnly');
			this.FanOnlyService.getCharacteristic(Characteristic.On)
				.onSet(value => this.handleModeSwitch(ESP_MODE.FAN_ONLY, !!value, 'FAN_ONLY'))
				.updateValue(this.state.mode === ESP_MODE.FAN_ONLY ? 1 : 0);
		}
	}

	async handleModeSwitch(targetMode, on, label) {
		if (this.state.mode == null) return;
		if (this.state.mode === targetMode && on) return;
		if (this.state.mode !== targetMode && !on) return;

		if (on) {
			if (PRIMARY_MODES.includes(this.state.mode)) {
				this.accessory.context.preSupplementaryMode = this.state.mode;
			}
			this.state.mode = targetMode;
			this.log(`${this.name} - Setting AC Mode to ${label}`);
		} else {
			const restore = this.accessory.context.preSupplementaryMode
				|| (PRIMARY_MODES.includes(this.accessory.context.lastTargetState) ? this.accessory.context.lastTargetState : ESP_MODE.OFF);
			this.state.mode = restore;
			this.accessory.context.preSupplementaryMode = null;
			this.log(`${this.name} - Leaving ${label}, restoring to mode ${restore}`);
		}
		stateManager.markDirty(this, 'mode');
		this.syncModeSwitches(this.state.mode);
		try {
			await stateManager.sendState(this);
		} catch (err) {
			this.log.error(`${this.name} - mode switch send failed: ${err.message || err}`);
			throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
		}
	}

	syncModeSwitches(currentMode) {
		if (this.DryService) this.DryService.updateCharacteristic(Characteristic.On, currentMode === ESP_MODE.DRY ? 1 : 0);
		if (this.FanOnlyService) this.FanOnlyService.updateCharacteristic(Characteristic.On, currentMode === ESP_MODE.FAN_ONLY ? 1 : 0);
	}

	removeDisabledServices() {
		if (this.settingDisabled('disableHumiditySensor')) this.removeServiceIfPresent(Service.HumiditySensor);
		if (this.settingDisabled('disableOutdoorTempSensor')) this.removeServiceById(Service.TemperatureSensor, 'outdoor');
		if (this.settingDisabled('disableBeeperSwitch')) this.removeServiceById(Service.Switch, 'beeper');
		if (this.settingDisabled('disableDisplaySwitch')) this.removeServiceById(Service.Switch, 'display');
		if (this.settingDisabled('disableDryMode')) this.removeServiceById(Service.Switch, 'dry');
		if (this.settingDisabled('disableFanOnlyMode')) this.removeServiceById(Service.Switch, 'fanOnly');

		if (!this.entities.humiditySensor) this.removeServiceIfPresent(Service.HumiditySensor);
		if (!this.entities.outdoorTempSensor) this.removeServiceById(Service.TemperatureSensor, 'outdoor');
		if (!this.entities.beeperSwitch) this.removeServiceById(Service.Switch, 'beeper');
		if (!this.entities.displayButton) this.removeServiceById(Service.Switch, 'display');
		if (!this.config.supportedModesList.includes(ESP_MODE.DRY)) this.removeServiceById(Service.Switch, 'dry');
		if (!this.config.supportedModesList.includes(ESP_MODE.FAN_ONLY)) this.removeServiceById(Service.Switch, 'fanOnly');
	}

	removeServiceIfPresent(serviceType) {
		const svc = this.accessory.getService(serviceType);
		if (svc) this.accessory.removeService(svc);
	}

	removeServiceById(serviceType, subtype) {
		const svc = this.accessory.getServiceById(serviceType, subtype);
		if (svc) this.accessory.removeService(svc);
	}

	attachPowerCharacteristic() {
		const eve = makeEveClasses(this.api);
		if (!eve) return;
		this._eve = eve;
		this.PowerCharacteristic = this.HeaterCoolerService.getCharacteristic(eve.CurrentPowerConsumption);
		const initial = readSensorValue(this.entities.powerSensor);
		if (initial != null) this.PowerCharacteristic.updateValue(Math.max(0, initial));

		if (FakeGatoHistoryService && !this.HistoryService) {
			try {
				this.HistoryService = new FakeGatoHistoryService('energy', this.accessory, { storage: 'fs', log: this.log });
			} catch (err) {
				this.log.easyDebug(`fakegato-history init failed for ${this.name}: ${err.message || err}`);
			}
		}
	}

	attachOptionalEntityListeners() {
		if (this.entities.humiditySensor && this.HumidityService) {
			this.entities.humiditySensor.on('state', s => {
				const v = readSensorValue({ state: s });
				if (v == null) return;
				this.HumidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, clampRange(v, 0, 100));
			});
		}
		if (this.entities.outdoorTempSensor && this.OutdoorTempService) {
			this.entities.outdoorTempSensor.on('state', s => {
				const v = readSensorValue({ state: s });
				if (v == null) return;
				this.OutdoorTempService.updateCharacteristic(Characteristic.CurrentTemperature, clampRange(v, -100, 100));
			});
		}
		if (this.entities.beeperSwitch && this.BeeperService) {
			this.entities.beeperSwitch.on('state', s => {
				if (s == null || s.state == null) return;
				this.BeeperService.updateCharacteristic(Characteristic.On, Boolean(s.state));
			});
		}
		if (this.entities.powerSensor && this.PowerCharacteristic) {
			this.entities.powerSensor.on('state', s => {
				const v = readSensorValue({ state: s });
				if (v == null) return;
				const power = Math.max(0, v);
				this.PowerCharacteristic.updateValue(power);
				if (this.HistoryService) {
					try {
						this.HistoryService.addEntry({ time: Math.floor(Date.now() / 1000), power });
					} catch (err) {
						this.log.easyDebug(`fakegato addEntry failed: ${err.message || err}`);
					}
				}
			});
		}
	}

	updateClimateState(state) {
		this.log.easyDebug(`${this.name} entity state:`);
		this.log.easyDebug(state);

		this.state = state;
		this.syncModeSwitches(this.state.mode);

		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature)
			.updateValue(this.state.currentTemperature);

		if (this.state.mode === ESP_MODE.OFF) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.Active).updateValue(0);
			this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(0);
			return;
		}

		if (PRIMARY_MODES.includes(this.state.mode)) {
			this.accessory.context.lastTargetState = this.state.mode;
			this.HeaterCoolerService.getCharacteristic(Characteristic.Active).updateValue(1);

			const clampedTarget = this.clampTargetTemperature(this.state.targetTemperature);
			if (this.supportsHeating()) {
				this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature).updateValue(clampedTarget);
			}
			if (this.supportsCooling()) {
				this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(clampedTarget);
			}

			if (this.swingModeValue) {
				this.HeaterCoolerService.getCharacteristic(Characteristic.SwingMode).updateValue(this.state.swingMode ? 1 : 0);
			}
			if (this.supportsFanControl()) {
				this.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed)
					.updateValue(fanModeToSpeed(this.state.fanMode, this.config.supportedFanModesList));
			}

			this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
				.updateValue(espModeToHkTargetState(this.state.mode));
			this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
				.updateValue(deriveCurrentHeaterCoolerState(this.state));
			return;
		}

		this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.updateValue(Characteristic.TargetHeaterCoolerState.AUTO);
		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
			.updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
	}
}

module.exports = DeviceAccessory;
module.exports.SUPPLEMENTARY_SWITCH_KEYS = SUPPLEMENTARY_SWITCH_KEYS;
module.exports.OPTIONAL_SENSOR_KEYS = OPTIONAL_SENSOR_KEYS;

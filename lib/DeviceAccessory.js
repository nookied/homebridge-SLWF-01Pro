const stateManager = require('./stateManager');
const { makeEveClasses } = require('./eve');
const {
	ESP_MODE,
	deriveCurrentHeaterCoolerState,
	espModeToHkTargetState,
	pickDefaultSwingValue,
	buildFanLadder,
	fanLadderMinStep,
	fanStateToSpeed,
	buildPresetList,
	activePresetEntry,
	presetSubtype,
	ESP_PRESET,
	chooseInitialTargetMode,
	pickAutoMode,
	supportsCool,
	supportsHeat,
	deriveDeviceId,
} = require('./state');

// fakegato-history is an OPTIONAL peer dependency, deliberately not installed by
// default: it hard-depends on googleapis (~194 MB) for a Google Drive storage
// backend this plugin never uses, and that tree carries advisories of its own.
// Live power readings work without it; only the Eve history graph needs it.
// NOTE: this module exports a FACTORY that must be called with the Homebridge
// api — `require('fakegato-history')(api)` returns the service class. Calling
// `new` on the factory itself sets fakegato's internal homebridge reference to
// whatever the first argument was and then dies on `homebridge.hap`, which is
// how Eve history silently never worked before this was corrected.
let FakeGatoHistoryFactory = null;
try {
	FakeGatoHistoryFactory = require('fakegato-history');
} catch (_e) {
	FakeGatoHistoryFactory = null;
}
// Warn once per Homebridge run, not once per AC.
let historyUnavailableWarned = false;

let Service;
let Characteristic;

const { UUID_NAMESPACE, ACCESSORY_SCHEMA_VERSION, DEFAULT_ESPHOME_PORT } = require('./constants');

const SET_DEBOUNCE_MS = 600;
const PRIMARY_MODES = [ESP_MODE.COOL, ESP_MODE.HEAT, ESP_MODE.AUTO, ESP_MODE.HEAT_COOL];
const SUPPLEMENTARY_MODES = [ESP_MODE.DRY, ESP_MODE.FAN_ONLY];

const DEFAULT_VISUAL_MIN_TEMP = 16;
const DEFAULT_VISUAL_MAX_TEMP = 30;
const DEFAULT_VISUAL_TEMP_STEP = 0.5;

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

function isPresent(value) {
	if (value == null) return false;
	if (typeof value === 'number' && !Number.isFinite(value)) return false;
	return true;
}

function safeUpdate(characteristic, value) {
	if (!characteristic) return;
	if (!isPresent(value)) return;
	characteristic.updateValue(value);
}

function sanitizeFirmwareRevision(raw) {
	if (typeof raw !== 'string' || raw.length === 0) return undefined;
	const match = raw.match(/^\d+(?:\.\d+){0,2}/);
	return match ? match[0] : undefined;
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
		this.manufacturer = this.deviceInfo.manufacturer || 'SMLIGHT';
		this.model = this.deviceInfo.model || climate.name || 'SLWF-01Pro';
		this.firmwareRevision = sanitizeFirmwareRevision(this.deviceInfo.esphomeVersion);

		this.state = climate.state || {};
		this.connected = true;
		this.pending = [];
		this.setDelay = SET_DEBOUNCE_MS;
		this._sendTimeout = null;

		this.swingModeValue = pickDefaultSwingValue(this.config.supportedSwingModesList);
		// One ladder covering both the standard fan modes and any custom ones
		// (Midea reports "silent"/"turbo" separately), and one entry per preset
		// the device can actually be put into.
		this.fanLadder = buildFanLadder(this.config.supportedFanModesList, this.config.supportedCustomFanModesList);
		this.presetList = buildPresetList(this.config.supportedPresetsList, this.config.supportedCustomPresetsList);
		this.PresetServices = new Map();

		this.UUID = this.api.hap.uuid.generate(`${UUID_NAMESPACE}:${this.id}`);
		this.accessory = platform.accessories.find(acc => acc.UUID === this.UUID);

		if (!this.accessory) {
			this.log(`Creating new SLWF-01Pro accessory: "${this.name}"`);
			this.isNewAccessory = true;
			const category = (this.api.hap.Categories && this.api.hap.Categories.AIR_CONDITIONER) || 21;
			this.accessory = new this.api.platformAccessory(this.name, this.UUID, category);
			this.accessory.context.schemaVersion = ACCESSORY_SCHEMA_VERSION;
			this.accessory.context.deviceId = this.id;
			this.accessory.context.host = this.host;
			this.accessory.context.port = device.port || DEFAULT_ESPHOME_PORT;
			this.accessory.context.lastTargetState = chooseInitialTargetMode(this.state.mode, this.config.supportedModesList);
			platform.accessories.push(this.accessory);
			this.api.registerPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [this.accessory]);
		} else {
			this.log(`Device "${this.name}" reconnected.`);
			this.isNewAccessory = false;
			this.accessory.context.schemaVersion = ACCESSORY_SCHEMA_VERSION;
			this.accessory.context.host = this.host;
			this.accessory.context.port = device.port || DEFAULT_ESPHOME_PORT;
			if (PRIMARY_MODES.includes(this.state.mode)) {
				this.accessory.context.lastTargetState = chooseInitialTargetMode(this.state.mode, this.config.supportedModesList);
			}
		}

		if (!SUPPLEMENTARY_MODES.includes(this.state.mode)) {
			this.accessory.context.preSupplementaryMode = null;
		}

		this.setupAccessoryInformation();
		this.addClimateService();
		this.removeLegacyPowerCharacteristic();
		this.removeConnectionStatusCharacteristics();

		this.addOptionalSensorServices();
		this.addOptionalSwitchServices();
		this.addModeSwitchServices();
		this.addPresetServices();

		this.removeDisabledServices();
		this.linkOptionalServices();

		this.esphome.on('state', this.guarded('climate state update', this.updateClimateState.bind(this)));
		this.attachOptionalEntityListeners();
	}

	// ESPHome 'state' events fire outside any HomeKit call stack, so an exception
	// in a listener becomes an unhandled exception and can take the bridge down
	// with it. Homebridge requires plugins to catch and log their own errors, so
	// every listener attached to the transport goes through here.
	guarded(label, fn) {
		return (...args) => {
			try {
				fn(...args);
			} catch (err) {
				this.log.error(`${this.name} - ${label} failed: ${err.message || err}`);
				this.log.easyDebug(err);
			}
		};
	}

	linkOptionalServices() {
		if (!this.HeaterCoolerService || typeof this.HeaterCoolerService.addLinkedService !== 'function') return;
		const candidates = [
			this.HumidityService,
			this.OutdoorTempService,
			this.PowerService,
			this.BeeperService,
			this.DisplayService,
			this.DryService,
			this.FanOnlyService,
			...this.PresetServices.values(),
		];
		for (const svc of candidates) {
			if (!svc) continue;
			try {
				if (Array.isArray(this.HeaterCoolerService.linkedServices) && this.HeaterCoolerService.linkedServices.includes(svc)) continue;
				this.HeaterCoolerService.addLinkedService(svc);
			} catch (err) {
				this.log.easyDebug(`linkOptionalServices: could not link ${svc.displayName}: ${err.message || err}`);
			}
		}
	}

	settingDisabled(key) {
		// Per-device override wins in either direction when the user sets it explicitly.
		// Otherwise inherit the platform-wide default. Symmetric override is required so
		// users can keep the platform default ("hide everything") and selectively enable
		// a service for a single AC by setting the per-device flag to false.
		if (this.device[key] !== undefined) return Boolean(this.device[key]);
		return Boolean(this.platform[key]);
	}

	setupAccessoryInformation() {
		const info = this.accessory.getService(Service.AccessoryInformation)
			|| this.accessory.addService(Service.AccessoryInformation);
		info.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
			.setCharacteristic(Characteristic.Model, this.model)
			.setCharacteristic(Characteristic.SerialNumber, this.serial)
			.setCharacteristic(Characteristic.Name, this.name);
		if (this.firmwareRevision) {
			info.setCharacteristic(Characteristic.FirmwareRevision, this.firmwareRevision);
		}
		// Bind a no-op Identify handler so HAP-NodeJS doesn't log "no Identify handler"
		// at every accessory startup, and so Apple Home's Identify button at least
		// produces a log entry the user can see.
		info.getCharacteristic(Characteristic.Identify).onSet(() => {
			this.log(`Identify: ${this.name}`);
		});
	}

	setConfiguredName(service, name) {
		if (!service || !Characteristic.ConfiguredName) return;
		try {
			if (service.testCharacteristic && !service.testCharacteristic(Characteristic.ConfiguredName)) {
				service.addOptionalCharacteristic(Characteristic.ConfiguredName);
			}
			const configuredName = service.getCharacteristic(Characteristic.ConfiguredName);
			// Preserve user-chosen names on cached services, but still seed ConfiguredName
			// when a newly-enabled companion service didn't exist in the cache yet.
			if (!this.isNewAccessory && typeof configuredName.value === 'string' && configuredName.value.length > 0) return;
			service.setCharacteristic(Characteristic.ConfiguredName, name);
		} catch (err) {
			this.log.easyDebug(`setConfiguredName(${name}) failed: ${err.message || err}`);
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
		return this.fanLadder.length > 1;
	}

	supportedModes() {
		return Array.isArray(this.config.supportedModesList) ? this.config.supportedModesList : [];
	}

	supportsMode(mode) {
		return this.supportedModes().includes(mode);
	}

	isModeActive(mode) {
		return mode != null && mode !== ESP_MODE.OFF;
	}

	addClimateService() {
		this.HeaterCoolerService = this.accessory.getService(Service.HeaterCooler)
			|| this.accessory.addService(Service.HeaterCooler, this.name);

		// Mark HeaterCooler as the accessory's primary service so Apple Home picks it
		// for the main tile when companion Switch services (DRY/FAN_ONLY/Beeper/Display) are present.
		if (typeof this.HeaterCoolerService.setPrimaryService === 'function') {
			this.HeaterCoolerService.setPrimaryService(true);
		}
		this.setConfiguredName(this.HeaterCoolerService, this.name);

		this.HeaterCoolerService.getCharacteristic(Characteristic.Active)
			.onSet(stateManager.set.Active.bind(this))
			.updateValue(this.isModeActive(this.state.mode) ? 1 : 0);

		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
			.updateValue(deriveCurrentHeaterCoolerState(this.state));

		const validTargetStates = [];
		if (this.supportsMode(ESP_MODE.COOL)) validTargetStates.push(Characteristic.TargetHeaterCoolerState.COOL);
		if (this.supportsMode(ESP_MODE.HEAT)) validTargetStates.push(Characteristic.TargetHeaterCoolerState.HEAT);
		if (this.supportsAuto()) validTargetStates.push(Characteristic.TargetHeaterCoolerState.AUTO);
		if (validTargetStates.length === 0) validTargetStates.push(Characteristic.TargetHeaterCoolerState.AUTO);

		this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.setProps({ validValues: validTargetStates })
			.onSet(stateManager.set.TargetHeaterCoolerState.bind(this))
			.updateValue(espModeToHkTargetState(this.accessory.context.lastTargetState));

		// HAP requires CurrentTemperature/threshold characteristics to be valid finite numbers,
		// even on the first read by Apple Home during pairing. Some ESPHome firmwares don't
		// advertise visualMinTemperature/visualMaxTemperature/visualTargetTemperatureStep in
		// their config; we apply sane defaults so setProps and updateValue can't NaN out.
		const visualMin = isPresent(this.config.visualMinTemperature) ? this.config.visualMinTemperature : DEFAULT_VISUAL_MIN_TEMP;
		const visualMax = isPresent(this.config.visualMaxTemperature) ? this.config.visualMaxTemperature : DEFAULT_VISUAL_MAX_TEMP;
		const visualStep = isPresent(this.config.visualTargetTemperatureStep) ? this.config.visualTargetTemperatureStep : DEFAULT_VISUAL_TEMP_STEP;

		const safeCurrent = isPresent(this.state.currentTemperature)
			? clampRange(this.state.currentTemperature, -100, 100)
			: (visualMin + visualMax) / 2;
		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature)
			.setProps({ minValue: -100, maxValue: 100, minStep: 0.1 })
			.updateValue(safeCurrent);

		const tempProps = {
			minValue: visualMin,
			maxValue: visualMax,
			minStep: visualStep,
		};
		const safeTarget = isPresent(this.state.targetTemperature)
			? this.clampTargetTemperature(this.state.targetTemperature)
			: visualMin;

		if (this.supportsCooling()) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
				.setProps(tempProps)
				.onSet(stateManager.set.CoolingThresholdTemperature.bind(this))
				.updateValue(safeTarget);
		}
		if (this.supportsHeating()) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature)
				.setProps(tempProps)
				.onSet(stateManager.set.HeatingThresholdTemperature.bind(this))
				.updateValue(safeTarget);
		}

		if (this.swingModeValue) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.SwingMode)
				.onSet(stateManager.set.SwingMode.bind(this))
				.updateValue(this.state.swingMode ? 1 : 0);
		}
		if (this.supportsFanControl()) {
			const safeSpeed = fanStateToSpeed(this.state.fanMode, this.state.customFanMode, this.fanLadder);
			this.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed)
				.setProps({ minValue: 0, maxValue: 100, minStep: fanLadderMinStep(this.fanLadder) })
				.onSet(stateManager.set.RotationSpeed.bind(this))
				.updateValue(isPresent(safeSpeed) ? safeSpeed : 0);
		}

		this.updateClimateState(this.state);
	}

	setConnectedStatus(connected) {
		this.connected = connected;
	}

	clampTargetTemperature(value) {
		if (value == null) return value;
		const min = isPresent(this.config.visualMinTemperature) ? this.config.visualMinTemperature : DEFAULT_VISUAL_MIN_TEMP;
		const max = isPresent(this.config.visualMaxTemperature) ? this.config.visualMaxTemperature : DEFAULT_VISUAL_MAX_TEMP;
		if (value < min) return min;
		if (value > max) return max;
		return value;
	}

	addOptionalSensorServices() {
		if (this.entities.humiditySensor && !this.settingDisabled('disableHumiditySensor')) {
			const humidityName = `${this.name} Humidity`;
			this.HumidityService = this.accessory.getServiceById(Service.HumiditySensor, 'humidity')
				|| this.accessory.addService(Service.HumiditySensor, humidityName, 'humidity');
			this.setConfiguredName(this.HumidityService, humidityName);
			const initial = readSensorValue(this.entities.humiditySensor);
			if (initial != null) this.HumidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, clampRange(initial, 0, 100));
		}

		if (this.entities.powerSensor && !this.settingDisabled('disablePowerSensor')) {
			this.attachPowerService();
		}

		if (this.entities.outdoorTempSensor && !this.settingDisabled('disableOutdoorTempSensor')) {
			const outdoorName = `${this.name} Outdoor`;
			this.OutdoorTempService = this.accessory.getServiceById(Service.TemperatureSensor, 'outdoor')
				|| this.accessory.addService(Service.TemperatureSensor, outdoorName, 'outdoor');
			this.setConfiguredName(this.OutdoorTempService, outdoorName);
			this.OutdoorTempService.getCharacteristic(Characteristic.CurrentTemperature)
				.setProps({ minValue: -100, maxValue: 100, minStep: 0.1 });
			const initial = readSensorValue(this.entities.outdoorTempSensor);
			if (initial != null) this.OutdoorTempService.updateCharacteristic(Characteristic.CurrentTemperature, clampRange(initial, -100, 100));
		}
	}

	addOptionalSwitchServices() {
		if (this.entities.beeperSwitch && !this.settingDisabled('disableBeeperSwitch')) {
			const beeperName = `${this.name} Beeper`;
			this.BeeperService = this.accessory.getServiceById(Service.Switch, 'beeper')
				|| this.accessory.addService(Service.Switch, beeperName, 'beeper');
			this.setConfiguredName(this.BeeperService, beeperName);
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
			const displayName = `${this.name} Display`;
			this.DisplayService = this.accessory.getServiceById(Service.Switch, 'display')
				|| this.accessory.addService(Service.Switch, displayName, 'display');
			this.setConfiguredName(this.DisplayService, displayName);
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
		if (this.supportsMode(ESP_MODE.DRY) && !this.settingDisabled('disableDryMode')) {
			const dryName = `${this.name} Dry`;
			this.DryService = this.accessory.getServiceById(Service.Switch, 'dry')
				|| this.accessory.addService(Service.Switch, dryName, 'dry');
			this.setConfiguredName(this.DryService, dryName);
			this.DryService.getCharacteristic(Characteristic.On)
				.onSet(value => this.handleModeSwitch(ESP_MODE.DRY, !!value, 'DRY'))
				.updateValue(this.state.mode === ESP_MODE.DRY ? 1 : 0);
		}

		if (this.supportsMode(ESP_MODE.FAN_ONLY) && !this.settingDisabled('disableFanOnlyMode')) {
			const fanOnlyName = `${this.name} Fan Only`;
			this.FanOnlyService = this.accessory.getServiceById(Service.Switch, 'fanOnly')
				|| this.accessory.addService(Service.Switch, fanOnlyName, 'fanOnly');
			this.setConfiguredName(this.FanOnlyService, fanOnlyName);
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
			// Record the mode we're leaving so switching back off returns there.
			// OFF must be recorded too: an AC that was off, switched to DRY, then
			// switched back, has to end up off again — not started up in the
			// cached lastTargetState. Modes reached from another supplementary
			// mode (DRY -> FAN_ONLY) keep the original pre-excursion mode.
			if (PRIMARY_MODES.includes(this.state.mode) || this.state.mode === ESP_MODE.OFF) {
				this.accessory.context.preSupplementaryMode = this.state.mode;
			}
			this.state.mode = targetMode;
			this.log(`${this.name} - Setting AC Mode to ${label}`);
		} else {
			// `!= null` rather than `||`: ESP_MODE.OFF is 0, and `||` would treat a
			// legitimately recorded OFF as "nothing recorded" and fall through to
			// lastTargetState, turning the AC on instead of off.
			const stored = this.accessory.context.preSupplementaryMode;
			const restore = stored != null
				? stored
				: (PRIMARY_MODES.includes(this.accessory.context.lastTargetState) ? this.accessory.context.lastTargetState : ESP_MODE.OFF);
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

	// Warn once per device if a requested preset never took effect. Firmware that
	// lists presets it does not implement is common enough on older ESPHome
	// builds that a silent snap-back would just look like a plugin bug.
	// Same story as presets: firmware can advertise a custom fan mode, accept the
	// command, and report a standard mode back. ESPHome 2024.4.2 on the
	// SLWF-01Pro answers "silent" with plain LOW. The slider then settles on what
	// the device reports, which looks like it jumped for no reason.
	warnIfCustomFanModeIgnored() {
		const requested = this._requestedCustomFanMode;
		if (!requested) return;
		this._requestedCustomFanMode = null;
		if (this.state.customFanMode === requested) return;
		if (this._customFanIgnoredWarned) return;
		this._customFanIgnoredWarned = true;
		const firmware = this.deviceInfo.esphomeVersion ? ` (ESPHome ${this.deviceInfo.esphomeVersion})` : '';
		this.log.warn(
			`${this.name} - the device advertises the "${requested}" fan mode but reported a standard mode instead${firmware}. ` +
			'The fan slider will settle on what the device reports. Updating the dongle firmware usually fixes this.'
		);
	}

	warnIfPresetIgnored() {
		const requested = this._requestedPreset;
		if (!requested) return;
		const active = activePresetEntry(this.state.preset, this.state.customPreset, this.presetList);
		const activeSubtype = active ? presetSubtype(active) : null;
		if (activeSubtype === presetSubtype(requested)) {
			this._requestedPreset = null;
			return;
		}
		this._requestedPreset = null;
		if (this._presetIgnoredWarned) return;
		this._presetIgnoredWarned = true;
		const firmware = this.deviceInfo.esphomeVersion ? ` (ESPHome ${this.deviceInfo.esphomeVersion})` : '';
		this.log.warn(
			`${this.name} - the device advertises the "${requested.label}" preset but did not apply it${firmware}. ` +
			'Some older ESPHome builds list presets they do not implement; updating the dongle firmware usually fixes this. ' +
			'Set "disablePresets": true to hide these switches.'
		);
	}

	removeDisabledServices() {
		if (this.settingDisabled('disableHumiditySensor')) this.removeServiceIfPresent(Service.HumiditySensor);
		if (this.settingDisabled('disableOutdoorTempSensor')) this.removeServiceById(Service.TemperatureSensor, 'outdoor');
		if (this.settingDisabled('disablePowerSensor')) this.removeServiceById(Service.Outlet, 'power');
		if (this.settingDisabled('disableBeeperSwitch')) this.removeServiceById(Service.Switch, 'beeper');
		if (this.settingDisabled('disableDisplaySwitch')) this.removeServiceById(Service.Switch, 'display');
		if (this.settingDisabled('disableDryMode')) this.removeServiceById(Service.Switch, 'dry');
		if (this.settingDisabled('disableFanOnlyMode')) this.removeServiceById(Service.Switch, 'fanOnly');

		if (!this.entities.humiditySensor) this.removeServiceIfPresent(Service.HumiditySensor);
		if (!this.entities.outdoorTempSensor) this.removeServiceById(Service.TemperatureSensor, 'outdoor');
		if (!this.entities.powerSensor) this.removeServiceById(Service.Outlet, 'power');
		if (!this.entities.beeperSwitch) this.removeServiceById(Service.Switch, 'beeper');
		if (!this.entities.displayButton) this.removeServiceById(Service.Switch, 'display');
		if (!this.supportsMode(ESP_MODE.DRY)) this.removeServiceById(Service.Switch, 'dry');
		if (!this.supportsMode(ESP_MODE.FAN_ONLY)) this.removeServiceById(Service.Switch, 'fanOnly');

		// Drop any cached preset switch that this device no longer offers, or
		// that the user has since disabled. Preset lists differ between firmware
		// versions, so cached-but-gone is a normal case rather than an error.
		const wanted = this.settingDisabled('disablePresets')
			? new Set()
			: new Set(this.presetList.map(presetSubtype));
		for (const service of this.accessory.services.slice()) {
			const subtype = service.subtype;
			if (typeof subtype === 'string' && subtype.startsWith('preset-') && !wanted.has(subtype)) {
				this.accessory.removeService(service);
				this.PresetServices.delete(subtype);
			}
		}
	}

	removeServiceIfPresent(serviceType) {
		const svc = this.accessory.getService(serviceType);
		if (svc) this.accessory.removeService(svc);
	}

	removeServiceById(serviceType, subtype) {
		if (!serviceType) return;
		const svc = this.accessory.getServiceById(serviceType, subtype);
		if (svc) this.accessory.removeService(svc);
	}

	removeLegacyPowerCharacteristic() {
		const eve = makeEveClasses(this.api);
		if (!eve || !this.HeaterCoolerService || typeof this.HeaterCoolerService.testCharacteristic !== 'function') return;
		if (!this.HeaterCoolerService.testCharacteristic(eve.CurrentPowerConsumption)) return;
		const characteristic = this.HeaterCoolerService.getCharacteristic(eve.CurrentPowerConsumption);
		if (characteristic && typeof this.HeaterCoolerService.removeCharacteristic === 'function') {
			this.HeaterCoolerService.removeCharacteristic(characteristic);
			this.log.easyDebug(`${this.name}: removed legacy Eve power characteristic from HeaterCooler service`);
		}
	}

	removeConnectionStatusCharacteristics() {
		if (!this.HeaterCoolerService || typeof this.HeaterCoolerService.testCharacteristic !== 'function') return;
		for (const characteristicType of [Characteristic.StatusActive, Characteristic.StatusFault]) {
			if (!characteristicType) continue;
			if (!this.HeaterCoolerService.testCharacteristic(characteristicType)) continue;
			const characteristic = this.HeaterCoolerService.getCharacteristic(characteristicType);
			if (characteristic && typeof this.HeaterCoolerService.removeCharacteristic === 'function') {
				this.HeaterCoolerService.removeCharacteristic(characteristic);
			}
		}
	}

	updatePowerValue(power) {
		if (this.PowerCharacteristic) this.PowerCharacteristic.updateValue(power);
		if (this.PowerService && Characteristic.OutletInUse) {
			this.PowerService.updateCharacteristic(Characteristic.OutletInUse, power > 0);
		}
	}

	attachPowerService() {
		const eve = makeEveClasses(this.api);
		if (!eve || !Service.Outlet) return;
		this._eve = eve;
		const powerName = `${this.name} Power`;
		this.PowerService = this.accessory.getServiceById(Service.Outlet, 'power')
			|| this.accessory.addService(Service.Outlet, powerName, 'power');
		this.setConfiguredName(this.PowerService, powerName);
		// Hide the Outlet from Apple Home so it doesn't render as a separate (toggle-only)
		// tile. Eve.app and other HAP-direct clients still see the service in the database
		// and can read CurrentPowerConsumption. The snap-back onSet below stays as a
		// fallback for HAP-NodeJS versions that predate setHiddenService.
		if (typeof this.PowerService.setHiddenService === 'function') {
			this.PowerService.setHiddenService(true);
		}
		this.PowerService.getCharacteristic(Characteristic.On)
			.onSet(() => {
				setTimeout(() => this.PowerService.updateCharacteristic(Characteristic.On, true), 0);
			})
			.updateValue(true);
		if (Characteristic.OutletInUse) {
			this.PowerService.getCharacteristic(Characteristic.OutletInUse).updateValue(false);
		}
		this.PowerCharacteristic = this.PowerService.getCharacteristic(eve.CurrentPowerConsumption);
		const initial = readSensorValue(this.entities.powerSensor);
		if (initial != null) this.updatePowerValue(Math.max(0, initial));

		if (FakeGatoHistoryFactory && !this.HistoryService) {
			try {
				// `storage: 'fs'` with no explicit path makes fakegato write under
				// homebridge.user.storagePath(), which is what Homebridge requires
				// of plugins that persist anything to disk.
				const FakeGatoHistoryService = FakeGatoHistoryFactory(this.api);
				this.HistoryService = new FakeGatoHistoryService('energy', this.accessory, { storage: 'fs', log: this.log });
			} catch (err) {
				// warn, not easyDebug: a silent failure here is exactly what kept
				// the broken initialisation above hidden.
				this.log.warn(`${this.name} - Eve history unavailable: ${err.message || err}`);
			}
		} else if (!FakeGatoHistoryFactory && !historyUnavailableWarned) {
			historyUnavailableWarned = true;
			this.log.warn(
				'Power monitoring is enabled, but the optional "fakegato-history" package is not installed, ' +
				'so Eve will show live wattage without the history graph. Install it next to the plugin ' +
				'(e.g. `npm install -g fakegato-history` for a global Homebridge install) and restart Homebridge ' +
				'to enable history. It is optional because it pulls in ~194 MB of googleapis for a storage backend ' +
				'this plugin does not use.'
			);
		}
	}

	attachOptionalEntityListeners() {
		if (this.entities.humiditySensor && this.HumidityService) {
			this.entities.humiditySensor.on('state', this.guarded('humidity update', s => {
				const v = readSensorValue({ state: s });
				if (v == null) return;
				this.HumidityService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, clampRange(v, 0, 100));
			}));
		}
		if (this.entities.outdoorTempSensor && this.OutdoorTempService) {
			this.entities.outdoorTempSensor.on('state', this.guarded('outdoor temperature update', s => {
				const v = readSensorValue({ state: s });
				if (v == null) return;
				this.OutdoorTempService.updateCharacteristic(Characteristic.CurrentTemperature, clampRange(v, -100, 100));
			}));
		}
		if (this.entities.beeperSwitch && this.BeeperService) {
			this.entities.beeperSwitch.on('state', this.guarded('beeper update', s => {
				if (s == null || s.state == null) return;
				this.BeeperService.updateCharacteristic(Characteristic.On, Boolean(s.state));
			}));
		}
		if (this.entities.powerSensor && this.PowerCharacteristic) {
			this.entities.powerSensor.on('state', this.guarded('power update', s => {
				const v = readSensorValue({ state: s });
				if (v == null) return;
				const power = Math.max(0, v);
				this.updatePowerValue(power);
				if (this.HistoryService) {
					try {
						this.HistoryService.addEntry({ time: Math.floor(Date.now() / 1000), power });
					} catch (err) {
						this.log.easyDebug(`fakegato addEntry failed: ${err.message || err}`);
					}
				}
			}));
		}
	}

	updateClimateState(state) {
		// Keep the last good state rather than adopting a malformed payload:
		// this.state is what stateManager builds outgoing commands from, so
		// assigning null here would poison the next write as well as this read.
		if (!state || typeof state !== 'object') {
			this.log.easyDebug(`${this.name} - ignoring empty climate state payload`);
			return;
		}

		this.log.easyDebug(`${this.name} entity state:`);
		this.log.easyDebug(state);

		this.state = state;
		this.syncModeSwitches(this.state.mode);
		this.syncPresetSwitches();
		// Only the device's own report can tell us whether these took effect.
		this.warnIfPresetIgnored();
		this.warnIfCustomFanModeIgnored();

		safeUpdate(this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature), clampRange(this.state.currentTemperature, -100, 100));

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
				safeUpdate(this.HeaterCoolerService.getCharacteristic(Characteristic.HeatingThresholdTemperature), clampedTarget);
			}
			if (this.supportsCooling()) {
				safeUpdate(this.HeaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature), clampedTarget);
			}

			this.updateAirflowCharacteristics();

			this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
				.updateValue(espModeToHkTargetState(this.state.mode));
			this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
				.updateValue(deriveCurrentHeaterCoolerState(this.state));
			return;
		}

		// Fallthrough: state has a non-OFF, non-PRIMARY mode (DRY/FAN_ONLY/unknown).
		// Use the first member of validTargetStates instead of hardcoded AUTO so we don't
		// write a value that violates setProps({ validValues }) and crash the HAP path.
		const validValues = this.HeaterCoolerService
			.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.props.validValues;
		const fallbackTarget = (Array.isArray(validValues) && validValues.length > 0)
			? validValues[0]
			: Characteristic.TargetHeaterCoolerState.AUTO;
		this.HeaterCoolerService.getCharacteristic(Characteristic.Active).updateValue(1);
		this.HeaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
			.updateValue(fallbackTarget);
		this.HeaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
			.updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
		// Fan speed and swing still apply in DRY/FAN_ONLY — in FAN_ONLY they're the
		// only thing the AC is doing — so they have to track the device here too.
		this.updateAirflowCharacteristics();
	}

	updateAirflowCharacteristics() {
		if (this.swingModeValue) {
			this.HeaterCoolerService.getCharacteristic(Characteristic.SwingMode).updateValue(this.state.swingMode ? 1 : 0);
		}
		if (this.supportsFanControl()) {
			safeUpdate(this.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed), fanStateToSpeed(this.state.fanMode, this.state.customFanMode, this.fanLadder));
		}
	}

	addPresetServices() {
		if (this.settingDisabled('disablePresets')) return;
		for (const entry of this.presetList) {
			const subtype = presetSubtype(entry);
			const name = `${this.name} ${entry.label}`;
			const service = this.accessory.getServiceById(Service.Switch, subtype)
				|| this.accessory.addService(Service.Switch, name, subtype);
			this.setConfiguredName(service, name);
			service.getCharacteristic(Characteristic.On)
				.onSet(value => this.handlePresetSwitch(entry, !!value))
				.updateValue(this.isPresetActive(entry) ? 1 : 0);
			this.PresetServices.set(subtype, service);
		}
	}

	isPresetActive(entry) {
		const active = activePresetEntry(this.state.preset, this.state.customPreset, this.presetList);
		return Boolean(active) && presetSubtype(active) === presetSubtype(entry);
	}

	async handlePresetSwitch(entry, on) {
		if (on && this.isPresetActive(entry)) return;
		if (!on && !this.isPresetActive(entry)) return;

		if (on) {
			// preset and customPreset are alternatives on the wire; send exactly
			// one and keep the local mirror consistent so the next read is right.
			if (entry.custom !== undefined) {
				this.state.customPreset = entry.custom;
				stateManager.markDirty(this, 'customPreset');
			} else {
				this.state.preset = entry.preset;
				this.state.customPreset = '';
				stateManager.markDirty(this, 'preset');
			}
			this.log(`${this.name} - Setting preset to ${entry.label}`);
		} else {
			// There is no "clear custom preset" command — leaving any preset is
			// done by selecting NONE.
			this.state.preset = ESP_PRESET.NONE;
			this.state.customPreset = '';
			stateManager.markDirty(this, 'preset');
			this.log(`${this.name} - Clearing preset ${entry.label}`);
		}

		// Some firmware advertises presets in supportedPresetsList without
		// implementing them — ESPHome 2024.4.2 on the SLWF-01Pro accepts the
		// command and silently stays on preset NONE. Remember what we asked for
		// so the next state push can tell the user rather than just snapping the
		// switch back off and looking broken.
		this._requestedPreset = on ? entry : null;
		this.syncPresetSwitches();
		try {
			await stateManager.sendState(this);
		} catch (err) {
			this.log.error(`${this.name} - preset change failed: ${err.message || err}`);
			throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
		}
	}

	// Presets are mutually exclusive on the device, so exactly one switch may be
	// on at a time.
	syncPresetSwitches() {
		if (this.PresetServices.size === 0) return;
		const active = activePresetEntry(this.state.preset, this.state.customPreset, this.presetList);
		const activeSubtype = active ? presetSubtype(active) : null;
		for (const [subtype, service] of this.PresetServices) {
			service.updateCharacteristic(Characteristic.On, subtype === activeSubtype ? 1 : 0);
		}
	}
}

module.exports = DeviceAccessory;
module.exports.SUPPLEMENTARY_SWITCH_KEYS = SUPPLEMENTARY_SWITCH_KEYS;
module.exports.OPTIONAL_SENSOR_KEYS = OPTIONAL_SENSOR_KEYS;

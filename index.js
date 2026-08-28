const Esphome = require('./lib/esphome');
const { PLUGIN_NAME, PLATFORM_NAME, ACCESSORY_SCHEMA_VERSION } = require('./lib/constants');

class SLWFOnePro {
	constructor(log, config, api) {
		config = config || {};
		this.api = api;
		this.log = log;

		this.accessories = [];
		this.staleAccessories = [];
		this.cachedAccessoryFallbacks = [];
		this.esphomeDevices = {};
		this.PLUGIN_NAME = PLUGIN_NAME;
		this.PLATFORM_NAME = PLATFORM_NAME;
		this.ACCESSORY_SCHEMA_VERSION = ACCESSORY_SCHEMA_VERSION;
		this.name = config.name || PLATFORM_NAME;
		this.devices = config.devices || [];
		this.debug = config.debug || false;
		// Defaults intentionally favour a clean Apple Home install: just the AC tile
		// shows up, with mDNS auto-discovery already on. Power users opt into the
		// extras (humidity / outdoor temp / power / beeper / display / DRY / FAN_ONLY)
		// either globally by flipping the platform flag or per-device.
		this.autoDiscover = config.autoDiscover ?? true;
		this.discoveryTimeout = config.discoveryTimeout || undefined;

		this.disableHumiditySensor = config.disableHumiditySensor ?? true;
		this.disableOutdoorTempSensor = config.disableOutdoorTempSensor ?? true;
		this.disableBeeperSwitch = config.disableBeeperSwitch ?? true;
		this.disableDisplaySwitch = config.disableDisplaySwitch ?? true;
		this.disableDryMode = config.disableDryMode ?? true;
		this.disableFanOnlyMode = config.disableFanOnlyMode ?? true;
		this.disablePresets = config.disablePresets ?? true;
		this.disablePowerSensor = config.disablePowerSensor ?? true;

		this.log.easyDebug = (...content) => {
			const message = content.map(part => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ');
			if (this.debug) this.log(message);
			else this.log.debug(message);
		};

		this.api.on('didFinishLaunching', () => {
			Promise.resolve(Esphome.init.call(this)).catch(err => {
				this.log.error(`Plugin initialization failed: ${err.message || err}`);
			});
		});
	}

	configureAccessory(accessory) {
		const cachedVersion = accessory.context && accessory.context.schemaVersion;
		// Only ever evict accessories OLDER than the current schema. An accessory
		// stamped by a newer build (someone who ran 1.1.0, which briefly used v7)
		// is left alone — re-evicting it would cost them their Apple Home rooms a
		// second time for no benefit.
		if (!(cachedVersion >= ACCESSORY_SCHEMA_VERSION)) {
			this.log.warn(`Cached accessory "${accessory.displayName}" is from an older plugin schema (v${cachedVersion || 1}); will be re-registered with the current schema (v${ACCESSORY_SCHEMA_VERSION}).`);
			this.staleAccessories.push(accessory);
			return;
		}
		this.log.easyDebug(`Found cached accessory: ${accessory.displayName} (${accessory.context.deviceId || 'no id'})`);
		this.accessories.push(accessory);
	}
}

module.exports = (api) => {
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SLWFOnePro, true);
};

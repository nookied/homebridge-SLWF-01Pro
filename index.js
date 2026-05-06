const Esphome = require('./lib/esphome');

const PLUGIN_NAME = 'homebridge-slwf-01pro';
const PLATFORM_NAME = 'SLWFOnePro';
const ACCESSORY_SCHEMA_VERSION = 3;

class SLWFOnePro {
	constructor(log, config, api) {
		this.api = api;
		this.log = log;

		this.accessories = [];
		this.staleAccessories = [];
		this.esphomeDevices = {};
		this.PLUGIN_NAME = PLUGIN_NAME;
		this.PLATFORM_NAME = PLATFORM_NAME;
		this.ACCESSORY_SCHEMA_VERSION = ACCESSORY_SCHEMA_VERSION;
		this.name = config.name || PLATFORM_NAME;
		this.devices = config.devices || [];
		this.debug = config.debug || false;
		this.autoDiscover = config.autoDiscover || false;
		this.discoveryTimeout = config.discoveryTimeout || undefined;

		this.disableHumiditySensor = config.disableHumiditySensor || false;
		this.disableOutdoorTempSensor = config.disableOutdoorTempSensor || false;
		this.disableBeeperSwitch = config.disableBeeperSwitch || false;
		this.disableDisplaySwitch = config.disableDisplaySwitch || false;
		this.disableDryMode = config.disableDryMode || false;
		this.disableFanOnlyMode = config.disableFanOnlyMode || false;
		this.disablePowerSensor = config.disablePowerSensor || false;

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
		if (cachedVersion !== ACCESSORY_SCHEMA_VERSION) {
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

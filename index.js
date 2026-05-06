const ESPHome = require('./lib/esphome');

const PLUGIN_NAME = 'homebridge-slwf-01pro';
const PLATFORM_NAME = 'ESPHomeAC';

class ESPHomeAC {
	constructor(log, config, api) {
		this.api = api;
		this.log = log;

		this.accessories = [];
		this.esphomeDevices = {};
		this.PLUGIN_NAME = PLUGIN_NAME;
		this.PLATFORM_NAME = PLATFORM_NAME;
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
			Promise.resolve(ESPHome.init.call(this)).catch(err => {
				this.log.error(`Plugin initialization failed: ${err.message || err}`);
			});
		});
	}

	configureAccessory(accessory) {
		this.log.easyDebug(`Found cached accessory: ${accessory.displayName} (${accessory.context.deviceId || 'no id'})`);
		this.accessories.push(accessory);
	}
}

module.exports = (api) => {
	api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, ESPHomeAC, true);
};

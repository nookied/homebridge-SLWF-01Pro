const { fanSpeedToFanMode, pickAutoMode, ESP_MODE, HK_TARGET } = require('./state');

const ACTIVE_BATCH_MS = 100;
const TEMP_BATCH_MS = 50;

const COMMAND_FIELDS = ['mode', 'targetTemperature', 'fanMode', 'swingMode'];

function buildCommandPayload(that) {
	const payload = { key: that.esphome.config.key };
	const dirty = that._dirty || {};
	for (const field of COMMAND_FIELDS) {
		if (dirty[field] && that.state[field] !== undefined && that.state[field] !== null) {
			payload[field] = that.state[field];
		}
	}
	return payload;
}

function markDirty(that, field) {
	if (!that._dirty) that._dirty = {};
	that._dirty[field] = true;
}

function clearDirty(that) {
	that._dirty = {};
}

function sendState(that) {
	return new Promise((resolve, reject) => {
		that.pending.push({ resolve, reject });
		clearTimeout(that._sendTimeout);
		that._sendTimeout = setTimeout(() => {
			const currentPending = that.pending;
			that.pending = [];
			that._sendTimeout = null;
			if (!that.connected) {
				that.log.error(`ERROR setting status of ${that.name}, device is disconnected`);
				const err = new that.api.hap.HapStatusError(-70402);
				currentPending.forEach(({ reject: rj }) => rj(err));
				clearDirty(that);
				return;
			}
			const payload = buildCommandPayload(that);
			if (Object.keys(payload).length <= 1) {
				clearDirty(that);
				currentPending.forEach(({ resolve: rs }) => rs());
				return;
			}
			try {
				that.log.easyDebug(`${that.name} - Sending command: ${JSON.stringify(payload)}`);
				that.esphome.connection.climateCommandService(payload);
				clearDirty(that);
				currentPending.forEach(({ resolve: rs }) => rs());
			} catch (err) {
				that.log.error(`ERROR sending state to ${that.name}: ${err.message || err}`);
				currentPending.forEach(({ reject: rj }) => rj(new that.api.hap.HapStatusError(-70402)));
				clearDirty(that);
			}
		}, that.setDelay);
	});
}

module.exports = {
	sendState,
	markDirty,
	set: {
		Active(active) {
			return new Promise((resolve, reject) => {
				setTimeout(() => {
					const wantOn = !!active;
					const isOn = this.state.mode != null && this.state.mode !== ESP_MODE.OFF;
					if (wantOn === isOn) return resolve();
					this.state.mode = wantOn ? (this.accessory.context.lastTargetState || ESP_MODE.COOL) : ESP_MODE.OFF;
					markDirty(this, 'mode');
					this.log(`${this.name} - Setting AC Active to ${wantOn ? 'ON' : 'OFF'}`);
					sendState(this).then(resolve).catch(reject);
				}, ACTIVE_BATCH_MS);
			});
		},

		TargetHeaterCoolerState(hkTarget) {
			return new Promise((resolve, reject) => {
				let espMode;
				let logMode;
				switch (hkTarget) {
					case HK_TARGET.AUTO:
						espMode = pickAutoMode(this.config.supportedModesList);
						if (espMode === null) return resolve();
						logMode = espMode === ESP_MODE.HEAT_COOL ? 'HEAT_COOL' : 'AUTO';
						break;
					case HK_TARGET.HEAT: espMode = ESP_MODE.HEAT; logMode = 'HEAT'; break;
					case HK_TARGET.COOL: espMode = ESP_MODE.COOL; logMode = 'COOL'; break;
					default: return resolve();
				}
				if (this.state.mode === espMode) return resolve();
				this.state.mode = espMode;
				this.accessory.context.lastTargetState = espMode;
				markDirty(this, 'mode');
				this.log(`${this.name} - Setting AC Mode to ${logMode}`);
				sendState(this).then(resolve).catch(reject);
			});
		},

		CoolingThresholdTemperature(temp) {
			return new Promise((resolve, reject) => {
				setTimeout(() => {
					if (this.state.targetTemperature === temp) return resolve();
					this.state.targetTemperature = temp;
					markDirty(this, 'targetTemperature');
					this.log(`${this.name} - Setting AC Cooling Temperature to ${temp}ºC`);
					sendState(this).then(resolve).catch(reject);
				}, TEMP_BATCH_MS);
			});
		},

		HeatingThresholdTemperature(temp) {
			return new Promise((resolve, reject) => {
				setTimeout(() => {
					if (this.state.targetTemperature === temp) return resolve();
					this.state.targetTemperature = temp;
					markDirty(this, 'targetTemperature');
					this.log(`${this.name} - Setting AC Heating Temperature to ${temp}ºC`);
					sendState(this).then(resolve).catch(reject);
				}, TEMP_BATCH_MS);
			});
		},

		SwingMode(swing) {
			return new Promise((resolve, reject) => {
				if (!this.swingModeValue) return resolve();
				const target = swing ? this.swingModeValue : 0;
				if (this.state.swingMode === target) return resolve();
				this.state.swingMode = target;
				markDirty(this, 'swingMode');
				this.log(`${this.name} - Setting AC Swing to ${swing ? 'ON' : 'OFF'}`);
				sendState(this).then(resolve).catch(reject);
			});
		},

		RotationSpeed(speed) {
			return new Promise((resolve, reject) => {
				const fanMode = fanSpeedToFanMode(speed, this.config.supportedFanModesList);
				if (fanMode === undefined) return resolve();
				if (this.state.fanMode === fanMode) return resolve();
				this.state.fanMode = fanMode;
				markDirty(this, 'fanMode');
				this.log(`${this.name} - Setting AC Fan Level to ${speed}%`);
				sendState(this).then(resolve).catch(reject);
			});
		},
	},
};

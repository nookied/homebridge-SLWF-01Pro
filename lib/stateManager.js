const { speedToFanCommand, pickAutoMode, chooseInitialTargetMode, ESP_MODE, HK_TARGET } = require('./state');

const ACTIVE_BATCH_MS = 100;
const TEMP_BATCH_MS = 50;

const COMMAND_FIELDS = ['mode', 'targetTemperature', 'fanMode', 'swingMode', 'customFanMode', 'preset', 'customPreset'];

// customFanMode and customPreset are empty strings when the device isn't in one.
// Sending an empty string would ask ESPHome to select a custom mode named "",
// so a field is only ever sent when it carries a real selection. Leaving a
// custom mode is expressed by sending its standard counterpart instead.
const NEVER_SEND_EMPTY = ['customFanMode', 'customPreset'];

function buildCommandPayload(that) {
	const payload = { key: that.esphome.config.key };
	const dirty = that._dirty || {};
	for (const field of COMMAND_FIELDS) {
		if (!dirty[field]) continue;
		const value = that.state[field];
		if (value === undefined || value === null) continue;
		if (NEVER_SEND_EMPTY.includes(field) && value === '') continue;
		payload[field] = value;
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
					this.state.mode = wantOn
						? chooseInitialTargetMode(this.accessory.context.lastTargetState, this.config.supportedModesList)
						: ESP_MODE.OFF;
					markDirty(this, 'mode');
					this.log(`${this.name} - Setting AC Active to ${wantOn ? 'ON' : 'OFF'}`);
					sendState(this).then(resolve).catch(reject);
				}, ACTIVE_BATCH_MS);
			});
		},

		TargetHeaterCoolerState(hkTarget) {
			return new Promise((resolve, reject) => {
				const supportedModes = Array.isArray(this.config.supportedModesList) ? this.config.supportedModesList : [];
				let espMode;
				let logMode;
				switch (hkTarget) {
					case HK_TARGET.AUTO:
						espMode = pickAutoMode(supportedModes);
						if (espMode === null) return resolve();
						logMode = espMode === ESP_MODE.HEAT_COOL ? 'HEAT_COOL' : 'AUTO';
						break;
					case HK_TARGET.HEAT:
						if (!supportedModes.includes(ESP_MODE.HEAT)) return resolve();
						espMode = ESP_MODE.HEAT;
						logMode = 'HEAT';
						break;
					case HK_TARGET.COOL:
						if (!supportedModes.includes(ESP_MODE.COOL)) return resolve();
						espMode = ESP_MODE.COOL;
						logMode = 'COOL';
						break;
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
				// The ladder covers standard and custom fan modes; the command
				// carries exactly one of them, never both.
				const command = speedToFanCommand(speed, this.fanLadder);
				if (!command) return resolve();

				if (command.customFanMode !== undefined) {
					if (this.state.customFanMode === command.customFanMode) return resolve();
					this.state.customFanMode = command.customFanMode;
					markDirty(this, 'customFanMode');
					this.log(`${this.name} - Setting AC Fan Level to ${speed}% (${command.customFanMode})`);
				} else {
					const alreadyThere = this.state.fanMode === command.fanMode && !this.state.customFanMode;
					if (alreadyThere) return resolve();
					this.state.fanMode = command.fanMode;
					// Selecting a standard mode leaves any custom one; mirror that
					// locally so the next read doesn't still think we're in it.
					this.state.customFanMode = '';
					markDirty(this, 'fanMode');
					this.log(`${this.name} - Setting AC Fan Level to ${speed}%`);
				}
				sendState(this).then(resolve).catch(reject);
			});
		},
	},
};

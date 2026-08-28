// Preset switches as they appear on the accessory (1.1.0).
//
// Capabilities mirror a live SLWF-01Pro: presets [NONE, BOOST, ECO, SLEEP] plus
// a custom "freeze protection", and custom fan modes silent/turbo.

const DeviceAccessory = require('../../lib/DeviceAccessory');
const { Characteristic, Service, makeFakePlatform, makeFakeClimateEntity } = require('../helpers/hapShim');

jest.mock('fakegato-history', () => null, { virtual: true });

const REAL_CAPABILITIES = {
	supportedModes: [0, 1, 2, 3, 4, 5],
	supportedFanModes: [2, 3, 4, 5],
	supportedCustomFanModes: ['silent', 'turbo'],
	supportedPresets: [0, 3, 5, 6],
	supportedCustomPresets: ['freeze protection'],
};

function build({ disablePresets = false, capabilities = REAL_CAPABILITIES, state = {} } = {}) {
	const platform = makeFakePlatform();
	platform.api.registerPlatformAccessories = () => {};
	platform.disablePresets = disablePresets;
	const sent = [];
	const climate = makeFakeClimateEntity({ ...capabilities, state });
	climate.connection = { climateCommandService: p => sent.push(p) };
	const accessory = new DeviceAccessory({
		device: { name: 'AC', host: '192.168.1.10' },
		deviceInfo: { macAddress: '24:D7:EB:FA:E8:10' },
		entities: { climate },
		platform,
	});
	accessory.setDelay = 1;
	return { platform, accessory, climate, sent };
}

const presetSwitch = (accessory, subtype) => accessory.accessory.getServiceById(Service.Switch, subtype);
const isOn = svc => Boolean(svc.getCharacteristic(Characteristic.On).value);

describe('preset switches', () => {
	test('one switch per advertised preset, including the custom one', () => {
		const { accessory } = build();

		expect(presetSwitch(accessory, 'preset-3')).toBeDefined();
		expect(presetSwitch(accessory, 'preset-5')).toBeDefined();
		expect(presetSwitch(accessory, 'preset-6')).toBeDefined();
		expect(presetSwitch(accessory, 'preset-custom-freeze-protection')).toBeDefined();
	});

	test('no switch for NONE, nor for presets the device never advertised', () => {
		const { accessory } = build();

		expect(presetSwitch(accessory, 'preset-0')).toBeUndefined();
		expect(presetSwitch(accessory, 'preset-2')).toBeUndefined();   // AWAY
	});

	test('none are created when presets are disabled', () => {
		const { accessory } = build({ disablePresets: true });

		for (const subtype of ['preset-3', 'preset-5', 'preset-6', 'preset-custom-freeze-protection']) {
			expect(presetSwitch(accessory, subtype)).toBeUndefined();
		}
	});

	test('a device advertising no presets gets no switches', () => {
		const { accessory } = build({
			capabilities: { ...REAL_CAPABILITIES, supportedPresets: [], supportedCustomPresets: [] },
		});

		expect(accessory.PresetServices.size).toBe(0);
	});

	test('the switch reflects the preset the device is already in', () => {
		const { accessory } = build({ state: { preset: 5 } });

		expect(isOn(presetSwitch(accessory, 'preset-5'))).toBe(true);
		expect(isOn(presetSwitch(accessory, 'preset-3'))).toBe(false);
	});
});

describe('setting a preset', () => {
	test('turning one on sends that preset', async () => {
		const { accessory, sent } = build();

		await accessory.handlePresetSwitch({ preset: 5, label: 'Eco' }, true);

		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ preset: 5 });
		expect(sent[0].customPreset).toBeUndefined();
	});

	test('turning on a custom preset sends customPreset, not preset', async () => {
		const { accessory, sent } = build();

		await accessory.handlePresetSwitch({ custom: 'freeze protection', label: 'Freeze Protection' }, true);

		expect(sent[0]).toMatchObject({ customPreset: 'freeze protection' });
		expect(sent[0].preset).toBeUndefined();
	});

	test('turning one off leaves the preset by selecting NONE', async () => {
		// There is no "clear custom preset" command on the wire.
		const { accessory, sent } = build({ state: { preset: 5 } });

		await accessory.handlePresetSwitch({ preset: 5, label: 'Eco' }, false);

		expect(sent[0]).toMatchObject({ preset: 0 });
	});

	test('presets are mutually exclusive in HomeKit', async () => {
		const { accessory } = build();

		await accessory.handlePresetSwitch({ preset: 5, label: 'Eco' }, true);
		expect(isOn(presetSwitch(accessory, 'preset-5'))).toBe(true);

		await accessory.handlePresetSwitch({ preset: 3, label: 'Boost' }, true);
		expect(isOn(presetSwitch(accessory, 'preset-3'))).toBe(true);
		expect(isOn(presetSwitch(accessory, 'preset-5'))).toBe(false);
	});

	test('a custom preset switching on turns the standard ones off', async () => {
		const { accessory } = build({ state: { preset: 6 } });

		await accessory.handlePresetSwitch({ custom: 'freeze protection', label: 'Freeze Protection' }, true);

		expect(isOn(presetSwitch(accessory, 'preset-custom-freeze-protection'))).toBe(true);
		expect(isOn(presetSwitch(accessory, 'preset-6'))).toBe(false);
	});

	test('a redundant toggle sends nothing', async () => {
		const { accessory, sent } = build({ state: { preset: 5 } });

		await accessory.handlePresetSwitch({ preset: 5, label: 'Eco' }, true);   // already on
		await accessory.handlePresetSwitch({ preset: 3, label: 'Boost' }, false); // already off

		expect(sent).toHaveLength(0);
	});
});

describe('device-initiated preset changes reach HomeKit', () => {
	test('a state push turns the matching switch on', () => {
		const { accessory, climate } = build();

		climate.emit('state', { mode: 2, preset: 6, customPreset: '', fanMode: 4, swingMode: 0 });

		expect(isOn(presetSwitch(accessory, 'preset-6'))).toBe(true);
	});

	test('a state push clearing the preset turns every switch off', () => {
		const { accessory, climate } = build({ state: { preset: 6 } });

		climate.emit('state', { mode: 2, preset: 0, customPreset: '', fanMode: 4, swingMode: 0 });

		for (const subtype of ['preset-3', 'preset-5', 'preset-6', 'preset-custom-freeze-protection']) {
			expect(isOn(presetSwitch(accessory, subtype))).toBe(false);
		}
	});
});

describe('custom fan modes on the accessory', () => {
	test('the slider gains rungs for silent and turbo, restoring detents', () => {
		const { accessory } = build();
		const rs = accessory.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed);

		// AUTO, silent, LOW, MEDIUM, HIGH, turbo -> 0/20/40/60/80/100
		expect(rs.props.minStep).toBe(20);
		expect(accessory.fanLadder).toHaveLength(6);
	});

	test('a device without custom fan modes is unaffected', () => {
		const { accessory } = build({
			capabilities: { ...REAL_CAPABILITIES, supportedCustomFanModes: [] },
		});

		expect(accessory.fanLadder).toHaveLength(4);
	});

	test('a device reporting a custom fan mode shows the right speed', () => {
		const { accessory, climate } = build();

		climate.emit('state', { mode: 2, fanMode: 5, customFanMode: 'silent', swingMode: 0, preset: 0, customPreset: '' });

		expect(accessory.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed).value).toBe(20);
	});
});

// ESPHome 2024.4.2 on a real SLWF-01Pro lists BOOST/ECO/SLEEP and a custom
// "freeze protection" in its capabilities, accepts the command, and then stays
// on preset NONE. Verified against the hardware. Without an explanation the
// switch just snaps back and looks like a plugin bug.
describe('firmware that advertises presets it does not implement', () => {
	function buildWithWarnings(state = {}) {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		platform.disablePresets = false;
		const warnings = [];
		platform.log.warn = msg => warnings.push(String(msg));
		const climate = makeFakeClimateEntity({ ...REAL_CAPABILITIES, state });
		climate.connection = { climateCommandService: () => {} };
		const accessory = new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10', esphomeVersion: '2024.4.2' },
			entities: { climate },
			platform,
		});
		accessory.setDelay = 1;
		return { accessory, climate, warnings };
	}

	test('a preset that never takes effect is explained, once', async () => {
		const { accessory, climate, warnings } = buildWithWarnings();

		await accessory.handlePresetSwitch({ preset: 5, label: 'Eco' }, true);
		climate.emit('state', { mode: 4, preset: 0, customPreset: '', fanMode: 2, swingMode: 0 });

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('Eco');
		expect(warnings[0]).toContain('2024.4.2');
		expect(warnings[0]).toContain('disablePresets');

		// Still only once, however many times it is retried.
		await accessory.handlePresetSwitch({ preset: 6, label: 'Sleep' }, true);
		climate.emit('state', { mode: 4, preset: 0, customPreset: '', fanMode: 2, swingMode: 0 });
		expect(warnings).toHaveLength(1);
	});

	test('the switch reflects reality — it does not stay on', async () => {
		const { accessory, climate } = buildWithWarnings();

		await accessory.handlePresetSwitch({ preset: 5, label: 'Eco' }, true);
		climate.emit('state', { mode: 4, preset: 0, customPreset: '', fanMode: 2, swingMode: 0 });

		expect(isOn(presetSwitch(accessory, 'preset-5'))).toBe(false);
	});

	test('firmware that does honour the preset says nothing', async () => {
		const { accessory, climate, warnings } = buildWithWarnings();

		await accessory.handlePresetSwitch({ preset: 5, label: 'Eco' }, true);
		climate.emit('state', { mode: 4, preset: 5, customPreset: '', fanMode: 2, swingMode: 0 });

		expect(warnings).toHaveLength(0);
		expect(isOn(presetSwitch(accessory, 'preset-5'))).toBe(true);
	});

	test('an unsolicited state change never warns', () => {
		const { climate, warnings } = buildWithWarnings();

		climate.emit('state', { mode: 4, preset: 0, customPreset: '', fanMode: 2, swingMode: 0 });

		expect(warnings).toHaveLength(0);
	});
});

// The same firmware answers customFanMode "silent" with plain fanMode 3 (LOW)
// and an empty customFanMode. Verified against the hardware. The slider then
// settles at LOW's percentage, which looks like an unexplained jump.
describe('firmware that reports a standard mode for a custom fan mode', () => {
	function buildWithWarnings() {
		const platform = makeFakePlatform();
		platform.api.registerPlatformAccessories = () => {};
		platform.disablePresets = false;
		const warnings = [];
		platform.log.warn = msg => warnings.push(String(msg));
		const climate = makeFakeClimateEntity({ ...REAL_CAPABILITIES });
		climate.connection = { climateCommandService: () => {} };
		const accessory = new DeviceAccessory({
			device: { name: 'AC', host: '192.168.1.10' },
			deviceInfo: { macAddress: '24:D7:EB:FA:E8:10', esphomeVersion: '2024.4.2' },
			entities: { climate },
			platform,
		});
		accessory.setDelay = 1;
		return { accessory, climate, warnings };
	}

	const stateManager = require('../../lib/stateManager');

	test('a custom fan mode that comes back as a standard one is explained, once', async () => {
		const { accessory, climate, warnings } = buildWithWarnings();

		await stateManager.set.RotationSpeed.call(accessory, 20);      // silent
		climate.emit('state', { mode: 4, fanMode: 3, customFanMode: '', swingMode: 0, preset: 0, customPreset: '' });

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain('silent');
		expect(warnings[0]).toContain('2024.4.2');

		await stateManager.set.RotationSpeed.call(accessory, 100);     // turbo
		climate.emit('state', { mode: 4, fanMode: 5, customFanMode: '', swingMode: 0, preset: 0, customPreset: '' });
		expect(warnings).toHaveLength(1);
	});

	test('the slider settles on whatever the device reports', async () => {
		const { accessory, climate } = buildWithWarnings();

		await stateManager.set.RotationSpeed.call(accessory, 20);
		climate.emit('state', { mode: 4, fanMode: 3, customFanMode: '', swingMode: 0, preset: 0, customPreset: '' });

		// LOW is rung 2 of 6 -> 40%, not the 20% that was asked for.
		expect(accessory.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed).value).toBe(40);
	});

	test('firmware that does honour it says nothing', async () => {
		const { accessory, climate, warnings } = buildWithWarnings();

		await stateManager.set.RotationSpeed.call(accessory, 20);
		climate.emit('state', { mode: 4, fanMode: 3, customFanMode: 'silent', swingMode: 0, preset: 0, customPreset: '' });

		expect(warnings).toHaveLength(0);
		expect(accessory.HeaterCoolerService.getCharacteristic(Characteristic.RotationSpeed).value).toBe(20);
	});

	test('selecting a standard fan mode never warns', async () => {
		const { accessory, climate, warnings } = buildWithWarnings();

		await stateManager.set.RotationSpeed.call(accessory, 60);      // MEDIUM
		climate.emit('state', { mode: 4, fanMode: 4, customFanMode: '', swingMode: 0, preset: 0, customPreset: '' });

		expect(warnings).toHaveLength(0);
	});
});

// Distinguishes "real but misconfigured device entry" from "empty Homebridge UI
// form scaffolding that happens to set disable* flags by default" — the latter
// shouldn't generate log noise on every restart.

const { init, looksLikeRealEntry, collectManualDevices } = require('../../lib/esphome');

describe('looksLikeRealEntry', () => {
	test('empty form scaffolding is not a real entry', () => {
		expect(looksLikeRealEntry({})).toBe(false);
		expect(looksLikeRealEntry({ port: 6053 })).toBe(false);
	});

	test('default disable* flags from an older schema (without name or host) is not a real entry', () => {
		// What the Homebridge UI form persisted under the 0.4.x schema for an unfilled row.
		expect(looksLikeRealEntry({
			port: 6053,
			disableHumiditySensor: false,
			disableOutdoorTempSensor: false,
			disablePowerSensor: false,
			disableBeeperSwitch: false,
			disableDisplaySwitch: false,
			disableDryMode: false,
			disableFanOnlyMode: false,
			discovered: false,
		})).toBe(false);
	});

	test('a name without a host is a real misconfiguration worth warning about', () => {
		expect(looksLikeRealEntry({ name: 'Living Room AC' })).toBe(true);
	});

	test('an encryption key without a host is a real misconfiguration worth warning about', () => {
		expect(looksLikeRealEntry({ encryptionKey: 'cGxhY2Vob2xkZXI=' })).toBe(true);
	});

	test('a name and an encryption key both flag as real', () => {
		expect(looksLikeRealEntry({ name: 'AC', encryptionKey: 'cGxhY2Vob2xkZXI=' })).toBe(true);
	});
});

describe('collectManualDevices', () => {
	test('drops empty UI scaffolding before device orchestration', () => {
		const warnings = [];
		const result = collectManualDevices([
			{ port: 6053, disableHumiditySensor: false },
			{ name: 'Living Room AC', host: '192.168.1.10' },
		], { warn: msg => warnings.push(msg) });

		expect(result.manualDevices).toHaveLength(1);
		expect(result.manualDevices[0].host).toBe('192.168.1.10');
		expect(result.invalidManualDeviceCount).toBe(0);
		expect(warnings).toHaveLength(0);
	});

	test('keeps real hostless entries out of live devices but counts them as invalid', () => {
		const warnings = [];
		const result = collectManualDevices([
			{ name: 'Missing Host AC' },
		], { warn: msg => warnings.push(msg) });

		expect(result.manualDevices).toHaveLength(0);
		expect(result.invalidManualDeviceCount).toBe(1);
		expect(warnings[0]).toContain('Missing Host AC');
	});
});

describe('init with invalid manual entries', () => {
	test('does not prune cached accessories when a real manual device is missing host', async () => {
		const warnings = [];
		const platform = {
			devices: [{ name: 'Missing Host AC' }],
			autoDiscover: false,
			accessories: [{ displayName: 'Cached AC', context: { host: '192.168.1.10' } }],
			staleAccessories: [],
			esphomeDevices: {},
			_clients: [],
			PLUGIN_NAME: 'homebridge-slwf-01pro',
			PLATFORM_NAME: 'SLWFOnePro',
			log: Object.assign(function () {}, {
				warn: msg => warnings.push(msg),
				error: function () {},
				debug: function () {},
				easyDebug: function () {},
			}),
			api: {
				user: { persistPath: () => '/tmp/does-not-exist' },
				unregisterPlatformAccessories: jest.fn(),
			},
		};

		await init.call(platform);

		expect(platform.api.unregisterPlatformAccessories).not.toHaveBeenCalled();
		expect(platform.accessories).toHaveLength(1);
		expect(warnings.some(m => m.includes('no host configured'))).toBe(true);
		expect(warnings.some(m => m.includes('Keeping cached accessories'))).toBe(true);
	});
});

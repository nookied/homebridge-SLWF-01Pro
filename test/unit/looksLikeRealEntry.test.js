// Distinguishes "real but misconfigured device entry" from "empty Homebridge UI
// form scaffolding that happens to set disable* flags by default" — the latter
// shouldn't generate log noise on every restart.

const { looksLikeRealEntry } = require('../../lib/esphome');

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

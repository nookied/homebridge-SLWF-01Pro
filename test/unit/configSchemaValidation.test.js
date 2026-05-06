const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'config.schema.json');

// `condition` is a Homebridge UI extension (legacy syntax for conditional fields).
// Declaring it tells ajv to accept-and-ignore rather than warn.
const HOMEBRIDGE_KEYWORDS = ['condition'];

function makeValidator() {
	const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
	const wrapper = JSON.parse(raw);
	const innerSchema = wrapper.schema;
	const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
	addFormats(ajv);
	for (const kw of HOMEBRIDGE_KEYWORDS) {
		if (!ajv.RULES.keywords[kw]) ajv.addKeyword(kw);
	}
	return ajv.compile(innerSchema);
}

describe('config.schema.json — ajv validation against sample configs', () => {
	let validate;
	beforeAll(() => { validate = makeValidator(); });

	test('schema compiles without errors', () => {
		expect(validate).toBeInstanceOf(Function);
	});

	test('empty platform block (just identifier) is valid', () => {
		const config = {};
		const ok = validate(config);
		if (!ok) console.error(validate.errors);
		expect(ok).toBe(true);
	});

	test('autoDiscover-only minimal config is valid', () => {
		const config = { autoDiscover: true };
		expect(validate(config)).toBe(true);
	});

	test('autoDiscover with discoveryTimeout is valid', () => {
		const config = { autoDiscover: true, discoveryTimeout: 10 };
		expect(validate(config)).toBe(true);
	});

	test('manual device with all required fields is valid', () => {
		const config = {
			devices: [{ name: 'Living Room AC', host: '192.168.1.10' }],
		};
		expect(validate(config)).toBe(true);
	});

	test('manual device with all optional fields is valid', () => {
		const config = {
			devices: [{
				name: 'Living Room AC',
				host: '192.168.1.10',
				port: 6053,
				encryptionKey: 'abc123==',
				disableHumiditySensor: true,
				disableOutdoorTempSensor: false,
				disablePowerSensor: true,
				disableBeeperSwitch: false,
				disableDisplaySwitch: false,
				disableDryMode: false,
				disableFanOnlyMode: false,
			}],
		};
		expect(validate(config)).toBe(true);
	});

	test('platform-level disable flags are accepted', () => {
		const config = {
			autoDiscover: true,
			disableHumiditySensor: true,
			disableOutdoorTempSensor: true,
			disablePowerSensor: true,
			disableBeeperSwitch: true,
			disableDisplaySwitch: true,
			disableDryMode: true,
			disableFanOnlyMode: true,
		};
		expect(validate(config)).toBe(true);
	});

	test('mixed manual + auto-discovery config is valid', () => {
		const config = {
			autoDiscover: true,
			discoveryTimeout: 5,
			disableHumiditySensor: true,
			devices: [
				{ name: 'AC One', host: '192.168.1.10' },
				{ name: 'AC Two', host: 'ac-two.local', port: 6053, encryptionKey: '' },
			],
		};
		expect(validate(config)).toBe(true);
	});

	test('full sample from config-sample.json is valid (after extracting platform block)', () => {
		const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config-sample.json'), 'utf8'));
		const block = sample.platforms.find(p => p.platform === 'SLWFOnePro');
		expect(block).toBeDefined();
		// Strip Homebridge envelope keys (handled by Homebridge itself, not our schema)
		const stripped = { ...block };
		delete stripped.platform;
		expect(validate(stripped)).toBe(true);
	});

	test('rejects device entry missing required `name`', () => {
		const config = { devices: [{ host: '192.168.1.10' }] };
		expect(validate(config)).toBe(false);
		expect(validate.errors.some(e => e.params.missingProperty === 'name')).toBe(true);
	});

	test('rejects device entry missing required `host`', () => {
		const config = { devices: [{ name: 'AC' }] };
		expect(validate(config)).toBe(false);
		expect(validate.errors.some(e => e.params.missingProperty === 'host')).toBe(true);
	});

	test('rejects empty `name` (minLength 1)', () => {
		const config = { devices: [{ name: '', host: '192.168.1.10' }] };
		expect(validate(config)).toBe(false);
		expect(validate.errors.some(e => e.keyword === 'minLength')).toBe(true);
	});

	test('rejects port below valid TCP range', () => {
		const config = { devices: [{ name: 'AC', host: '192.168.1.10', port: 0 }] };
		expect(validate(config)).toBe(false);
	});

	test('rejects port above valid TCP range', () => {
		const config = { devices: [{ name: 'AC', host: '192.168.1.10', port: 70000 }] };
		expect(validate(config)).toBe(false);
	});

	test('rejects discoveryTimeout below minimum', () => {
		const config = { autoDiscover: true, discoveryTimeout: 1 };
		expect(validate(config)).toBe(false);
	});

	test('rejects discoveryTimeout above maximum', () => {
		const config = { autoDiscover: true, discoveryTimeout: 999 };
		expect(validate(config)).toBe(false);
	});

	test('rejects wrong-type values for booleans', () => {
		const config = { autoDiscover: 'yes' };
		expect(validate(config)).toBe(false);
	});

	test('rejects wrong-type values for integer fields', () => {
		const config = { discoveryTimeout: 'fast' };
		expect(validate(config)).toBe(false);
	});

	test('does NOT reject unrelated properties (additionalProperties stays open)', () => {
		// Homebridge UI may add fields like _bridge for child-bridge config.
		// Our schema must not break those.
		const config = {
			autoDiscover: true,
			_bridge: { username: 'AB:CD:EF:01:02:03', port: 51826 },
		};
		expect(validate(config)).toBe(true);
	});

	test('null values for optional booleans are not crashing the validator', () => {
		// Some UIs save unset booleans as null. We don't want validation to fail
		// because the user is allowed to "unset" a field.
		const config = { autoDiscover: null };
		// May or may not validate true depending on schema strictness — but must not throw.
		const result = validate(config);
		expect(typeof result).toBe('boolean');
	});
});

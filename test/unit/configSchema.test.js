const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'config.schema.json');
const INDEX_PATH = path.join(__dirname, '..', '..', 'index.js');
const CONSTANTS_PATH = path.join(__dirname, '..', '..', 'lib', 'constants.js');
const DEVICE_ACCESSORY_PATH = path.join(__dirname, '..', '..', 'lib', 'DeviceAccessory.js');

function loadSchema() {
	const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
	return JSON.parse(raw);
}

function loadFile(p) {
	return fs.readFileSync(p, 'utf8');
}

describe('config.schema.json', () => {
	let schema;
	beforeAll(() => { schema = loadSchema(); });

	test('parses as JSON', () => {
		expect(schema).toBeDefined();
		expect(typeof schema).toBe('object');
	});

	test('has the four required Homebridge plugin schema fields', () => {
		expect(schema.pluginAlias).toBe('SLWFOnePro');
		expect(schema.pluginType).toBe('platform');
		expect(typeof schema.singular).toBe('boolean');
		expect(schema.schema).toBeDefined();
	});

	test('pluginAlias matches PLATFORM_NAME constant', () => {
		const constantsSrc = loadFile(CONSTANTS_PATH);
		const match = constantsSrc.match(/const\s+PLATFORM_NAME\s*=\s*['"]([^'"]+)['"]/);
		expect(match).not.toBeNull();
		const platformName = match[1];
		expect(schema.pluginAlias).toBe(platformName);
		// And confirm the constant is actually exported from lib/constants.js
		const { PLATFORM_NAME } = require('../../lib/constants');
		expect(PLATFORM_NAME).toBe(platformName);
	});

	test('schema.properties is an object with at least the required keys', () => {
		expect(schema.schema.type).toBe('object');
		const props = schema.schema.properties;
		expect(props).toBeDefined();
		const expected = [
			'name', 'debug', 'autoDiscover', 'discoveryTimeout',
			'disableHumiditySensor', 'disableOutdoorTempSensor', 'disablePowerSensor',
			'disableBeeperSwitch', 'disableDisplaySwitch', 'disableDryMode', 'disableFanOnlyMode',
			'devices',
		];
		for (const key of expected) {
			expect(props[key]).toBeDefined();
		}
	});

	test('every platform-level property is read in index.js', () => {
		const indexSrc = loadFile(INDEX_PATH);
		const props = Object.keys(schema.schema.properties);
		for (const key of props) {
			// `name` is special — Homebridge passes it but we read it via config.name
			// `devices` is special — it's read as an array
			// for everything else, expect a `config.<key>` reference in index.js
			expect(indexSrc).toMatch(new RegExp(`config\\.${key}\\b`));
		}
	});

	test('devices items have the required + optional + per-device-disable properties', () => {
		const items = schema.schema.properties.devices.items.properties;
		expect(items.name).toBeDefined();
		expect(items.host).toBeDefined();
		expect(items.port).toBeDefined();
		expect(items.encryptionKey).toBeDefined();

		// Per-device disable flags must match the platform-level disable flags 1:1
		const platformDisableFlags = Object.keys(schema.schema.properties).filter(k => k.startsWith('disable'));
		const deviceDisableFlags = Object.keys(items).filter(k => k.startsWith('disable'));
		expect(deviceDisableFlags.sort()).toEqual(platformDisableFlags.sort());
	});

	test('every per-device disable flag is honoured by DeviceAccessory.settingDisabled', () => {
		const items = schema.schema.properties.devices.items.properties;
		const deviceDisableFlags = Object.keys(items).filter(k => k.startsWith('disable'));
		const accessorySrc = loadFile(DEVICE_ACCESSORY_PATH);

		for (const flag of deviceDisableFlags) {
			// Either the flag is referenced via settingDisabled('flagName') or directly
			const hasSettingCall = accessorySrc.includes(`settingDisabled('${flag}')`);
			const hasDirectAccess = accessorySrc.includes(`'${flag}'`) || accessorySrc.includes(`"${flag}"`);
			expect(hasSettingCall || hasDirectAccess).toBe(true);
		}
	});

	test('layout references valid property keys', () => {
		const layout = schema.layout;
		expect(Array.isArray(layout)).toBe(true);
		const platformProps = new Set(Object.keys(schema.schema.properties));
		const devicesProps = new Set(Object.keys(schema.schema.properties.devices.items.properties));

		const collectKeys = (entry, out) => {
			if (typeof entry === 'string') {
				out.push(entry);
			} else if (entry && typeof entry === 'object') {
				if (entry.key) out.push(entry.key);
				if (Array.isArray(entry.items)) {
					entry.items.forEach(child => collectKeys(child, out));
				}
			}
		};

		const referenced = [];
		layout.forEach(entry => collectKeys(entry, referenced));

		const missing = referenced.filter(ref => (
			ref.startsWith('devices[].')
				? !devicesProps.has(ref.slice('devices[].'.length))
				: !platformProps.has(ref)
		));

		expect(missing).toEqual([]);
	});

	test('discoveryTimeout has a working condition that depends on autoDiscover', () => {
		const cond = schema.schema.properties.discoveryTimeout.condition;
		expect(cond).toBeDefined();
		expect(typeof cond.functionBody).toBe('string');
		expect(cond.functionBody).toContain('autoDiscover');
	});

	test('platform-level disable flags default to true (clean Apple Home install)', () => {
		const props = schema.schema.properties;
		const flags = Object.keys(props).filter(k => k.startsWith('disable'));
		for (const flag of flags) {
			expect(props[flag].type).toBe('boolean');
			expect(props[flag].default).toBe(true);
		}
	});

	test('per-device disable flags have no default — undefined falls through to platform', () => {
		// Per-device flags must remain undefined unless explicitly set by the user; if the
		// schema set default:false here, the UI would write false to every saved device
		// config and override the platform default, defeating the symmetric override.
		const deviceProps = schema.schema.properties.devices.items.properties;
		const deviceFlags = Object.keys(deviceProps).filter(k => k.startsWith('disable'));
		for (const flag of deviceFlags) {
			expect(deviceProps[flag].type).toBe('boolean');
			expect(deviceProps[flag].default).toBeUndefined();
		}
	});

	test('autoDiscover defaults to true so fresh installs pick up devices automatically', () => {
		expect(schema.schema.properties.autoDiscover.default).toBe(true);
	});

	test('default `name` matches the platform identifier so new UI installs label themselves correctly', () => {
		expect(schema.schema.properties.name.default).toBe(schema.pluginAlias);
	});

	test('discoveryTimeout integer constraints are sensible', () => {
		const dt = schema.schema.properties.discoveryTimeout;
		expect(dt.type).toBe('integer');
		expect(dt.minimum).toBeGreaterThanOrEqual(2);
		expect(dt.maximum).toBeLessThanOrEqual(60);
		expect(dt.default).toBeGreaterThanOrEqual(dt.minimum);
		expect(dt.default).toBeLessThanOrEqual(dt.maximum);
	});

	test('port integer constraints are within TCP range', () => {
		const { DEFAULT_ESPHOME_PORT } = require('../../lib/constants');
		const port = schema.schema.properties.devices.items.properties.port;
		expect(port.type).toBe('integer');
		expect(port.minimum).toBe(1);
		expect(port.maximum).toBe(65535);
		expect(port.default).toBe(DEFAULT_ESPHOME_PORT);
	});
});

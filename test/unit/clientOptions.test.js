// Locks in the options passed to the ESPHome native-API client.
//
// clearSession is the one that matters. The client destroys and recreates its
// entity objects on reconnect *only* when clearSession is true. DeviceAccessory
// binds its 'state' listeners to those objects once, and esphome.js's
// 'initialized' handler early-returns on reconnect — so flipping this to true
// would leave the plugin holding destroyed entities, and HomeKit would silently
// stop receiving updates after the first reconnect. Nothing else in the suite
// would catch that, hence this test.

const mockClientInstances = [];

jest.mock('@2colors/esphome-native-api', () => ({
	Client: class {
		constructor(options) {
			this.options = options;
			mockClientInstances.push(this);
		}
		on() {}
		connect() {}
	},
	Discovery: class {},
}));

const { init } = require('../../lib/esphome');
const { DEFAULT_ESPHOME_PORT } = require('../../lib/constants');

function makePlatform(devices) {
	const log = Object.assign(() => {}, { error: () => {}, warn: () => {}, easyDebug: () => {} });
	return {
		log,
		devices,
		autoDiscover: false,
		accessories: [],
		staleAccessories: [],
		cachedAccessoryFallbacks: [],
		esphomeDevices: {},
		PLUGIN_NAME: 'homebridge-slwf-01pro',
		PLATFORM_NAME: 'SLWFOnePro',
		api: {
			user: { persistPath: () => '/nonexistent-path-for-tests' },
			unregisterPlatformAccessories: () => {},
		},
	};
}

describe('ESPHome client options', () => {
	beforeEach(() => {
		mockClientInstances.length = 0;
	});

	test('clearSession is false, so entity objects survive reconnects', async () => {
		await init.call(makePlatform([{ name: 'Living Room AC', host: '192.168.1.120' }]));

		expect(mockClientInstances).toHaveLength(1);
		expect(mockClientInstances[0].options.clearSession).toBe(false);
	});

	test('host, port and encryption key are forwarded as configured', async () => {
		await init.call(makePlatform([
			{ name: 'Living Room AC', host: '192.168.1.120', port: 6100, encryptionKey: 'secret' },
		]));

		expect(mockClientInstances[0].options).toMatchObject({
			host: '192.168.1.120',
			port: 6100,
			encryptionKey: 'secret',
		});
	});

	test('a device without an explicit port gets the ESPHome default', async () => {
		await init.call(makePlatform([{ name: 'Bedroom AC', host: '192.168.1.121' }]));

		expect(mockClientInstances[0].options.port).toBe(DEFAULT_ESPHOME_PORT);
		expect(mockClientInstances[0].options.encryptionKey).toBe('');
	});

	test('one client is spawned per configured device', async () => {
		await init.call(makePlatform([
			{ name: 'A', host: '192.168.1.120' },
			{ name: 'B', host: '192.168.1.121' },
		]));

		expect(mockClientInstances.map(c => c.options.host)).toEqual(['192.168.1.120', '192.168.1.121']);
	});

	test('a reconnect interval is always set, so dropped devices retry on their own', async () => {
		await init.call(makePlatform([{ name: 'Living Room AC', host: '192.168.1.120' }]));

		expect(mockClientInstances[0].options.reconnectInterval).toBeGreaterThan(0);
	});
});

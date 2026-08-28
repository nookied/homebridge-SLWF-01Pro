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
			this.handlers = {};
			mockClientInstances.push(this);
		}
		on(event, fn) { this.handlers[event] = fn; }
		emit(event, payload) { if (this.handlers[event]) this.handlers[event](payload); }
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

// A device that drops off the network fails every reconnect attempt for as long
// as it stays away. On the live test bench one AC went offline for ten minutes
// and produced ~60 identical `getaddrinfo ENOTFOUND` lines at error level.
describe('repeated connection failures do not flood the log', () => {
	beforeEach(() => {
		mockClientInstances.length = 0;
	});

	function spawn() {
		const platform = makePlatform([{ name: 'Living Room AC', host: '192.168.1.120' }]);
		const errors = [];
		const infos = [];
		platform.log = Object.assign(msg => infos.push(String(msg)), {
			error: msg => errors.push(String(msg)),
			warn: () => {},
			easyDebug: () => {},
		});
		return { platform, errors, infos };
	}

	test('the same error repeated is logged once, not every retry', async () => {
		const { platform, errors } = spawn();
		await init.call(platform);
		const client = mockClientInstances[0];

		for (let i = 0; i < 20; i++) {
			client.emit('error', new Error('getaddrinfo ENOTFOUND air-conditioner-fae29f.local'));
		}

		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('ENOTFOUND');
	});

	test('a different error still gets through', async () => {
		const { platform, errors } = spawn();
		await init.call(platform);
		const client = mockClientInstances[0];

		client.emit('error', new Error('read ECONNRESET'));
		client.emit('error', new Error('read ECONNRESET'));
		client.emit('error', new Error('getaddrinfo ENOTFOUND'));

		expect(errors).toHaveLength(2);
	});

	test('reconnecting reports how many attempts failed, and re-arms logging', async () => {
		const { platform, errors, infos } = spawn();
		await init.call(platform);
		const client = mockClientInstances[0];

		for (let i = 0; i < 5; i++) client.emit('error', new Error('read ECONNRESET'));
		client.emit('connected');

		expect(infos.some(m => m.includes('failed attempt'))).toBe(true);

		// After coming back, the same error is newsworthy again.
		client.emit('error', new Error('read ECONNRESET'));
		expect(errors).toHaveLength(2);
	});
});

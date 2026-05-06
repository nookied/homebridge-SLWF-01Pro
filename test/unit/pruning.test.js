// Verifies pruneOrphanedAccessories never unregisters cached accessories when
// autoDiscover is on — an offline device shouldn't lose its Apple Home identity
// (name/room/automations) just because mDNS missed it on this boot.

const { pruneOrphanedAccessories } = require('../../lib/esphome');

function makeFakeAccessory(displayName, host) {
	return {
		displayName,
		UUID: `uuid:${host}`,
		context: { host },
	};
}

function makePlatform({ autoDiscover, accessories }) {
	const unregistered = [];
	const messages = [];
	const easyDebugMessages = [];
	return {
		autoDiscover,
		accessories: accessories.slice(),
		PLUGIN_NAME: 'homebridge-slwf-01pro',
		PLATFORM_NAME: 'SLWFOnePro',
		log: Object.assign(function (msg) { messages.push(msg); }, {
			info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
			easyDebug: msg => easyDebugMessages.push(msg),
		}),
		api: {
			unregisterPlatformAccessories: (plugin, alias, accs) => {
				unregistered.push(...accs);
			},
		},
		_unregistered: unregistered,
		_messages: messages,
		_easyDebugMessages: easyDebugMessages,
	};
}

describe('pruneOrphanedAccessories with autoDiscover on', () => {
	test('cached accessory missing from current discovery is kept, not unregistered', () => {
		const offline = makeFakeAccessory('Living Room AC', '192.168.1.50');
		const online = makeFakeAccessory('Bedroom AC', '192.168.1.51');
		const platform = makePlatform({
			autoDiscover: true,
			accessories: [offline, online],
		});

		// Discovery only found the bedroom AC this scan; living room is offline.
		pruneOrphanedAccessories(platform, ['192.168.1.51']);

		expect(platform._unregistered).toHaveLength(0);
		expect(platform.accessories).toContain(offline);
		expect(platform.accessories).toContain(online);
		expect(platform._easyDebugMessages.some(m => m.includes('192.168.1.50'))).toBe(true);
	});

	test('empty discovery keeps all cached accessories', () => {
		const a = makeFakeAccessory('AC1', '192.168.1.50');
		const b = makeFakeAccessory('AC2', '192.168.1.51');
		const platform = makePlatform({
			autoDiscover: true,
			accessories: [a, b],
		});

		pruneOrphanedAccessories(platform, []);

		expect(platform._unregistered).toHaveLength(0);
		expect(platform.accessories).toHaveLength(2);
	});
});

describe('pruneOrphanedAccessories with autoDiscover off', () => {
	test('cached accessory not in manual list is unregistered (legacy behaviour preserved)', () => {
		const removed = makeFakeAccessory('Removed AC', '192.168.1.50');
		const kept = makeFakeAccessory('Manual AC', '192.168.1.51');
		const platform = makePlatform({
			autoDiscover: false,
			accessories: [removed, kept],
		});

		// Only the kept host is in the manual config now.
		pruneOrphanedAccessories(platform, ['192.168.1.51']);

		expect(platform._unregistered).toContain(removed);
		expect(platform._unregistered).not.toContain(kept);
		expect(platform.accessories).not.toContain(removed);
		expect(platform.accessories).toContain(kept);
	});

	test('all cached accessories are pruned when no manual devices remain', () => {
		const a = makeFakeAccessory('AC1', '192.168.1.50');
		const b = makeFakeAccessory('AC2', '192.168.1.51');
		const platform = makePlatform({
			autoDiscover: false,
			accessories: [a, b],
		});

		pruneOrphanedAccessories(platform, []);

		expect(platform._unregistered).toHaveLength(2);
		expect(platform.accessories).toHaveLength(0);
	});
});

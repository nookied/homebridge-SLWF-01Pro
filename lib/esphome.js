const { Client } = require('@2colors/esphome-native-api');
const DeviceAccessory = require('./DeviceAccessory');
const { discoverDevices } = require('./discovery');
const { bundleEntities } = require('./classifyEntity');

const RECONNECT_INTERVAL_MS = 5000;
const DEFAULT_DISCOVERY_TIMEOUT_S = 5;

function normalizeHost(value) {
	if (!value) return '';
	return value.toString().toLowerCase().replace(/\.local\.?$/, '').replace(/\.$/, '');
}

async function init() {
	const platform = this;
	platform._clients = [];

	const manualDevices = (platform.devices || []).map(d => ({
		...d,
		port: d.port || 6053,
		discovered: false,
	}));

	const allDevices = manualDevices.slice();
	let discoverySucceeded = !platform.autoDiscover;

	if (platform.autoDiscover) {
		try {
			const discovered = await discoverDevices({
				timeout: platform.discoveryTimeout || DEFAULT_DISCOVERY_TIMEOUT_S,
				log: platform.log,
			});
			discoverySucceeded = true;
			const knownIdentifiers = new Set();
			for (const d of allDevices) {
				if (d.host) knownIdentifiers.add(normalizeHost(d.host));
			}
			for (const d of discovered) {
				const candidates = [normalizeHost(d.host), normalizeHost(d.address)].filter(Boolean);
				if (candidates.some(c => knownIdentifiers.has(c))) continue;
				allDevices.push(d);
				candidates.forEach(c => knownIdentifiers.add(c));
			}
		} catch (err) {
			platform.log.error(`Auto-discovery failed: ${err.message || err}`);
		}
	}

	if (allDevices.length === 0) {
		if (manualDevices.length === 0 && (!platform.autoDiscover || discoverySucceeded)) {
			platform.log('No ESPHome devices configured and none discovered. Plugin will idle.');
			pruneOrphanedAccessories(platform, []);
		} else {
			platform.log.error('Auto-discovery returned no devices and no manual devices configured — keeping cached accessories. Will retry on next restart.');
		}
		return;
	}

	for (const device of allDevices) {
		if (!device.host) {
			platform.log.error(`Skipping device without host: ${JSON.stringify(device)}`);
			continue;
		}
		spawnClient(platform, device);
	}

	const liveHosts = allDevices.map(d => d.host).filter(Boolean);
	pruneOrphanedAccessories(platform, liveHosts);
}

function spawnClient(platform, device) {
	const client = new Client({
		host: device.host,
		port: device.port || 6053,
		encryptionKey: device.encryptionKey || '',
		clearSession: false,
		reconnectInterval: RECONNECT_INTERVAL_MS,
	});
	platform._clients.push({ client, device });

	let deviceInfo = null;
	let initialized = false;

	client.on('deviceInfo', info => { deviceInfo = info; });

	client.on('connected', () => {
		platform.log(`${device.name || device.host} client connected`);
		const acc = platform.esphomeDevices[device.host];
		if (acc && typeof acc.setConnectedStatus === 'function') acc.setConnectedStatus(true);
	});

	client.on('disconnected', () => {
		platform.log(`${device.name || device.host} client disconnected!`);
		const acc = platform.esphomeDevices[device.host];
		if (acc && typeof acc.setConnectedStatus === 'function') acc.setConnectedStatus(false);
	});

	client.on('error', err => {
		platform.log.error(`${device.name || device.host} error: ${err.message || err}`);
		platform.log.easyDebug(err);
	});

	client.on('initialized', () => {
		if (initialized) {
			platform.log.easyDebug(`${device.name || device.host}: re-initialized after reconnect.`);
			return;
		}
		initialized = true;

		const entities = Object.values(client.entities || {});
		const bundle = bundleEntities(entities);

		if (!bundle.climate) {
			platform.log(`${device.name || device.host}: no Climate entity present (${entities.length} entities total) — skipping accessory creation.`);
			return;
		}

		const displayName = device.name || (deviceInfo && deviceInfo.name) || device.host;
		try {
			const accessory = new DeviceAccessory({
				device: { ...device, name: displayName },
				deviceInfo,
				entities: bundle,
				platform,
			});
			platform.esphomeDevices[device.host] = accessory;
			const count = Object.keys(bundle).length;
			platform.log(`Initialized "${displayName}" with ${count} mapped entit${count === 1 ? 'y' : 'ies'}`);
		} catch (err) {
			platform.log.error(`Failed to initialize "${displayName}": ${err.message || err}`);
		}
	});

	client.connect();
}

function pruneOrphanedAccessories(platform, liveHosts) {
	const liveSet = new Set(liveHosts.map(h => normalizeHost(h)).filter(Boolean));
	for (const accessory of platform.accessories.slice()) {
		const cachedHost = normalizeHost(accessory.context.host);
		if (cachedHost && liveSet.has(cachedHost)) continue;
		platform.log(`Unregistering orphaned accessory: "${accessory.displayName}" (host: ${accessory.context.host || 'unknown'})`);
		platform.api.unregisterPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [accessory]);
		const idx = platform.accessories.indexOf(accessory);
		if (idx >= 0) platform.accessories.splice(idx, 1);
	}
}

module.exports = { init };

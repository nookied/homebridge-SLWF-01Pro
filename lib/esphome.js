const fs = require('fs');
const path = require('path');
const { Client } = require('@2colors/esphome-native-api');
const DeviceAccessory = require('./DeviceAccessory');
const { discoverDevices } = require('./discovery');
const { bundleEntities } = require('./classifyEntity');

const RECONNECT_INTERVAL_MS = 5000;
const DEFAULT_DISCOVERY_TIMEOUT_S = 5;
const FIRST_STATE_TIMEOUT_MS = 5000;

const UPSTREAM_PLUGIN_NAME = 'homebridge-esphome-ac';
const LEGACY_PLATFORM_NAME = 'ESPHomeAC';

function normalizeHost(value) {
	if (!value) return '';
	return value.toString().toLowerCase().replace(/\.local\.?$/, '').replace(/\.$/, '');
}

function detectOrphanedAccessories(platform) {
	try {
		const cacheDir = path.join(platform.api.user.persistPath(), 'accessories');
		if (!fs.existsSync(cacheDir)) return;

		const files = fs.readdirSync(cacheDir).filter(f => f.startsWith('cachedAccessories.'));
		let upstreamCount = 0;
		let legacyPlatformCount = 0;

		for (const file of files) {
			let content;
			try {
				content = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
			} catch (_e) {
				continue;
			}
			if (!Array.isArray(content)) continue;
			for (const acc of content) {
				if (!acc) continue;
				if (acc.plugin === UPSTREAM_PLUGIN_NAME) upstreamCount++;
				else if (acc.plugin === platform.PLUGIN_NAME && acc.platform === LEGACY_PLATFORM_NAME) legacyPlatformCount++;
			}
		}

		if (upstreamCount > 0) {
			platform.log.warn(
				`Detected ${upstreamCount} cached accessor${upstreamCount === 1 ? 'y' : 'ies'} from upstream "${UPSTREAM_PLUGIN_NAME}". ` +
				`These are orphans (this plugin is "${platform.PLUGIN_NAME}", different name). ` +
				`Clean up via Homebridge UI → Settings → Remove Single Cached Accessory, ` +
				`or stop Homebridge and delete cachedAccessories.* in ${cacheDir}, then restart.`
			);
		}
		if (legacyPlatformCount > 0) {
			platform.log.warn(
				`Detected ${legacyPlatformCount} cached accessor${legacyPlatformCount === 1 ? 'y' : 'ies'} using the legacy "${LEGACY_PLATFORM_NAME}" platform identifier (pre-0.2.0). ` +
				`The platform was renamed to "SLWFOnePro" in v0.2.0; the old entries are orphans. ` +
				`Update your config.json (\`"platform": "SLWFOnePro"\`) and clean up via Homebridge UI → Settings → Remove Single Cached Accessory.`
			);
		}
	} catch (err) {
		platform.log.easyDebug(`Orphan detection failed (non-fatal): ${err.message || err}`);
	}
}

function evictStaleSchemaAccessories(platform) {
	if (!platform.staleAccessories || platform.staleAccessories.length === 0) return;
	const stale = platform.staleAccessories.slice();
	platform.staleAccessories = [];
	platform.log(`Evicting ${stale.length} cached accessor${stale.length === 1 ? 'y' : 'ies'} from an older plugin schema. They will be re-registered fresh with stable UUIDs.`);
	try {
		platform.api.unregisterPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, stale);
	} catch (err) {
		platform.log.error(`Failed to evict stale-schema accessories: ${err.message || err}`);
	}
}

async function init() {
	const platform = this;
	platform._clients = [];
	evictStaleSchemaAccessories(platform);
	detectOrphanedAccessories(platform);

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
			platform.log('No SLWF-01Pro / ESPHome devices configured and none discovered. Plugin will idle.');
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

		const create = () => {
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
		};

		// Wait for the climate's first state event before creating the accessory.
		// HAP characteristic values must be defined when Apple Home pairs (otherwise → "out of compliance").
		// 5s timeout fallback: if state never arrives, create with whatever defaults the device gives us.
		if (bundle.climate.state && bundle.climate.state.mode != null) {
			create();
			return;
		}

		platform.log.easyDebug(`${displayName}: waiting for first climate state event before creating accessory…`);
		let created = false;
		const onState = () => {
			if (created) return;
			created = true;
			clearTimeout(timer);
			create();
		};
		bundle.climate.once('state', onState);
		const timer = setTimeout(() => {
			if (created) return;
			created = true;
			bundle.climate.removeListener('state', onState);
			platform.log.warn(`${displayName}: no climate state received within ${FIRST_STATE_TIMEOUT_MS / 1000}s — creating accessory with default values.`);
			create();
		}, FIRST_STATE_TIMEOUT_MS);
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

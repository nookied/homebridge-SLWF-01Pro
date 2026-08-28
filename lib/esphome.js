const fs = require('fs');
const path = require('path');
const { Client } = require('@2colors/esphome-native-api');
const DeviceAccessory = require('./DeviceAccessory');
const { discoverDevices } = require('./discovery');
const { bundleEntities } = require('./classifyEntity');
const { DEFAULT_ESPHOME_PORT } = require('./constants');

const RECONNECT_INTERVAL_MS = 5000;
const DEFAULT_DISCOVERY_TIMEOUT_S = 5;
const FIRST_STATE_TIMEOUT_MS = 5000;

const UPSTREAM_PLUGIN_NAME = 'homebridge-esphome-ac';
const LEGACY_PLATFORM_NAME = 'ESPHomeAC';

function normalizeHost(value) {
	if (!value) return '';
	return value.toString().toLowerCase().replace(/\.local\.?$/, '').replace(/\.$/, '');
}

function deviceIdentifiers(device) {
	return [normalizeHost(device && device.host), normalizeHost(device && device.address)].filter(Boolean);
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
	platform.cachedAccessoryFallbacks = (platform.cachedAccessoryFallbacks || []).concat(stale);
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

	const { manualDevices, invalidManualDeviceCount } = collectManualDevices(platform.devices || [], platform.log);

	const allDevices = manualDevices.slice();
	let discoverySucceeded = !platform.autoDiscover;

	if (platform.autoDiscover) {
		try {
			const discovered = await discoverDevices({
				timeout: platform.discoveryTimeout || DEFAULT_DISCOVERY_TIMEOUT_S,
				log: platform.log,
			});
			discoverySucceeded = true;
			const knownIdentifiers = knownDeviceIdentifiers(allDevices);
			for (const d of discovered) {
				const candidates = deviceIdentifiers(d);
				if (candidates.some(c => knownIdentifiers.has(c))) continue;
				allDevices.push(d);
				candidates.forEach(c => knownIdentifiers.add(c));
			}
			addCachedAccessoryDevices(platform, allDevices);
		} catch (err) {
			platform.log.error(`Auto-discovery failed: ${err.message || err}`);
			addCachedAccessoryDevices(platform, allDevices);
		}
	}

	if (allDevices.length === 0) {
		if (invalidManualDeviceCount > 0) {
			platform.log.warn('No valid manual device hosts were configured. Keeping cached accessories until the device list is fixed.');
			if (platform.autoDiscover) pruneOrphanedAccessories(platform, []);
			return;
		}
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
			// Empty form-template rows persisted by the Homebridge UI (no host, no name,
			// no encryption key — just defaulted disable* flags from older schemas) get
			// silently dropped. A real misconfiguration (user typed a name but forgot the
			// host, or set an encryption key but forgot the host) still gets a warning.
			if (looksLikeRealEntry(device)) {
				platform.log.warn(`Skipping device "${device.name || '(unnamed)'}" — no host configured.`);
			}
			continue;
		}
		spawnClient(platform, device);
	}

	const liveHosts = allDevices.map(d => d.host).filter(Boolean);
	if (invalidManualDeviceCount > 0 && !platform.autoDiscover) {
		platform.log.warn('One or more manual device entries are missing a host. Skipping orphan pruning to avoid removing cached accessories while the config is invalid.');
		return;
	}
	pruneOrphanedAccessories(platform, liveHosts);
}

function collectManualDevices(devices, log) {
	const manualDevices = [];
	let invalidManualDeviceCount = 0;
	for (const d of devices) {
		const device = {
			...d,
			port: d.port || DEFAULT_ESPHOME_PORT,
			discovered: false,
		};
		if (device.host) {
			manualDevices.push(device);
			continue;
		}
		if (looksLikeRealEntry(device)) {
			invalidManualDeviceCount++;
			log.warn(`Skipping device "${device.name || '(unnamed)'}" — no host configured.`);
		}
	}
	return { manualDevices, invalidManualDeviceCount };
}

function knownDeviceIdentifiers(devices) {
	const known = new Set();
	for (const d of devices) {
		deviceIdentifiers(d).forEach(id => known.add(id));
	}
	return known;
}

function addCachedAccessoryDevices(platform, devices) {
	if (!platform.autoDiscover) return [];
	const knownIdentifiers = knownDeviceIdentifiers(devices);

	const added = [];
	const cachedAccessories = [
		...(platform.accessories || []),
		...(platform.cachedAccessoryFallbacks || []),
	];
	for (const accessory of cachedAccessories) {
		const host = accessory.context && accessory.context.host;
		const key = normalizeHost(host);
		if (!key || knownIdentifiers.has(key)) continue;
		const device = {
			name: accessory.displayName || host,
			host,
			port: accessory.context.port || DEFAULT_ESPHOME_PORT,
			discovered: false,
			cached: true,
		};
		devices.push(device);
		added.push(device);
		knownIdentifiers.add(key);
	}

	if (added.length > 0) {
		platform.log.easyDebug(`Using ${added.length} cached accessor${added.length === 1 ? 'y' : 'ies'} as fallback connection target${added.length === 1 ? '' : 's'} after mDNS did not rediscover them: ${added.map(d => d.host).join(', ')}`);
	}
	return added;
}

function spawnClient(platform, device) {
	const client = new Client({
		host: device.host,
		port: device.port || DEFAULT_ESPHOME_PORT,
		encryptionKey: device.encryptionKey || '',
		// clearSession MUST stay false. The client only destroys and recreates its
		// entity objects when clearSession is true. DeviceAccessory binds its
		// 'state' listeners to those objects exactly once, and the 'initialized'
		// handler below deliberately early-returns on reconnect — so with
		// clearSession: true the plugin would keep a reference to destroyed
		// entities and HomeKit would silently stop receiving updates after the
		// first reconnect. Covered by test/unit/clientOptions.test.js.
		clearSession: false,
		reconnectInterval: RECONNECT_INTERVAL_MS,
	});
	platform._clients.push({ client, device });

	let deviceInfo = null;
	let initialized = false;
	const label = device.name || device.host;

	// A device that drops off the network fails every reconnect attempt, and the
	// client retries every RECONNECT_INTERVAL_MS for as long as it stays away.
	// Logging each identical failure at error level buries every other plugin's
	// output — one AC offline overnight is thousands of lines saying the same
	// thing. Log the first occurrence, then keep repeats at debug level until the
	// message changes or the device returns.
	let lastErrorMessage = null;
	let suppressedErrorCount = 0;

	client.on('deviceInfo', info => { deviceInfo = info; });

	client.on('connected', () => {
		if (suppressedErrorCount > 0) {
			platform.log(`${label} client connected (after ${suppressedErrorCount + 1} failed attempt${suppressedErrorCount === 0 ? '' : 's'})`);
		} else {
			platform.log(`${label} client connected`);
		}
		lastErrorMessage = null;
		suppressedErrorCount = 0;
		const acc = platform.esphomeDevices[device.host];
		if (acc && typeof acc.setConnectedStatus === 'function') acc.setConnectedStatus(true);
	});

	client.on('disconnected', () => {
		platform.log(`${label} client disconnected!`);
		const acc = platform.esphomeDevices[device.host];
		if (acc && typeof acc.setConnectedStatus === 'function') acc.setConnectedStatus(false);
	});

	client.on('error', err => {
		const message = (err && err.message) || String(err);
		if (message === lastErrorMessage) {
			suppressedErrorCount++;
			platform.log.easyDebug(`${label} error (repeat ${suppressedErrorCount}): ${message}`);
			return;
		}
		lastErrorMessage = message;
		suppressedErrorCount = 0;
		platform.log.error(`${label} error: ${message}`);
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

function looksLikeRealEntry(device) {
	return Boolean(device.name || device.encryptionKey);
}

function pruneOrphanedAccessories(platform, liveHosts) {
	const liveSet = new Set(liveHosts.map(h => normalizeHost(h)).filter(Boolean));

	// With autoDiscover on, an offline device shouldn't lose its HomeKit registration —
	// the user may have it powered off briefly, or mDNS may have missed it this scan.
	// Apple Home will show it as "Not Responding" until it reconnects, preserving the
	// user's name/room/automations. To remove an accessory permanently, use the
	// Homebridge UI → Remove Single Cached Accessory action.
	if (platform.autoDiscover) {
		const offline = platform.accessories
			.map(a => a.context.host)
			.filter(h => h && !liveSet.has(normalizeHost(h)));
		if (offline.length > 0) {
			platform.log.easyDebug(`Auto-discovery kept ${offline.length} cached accessor${offline.length === 1 ? 'y' : 'ies'} that didn't respond this scan: ${offline.join(', ')}. They'll reconnect when reachable.`);
		}
		return;
	}

	for (const accessory of platform.accessories.slice()) {
		const cachedHost = normalizeHost(accessory.context.host);
		if (cachedHost && liveSet.has(cachedHost)) continue;
		platform.log(`Unregistering orphaned accessory: "${accessory.displayName}" (host: ${accessory.context.host || 'unknown'})`);
		platform.api.unregisterPlatformAccessories(platform.PLUGIN_NAME, platform.PLATFORM_NAME, [accessory]);
		const idx = platform.accessories.indexOf(accessory);
		if (idx >= 0) platform.accessories.splice(idx, 1);
	}
}

module.exports = { init, spawnClient, pruneOrphanedAccessories, looksLikeRealEntry, collectManualDevices, addCachedAccessoryDevices };

const { Discovery } = require('@2colors/esphome-native-api');

const DEFAULT_TIMEOUT_SECONDS = 5;

function prettyNameFromHostname(hostname) {
	if (!hostname) return null;
	const stem = hostname.replace(/\.local\.?$/i, '');
	return stem.split(/[-_]/)
		.filter(Boolean)
		.map(part => part[0].toUpperCase() + part.slice(1))
		.join(' ');
}

function normalizeDiscovered(info) {
	const host = info.host ? info.host.replace(/\.$/, '') : info.address;
	return {
		name: prettyNameFromHostname(info.host || host) || host,
		host,
		port: info.port || 6053,
		address: info.address,
		mac: info.mac || null,
		discovered: true,
	};
}

function dedupeDevices(devices) {
	const seen = new Set();
	const out = [];
	for (const dev of devices) {
		const key = (dev.host || dev.address || '').toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(dev);
	}
	return out;
}

async function discoverDevices({ timeout = DEFAULT_TIMEOUT_SECONDS, log } = {}) {
	if (log) log(`Browsing mDNS for ESPHome devices (timeout ${timeout}s)…`);
	let raw;
	try {
		raw = await Discovery({ timeout });
	} catch (err) {
		if (log) log.error(`mDNS discovery failed: ${err.message || err}`);
		return [];
	}
	const found = (raw || []).map(normalizeDiscovered);
	const unique = dedupeDevices(found);
	if (log) log(`Discovered ${unique.length} ESPHome device${unique.length === 1 ? '' : 's'}.`);
	return unique;
}

module.exports = {
	discoverDevices,
	prettyNameFromHostname,
	dedupeDevices,
};

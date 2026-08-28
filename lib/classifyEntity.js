// ESPHome EntityCategory: 0 = none (a normal, user-facing entity),
// 1 = config, 2 = diagnostic. Anything not "none" is plumbing that belongs in
// the ESPHome dashboard, not in someone's Home app.
const ENTITY_CATEGORY_NONE = 0;

// Device classes that must never be reachable from a HomeKit tile. Real
// SLWF-01Pro firmware exposes a `Factory reset` Button (entityCategory 1,
// deviceClass "restart") next to the Display Toggle button; a stray name match
// there would put a factory reset one tap away in the Home app.
const UNSAFE_DEVICE_CLASSES = ['restart', 'reboot', 'update', 'identify'];

function blob(entity) {
	const cfg = entity.config || {};
	return [cfg.name, cfg.objectId].filter(Boolean).join(' ').toLowerCase();
}

function isExposable(entity) {
	const cfg = entity.config || {};
	// Climate is the accessory itself and is always exposed; the category guard
	// applies to the companion entities we surface as extra services.
	if (entity.type === 'Climate') return true;
	if (cfg.entityCategory !== undefined && cfg.entityCategory !== ENTITY_CATEGORY_NONE) return false;
	if (cfg.deviceClass && UNSAFE_DEVICE_CLASSES.includes(String(cfg.deviceClass).toLowerCase())) return false;
	if (cfg.disabledByDefault) return false;
	return true;
}

function classifyEntity(entity) {
	if (!entity || !entity.type) return null;
	if (!isExposable(entity)) return null;
	const text = blob(entity);

	if (entity.type === 'Climate') return 'climate';

	if (entity.type === 'Sensor') {
		if (text.includes('humidity')) return 'humiditySensor';
		if (text.includes('outdoor') && text.includes('temp')) return 'outdoorTempSensor';
		if (text.includes('power')) return 'powerSensor';
		return null;
	}

	if (entity.type === 'Switch') {
		if (text.includes('beeper') || text.includes('beep')) return 'beeperSwitch';
		return null;
	}

	if (entity.type === 'Button') {
		if (text.includes('display')) return 'displayButton';
		return null;
	}

	return null;
}

function bundleEntities(entities) {
	const bundle = {};
	for (const entity of entities) {
		const slot = classifyEntity(entity);
		if (!slot) continue;
		if (bundle[slot]) continue;
		bundle[slot] = entity;
	}
	return bundle;
}

module.exports = {
	classifyEntity,
	bundleEntities,
	isExposable,
};

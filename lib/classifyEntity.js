function blob(entity) {
	const cfg = entity.config || {};
	return [cfg.name, cfg.objectId].filter(Boolean).join(' ').toLowerCase();
}

function classifyEntity(entity) {
	if (!entity || !entity.type) return null;
	const text = blob(entity);

	if (entity.type === 'Climate') return 'climate';

	if (entity.type === 'Sensor') {
		if (text.includes('humidity')) return 'humiditySensor';
		if (text.includes('outdoor') && text.includes('temp')) return 'outdoorTempSensor';
		if (text.includes('outdoor temperature')) return 'outdoorTempSensor';
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
};

/**
 * Single source of truth for plugin-wide constants that need to stay in sync
 * across multiple files (e.g. between index.js and DeviceAccessory.js).
 */

const PLUGIN_NAME = 'homebridge-slwf-01pro';
const PLATFORM_NAME = 'SLWFOnePro';
const DEFAULT_ESPHOME_PORT = 6053;

/**
 * Bumped whenever the shape of a created accessory changes incompatibly:
 * new linked services, primary-service reassignment, characteristic prop
 * changes, etc. Cached accessories with a different schemaVersion are
 * evicted at startup and re-created cleanly.
 *
 * History:
 *   v1 (implicit) — pre-0.3.0; no schemaVersion stamp
 *   v2 — 0.3.0 introduced UUID namespace prefix (homebridge-slwf-01pro:<id>)
 *   v3 — 0.4.1 introduced AccessoryCategory.AIR_CONDITIONER + linked services
 *   v4 — 0.4.2 introduced ConfiguredName on companion services + Identify handler
 *   v5 — moves Eve power from HeaterCooler to a linked Outlet service
 *   v6 — removes sticky transport StatusActive/StatusFault from HeaterCooler
 *   v7 — WITHDRAWN. Published briefly in 1.1.0 for the preset switches, then
 *        reverted in 1.1.1: preset services and the re-anchored RotationSpeed
 *        migrate onto a cached accessory in place (test/unit/cachedUpgrade.test.js),
 *        so the eviction bought nothing and cost every upgrading user their
 *        Apple Home room assignments. Accessories already stamped v7 are left
 *        alone by the >= comparison in index.js.
 *
 * Bump this ONLY when a cached accessory genuinely cannot be migrated in place.
 * An eviction is not free: Homebridge unregisters and re-registers the
 * accessory, and Apple Home treats that as a new device, losing its room and
 * any rename.
 */
const ACCESSORY_SCHEMA_VERSION = 6;

const UUID_NAMESPACE = 'homebridge-slwf-01pro';

module.exports = {
	PLUGIN_NAME,
	PLATFORM_NAME,
	DEFAULT_ESPHOME_PORT,
	ACCESSORY_SCHEMA_VERSION,
	UUID_NAMESPACE,
};

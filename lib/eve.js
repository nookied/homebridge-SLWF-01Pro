const EVE_POWER_UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

function resolveFormats(api) {
	const Characteristic = api && api.hap && api.hap.Characteristic;
	if (!Characteristic) return null;
	if (api.hap.Formats) return { Formats: api.hap.Formats, Perms: api.hap.Perms };
	if (Characteristic.Formats) return { Formats: Characteristic.Formats, Perms: Characteristic.Perms };
	return {
		Formats: { FLOAT: 'float' },
		Perms: { READ: 'pr', NOTIFY: 'ev' },
	};
}

function makeEveClasses(api) {
	const enums = resolveFormats(api);
	if (!enums) return null;
	const Characteristic = api.hap.Characteristic;

	class CurrentPowerConsumption extends Characteristic {
		constructor() {
			super('Current Consumption', EVE_POWER_UUID, {
				format: enums.Formats.FLOAT,
				unit: 'W',
				minValue: 0,
				maxValue: 100000,
				minStep: 0.1,
				perms: [enums.Perms.READ, enums.Perms.NOTIFY],
			});
			this.value = this.getDefaultValue();
		}
	}
	CurrentPowerConsumption.UUID = EVE_POWER_UUID;

	return { CurrentPowerConsumption };
}

module.exports = { makeEveClasses, EVE_POWER_UUID };

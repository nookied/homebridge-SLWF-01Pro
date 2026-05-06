const { prettyNameFromHostname, dedupeDevices } = require('../../lib/discovery');

describe('prettyNameFromHostname', () => {
	test('typical SLWF-01Pro auto-discovery hostname', () => {
		expect(prettyNameFromHostname('air-conditioner-fae810')).toBe('Air Conditioner Fae810');
	});
	test('strips trailing .local', () => {
		expect(prettyNameFromHostname('living-room.local')).toBe('Living Room');
	});
	test('strips trailing .local.', () => {
		expect(prettyNameFromHostname('bedroom.local.')).toBe('Bedroom');
	});
	test('snake_case', () => {
		expect(prettyNameFromHostname('basement_ac')).toBe('Basement Ac');
	});
	test('null/empty', () => {
		expect(prettyNameFromHostname(null)).toBe(null);
		expect(prettyNameFromHostname('')).toBe(null);
	});
});

describe('dedupeDevices', () => {
	test('removes duplicates by host', () => {
		const out = dedupeDevices([
			{ host: 'a.local', address: '1.1.1.1' },
			{ host: 'a.local', address: '2.2.2.2' },
			{ host: 'b.local', address: '3.3.3.3' },
		]);
		expect(out).toHaveLength(2);
		expect(out[0].address).toBe('1.1.1.1');
	});
	test('case-insensitive', () => {
		const out = dedupeDevices([
			{ host: 'A.local' },
			{ host: 'a.local' },
		]);
		expect(out).toHaveLength(1);
	});
	test('falls back to address when no host', () => {
		const out = dedupeDevices([
			{ address: '10.0.0.1' },
			{ address: '10.0.0.1' },
			{ address: '10.0.0.2' },
		]);
		expect(out).toHaveLength(2);
	});
	test('skips entries with neither host nor address', () => {
		const out = dedupeDevices([{}, { host: 'x' }]);
		expect(out).toHaveLength(1);
	});
});

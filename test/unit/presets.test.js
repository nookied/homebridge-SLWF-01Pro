// Presets and custom fan modes, added in 1.1.0.
//
// The capability lists used here are the ones a live SLWF-01Pro reports:
//   supportedFanModesList:       [2, 3, 4, 5]            AUTO, LOW, MEDIUM, HIGH
//   supportedCustomFanModesList: ["silent", "turbo"]
//   supportedPresetsList:        [0, 3, 5, 6]            NONE, BOOST, ECO, SLEEP
//   supportedCustomPresetsList:  ["freeze protection"]
//
// Note what that means: AWAY is not offered, and there is a custom preset
// outside the enum entirely — so reading only supportedPresetsList would miss a
// capability the hardware has.

const {
	ESP_PRESET,
	buildFanLadder,
	fanLadderAnchors,
	fanLadderMinStep,
	speedToFanCommand,
	fanStateToSpeed,
	buildPresetList,
	activePresetEntry,
	presetSubtype,
} = require('../../lib/state');

const FAN_MODES = [2, 3, 4, 5];
const CUSTOM_FAN = ['silent', 'turbo'];
const PRESETS = [0, 3, 5, 6];
const CUSTOM_PRESETS = ['freeze protection'];

describe('fan ladder with custom fan modes', () => {
	test('custom modes are ordered around the standard speeds, not appended blindly', () => {
		const ladder = buildFanLadder(FAN_MODES, CUSTOM_FAN);

		expect(ladder).toEqual([
			{ mode: 2 },              // AUTO stays at the bottom; 0% has always meant AUTO
			{ custom: 'silent' },     // slower than LOW
			{ mode: 3 },
			{ mode: 4 },
			{ mode: 5 },
			{ custom: 'turbo' },      // faster than HIGH
		]);
	});

	test('six rungs restore real detents', () => {
		const ladder = buildFanLadder(FAN_MODES, CUSTOM_FAN);

		expect(fanLadderAnchors(ladder)).toEqual([0, 20, 40, 60, 80, 100]);
		expect(fanLadderMinStep(ladder)).toBe(20);
	});

	test('every rung round-trips', () => {
		const ladder = buildFanLadder(FAN_MODES, CUSTOM_FAN);

		for (const anchor of fanLadderAnchors(ladder)) {
			const command = speedToFanCommand(anchor, ladder);
			const back = fanStateToSpeed(command.fanMode, command.customFanMode || '', ladder);
			expect(back).toBe(anchor);
		}
	});

	test('a command carries either a standard or a custom mode, never both', () => {
		const ladder = buildFanLadder(FAN_MODES, CUSTOM_FAN);

		expect(speedToFanCommand(0, ladder)).toEqual({ fanMode: 2 });
		expect(speedToFanCommand(20, ladder)).toEqual({ customFanMode: 'silent' });
		expect(speedToFanCommand(100, ladder)).toEqual({ customFanMode: 'turbo' });

		for (const anchor of fanLadderAnchors(ladder)) {
			const command = speedToFanCommand(anchor, ladder);
			expect('fanMode' in command && 'customFanMode' in command).toBe(false);
		}
	});

	test('an active custom mode wins over a stale fanMode', () => {
		// ESPHome leaves fanMode at whatever it was while a custom mode is active.
		const ladder = buildFanLadder(FAN_MODES, CUSTOM_FAN);

		expect(fanStateToSpeed(5, 'silent', ladder)).toBe(20);
		expect(fanStateToSpeed(2, 'turbo', ladder)).toBe(100);
		expect(fanStateToSpeed(5, '', ladder)).toBe(80);
	});

	test('an unrecognised custom mode yields no percentage rather than a wrong one', () => {
		const ladder = buildFanLadder(FAN_MODES, CUSTOM_FAN);

		expect(fanStateToSpeed(3, 'jet stream', ladder)).toBeUndefined();
	});

	test('a device with no custom modes behaves exactly as before', () => {
		expect(buildFanLadder(FAN_MODES, [])).toEqual([{ mode: 2 }, { mode: 3 }, { mode: 4 }, { mode: 5 }]);
		expect(buildFanLadder(FAN_MODES, undefined)).toHaveLength(4);
	});

	test('ON and OFF are excluded — they are not speeds', () => {
		// ClimateFanMode.Off would fight the Active characteristic if it became a rung.
		const ladder = buildFanLadder([0, 1, 2, 3, 5], []);

		expect(ladder).toEqual([{ mode: 2 }, { mode: 3 }, { mode: 5 }]);
	});

	test('an unfamiliar custom mode is placed last rather than guessed at', () => {
		// ESPHome gives no ordering information for custom fan modes. Names we
		// recognise are slotted in; anything else goes after the known rungs, so
		// it stays reachable without claiming a speed it may not have.
		const ladder = buildFanLadder([3, 5], ['quiet', 'turbo', 'nebula']);

		expect(ladder).toEqual([
			{ custom: 'quiet' },     // recognised as slower than any standard mode
			{ mode: 3 },
			{ mode: 5 },
			{ custom: 'turbo' },     // recognised as faster
			{ custom: 'nebula' },    // unknown -> appended, still selectable
		]);
	});
});

describe('preset list', () => {
	test('both the enum presets and the custom ones are surfaced', () => {
		expect(buildPresetList(PRESETS, CUSTOM_PRESETS)).toEqual([
			{ preset: 3, label: 'Boost' },
			{ preset: 5, label: 'Eco' },
			{ preset: 6, label: 'Sleep' },
			{ custom: 'freeze protection', label: 'Freeze Protection' },
		]);
	});

	test('NONE is not a preset you can switch on', () => {
		const list = buildPresetList(PRESETS, CUSTOM_PRESETS);

		expect(list.some(e => e.preset === ESP_PRESET.NONE)).toBe(false);
	});

	test('a device advertising no presets gets no switches', () => {
		expect(buildPresetList([], [])).toEqual([]);
		expect(buildPresetList([0], [])).toEqual([]);
		expect(buildPresetList(undefined, undefined)).toEqual([]);
	});

	test('subtypes are stable and safe to use as service ids', () => {
		const list = buildPresetList(PRESETS, CUSTOM_PRESETS);
		const subtypes = list.map(presetSubtype);

		expect(subtypes).toEqual(['preset-3', 'preset-5', 'preset-6', 'preset-custom-freeze-protection']);
		expect(new Set(subtypes).size).toBe(subtypes.length);
		for (const s of subtypes) expect(s).toMatch(/^preset-[a-z0-9-]+$/);
	});
});

describe('which preset is active', () => {
	const list = buildPresetList(PRESETS, CUSTOM_PRESETS);

	test('no preset when the device reports NONE', () => {
		expect(activePresetEntry(ESP_PRESET.NONE, '', list)).toBeNull();
	});

	test('a standard preset is matched', () => {
		expect(activePresetEntry(5, '', list)).toEqual({ preset: 5, label: 'Eco' });
	});

	test('a custom preset takes precedence over the enum value', () => {
		// preset stays at some value while a custom preset is what is really set.
		expect(activePresetEntry(0, 'freeze protection', list))
			.toEqual({ custom: 'freeze protection', label: 'Freeze Protection' });
		expect(activePresetEntry(5, 'freeze protection', list).custom).toBe('freeze protection');
	});

	test('a preset the device reports but never advertised is not invented', () => {
		expect(activePresetEntry(2, '', list)).toBeNull();            // AWAY, not advertised
		expect(activePresetEntry(0, 'holiday', list)).toBeNull();     // unknown custom
	});
});

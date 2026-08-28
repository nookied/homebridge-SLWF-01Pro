// DRY / FAN_ONLY are exposed as supplementary Switch services because HomeKit's
// HeaterCooler has no slot for them. Turning one off has to restore whatever the
// AC was doing beforehand — including "nothing", if it was off. Regression cover
// for 0.5.8: OFF was not recorded as a restore target, so an AC that was off and
// had Dry toggled on and back off started cooling instead of returning to off.

const DeviceAccessory = require('../../lib/DeviceAccessory');
const { ESP_MODE } = require('../../lib/state');

const handleModeSwitch = DeviceAccessory.prototype.handleModeSwitch;

function makeContext({ mode, lastTargetState = ESP_MODE.COOL, preSupplementaryMode = null }) {
	const sent = [];
	const log = Object.assign(() => {}, { error: () => {}, warn: () => {}, easyDebug: () => {} });
	return {
		sent,
		ctx: {
			name: 'Test AC',
			log,
			connected: true,
			pending: [],
			_sendTimeout: null,
			setDelay: 1,
			state: { mode },
			accessory: { context: { lastTargetState, preSupplementaryMode } },
			api: { hap: { HapStatusError: class extends Error {} } },
			esphome: { config: { key: 1 }, connection: { climateCommandService: p => sent.push(p) } },
			syncModeSwitches: () => {},
		},
	};
}

describe('handleModeSwitch — restoring the mode a supplementary switch interrupted', () => {
	test('an AC that was OFF returns to OFF after Dry is switched on and back off', async () => {
		const { ctx, sent } = makeContext({ mode: ESP_MODE.OFF });

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, true, 'DRY');
		expect(ctx.state.mode).toBe(ESP_MODE.DRY);

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, false, 'DRY');
		expect(ctx.state.mode).toBe(ESP_MODE.OFF);
		expect(sent).toEqual([{ key: 1, mode: ESP_MODE.DRY }, { key: 1, mode: ESP_MODE.OFF }]);
	});

	test('an AC that was OFF returns to OFF after Fan Only is switched on and back off', async () => {
		const { ctx } = makeContext({ mode: ESP_MODE.OFF });

		await handleModeSwitch.call(ctx, ESP_MODE.FAN_ONLY, true, 'FAN_ONLY');
		await handleModeSwitch.call(ctx, ESP_MODE.FAN_ONLY, false, 'FAN_ONLY');

		expect(ctx.state.mode).toBe(ESP_MODE.OFF);
	});

	test('a recorded OFF is honoured rather than treated as "nothing recorded"', async () => {
		// ESP_MODE.OFF is 0, so a truthiness check on the stored value would skip it.
		const { ctx } = makeContext({ mode: ESP_MODE.DRY, preSupplementaryMode: ESP_MODE.OFF });

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, false, 'DRY');

		expect(ctx.state.mode).toBe(ESP_MODE.OFF);
	});

	test('a running AC still returns to the mode it was in', async () => {
		const { ctx } = makeContext({ mode: ESP_MODE.HEAT });

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, true, 'DRY');
		expect(ctx.state.mode).toBe(ESP_MODE.DRY);

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, false, 'DRY');
		expect(ctx.state.mode).toBe(ESP_MODE.HEAT);
	});

	test('switching between two supplementary modes keeps the pre-excursion mode', async () => {
		const { ctx } = makeContext({ mode: ESP_MODE.COOL });

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, true, 'DRY');
		await handleModeSwitch.call(ctx, ESP_MODE.FAN_ONLY, true, 'FAN_ONLY');
		expect(ctx.state.mode).toBe(ESP_MODE.FAN_ONLY);

		await handleModeSwitch.call(ctx, ESP_MODE.FAN_ONLY, false, 'FAN_ONLY');
		expect(ctx.state.mode).toBe(ESP_MODE.COOL);
	});

	test('the restore target is cleared once used, so the next excursion re-records it', async () => {
		const { ctx } = makeContext({ mode: ESP_MODE.OFF });

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, true, 'DRY');
		await handleModeSwitch.call(ctx, ESP_MODE.DRY, false, 'DRY');
		expect(ctx.accessory.context.preSupplementaryMode).toBeNull();

		ctx.state.mode = ESP_MODE.HEAT;
		await handleModeSwitch.call(ctx, ESP_MODE.DRY, true, 'DRY');
		expect(ctx.accessory.context.preSupplementaryMode).toBe(ESP_MODE.HEAT);
	});

	test('falls back to lastTargetState when nothing was recorded', async () => {
		// e.g. the switch is toggled off after a restart that never saw it toggled on.
		const { ctx } = makeContext({ mode: ESP_MODE.DRY, lastTargetState: ESP_MODE.HEAT });

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, false, 'DRY');

		expect(ctx.state.mode).toBe(ESP_MODE.HEAT);
	});

	test('no command is sent when the switch already matches the device mode', async () => {
		const { ctx, sent } = makeContext({ mode: ESP_MODE.DRY });

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, true, 'DRY');
		expect(sent).toEqual([]);

		ctx.state.mode = ESP_MODE.COOL;
		await handleModeSwitch.call(ctx, ESP_MODE.DRY, false, 'DRY');
		expect(sent).toEqual([]);
	});

	test('does nothing before the device has reported a mode', async () => {
		const { ctx, sent } = makeContext({ mode: null });

		await handleModeSwitch.call(ctx, ESP_MODE.DRY, true, 'DRY');

		expect(ctx.state.mode).toBeNull();
		expect(sent).toEqual([]);
	});
});

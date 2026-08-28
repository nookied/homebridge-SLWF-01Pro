// Flat config, replacing .eslintrc.json + .eslintignore (eslint 9+ ignores both).
// Kept deliberately close to the old rule set: eslint:recommended plus tab
// indentation, with jest globals scoped to the test directory rather than
// applied repo-wide.

import globals from 'globals';
import pluginJs from '@eslint/js';
import pluginJest from 'eslint-plugin-jest';

export default [
	{
		ignores: ['node_modules/**', 'coverage/**'],
	},
	{
		files: ['**/*.js'],
		languageOptions: {
			sourceType: 'commonjs',
			ecmaVersion: 2022,
			globals: {
				...globals.node,
			},
		},
	},
	pluginJs.configs.recommended,
	{
		files: ['**/*.js'],
		rules: {
			// The codebase is tab-indented and stays that way. `indent` is
			// deprecated in eslint core but still shipped in 10.x; if it is
			// removed in a later major, replace it with @stylistic/js rather
			// than silently dropping indentation enforcement.
			indent: ['error', 'tab', { SwitchCase: 1 }],
			// eslint 9 changed no-unused-vars to report caught-but-unused error
			// bindings. This codebase marks deliberately-ignored ones `_e`.
			'no-unused-vars': ['error', { caughtErrorsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['test/**/*.js'],
		plugins: { jest: pluginJest },
		languageOptions: {
			globals: {
				...globals.jest,
			},
		},
		rules: {
			...pluginJest.configs.recommended.rules,
		},
	},
];

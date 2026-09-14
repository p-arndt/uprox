import prettier from 'eslint-config-prettier';
import path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = path.resolve(import.meta.dirname, '.gitignore');

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	{
		// Size and complexity budgets. Warnings only for now: they point at code to
		// split into smaller, testable modules without blocking existing files.
		files: ['src/**/*.{js,ts,svelte}'],
		ignores: ['src/lib/components/ui/**'],
		rules: {
			'max-lines': ['warn', { max: 600, skipBlankLines: true, skipComments: true }],
			'max-lines-per-function': ['warn', { max: 120, skipBlankLines: true, skipComments: true }],
			complexity: ['warn', 20],
			'max-depth': ['warn', 4]
		}
	},
	{
		// Client code (anything that can end up in the browser bundle) must never
		// value-import server modules. Type-only imports are erased at build time
		// and stay allowed.
		files: [
			'src/lib/**/*.{js,ts,svelte}',
			'src/routes/**/*.svelte',
			'src/routes/**/+page.{js,ts}',
			'src/routes/**/+layout.{js,ts}',
			'src/hooks.client.{js,ts}'
		],
		ignores: ['src/lib/server/**', 'src/lib/**/*.server.{js,ts}'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/server', '$lib/server/**'],
							allowTypeImports: true,
							message:
								'Client code must not import server modules. Use `import type`, or move shared logic out of $lib/server.'
						}
					]
				}
			]
		}
	},
	{
		// Server code must not depend on UI components.
		files: [
			'src/lib/server/**/*.{js,ts}',
			'src/**/*.server.{js,ts}',
			'src/routes/**/+server.{js,ts}'
		],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							group: ['$lib/components', '$lib/components/**'],
							message: 'Server code must not import UI components.'
						}
					]
				}
			]
		}
	}
);

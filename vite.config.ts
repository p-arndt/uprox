import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			include: ['src/lib/**/*.ts', 'src/hooks.server.ts'],
			exclude: ['src/lib/components/ui/**', 'src/lib/server/db/**', '**/*.d.ts'],
			reporter: ['text', 'lcov'],
			// Floors just below the measured coverage so it can only go up.
			thresholds: { lines: 60, statements: 60, functions: 58, branches: 54 }
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['tests/unit/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					setupFiles: ['./tests/setup/server.ts'],
					include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
					exclude: ['tests/unit/**/*.svelte.{test,spec}.{js,ts}']
				}
			},

			{
				// Real SQL against in-process PGlite with all migrations applied.
				// Run with `pnpm test:db`; see tests/setup/db.ts.
				extends: './vite.config.ts',
				test: {
					name: 'db',
					environment: 'node',
					setupFiles: ['./tests/setup/server.ts', './tests/setup/db.ts'],
					include: ['tests/db/**/*.test.ts'],
					// PGlite boot + migrations take a moment per test file
					hookTimeout: 30_000,
					testTimeout: 30_000
				}
			}
		]
	}
});

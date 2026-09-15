import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

// SvelteKit snapshots `$env/dynamic/private` when this config loads, before any
// Vitest setup file runs, so test defaults must be seeded here. They let unit and
// PGlite tests run without a real `.env` (e.g. in CI) and never apply to dev or
// build. The DB values are placeholders: `db` only connects when a query runs,
// and the db project swaps it for PGlite.
if (process.env.VITEST) {
	process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString('base64');
	process.env.POSTGRES_HOST ??= 'localhost';
	process.env.POSTGRES_PORT ??= '5432';
	process.env.POSTGRES_USER ??= 'uprox';
	process.env.POSTGRES_PASSWORD ??= 'uprox';
	process.env.POSTGRES_DB ??= 'uprox_test';
}

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
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
					setupFiles: ['./tests/setup/db.ts'],
					include: ['tests/db/**/*.test.ts'],
					// PGlite boot + migrations take a moment per test file
					hookTimeout: 30_000,
					testTimeout: 30_000
				}
			}
		]
	}
});

import { defineConfig } from '@playwright/test';

/**
 * E2E tests run against a production build (`build && preview`) on port 4173,
 * backed by a dedicated `uprox_test` database so they never touch dev data.
 * `prepare-db.ts` drops & recreates that database as the first step of the
 * webServer command (before `preview`, since Playwright's globalSetup runs only
 * *after* the server has booted); the app's `init` hook then migrates it on
 * first boot. We override POSTGRES_DB and ORIGIN for the preview server —
 * ORIGIN must match the real origin or better-auth rejects the sign-in/up POSTs
 * as cross-origin.
 */
// E2E_PORT / E2E_DB let several runs (e.g. parallel worktrees) coexist on one machine.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const TEST_DB = process.env.E2E_DB ?? 'uprox_test';
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: 'tests/e2e',
	testMatch: '**/*.e2e.{ts,js}',
	// auth flows persist rows; keep runs deterministic by going serial.
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? 'github' : 'list',
	// a local fake LLM provider, so no test depends on the public internet
	globalSetup: './tests/e2e/mock-upstream.ts',
	use: {
		baseURL: ORIGIN,
		trace: 'on-first-retry'
	},
	webServer: {
		command: `pnpm build && tsx --env-file-if-exists=.env tests/e2e/prepare-db.ts && pnpm preview --port ${PORT} --strictPort`,
		port: PORT,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
		env: {
			...process.env,
			POSTGRES_DB: TEST_DB,
			E2E_DB: TEST_DB,
			ORIGIN
		}
	}
});

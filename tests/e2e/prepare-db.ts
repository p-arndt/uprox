/**
 * Create a clean, dedicated `uprox_test` database for the E2E run so tests
 * never read or clobber dev data.
 *
 * Run as the first step of the Playwright `webServer` command (via tsx), right
 * before `preview` — NOT as Playwright `globalSetup`, which runs only *after*
 * the web server has already booted (and the app's `init` hook would query a
 * database that doesn't exist yet).
 *
 * We connect to the always-present `postgres` admin database, terminate any
 * stragglers still attached to the test DB, then drop and recreate it. The
 * app's `init` hook migrates the empty schema on its first request. Connection
 * params mirror the docker-compose / `.env` defaults; override via env in CI.
 */
import postgres from 'postgres';

const TEST_DB = 'uprox_test';

async function main() {
	const admin = postgres({
		host: process.env.POSTGRES_HOST ?? 'localhost',
		port: Number(process.env.POSTGRES_PORT ?? 5432),
		user: process.env.POSTGRES_USER ?? 'uprox',
		password: process.env.POSTGRES_PASSWORD ?? 'uprox',
		database: 'postgres',
		max: 1,
		onnotice: () => {}
	});

	try {
		// boot any lingering connections (e.g. a previous reused preview server)
		await admin`
			SELECT pg_terminate_backend(pid)
			FROM pg_stat_activity
			WHERE datname = ${TEST_DB} AND pid <> pg_backend_pid()
		`;
		await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
		await admin.unsafe(`CREATE DATABASE ${TEST_DB}`);
		console.log(`[e2e] prepared clean database "${TEST_DB}"`);
	} finally {
		await admin.end();
	}
}

main().catch((err) => {
	console.error('[e2e] failed to prepare test database:', err);
	process.exit(1);
});

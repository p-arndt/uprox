/**
 * Setup for the `db` Vitest project: real SQL against an in-process PGlite
 * (Postgres compiled to WASM), no Docker needed.
 *
 * `$lib/server/db` is replaced with a drizzle instance over a fresh PGlite
 * database that has every migration from ./drizzle applied. Each test file
 * gets its own module registry and therefore its own empty database.
 *
 * Runs after tests/setup/server.ts, which seeds the env the server modules
 * read at import time.
 */
import path from 'node:path';
import { vi } from 'vitest';

const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, '../../drizzle');

vi.mock('$lib/server/db', async () => {
	const { PGlite } = await import('@electric-sql/pglite');
	const { drizzle } = await import('drizzle-orm/pglite');
	const { migrate } = await import('drizzle-orm/pglite/migrator');
	const schema = await import('$lib/server/db/schema');

	const client = new PGlite();
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

	// The app uses the postgres-js driver, whose `db.execute` resolves to the
	// row array. The PGlite driver resolves to `{ rows, fields }`, so adapt it
	// to keep raw-SQL helpers such as `orgDailyStats` working unchanged.
	const execute = db.execute.bind(db);
	Object.assign(db, {
		execute: async (query: Parameters<typeof execute>[0]) => (await execute(query)).rows
	});

	return { db, client };
});

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

type Database = PostgresJsDatabase<typeof schema>;

let instance: Database | undefined;

/**
 * Create the postgres client + drizzle instance. Reads env lazily so this is
 * only invoked on first real DB access at runtime — never at import time. That
 * keeps SvelteKit's build-time `analyse` step (which imports every server
 * module to read route config) from crashing when no database env is present.
 */
function createDb(): Database {
	const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = env;

	if (!POSTGRES_HOST) throw new Error('POSTGRES_HOST is not set');
	if (!POSTGRES_USER) throw new Error('POSTGRES_USER is not set');
	if (!POSTGRES_PASSWORD) throw new Error('POSTGRES_PASSWORD is not set');
	if (!POSTGRES_DB) throw new Error('POSTGRES_DB is not set');

	const client = postgres({
		host: POSTGRES_HOST,
		port: POSTGRES_PORT ? Number(POSTGRES_PORT) : 5432,
		user: POSTGRES_USER,
		password: POSTGRES_PASSWORD,
		database: POSTGRES_DB
	});

	return drizzle(client, { schema });
}

/**
 * Lazy proxy: `db` is always a valid reference (so top-level consumers like the
 * better-auth drizzle adapter can capture it at import time), but the real
 * connection is created on first property access. Methods are bound to the real
 * instance so drizzle's internal private fields resolve correctly.
 */
export const db: Database = new Proxy({} as Database, {
	get(_target, prop) {
		instance ??= createDb();
		const value = instance[prop as keyof Database];
		return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
	}
});

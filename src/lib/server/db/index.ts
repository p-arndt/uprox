import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

const {
	POSTGRES_HOST,
	POSTGRES_PORT,
	POSTGRES_USER,
	POSTGRES_PASSWORD,
	POSTGRES_DB,
	POSTGRES_POOL_MAX,
	POSTGRES_STATEMENT_TIMEOUT_MS
} = env;

if (!POSTGRES_HOST) throw new Error('POSTGRES_HOST is not set');
if (!POSTGRES_USER) throw new Error('POSTGRES_USER is not set');
if (!POSTGRES_PASSWORD) throw new Error('POSTGRES_PASSWORD is not set');
if (!POSTGRES_DB) throw new Error('POSTGRES_DB is not set');

/** Parse a positive integer env value, falling back when unset or invalid. */
function positiveInt(value: string | undefined, fallback: number): number {
	const n = Number(value);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

const client = postgres({
	host: POSTGRES_HOST,
	port: POSTGRES_PORT ? Number(POSTGRES_PORT) : 5432,
	user: POSTGRES_USER,
	password: POSTGRES_PASSWORD,
	database: POSTGRES_DB,
	// Explicit rather than implicit. Measured on a 400k-row audit log: raising
	// this to 20 made the usage page ~2x slower, because the extra concurrent
	// aggregates contend for the same database CPUs. Tune per deployment.
	max: positiveInt(POSTGRES_POOL_MAX, 10),
	connection: {
		// Server-side guard so a runaway analytics query can't hold a pooled
		// connection (and the page) indefinitely. Value in milliseconds.
		statement_timeout: positiveInt(POSTGRES_STATEMENT_TIMEOUT_MS, 30_000)
	}
});

export const db = drizzle(client, { schema });

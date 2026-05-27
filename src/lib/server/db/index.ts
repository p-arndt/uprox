import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

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

export const db = drizzle(client, { schema });

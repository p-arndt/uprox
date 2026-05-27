import { defineConfig } from 'drizzle-kit';

const { POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB } = process.env;

if (!POSTGRES_HOST) throw new Error('POSTGRES_HOST is not set');
if (!POSTGRES_USER) throw new Error('POSTGRES_USER is not set');
if (!POSTGRES_PASSWORD) throw new Error('POSTGRES_PASSWORD is not set');
if (!POSTGRES_DB) throw new Error('POSTGRES_DB is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	dialect: 'postgresql',
	dbCredentials: {
		host: POSTGRES_HOST,
		port: POSTGRES_PORT ? Number(POSTGRES_PORT) : 5432,
		user: POSTGRES_USER,
		password: POSTGRES_PASSWORD,
		database: POSTGRES_DB,
		ssl: false
	},
	verbose: true,
	strict: true
});

/**
 * Setup for the `server` Vitest project (node environment).
 *
 * Server modules read configuration through SvelteKit's `$env/dynamic/private`,
 * which is backed by `process.env`. We seed deterministic test values here —
 * before any test module is imported — so unit tests run without a real `.env`
 * (e.g. in CI). These never touch a real database or network: `db` is
 * constructed lazily and only connects when a query runs, which the pure-logic
 * units under test never do.
 */

// 32 zero-bytes, base64 — a valid AES-256 key purely for tests.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString('base64');

// db/index.ts throws at import time if these are unset; importing a module that
// transitively pulls in `db` (e.g. tokens.ts) would otherwise fail to load.
process.env.POSTGRES_HOST ??= 'localhost';
process.env.POSTGRES_PORT ??= '5432';
process.env.POSTGRES_USER ??= 'uprox';
process.env.POSTGRES_PASSWORD ??= 'uprox';
process.env.POSTGRES_DB ??= 'uprox_test';

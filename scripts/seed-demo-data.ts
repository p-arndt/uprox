/**
 * Seed the database with demo data: a default user, a policy, services with
 * machine tokens, and a large, realistic audit-log history covering EVERY
 * OpenAI model in the built-in price list across every billing shape —
 * standard vs. long-context rate card, provider prompt-cache reads, cache
 * writes, uncached requests, uprox response-cache hits, denials and errors.
 *
 * Standalone on purpose: it talks to Postgres directly (no SvelteKit runtime),
 * so it can run against a database the app server has never touched.
 *
 *   pnpm seed          # seed with defaults
 *   pnpm seed --reset  # wipe previously seeded data first
 *
 * Flags: --days=<n> --requests=<n> --email=<addr> --password=<pw> --reset --only-reset
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { hashPassword } from 'better-auth/crypto';
import {
	DEFAULT_MODEL_PRICES,
	providerForModel,
	costFromPrice,
	resolvePrice,
	contextTierForPromptTokens,
	LONG_CONTEXT_MIN_PROMPT_TOKENS,
	type ModelPrice
} from '../src/lib/server/providers.ts';

// ---------------------------------------------------------------- arguments

const args = new Map<string, string>();
for (const raw of process.argv.slice(2)) {
	const [key, value = 'true'] = raw.replace(/^--/, '').split('=');
	args.set(key, value);
}

const DAYS = Number(args.get('days') ?? 30);
/** extra randomized requests on top of the exhaustive per-model matrix */
const EXTRA_REQUESTS = Number(args.get('requests') ?? 1500);
const USER_EMAIL = args.get('email') ?? 'admin@admin.local';
const USER_PASSWORD = args.get('password') ?? 'admin';
const USER_NAME = 'Demo Admin';
const RESET = args.has('reset') || args.has('only-reset');
const ONLY_RESET = args.has('only-reset');

/** Marker written to every seeded row so --reset can find them again. */
const SEED_TAG = 'seed:demo-data';

// ---------------------------------------------------------------- database

const {
	POSTGRES_HOST = 'localhost',
	POSTGRES_PORT = '5432',
	POSTGRES_USER,
	POSTGRES_PASSWORD,
	POSTGRES_DB,
	ENCRYPTION_KEY
} = process.env;

if (!POSTGRES_USER || !POSTGRES_PASSWORD || !POSTGRES_DB) {
	console.error('POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB must be set (see .env).');
	process.exit(1);
}

const sql = postgres({
	host: POSTGRES_HOST,
	port: Number(POSTGRES_PORT),
	user: POSTGRES_USER,
	password: POSTGRES_PASSWORD,
	database: POSTGRES_DB
});

// ---------------------------------------------------------------- helpers

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Same AES-256-GCM envelope the app uses for provider secrets. */
function encryptSecret(plaintext: string): string | null {
	if (!ENCRYPTION_KEY) return null;
	const key = Buffer.from(ENCRYPTION_KEY, 'base64');
	if (key.length !== 32) return null;
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return [
		iv.toString('base64'),
		cipher.getAuthTag().toString('base64'),
		ciphertext.toString('base64')
	].join('.');
}

const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
/** Log-uniform draw, so token counts spread over orders of magnitude like real traffic. */
const logRand = (min: number, max: number) =>
	Math.round(Math.exp(Math.log(min) + Math.random() * (Math.log(max) - Math.log(min))));

/**
 * A timestamp within the last {@link DAYS} days, weighted towards European
 * business hours and recent days so the usage charts have a readable shape.
 */
function randomTimestamp(): Date {
	const dayBack = Math.floor(Math.pow(Math.random(), 1.6) * DAYS);
	const date = new Date();
	date.setUTCDate(date.getUTCDate() - dayBack);
	const weekday = date.getUTCDay();
	const hour =
		weekday === 0 || weekday === 6
			? randInt(0, 23)
			: pick([7, 8, 9, 9, 10, 10, 11, 12, 13, 14, 14, 15, 16, 17, 18, 20]);
	date.setUTCHours(hour, randInt(0, 59), randInt(0, 59), 0);
	return date > new Date() ? new Date(Date.now() - randInt(60, 3600) * 1000) : date;
}

// ---------------------------------------------------------------- models

/**
 * The GPT-5.5 and GPT-5.6 families — nothing from other providers, and none of
 * the older OpenAI models. Both families carry a long-context rate card, so
 * every seeded model can produce standard *and* long-context traffic.
 */
const OPENAI_MODELS = Object.keys(DEFAULT_MODEL_PRICES).filter(
	(model) => providerForModel(model)?.id === 'openai' && /^gpt-5\.(5|6)/.test(model)
);

type Scope = 'chat' | 'responses';

/** Which gateway endpoint a model is realistically called through. */
function scopeForModel(_model: string): Scope {
	return Math.random() < 0.15 ? 'responses' : 'chat';
}

const supportsCache = (_scope: Scope) => true;
const hasLongContextCard = (price: ModelPrice) => price.longIn != null;
/**
 * Only the models that actually surcharge cache writes report a write count
 * upstream (GPT-5.6 and later); everywhere else a written token is billed as
 * plain input and `cache_write_tokens` stays NULL, so we mirror that here.
 */
const reportsCacheWrites = (price: ModelPrice) =>
	price.cacheWrite != null && price.cacheWrite > price.in;

// ---------------------------------------------------------------- fixtures

// Budgets stay mostly out of the way: only one policy carries a ceiling, so the
// demo data isn't dominated by budget enforcement.
const POLICIES = [
	{ name: 'openai-standard', rateLimit: 600, daily: '0.0000', monthly: '0.0000' },
	{ name: 'openai-capped', rateLimit: 300, daily: '0.0000', monthly: '500.0000' }
];

const SERVICES = [
	{ name: 'support-copilot', type: 'agent', policy: 'openai-standard', cacheTtl: 300 },
	{ name: 'docs-indexer', type: 'workload', policy: 'openai-standard', cacheTtl: 3600 },
	{ name: 'long-context-research', type: 'agent', policy: 'openai-standard', cacheTtl: 0 },
	{ name: 'internal-playground', type: 'app', policy: 'openai-capped', cacheTtl: 0 }
];

const IPS = ['10.4.1.17', '10.4.2.31', '52.18.44.9', '81.169.145.66', '203.0.113.42'];

// ---------------------------------------------------------------- reset

async function reset(): Promise<void> {
	const services = await sql<{ id: string }[]>`
		select id from service where description = ${SEED_TAG}
	`;
	const ids = services.map((s) => s.id);
	if (ids.length > 0) {
		await sql`delete from request_trace where service_id in ${sql(ids)}`;
		await sql`delete from trace_span where service_id in ${sql(ids)}`;
		await sql`delete from audit_log where service_id in ${sql(ids)}`;
		await sql`delete from machine_token where service_id in ${sql(ids)}`;
		await sql`delete from service where id in ${sql(ids)}`;
	}
	await sql`delete from policy where name in ${sql(POLICIES.map((p) => p.name))}`;
	await sql`delete from provider_secret where label = ${SEED_TAG}`;
	await sql`delete from "user" where email = ${USER_EMAIL}`;
	console.log(`reset: removed ${ids.length} seeded service(s) and the demo user`);
}

// ---------------------------------------------------------------- seeding

/** Platform-default price rows for the OpenAI models, so cost lookups resolve. */
async function seedPrices(): Promise<void> {
	const rows = OPENAI_MODELS.map((model) => {
		const p = DEFAULT_MODEL_PRICES[model];
		return {
			is_default: true,
			model,
			provider: 'openai',
			input_per_mtok: String(p.in),
			output_per_mtok: String(p.out),
			cache_read_per_mtok: p.cacheRead != null ? String(p.cacheRead) : null,
			cache_write_per_mtok: p.cacheWrite != null ? String(p.cacheWrite) : null,
			long_input_per_mtok: p.longIn != null ? String(p.longIn) : null,
			long_output_per_mtok: p.longOut != null ? String(p.longOut) : null,
			long_cache_read_per_mtok: p.longCacheRead != null ? String(p.longCacheRead) : null,
			long_cache_write_per_mtok: p.longCacheWrite != null ? String(p.longCacheWrite) : null
		};
	});
	await sql`
		insert into model_price ${sql(rows)}
		on conflict (model) where is_default = true do update set
			provider = excluded.provider,
			input_per_mtok = excluded.input_per_mtok,
			output_per_mtok = excluded.output_per_mtok,
			cache_read_per_mtok = excluded.cache_read_per_mtok,
			cache_write_per_mtok = excluded.cache_write_per_mtok,
			long_input_per_mtok = excluded.long_input_per_mtok,
			long_output_per_mtok = excluded.long_output_per_mtok,
			long_cache_read_per_mtok = excluded.long_cache_read_per_mtok,
			long_cache_write_per_mtok = excluded.long_cache_write_per_mtok,
			updated_at = now()
	`;
	console.log(`prices: ${rows.length} OpenAI default rows`);
}

/**
 * The default user, with a better-auth credential account so the password
 * actually works at the sign-in form. The first user of an instance is its
 * owner; we set the role explicitly since the app's create hook doesn't run.
 */
async function seedUser(): Promise<string> {
	const existing = await sql<{ id: string }[]>`select id from "user" where email = ${USER_EMAIL}`;
	if (existing.length > 0) {
		console.log(`user: ${USER_EMAIL} already exists`);
		return existing[0].id;
	}
	const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from "user"`;
	const role = count === 0 ? 'owner' : 'admin';
	const [row] = await sql<{ id: string }[]>`
		insert into "user" (name, email, email_verified, role, updated_at)
		values (${USER_NAME}, ${USER_EMAIL}, true, ${role}, now())
		returning id
	`;
	await sql`
		insert into account (account_id, provider_id, user_id, password, updated_at)
		values (${row.id}, 'credential', ${row.id}, ${await hashPassword(USER_PASSWORD)}, now())
	`;
	console.log(`user: ${USER_EMAIL} / ${USER_PASSWORD} (${role})`);
	return row.id;
}

async function seedSettings(): Promise<void> {
	await sql`
		insert into settings (id, cache_ttl_seconds, tracing_enabled, tracing_retention_days,
			members_can_manage_tokens, members_can_manage_services)
		values (1, 300, true, 30, true, false)
		on conflict (id) do nothing
	`;
}

async function seedProviderSecret(userId: string): Promise<void> {
	const encrypted = encryptSecret(process.env.OPENAI_API_KEY ?? 'sk-demo-not-a-real-key');
	if (!encrypted) {
		console.log('provider: skipped (ENCRYPTION_KEY unset or not 32 bytes)');
		return;
	}
	const existing = await sql`select id from provider_secret where label = ${SEED_TAG}`;
	if (existing.length > 0) return;
	await sql`
		insert into provider_secret (provider, label, priority, encrypted_secret, hint, created_by_user_id)
		values ('openai', ${SEED_TAG}, 10, ${encrypted}, 'key', ${userId})
	`;
	console.log('provider: openai secret stored');
}

interface SeededToken {
	id: string;
	serviceId: string;
	plaintext: string;
}

async function seedServicesAndTokens(userId: string): Promise<SeededToken[]> {
	const policyIds = new Map<string, string>();
	for (const p of POLICIES) {
		const [row] = await sql<{ id: string }[]>`
			insert into policy (name, allowed_providers, allowed_models, preferred_provider,
				rate_limit_per_minute, daily_budget_usd, monthly_budget_usd, cache_ttl_seconds)
			values (${p.name}, ${sql.array(['openai'])},
				${sql.array(p.name === 'openai-capped' ? ['gpt-5.5*', 'gpt-5.6*'] : [])},
				'openai', ${p.rateLimit}, ${p.daily}, ${p.monthly}, null)
			returning id
		`;
		policyIds.set(p.name, row.id);
	}

	const tokens: SeededToken[] = [];
	for (const s of SERVICES) {
		const [service] = await sql<{ id: string }[]>`
			insert into service (name, type, description, policy_id, allowed_providers, cache_ttl_seconds, created_at)
			values (${s.name}, ${s.type}, ${SEED_TAG}, ${policyIds.get(s.policy)!},
				${sql.array(['openai'])}, ${s.cacheTtl}, now() - ${`${DAYS + 5} days`}::interval)
			returning id
		`;
		for (const suffix of ['prod', 'staging']) {
			const secret = randomBytes(32).toString('base64url');
			const plaintext = `uprox_live_${secret}`;
			const [token] = await sql<{ id: string }[]>`
				insert into machine_token (service_id, name, display, hashed_token, scopes,
					allowed_models, created_by_user_id, created_at)
				values (${service.id}, ${`${s.name}-${suffix}`},
					${`uprox_live_${secret.slice(0, 6)}…${secret.slice(-4)}`},
					${sha256(plaintext)},
					${sql.array(['chat', 'responses', 'models'])},
					${sql.array([])}, ${userId}, now() - ${`${DAYS + 5} days`}::interval)
				returning id
			`;
			tokens.push({ id: token.id, serviceId: service.id, plaintext });
		}
	}
	console.log(`services: ${SERVICES.length}, tokens: ${tokens.length}`);
	return tokens;
}

// ---------------------------------------------------------------- traffic

type CacheMode = 'none' | 'provider-read' | 'provider-write' | 'provider-mixed' | 'uprox-hit';

interface AuditRow {
	service_id: string;
	token_id: string;
	action: string;
	provider: string;
	model: string;
	status: string;
	status_code: number | null;
	cost_usd: string | null;
	saved_usd: string | null;
	input_tokens: number | null;
	output_tokens: number | null;
	saved_input_tokens: number | null;
	saved_output_tokens: number | null;
	provider_cached_tokens: number | null;
	cache_write_tokens: number | null;
	context_tier: string | null;
	latency_ms: number | null;
	ip: string;
	detail: string | null;
	created_at: Date;
}

/**
 * One priced gateway request. `long` forces the long-context rate card, so the
 * matrix below can guarantee coverage of both cards per model instead of hoping
 * the random prompt sizes reach the 272k threshold.
 */
function buildRequest(
	token: SeededToken,
	model: string,
	scope: Scope,
	cacheMode: CacheMode,
	long: boolean
): AuditRow {
	const price = resolvePrice(DEFAULT_MODEL_PRICES, model)!;
	const promptTokens = long
		? randInt(LONG_CONTEXT_MIN_PROMPT_TOKENS, 900_000)
		: logRand(200, 60_000);
	const outputTokens = logRand(20, 6000);

	let cacheRead = 0;
	let cacheWrite = 0;
	if (supportsCache(scope) && cacheMode !== 'none' && cacheMode !== 'uprox-hit') {
		// caches only ever cover part of the prompt, and never the whole of it
		if (cacheMode === 'provider-read' || cacheMode === 'provider-mixed') {
			cacheRead = Math.floor(promptTokens * (0.3 + Math.random() * 0.5));
		}
		if (
			(cacheMode === 'provider-write' || cacheMode === 'provider-mixed') &&
			reportsCacheWrites(price)
		) {
			cacheWrite = Math.floor((promptTokens - cacheRead) * (0.2 + Math.random() * 0.4));
		}
	}

	const base = {
		service_id: token.serviceId,
		token_id: token.id,
		action: `gateway.${scope}`,
		provider: 'openai',
		model,
		ip: pick(IPS),
		created_at: randomTimestamp()
	};

	if (cacheMode === 'uprox-hit') {
		// an exact-match response-cache replay: free, and it records what it saved
		const savedUsd = costFromPrice(price, promptTokens, outputTokens, 0, 0);
		return {
			...base,
			status: 'ok',
			status_code: 200,
			cost_usd: '0',
			saved_usd: savedUsd.toFixed(6),
			input_tokens: null,
			output_tokens: null,
			saved_input_tokens: promptTokens,
			saved_output_tokens: outputTokens,
			provider_cached_tokens: null,
			cache_write_tokens: null,
			context_tier: null,
			latency_ms: randInt(2, 25),
			detail: Math.random() < 0.3 ? 'cache hit (stream)' : 'cache hit'
		};
	}

	const cost = costFromPrice(price, promptTokens, outputTokens, cacheRead, cacheWrite);
	const tier = contextTierForPromptTokens(price, promptTokens);
	return {
		...base,
		status: 'ok',
		status_code: 200,
		cost_usd: cost.toFixed(6),
		saved_usd: null,
		input_tokens: promptTokens,
		output_tokens: outputTokens || null,
		saved_input_tokens: null,
		saved_output_tokens: null,
		provider_cached_tokens: cacheRead || null,
		cache_write_tokens: cacheWrite || null,
		context_tier: tier,
		latency_ms: tier === 'long' ? randInt(4000, 40000) : randInt(180, 9000),
		detail: null
	};
}

/** A denial or upstream failure — the non-happy paths the dashboards filter on. */
function buildFailure(token: SeededToken, model: string): AuditRow {
	const kind = pick(['deny-model', 'deny-budget', 'deny-rate', 'error-upstream', 'error-timeout']);
	const scope = scopeForModel(model);
	const shared = {
		service_id: token.serviceId,
		token_id: token.id,
		provider: 'openai',
		model,
		ip: pick(IPS),
		cost_usd: null,
		saved_usd: null,
		input_tokens: null,
		output_tokens: null,
		saved_input_tokens: null,
		saved_output_tokens: null,
		provider_cached_tokens: null,
		cache_write_tokens: null,
		context_tier: null,
		created_at: randomTimestamp()
	};
	switch (kind) {
		case 'deny-model':
			return {
				...shared,
				action: 'policy.deny',
				status: 'deny',
				status_code: 403,
				latency_ms: randInt(1, 8),
				detail: `model "${model}" not allowed by policy`
			};
		case 'deny-budget':
			return {
				...shared,
				action: 'policy.deny',
				status: 'deny',
				status_code: 402,
				latency_ms: randInt(1, 8),
				detail: 'daily budget exceeded'
			};
		case 'deny-rate':
			return {
				...shared,
				action: 'policy.deny',
				status: 'deny',
				status_code: 429,
				latency_ms: randInt(1, 8),
				detail: 'rate limit exceeded'
			};
		case 'error-timeout':
			return {
				...shared,
				action: `gateway.${scope}`,
				status: 'error',
				status_code: 504,
				latency_ms: randInt(30000, 60000),
				detail: 'upstream timeout'
			};
		default:
			return {
				...shared,
				action: `gateway.${scope}`,
				status: 'error',
				status_code: 500,
				latency_ms: randInt(200, 4000),
				detail: 'upstream error: server_error'
			};
	}
}

/**
 * The exhaustive matrix: every OpenAI model × every billing shape it can
 * actually produce. This is what guarantees the dashboards show long-context
 * rows, cache reads, cache writes and cache hits for the whole model list.
 */
function buildMatrix(tokens: SeededToken[]): AuditRow[] {
	const rows: AuditRow[] = [];
	for (const model of OPENAI_MODELS) {
		const price = DEFAULT_MODEL_PRICES[model];
		const scope = scopeForModel(model);
		const modes: CacheMode[] = supportsCache(scope)
			? reportsCacheWrites(price)
				? ['none', 'provider-read', 'provider-write', 'provider-mixed', 'uprox-hit']
				: ['none', 'provider-read', 'uprox-hit']
			: ['none', 'uprox-hit'];
		for (const mode of modes) {
			// both rate cards get the same weight, so neither tier is a rounding
			// error in the dashboards
			for (let i = 0; i < 3; i++) rows.push(buildRequest(pick(tokens), model, scope, mode, false));
			if (hasLongContextCard(price) && mode !== 'uprox-hit') {
				for (let i = 0; i < 3; i++) rows.push(buildRequest(pick(tokens), model, scope, mode, true));
			}
		}
		rows.push(buildFailure(pick(tokens), model));
	}
	return rows;
}

/** Randomized background traffic, weighted towards the models people actually use. */
function buildNoise(tokens: SeededToken[], count: number): AuditRow[] {
	// the workhorse tiers carry most of the traffic; the pro tiers are rarer
	const popular = OPENAI_MODELS.filter((m) => !m.endsWith('-pro'));
	const rows: AuditRow[] = [];
	for (let i = 0; i < count; i++) {
		const model = Math.random() < 0.75 ? pick(popular) : pick(OPENAI_MODELS);
		const roll = Math.random();
		if (roll < 0.06) {
			rows.push(buildFailure(pick(tokens), model));
			continue;
		}
		const scope = scopeForModel(model);
		const mode: CacheMode = !supportsCache(scope)
			? Math.random() < 0.12
				? 'uprox-hit'
				: 'none'
			: pick<CacheMode>([
					'none',
					'none',
					'none',
					'provider-read',
					'provider-read',
					'provider-write',
					'provider-mixed',
					'uprox-hit'
				]);
		const price = DEFAULT_MODEL_PRICES[model];
		// roughly a third of the background traffic bills against the long card
		const long = hasLongContextCard(price) && mode !== 'uprox-hit' && Math.random() < 0.35;
		rows.push(buildRequest(pick(tokens), model, scope, mode, long));
	}
	return rows;
}

async function insertAuditRows(rows: AuditRow[]): Promise<string[]> {
	const ids: string[] = [];
	const CHUNK = 500;
	for (let i = 0; i < rows.length; i += CHUNK) {
		const inserted = await sql<{ id: string }[]>`
			insert into audit_log ${sql(rows.slice(i, i + CHUNK))} returning id
		`;
		ids.push(...inserted.map((r) => r.id));
	}
	return ids;
}

/**
 * Traces for a sample of successful chat requests, so the trace viewer has
 * something to render. Grouped a few at a time under one trace group id to
 * exercise the multi-call timeline.
 */
async function seedTraces(rows: AuditRow[], ids: string[]): Promise<void> {
	const traceable = ids
		.map((id, i) => ({ id, row: rows[i] }))
		.filter(({ row }) => row.status === 'ok' && row.action.startsWith('gateway.'))
		.slice(0, 200);

	let group = randomBytes(16).toString('hex');
	const values = traceable.map(({ id, row }, i) => {
		if (i % 4 === 0) group = randomBytes(16).toString('hex');
		return {
			audit_log_id: id,
			service_id: row.service_id,
			trace_group_id: group,
			metadata: JSON.stringify({
				chatId: `chat_${randInt(1000, 9999)}`,
				env: pick(['prod', 'staging'])
			}),
			request_body: JSON.stringify({
				model: row.model,
				messages: [
					{ role: 'system', content: 'You are a helpful assistant.' },
					{ role: 'user', content: 'Summarize the attached support ticket in three bullets.' }
				],
				temperature: 0.2
			}),
			response_body: JSON.stringify({
				id: `chatcmpl_${randomBytes(8).toString('hex')}`,
				model: row.model,
				choices: [
					{
						index: 0,
						message: {
							role: 'assistant',
							content: '- Customer cannot log in\n- Reset link expired\n- Needs a new invite'
						},
						finish_reason: 'stop'
					}
				],
				usage: {
					prompt_tokens: row.input_tokens ?? 0,
					completion_tokens: row.output_tokens ?? 0,
					total_tokens: (row.input_tokens ?? 0) + (row.output_tokens ?? 0)
				}
			}),
			response_format: 'json',
			created_at: row.created_at
		};
	});
	if (values.length === 0) return;
	await sql`insert into request_trace ${sql(values)}`;
	console.log(`traces: ${values.length}`);
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
	if (RESET) await reset();
	if (ONLY_RESET) return;

	await seedPrices();
	const userId = await seedUser();
	await seedSettings();
	await seedProviderSecret(userId);
	const tokens = await seedServicesAndTokens(userId);

	const rows = [...buildMatrix(tokens), ...buildNoise(tokens, EXTRA_REQUESTS)].sort(
		(a, b) => a.created_at.getTime() - b.created_at.getTime()
	);
	const ids = await insertAuditRows(rows);
	console.log(`audit log: ${ids.length} rows over ${DAYS} days, ${OPENAI_MODELS.length} models`);
	await seedTraces(rows, ids);

	const spend = rows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0);
	const saved = rows.reduce((sum, r) => sum + Number(r.saved_usd ?? 0), 0);
	console.log(`spend: $${spend.toFixed(2)} · cache savings: $${saved.toFixed(2)}`);
	console.log('\nsign in with:');
	console.log(`  ${USER_EMAIL} / ${USER_PASSWORD}`);
	console.log('\nmachine tokens (shown once):');
	for (const t of tokens) console.log(`  ${t.plaintext}`);
}

main()
	.then(() => sql.end())
	.catch(async (error) => {
		console.error(error);
		await sql.end();
		process.exit(1);
	});

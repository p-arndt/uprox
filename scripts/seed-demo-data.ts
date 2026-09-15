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

const DAYS = Number(args.get('days') ?? 365);
/** total randomized requests spread over the window, on top of the coverage matrix */
const TOTAL_REQUESTS = Number(args.get('requests') ?? 25_000);
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

/** Midnight UTC of the day `dayIndex` days into the window (0 = oldest). */
function dayStart(dayIndex: number): Date {
	const date = new Date();
	date.setUTCHours(0, 0, 0, 0);
	date.setUTCDate(date.getUTCDate() - (DAYS - 1 - dayIndex));
	return date;
}

/** A wall-clock time on that day, weighted towards European office hours. */
function timeOnDay(dayIndex: number): Date {
	const date = dayStart(dayIndex);
	const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
	const hour = weekend
		? randInt(0, 23)
		: pick([6, 7, 8, 9, 9, 10, 10, 11, 11, 12, 13, 14, 14, 15, 15, 16, 17, 18, 20, 22]);
	date.setUTCHours(hour, randInt(0, 59), randInt(0, 59), 0);
	// never in the future: the last day of the window is only partly over
	return date > new Date() ? new Date(Date.now() - randInt(60, 7200) * 1000) : date;
}

/** A day picked in proportion to how busy it is — see {@link dailyWeights}. */
function randomDayIndex(weights: number[], total: number): number {
	let roll = Math.random() * total;
	for (let i = 0; i < weights.length; i++) {
		roll -= weights[i];
		if (roll <= 0) return i;
	}
	return weights.length - 1;
}

/**
 * Relative traffic per day: a platform that grows through the year, quiet at
 * weekends, noisy day to day, with the odd spike day (a backfill, a launch).
 * Flat traffic is the one thing a real usage chart never looks like.
 */
function dailyWeights(): { weights: number[]; total: number } {
	const weights: number[] = [];
	for (let d = 0; d < DAYS; d++) {
		const p = DAYS === 1 ? 1 : d / (DAYS - 1);
		// ~6x growth from the start of the window to now
		const growth = 0.35 + 1.9 * Math.pow(p, 1.4);
		const weekday = dayStart(d).getUTCDay();
		const weekend = weekday === 0 || weekday === 6 ? 0.28 : 1;
		const jitter = 0.65 + Math.random() * 0.7;
		const spike = Math.random() < 0.02 ? 2.5 + Math.random() * 2 : 1;
		weights.push(growth * weekend * jitter * spike);
	}
	return { weights, total: weights.reduce((sum, w) => sum + w, 0) };
}

// ---------------------------------------------------------------- models

/**
 * The workhorses: one previous-generation model and the whole GPT-5.6 family.
 * These carry essentially all of the traffic, which is what a real instance
 * looks like — a fleet settles on two or three models, it does not spread
 * itself evenly over a price list.
 */
const CORE_MODELS = ['gpt-5.5', 'gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'];

/**
 * The long tail: a pro tier someone reaches for occasionally, a cheap legacy
 * model still wired into an old job, and an embedding model. A few percent of
 * requests between them — enough to be visible in a breakdown, not enough to
 * matter in the spend.
 */
const RARE_MODELS = ['gpt-5.5-pro', 'gpt-4o-mini', 'text-embedding-3-small'];

const OPENAI_MODELS = [...CORE_MODELS, ...RARE_MODELS].filter(
	(model) => providerForModel(model)?.id === 'openai' && DEFAULT_MODEL_PRICES[model]
);

/** The day the 5.6 family becomes available, as a fraction of the window. */
const V56_LAUNCH = 0.45;

/**
 * The model mix at a point in the window. Before the 5.6 launch everything runs
 * on 5.5; afterwards the fleet migrates over a couple of months, cheapest tier
 * first. Static shares would make every month of the year look the same.
 */
function modelWeights(progress: number): Array<[string, number]> {
	const adopted =
		progress <= V56_LAUNCH ? 0 : Math.min(1, (progress - V56_LAUNCH) / (0.35 * (1 - V56_LAUNCH)));
	return [
		['gpt-5.5', 0.05 + 0.9 * (1 - adopted)],
		['gpt-5.6-luna', 0.58 * adopted],
		['gpt-5.6-terra', 0.24 * adopted],
		['gpt-5.6-sol', 0.07 * adopted],
		['gpt-5.5-pro', 0.012],
		['gpt-4o-mini', 0.018],
		['text-embedding-3-small', 0.02]
	];
}

/** Draw a model for a request landing `progress` of the way through the window. */
function modelForProgress(progress: number): string {
	const weights = modelWeights(progress);
	const total = weights.reduce((sum, [, w]) => sum + w, 0);
	let roll = Math.random() * total;
	for (const [model, w] of weights) {
		roll -= w;
		if (roll <= 0) return model;
	}
	return CORE_MODELS[0];
}

type Scope = 'chat' | 'responses' | 'embeddings';

/** Which gateway endpoint a model is realistically called through. */
function scopeForModel(model: string): Scope {
	if (model.startsWith('text-embedding')) return 'embeddings';
	return Math.random() < 0.15 ? 'responses' : 'chat';
}

const supportsCache = (scope: Scope) => scope !== 'embeddings';
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
		insert into settings (id, cache_ttl_seconds, 
			members_can_manage_tokens, members_can_manage_services)
		values (1, 300, true, false)
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
					${sql.array(['chat', 'responses', 'embeddings', 'models'])},
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
	long: boolean,
	dayIndex: number
): AuditRow {
	const price = resolvePrice(DEFAULT_MODEL_PRICES, model)!;
	// Real prompts are short: a chat turn with a system prompt and a little
	// context, a few thousand tokens. Long-context requests are the exception and
	// cluster just past the threshold rather than spreading to the context limit.
	const promptTokens = long
		? randInt(LONG_CONTEXT_MIN_PROMPT_TOKENS, 420_000)
		: scope === 'embeddings'
			? logRand(120, 8_000)
			: logRand(250, 24_000);
	const outputTokens = scope === 'embeddings' ? 0 : logRand(15, 2_500);

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
		created_at: timeOnDay(dayIndex)
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
function buildFailure(token: SeededToken, model: string, dayIndex: number): AuditRow {
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
		created_at: timeOnDay(dayIndex)
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
 * One row per (model × billing shape) it can actually produce, so a dashboard
 * always has a long-context row, a cache read, a cache write and a cache hit to
 * show for every model — even for a rare model the random traffic below might
 * skip. Deliberately thin: the mix a reader judges the instance by has to come
 * from the realistic traffic, not from this.
 */
function buildMatrix(tokens: SeededToken[], weights: number[], weightTotal: number): AuditRow[] {
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
			const day = randomDayIndex(weights, weightTotal);
			rows.push(buildRequest(pick(tokens), model, scope, mode, false, day));
			if (hasLongContextCard(price) && mode !== 'uprox-hit') {
				rows.push(
					buildRequest(pick(tokens), model, scope, mode, true, randomDayIndex(weights, weightTotal))
				);
			}
		}
		rows.push(buildFailure(pick(tokens), model, randomDayIndex(weights, weightTotal)));
	}
	return rows;
}

/**
 * How a request caches. Chat traffic reuses a system prompt and a running
 * conversation, so a cache read on part of the prompt is the common case, not
 * the exception; a write only happens when the prefix is new.
 */
function cacheModeFor(scope: Scope, price: ModelPrice): CacheMode {
	if (!supportsCache(scope)) return Math.random() < 0.05 ? 'uprox-hit' : 'none';
	const roll = Math.random();
	if (roll < 0.05) return 'uprox-hit';
	if (roll < 0.5) return 'provider-read';
	if (roll < 0.62) return reportsCacheWrites(price) ? 'provider-mixed' : 'provider-read';
	if (roll < 0.7) return reportsCacheWrites(price) ? 'provider-write' : 'none';
	return 'none';
}

/**
 * The bulk of the data: `count` requests spread over the window in proportion to
 * how busy each day is, with the model mix drifting as the fleet migrates.
 */
function buildTraffic(
	tokens: SeededToken[],
	count: number,
	weights: number[],
	weightTotal: number
): AuditRow[] {
	const rows: AuditRow[] = [];
	for (let d = 0; d < DAYS; d++) {
		const perDay = Math.round((count * weights[d]) / weightTotal);
		const progress = DAYS === 1 ? 1 : d / (DAYS - 1);
		for (let i = 0; i < perDay; i++) {
			const model = modelForProgress(progress);
			if (Math.random() < 0.04) {
				rows.push(buildFailure(pick(tokens), model, d));
				continue;
			}
			const scope = scopeForModel(model);
			const price = DEFAULT_MODEL_PRICES[model];
			const mode = cacheModeFor(scope, price);
			// Long context is rare in practice — a whole-repo or whole-corpus prompt,
			// not a chat turn — but it dominates spend wherever it does happen, which
			// is exactly the thing the rate-card breakdown exists to surface. Under a
			// percent of requests already buys it about a third of the bill; at the
			// few percent that looks harmless here, it drowns out every short-context
			// line in the chart.
			const long = hasLongContextCard(price) && mode !== 'uprox-hit' && Math.random() < 0.006;
			rows.push(buildRequest(pick(tokens), model, scope, mode, long, d));
		}
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

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
	if (RESET) await reset();
	if (ONLY_RESET) return;

	await seedPrices();
	const userId = await seedUser();
	await seedSettings();
	await seedProviderSecret(userId);
	const tokens = await seedServicesAndTokens(userId);

	const { weights, total } = dailyWeights();
	const rows = [
		...buildMatrix(tokens, weights, total),
		...buildTraffic(tokens, TOTAL_REQUESTS, weights, total)
	].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
	const ids = await insertAuditRows(rows);
	console.log(`audit log: ${ids.length} rows over ${DAYS} days, ${OPENAI_MODELS.length} models`);

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

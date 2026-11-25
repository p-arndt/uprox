/**
 * Model pricing: the data layer and runtime lookup for per-model token prices.
 *
 * Prices live in the `model_price` table at two scopes — platform defaults
 * (isDefault = true) and instance-specific overrides (isDefault = false). Cost
 * estimation resolves the *effective* map (defaults with instance custom rows
 * layered on top) and matches a model by longest prefix. The effective map is
 * cached in memory for a few seconds so the gateway doesn't hit the database on
 * every request; writes invalidate the cache immediately.
 */
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { modelPrice } from '$lib/server/db/schema';
import { audit } from '$lib/server/audit';
import {
	DEFAULT_MODEL_PRICES,
	providerForModel,
	resolvePrice,
	costFromPrice,
	contextTierForPromptTokens,
	type ContextTier,
	type ModelPrice
} from '$lib/server/providers';

type PriceMap = Record<string, ModelPrice>;

/** What a request cost, and which rate card it was billed against. */
export interface CostEstimate {
	costUsd: number | null;
	/** null exactly when `costUsd` is: nothing was priced, so no card applied */
	tier: ContextTier | null;
}

/**
 * Estimate a request's USD cost. Reads the instance's effective price map
 * (custom overrides layered over platform defaults) via a short-lived in-memory
 * cache, then matches the model by longest prefix. `promptTokens` is the total
 * input volume; `cacheReadTokens`/`cacheWriteTokens` are the cache subsets within
 * it, priced separately. Returns a null cost when the model has no price or no
 * prompt tokens were reported.
 *
 * The tier comes back alongside the cost because it's decided here, from the
 * resolved price — the caller has the model name but not the rate card, so it
 * can't tell a long-context request from a standard one on its own.
 *
 * Lives here rather than in providers.ts so the dependency runs one way only
 * (pricing -> providers): providers.ts stays pure and database-free.
 */
export async function estimateCost(
	model: string | undefined,
	promptTokens: number | undefined,
	completionTokens: number | undefined,
	cacheReadTokens = 0,
	cacheWriteTokens = 0
): Promise<CostEstimate> {
	if (!model || promptTokens == null) return { costUsd: null, tier: null };
	const prices = await getEffectivePriceMap();
	const price = resolvePrice(prices, model);
	if (!price) return { costUsd: null, tier: null };
	return {
		costUsd: costFromPrice(
			price,
			promptTokens,
			completionTokens ?? 0,
			cacheReadTokens,
			cacheWriteTokens
		),
		tier: contextTierForPromptTokens(price, promptTokens)
	};
}

const CACHE_TTL_MS = 30_000;

/** Single global cache entry for the instance's effective price map. */
let cachedEntry: { map: PriceMap; expires: number } | undefined;

/** Drop the cached effective price map (call after any write). */
export function invalidatePriceCache(): void {
	cachedEntry = undefined;
}

/**
 * Seed the platform-default prices (isDefault = true rows) from the built-in
 * list. Idempotent, so it's safe to run on every server start. This is where the
 * defaults live now (not in a migration).
 *
 * Defaults are *synced*, not just inserted: a default row is the code's price
 * list mirrored into the database, so a corrected rate (say, a cache-write price
 * the provider introduced) reaches existing instances on the next start instead
 * of being frozen at whatever was seeded first. Instance overrides are separate
 * (isDefault = false) rows and are never touched here — the conflict target is
 * the default partial unique index.
 *
 * A full write (the default) also deletes default rows for models missing from
 * `prices`, so the defaults are exactly the written map: turning the LiteLLM
 * sync off drops its extra models again, as do models LiteLLM later removes.
 *
 * With `updateExisting: false` only models without a default row are inserted
 * and nothing is deleted: used at startup on an instance that has synced
 * before, so a restart doesn't roll synced prices back to the code list.
 */
export async function seedDefaultModelPrices(
	prices: Record<string, ModelPrice> = DEFAULT_MODEL_PRICES,
	{ updateExisting = true }: { updateExisting?: boolean } = {}
): Promise<void> {
	const rows = Object.entries(prices).map(([model, p]) => ({
		isDefault: true,
		model: model.toLowerCase(),
		provider: providerForModel(model)?.id ?? null,
		inputPerMtok: String(p.in),
		outputPerMtok: String(p.out),
		cacheReadPerMtok: p.cacheRead != null ? String(p.cacheRead) : null,
		cacheWritePerMtok: p.cacheWrite != null ? String(p.cacheWrite) : null,
		longInputPerMtok: p.longIn != null ? String(p.longIn) : null,
		longOutputPerMtok: p.longOut != null ? String(p.longOut) : null,
		longCacheReadPerMtok: p.longCacheRead != null ? String(p.longCacheRead) : null,
		longCacheWritePerMtok: p.longCacheWrite != null ? String(p.longCacheWrite) : null,
		longMinPromptTokens: p.longMinPromptTokens ?? null
	}));
	if (rows.length === 0) return;
	const insert = db.insert(modelPrice).values(rows);
	if (!updateExisting) {
		await insert.onConflictDoNothing({
			target: modelPrice.model,
			where: eq(modelPrice.isDefault, true)
		});
	} else {
		await insert.onConflictDoUpdate({
			target: modelPrice.model,
			targetWhere: eq(modelPrice.isDefault, true),
			set: {
				provider: sql`excluded.provider`,
				inputPerMtok: sql`excluded.input_per_mtok`,
				outputPerMtok: sql`excluded.output_per_mtok`,
				cacheReadPerMtok: sql`excluded.cache_read_per_mtok`,
				cacheWritePerMtok: sql`excluded.cache_write_per_mtok`,
				longInputPerMtok: sql`excluded.long_input_per_mtok`,
				longOutputPerMtok: sql`excluded.long_output_per_mtok`,
				longCacheReadPerMtok: sql`excluded.long_cache_read_per_mtok`,
				longCacheWritePerMtok: sql`excluded.long_cache_write_per_mtok`,
				longMinPromptTokens: sql`excluded.long_min_prompt_tokens`,
				updatedAt: new Date()
			}
		});
		await db.delete(modelPrice).where(
			and(
				eq(modelPrice.isDefault, true),
				notInArray(
					modelPrice.model,
					rows.map((r) => r.model)
				)
			)
		);
	}
	invalidatePriceCache();
}

/**
 * Whether the defaults hold models beyond the built-in list — i.e. a LiteLLM
 * sync has succeeded on this database (a code-list-only write prunes them).
 */
export async function hasSyncedDefaultPrices(): Promise<boolean> {
	const codeModels = Object.keys(DEFAULT_MODEL_PRICES).map((m) => m.toLowerCase());
	const [row] = await db
		.select({ id: modelPrice.id })
		.from(modelPrice)
		.where(and(eq(modelPrice.isDefault, true), notInArray(modelPrice.model, codeModels)))
		.limit(1);
	return row != null;
}

/** All modelPrice rows for the instance (both defaults and custom overrides). */
function selectVisible() {
	return db.select().from(modelPrice);
}

/**
 * The instance's effective price map: platform defaults overlaid with custom
 * (isDefault = false) rows (custom wins per model), keyed by lower-cased model.
 * Cached globally for {@link CACHE_TTL_MS} and dropped by every pricing write.
 *
 * This is the one loader of resolved prices: gateway cost estimation and the
 * usage analytics' rate cards (usage-queries/rate-cards.ts) both read it and
 * match models with `resolvePrice`, so the two never disagree about a price.
 * The returned map is shared — do not mutate it.
 */
export async function getEffectivePriceMap(): Promise<PriceMap> {
	if (cachedEntry && cachedEntry.expires > Date.now()) return cachedEntry.map;

	const rows = await selectVisible();
	const toPrice = (r: (typeof rows)[number]): ModelPrice => ({
		in: Number(r.inputPerMtok),
		out: Number(r.outputPerMtok),
		...(r.cacheReadPerMtok != null ? { cacheRead: Number(r.cacheReadPerMtok) } : {}),
		...(r.cacheWritePerMtok != null ? { cacheWrite: Number(r.cacheWritePerMtok) } : {}),
		...(r.longInputPerMtok != null ? { longIn: Number(r.longInputPerMtok) } : {}),
		...(r.longOutputPerMtok != null ? { longOut: Number(r.longOutputPerMtok) } : {}),
		...(r.longCacheReadPerMtok != null ? { longCacheRead: Number(r.longCacheReadPerMtok) } : {}),
		...(r.longCacheWritePerMtok != null ? { longCacheWrite: Number(r.longCacheWritePerMtok) } : {}),
		...(r.longMinPromptTokens != null ? { longMinPromptTokens: r.longMinPromptTokens } : {})
	});
	const map: PriceMap = {};
	// defaults first, then custom rows override any matching model
	for (const r of rows) {
		if (r.isDefault) map[r.model.toLowerCase()] = toPrice(r);
	}
	for (const r of rows) {
		if (!r.isDefault) map[r.model.toLowerCase()] = toPrice(r);
	}

	cachedEntry = { map, expires: Date.now() + CACHE_TTL_MS };
	return map;
}

export interface EffectiveModelPrice {
	/** the custom override row id, present only for custom rows (editable/deletable) */
	id: string | null;
	model: string;
	provider: string | null;
	inputPerMtok: number;
	outputPerMtok: number;
	/** provider prompt-cache rates; null when this row leaves them to the fallback */
	cacheReadPerMtok: number | null;
	cacheWritePerMtok: number | null;
	/**
	 * The long-context rate card, billed above LONG_CONTEXT_MIN_PROMPT_TOKENS. A
	 * null `longInputPerMtok` means the model has a single rate card.
	 */
	longInputPerMtok: number | null;
	longOutputPerMtok: number | null;
	longCacheReadPerMtok: number | null;
	longCacheWritePerMtok: number | null;
	/** inclusive prompt-token threshold of the long card; null = the 272k default */
	longMinPromptTokens: number | null;
	/** 'custom' when the instance has its own row, else 'default' */
	source: 'default' | 'custom';
	/** the platform default beneath an override, if one exists */
	defaultInputPerMtok: number | null;
	defaultOutputPerMtok: number | null;
	defaultCacheReadPerMtok: number | null;
	defaultCacheWritePerMtok: number | null;
	defaultLongInputPerMtok: number | null;
	defaultLongOutputPerMtok: number | null;
	defaultLongCacheReadPerMtok: number | null;
	defaultLongCacheWritePerMtok: number | null;
	defaultLongMinPromptTokens: number | null;
}

/**
 * The list the dashboard renders: one entry per model visible to the instance,
 * marking whether it's a platform default or an instance-specific custom price,
 * and exposing the underlying default when an override shadows it.
 */
export async function listEffectiveModelPrices(): Promise<EffectiveModelPrice[]> {
	const rows = await selectVisible();
	type Row = (typeof rows)[number];
	const defaults = new Map<string, Row>();
	const customRows = new Map<string, Row>();
	for (const r of rows) {
		if (r.isDefault) defaults.set(r.model, r);
		else customRows.set(r.model, r);
	}

	const models = [...new Set([...defaults.keys(), ...customRows.keys()])].sort();
	return models.map((model) => {
		const o = customRows.get(model);
		const d = defaults.get(model);
		const eff = o ?? d!;
		const num = (v: string | null | undefined) => (v != null ? Number(v) : null);
		return {
			id: o?.id ?? null,
			model,
			provider: eff.provider,
			inputPerMtok: Number(eff.inputPerMtok),
			outputPerMtok: Number(eff.outputPerMtok),
			cacheReadPerMtok: num(eff.cacheReadPerMtok),
			cacheWritePerMtok: num(eff.cacheWritePerMtok),
			longInputPerMtok: num(eff.longInputPerMtok),
			longOutputPerMtok: num(eff.longOutputPerMtok),
			longCacheReadPerMtok: num(eff.longCacheReadPerMtok),
			longCacheWritePerMtok: num(eff.longCacheWritePerMtok),
			longMinPromptTokens: eff.longMinPromptTokens ?? null,
			source: o ? 'custom' : 'default',
			defaultInputPerMtok: d ? Number(d.inputPerMtok) : null,
			defaultOutputPerMtok: d ? Number(d.outputPerMtok) : null,
			defaultCacheReadPerMtok: d ? num(d.cacheReadPerMtok) : null,
			defaultCacheWritePerMtok: d ? num(d.cacheWritePerMtok) : null,
			defaultLongInputPerMtok: d ? num(d.longInputPerMtok) : null,
			defaultLongOutputPerMtok: d ? num(d.longOutputPerMtok) : null,
			defaultLongCacheReadPerMtok: d ? num(d.longCacheReadPerMtok) : null,
			defaultLongCacheWritePerMtok: d ? num(d.longCacheWritePerMtok) : null,
			defaultLongMinPromptTokens: d?.longMinPromptTokens ?? null
		};
	});
}

export interface ModelPriceInput {
	model: string;
	provider?: string | null;
	inputPerMtok: number;
	outputPerMtok: number;
	/** optional provider prompt-cache rates; omit/null to leave the fallback in charge */
	cacheReadPerMtok?: number | null;
	cacheWritePerMtok?: number | null;
	/**
	 * Optional long-context rate card. Omitting `longInputPerMtok` (or setting it
	 * null) gives the model a single rate card — every request bills standard.
	 */
	longInputPerMtok?: number | null;
	longOutputPerMtok?: number | null;
	longCacheReadPerMtok?: number | null;
	longCacheWritePerMtok?: number | null;
	/** inclusive long-card threshold in prompt tokens; omit/null = 272k default */
	longMinPromptTokens?: number | null;
}

/** Serialize an optional numeric price to the DB's string|null column shape. */
function priceStr(v: number | null | undefined): string | null {
	return v != null ? String(v) : null;
}

/**
 * Create or replace the instance's custom price for a model. Idempotent on
 * model: adding a model that already has a custom price simply updates it.
 */
export async function createOrgModelPrice(input: ModelPriceInput) {
	const model = input.model.trim().toLowerCase();
	const [row] = await db
		.insert(modelPrice)
		.values({
			isDefault: false,
			model,
			provider: input.provider?.trim() || null,
			inputPerMtok: String(input.inputPerMtok),
			outputPerMtok: String(input.outputPerMtok),
			cacheReadPerMtok: priceStr(input.cacheReadPerMtok),
			cacheWritePerMtok: priceStr(input.cacheWritePerMtok),
			longInputPerMtok: priceStr(input.longInputPerMtok),
			longOutputPerMtok: priceStr(input.longOutputPerMtok),
			longCacheReadPerMtok: priceStr(input.longCacheReadPerMtok),
			longCacheWritePerMtok: priceStr(input.longCacheWritePerMtok),
			longMinPromptTokens: input.longMinPromptTokens ?? null
		})
		.onConflictDoUpdate({
			target: modelPrice.model,
			// target the custom partial unique index (model where isDefault = false)
			targetWhere: eq(modelPrice.isDefault, false),
			set: {
				provider: input.provider?.trim() || null,
				inputPerMtok: String(input.inputPerMtok),
				outputPerMtok: String(input.outputPerMtok),
				cacheReadPerMtok: priceStr(input.cacheReadPerMtok),
				cacheWritePerMtok: priceStr(input.cacheWritePerMtok),
				longInputPerMtok: priceStr(input.longInputPerMtok),
				longOutputPerMtok: priceStr(input.longOutputPerMtok),
				longCacheReadPerMtok: priceStr(input.longCacheReadPerMtok),
				longCacheWritePerMtok: priceStr(input.longCacheWritePerMtok),
				longMinPromptTokens: input.longMinPromptTokens ?? null,
				updatedAt: new Date()
			}
		})
		.returning();
	invalidatePriceCache();
	await audit({
		action: 'pricing.upsert',
		status: 'ok',
		provider: row?.provider ?? null,
		model,
		detail: model
	});
	return row;
}

/** Update one of the instance's custom price rows by id. Returns null if not found. */
export async function updateOrgModelPrice(
	id: string,
	patch: {
		provider?: string | null;
		inputPerMtok?: number;
		outputPerMtok?: number;
		cacheReadPerMtok?: number | null;
		cacheWritePerMtok?: number | null;
		longInputPerMtok?: number | null;
		longOutputPerMtok?: number | null;
		longCacheReadPerMtok?: number | null;
		longCacheWritePerMtok?: number | null;
		longMinPromptTokens?: number | null;
	}
) {
	const [row] = await db
		.update(modelPrice)
		.set({
			...(patch.provider !== undefined ? { provider: patch.provider?.trim() || null } : {}),
			...(patch.inputPerMtok !== undefined ? { inputPerMtok: String(patch.inputPerMtok) } : {}),
			...(patch.outputPerMtok !== undefined ? { outputPerMtok: String(patch.outputPerMtok) } : {}),
			...(patch.cacheReadPerMtok !== undefined
				? { cacheReadPerMtok: priceStr(patch.cacheReadPerMtok) }
				: {}),
			...(patch.cacheWritePerMtok !== undefined
				? { cacheWritePerMtok: priceStr(patch.cacheWritePerMtok) }
				: {}),
			...(patch.longInputPerMtok !== undefined
				? { longInputPerMtok: priceStr(patch.longInputPerMtok) }
				: {}),
			...(patch.longOutputPerMtok !== undefined
				? { longOutputPerMtok: priceStr(patch.longOutputPerMtok) }
				: {}),
			...(patch.longCacheReadPerMtok !== undefined
				? { longCacheReadPerMtok: priceStr(patch.longCacheReadPerMtok) }
				: {}),
			...(patch.longCacheWritePerMtok !== undefined
				? { longCacheWritePerMtok: priceStr(patch.longCacheWritePerMtok) }
				: {}),
			...(patch.longMinPromptTokens !== undefined
				? { longMinPromptTokens: patch.longMinPromptTokens }
				: {}),
			updatedAt: new Date()
		})
		.where(and(eq(modelPrice.id, id), eq(modelPrice.isDefault, false)))
		.returning();
	if (!row) return null;
	invalidatePriceCache();
	await audit({
		action: 'pricing.update',
		status: 'ok',
		provider: row.provider,
		model: row.model,
		detail: row.model
	});
	return row;
}

/**
 * Delete one of the instance's custom price rows. Reverts that model to the
 * platform default (or removes it entirely if there is no default). No-op for
 * ids that aren't custom rows — platform defaults cannot be deleted from here.
 */
export async function deleteOrgModelPrice(id: string) {
	const [row] = await db
		.delete(modelPrice)
		.where(and(eq(modelPrice.id, id), eq(modelPrice.isDefault, false)))
		.returning();
	if (!row) return null;
	invalidatePriceCache();
	await audit({
		action: 'pricing.delete',
		status: 'ok',
		provider: row.provider,
		model: row.model,
		detail: row.model
	});
	return row;
}

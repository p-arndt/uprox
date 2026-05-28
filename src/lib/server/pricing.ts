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
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { modelPrice } from '$lib/server/db/schema';
import { audit } from '$lib/server/audit';
import { DEFAULT_MODEL_PRICES, providerForModel } from '$lib/server/providers';

type PriceMap = Record<string, { in: number; out: number }>;

const CACHE_TTL_MS = 30_000;

/** Single global cache entry for the instance's effective price map. */
let cachedEntry: { map: PriceMap; expires: number } | undefined;

/** Drop the cached effective price map (call after any write). */
export function invalidatePriceCache(): void {
	cachedEntry = undefined;
}

/**
 * Seed the platform-default prices (isDefault = true rows) from the built-in
 * list. Idempotent — existing defaults are left untouched — so it's safe to run
 * on every server start. This is where the defaults live now (not in a migration).
 */
export async function seedDefaultModelPrices(): Promise<void> {
	const rows = Object.entries(DEFAULT_MODEL_PRICES).map(([model, p]) => ({
		isDefault: true,
		model,
		provider: providerForModel(model)?.id ?? null,
		inputPerMtok: String(p.in),
		outputPerMtok: String(p.out)
	}));
	if (rows.length === 0) return;
	// ON CONFLICT DO NOTHING against the default partial unique index (model
	// where isDefault is true), so re-runs never duplicate or overwrite.
	await db.insert(modelPrice).values(rows).onConflictDoNothing();
}

/** All modelPrice rows for the instance (both defaults and custom overrides). */
function selectVisible() {
	return db.select().from(modelPrice);
}

/**
 * The instance's effective price map: platform defaults overlaid with custom
 * (isDefault = false) rows (custom wins per model). Cached globally for
 * {@link CACHE_TTL_MS}.
 */
export async function getEffectivePriceMap(): Promise<PriceMap> {
	if (cachedEntry && cachedEntry.expires > Date.now()) return cachedEntry.map;

	const rows = await selectVisible();
	const map: PriceMap = {};
	// defaults first, then custom rows override any matching model
	for (const r of rows) {
		if (r.isDefault) map[r.model] = { in: Number(r.inputPerMtok), out: Number(r.outputPerMtok) };
	}
	for (const r of rows) {
		if (!r.isDefault) map[r.model] = { in: Number(r.inputPerMtok), out: Number(r.outputPerMtok) };
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
	/** 'custom' when the instance has its own row, else 'default' */
	source: 'default' | 'custom';
	/** the platform default beneath an override, if one exists */
	defaultInputPerMtok: number | null;
	defaultOutputPerMtok: number | null;
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
		return {
			id: o?.id ?? null,
			model,
			provider: eff.provider,
			inputPerMtok: Number(eff.inputPerMtok),
			outputPerMtok: Number(eff.outputPerMtok),
			source: o ? 'custom' : 'default',
			defaultInputPerMtok: d ? Number(d.inputPerMtok) : null,
			defaultOutputPerMtok: d ? Number(d.outputPerMtok) : null
		};
	});
}

export interface ModelPriceInput {
	model: string;
	provider?: string | null;
	inputPerMtok: number;
	outputPerMtok: number;
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
			outputPerMtok: String(input.outputPerMtok)
		})
		.onConflictDoUpdate({
			target: modelPrice.model,
			// target the custom partial unique index (model where isDefault = false)
			targetWhere: eq(modelPrice.isDefault, false),
			set: {
				provider: input.provider?.trim() || null,
				inputPerMtok: String(input.inputPerMtok),
				outputPerMtok: String(input.outputPerMtok),
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
	patch: { provider?: string | null; inputPerMtok?: number; outputPerMtok?: number }
) {
	const [row] = await db
		.update(modelPrice)
		.set({
			...(patch.provider !== undefined ? { provider: patch.provider?.trim() || null } : {}),
			...(patch.inputPerMtok !== undefined ? { inputPerMtok: String(patch.inputPerMtok) } : {}),
			...(patch.outputPerMtok !== undefined ? { outputPerMtok: String(patch.outputPerMtok) } : {}),
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

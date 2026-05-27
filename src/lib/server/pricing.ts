/**
 * Model pricing: the data layer and runtime lookup for per-model token prices.
 *
 * Prices live in the `model_price` table at two scopes — platform defaults
 * (NULL org) and per-organization overrides. Cost estimation resolves an org's
 * *effective* map (defaults with the org's rows layered on top) and matches a
 * model by longest prefix. The effective map is cached in memory per org for a
 * few seconds so the gateway doesn't hit the database on every request; writes
 * invalidate the org's entry immediately.
 */
import { and, eq, isNotNull, isNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { modelPrice } from '$lib/server/db/schema';
import { audit } from '$lib/server/audit';
import { DEFAULT_MODEL_PRICES, providerForModel } from '$lib/server/providers';

type PriceMap = Record<string, { in: number; out: number }>;

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { map: PriceMap; expires: number }>();

/** Drop an org's cached effective price map (call after any write). */
export function invalidatePriceCache(orgId: string): void {
	cache.delete(orgId);
}

/**
 * Seed the platform-default prices (NULL-org rows) from the built-in list.
 * Idempotent — existing defaults are left untouched — so it's safe to run on
 * every server start. This is where the defaults live now (not in a migration).
 */
export async function seedDefaultModelPrices(): Promise<void> {
	const rows = Object.entries(DEFAULT_MODEL_PRICES).map(([model, p]) => ({
		organizationId: null,
		model,
		provider: providerForModel(model)?.id ?? null,
		inputPerMtok: String(p.in),
		outputPerMtok: String(p.out)
	}));
	if (rows.length === 0) return;
	// ON CONFLICT DO NOTHING against the default partial unique index (model
	// where org is null), so re-runs never duplicate or overwrite.
	await db.insert(modelPrice).values(rows).onConflictDoNothing();
}

/** All rows visible to an org: platform defaults plus the org's own. */
function selectVisible(orgId: string) {
	return db
		.select()
		.from(modelPrice)
		.where(or(isNull(modelPrice.organizationId), eq(modelPrice.organizationId, orgId)));
}

/**
 * An org's effective price map: platform defaults overlaid with the org's own
 * rows (org wins per model). Cached per org for {@link CACHE_TTL_MS}.
 */
export async function getEffectivePriceMap(orgId: string): Promise<PriceMap> {
	const hit = cache.get(orgId);
	if (hit && hit.expires > Date.now()) return hit.map;

	const rows = await selectVisible(orgId);
	const map: PriceMap = {};
	// defaults first, then org rows override any matching model
	for (const r of rows) {
		if (r.organizationId === null)
			map[r.model] = { in: Number(r.inputPerMtok), out: Number(r.outputPerMtok) };
	}
	for (const r of rows) {
		if (r.organizationId !== null)
			map[r.model] = { in: Number(r.inputPerMtok), out: Number(r.outputPerMtok) };
	}

	cache.set(orgId, { map, expires: Date.now() + CACHE_TTL_MS });
	return map;
}

export interface EffectiveModelPrice {
	/** the org override row id, present only for custom rows (editable/deletable) */
	id: string | null;
	model: string;
	provider: string | null;
	inputPerMtok: number;
	outputPerMtok: number;
	/** 'custom' when the org has its own row, else 'default' */
	source: 'default' | 'custom';
	/** the platform default beneath an override, if one exists */
	defaultInputPerMtok: number | null;
	defaultOutputPerMtok: number | null;
}

/**
 * The list the dashboard renders: one entry per model the org can see, marking
 * whether it's a platform default or the org's own price, and exposing the
 * underlying default when an override shadows it.
 */
export async function listEffectiveModelPrices(orgId: string): Promise<EffectiveModelPrice[]> {
	const rows = await selectVisible(orgId);
	type Row = (typeof rows)[number];
	const defaults = new Map<string, Row>();
	const orgRows = new Map<string, Row>();
	for (const r of rows) {
		if (r.organizationId === null) defaults.set(r.model, r);
		else orgRows.set(r.model, r);
	}

	const models = [...new Set([...defaults.keys(), ...orgRows.keys()])].sort();
	return models.map((model) => {
		const o = orgRows.get(model);
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
 * Create or replace an org's price for a model. Idempotent on (org, model):
 * adding a model the org already overrides simply updates it.
 */
export async function createOrgModelPrice(orgId: string, input: ModelPriceInput) {
	const model = input.model.trim().toLowerCase();
	const [row] = await db
		.insert(modelPrice)
		.values({
			organizationId: orgId,
			model,
			provider: input.provider?.trim() || null,
			inputPerMtok: String(input.inputPerMtok),
			outputPerMtok: String(input.outputPerMtok)
		})
		.onConflictDoUpdate({
			target: [modelPrice.organizationId, modelPrice.model],
			// infer the partial unique index, which covers org rows only
			targetWhere: isNotNull(modelPrice.organizationId),
			set: {
				provider: input.provider?.trim() || null,
				inputPerMtok: String(input.inputPerMtok),
				outputPerMtok: String(input.outputPerMtok),
				updatedAt: new Date()
			}
		})
		.returning();
	invalidatePriceCache(orgId);
	await audit({
		organizationId: orgId,
		action: 'pricing.upsert',
		status: 'ok',
		provider: row?.provider ?? null,
		model,
		detail: model
	});
	return row;
}

/** Update one of an org's own price rows by id. Returns null if not found. */
export async function updateOrgModelPrice(
	orgId: string,
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
		.where(and(eq(modelPrice.id, id), eq(modelPrice.organizationId, orgId)))
		.returning();
	if (!row) return null;
	invalidatePriceCache(orgId);
	await audit({
		organizationId: orgId,
		action: 'pricing.update',
		status: 'ok',
		provider: row.provider,
		model: row.model,
		detail: row.model
	});
	return row;
}

/**
 * Delete one of an org's own price rows. Reverts that model to the platform
 * default (or removes it entirely if there is no default). No-op for ids that
 * aren't this org's — platform defaults can't be deleted from here.
 */
export async function deleteOrgModelPrice(orgId: string, id: string) {
	const [row] = await db
		.delete(modelPrice)
		.where(and(eq(modelPrice.id, id), eq(modelPrice.organizationId, orgId)))
		.returning();
	if (!row) return null;
	invalidatePriceCache(orgId);
	await audit({
		organizationId: orgId,
		action: 'pricing.delete',
		status: 'ok',
		provider: row.provider,
		model: row.model,
		detail: row.model
	});
	return row;
}

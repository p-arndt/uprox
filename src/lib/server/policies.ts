/** Reusable limit & access presets. */
import { and, count, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { machineToken, policy, service } from '$lib/server/db/schema';
import { audit } from '$lib/server/audit';
import { getEffectivePriceMap } from '$lib/server/pricing';

export function listPolicies() {
	return db.select().from(policy).orderBy(desc(policy.createdAt));
}

/** How many live services and active tokens attach a preset. */
export interface PolicyUsage {
	services: number;
	tokens: number;
}

/**
 * Usage per preset id, counting only what the preset still governs: deleted
 * services and revoked tokens are left out. Presets nobody uses are absent.
 */
export async function policyUsageCounts(): Promise<Record<string, PolicyUsage>> {
	const [services, tokens] = await Promise.all([
		db
			.select({ policyId: service.policyId, n: count() })
			.from(service)
			.where(and(isNotNull(service.policyId), isNull(service.deletedAt)))
			.groupBy(service.policyId),
		db
			.select({ policyId: machineToken.policyId, n: count() })
			.from(machineToken)
			.where(and(isNotNull(machineToken.policyId), isNull(machineToken.revokedAt)))
			.groupBy(machineToken.policyId)
	]);
	const out: Record<string, PolicyUsage> = {};
	const entry = (id: string) => (out[id] ??= { services: 0, tokens: 0 });
	for (const r of services) if (r.policyId) entry(r.policyId).services = r.n;
	for (const r of tokens) if (r.policyId) entry(r.policyId).tokens = r.n;
	return out;
}

/**
 * Whether another preset already uses this name (case-insensitive). Presets are
 * picked by name on the service and token forms, so duplicates are ambiguous.
 */
export async function policyNameTaken(name: string, exceptId?: string): Promise<boolean> {
	const [row] = await db
		.select({ id: policy.id })
		.from(policy)
		.where(
			and(
				sql`lower(${policy.name}) = lower(${name.trim()})`,
				exceptId ? ne(policy.id, exceptId) : undefined
			)
		)
		.limit(1);
	return !!row;
}

export const POLICY_NAME_TAKEN = 'A preset with this name already exists';

/** Model ids the instance knows (priced models), for suggestions and typo hints. */
export async function knownModelIds(): Promise<string[]> {
	return Object.keys(await getEffectivePriceMap()).sort();
}

export async function createPolicy(input: {
	name: string;
	allowedProviders?: string[];
	allowedModels?: string[];
	// "openai" | "azure" | null — preferred backend for the shared model namespace
	preferredProvider?: string | null;
	rateLimitPerMinute?: number;
	dailyBudgetUsd?: number;
	monthlyBudgetUsd?: number;
	// null = inherit instance default, 0 = off, >0 = override
	cacheTtlSeconds?: number | null;
}) {
	const [row] = await db
		.insert(policy)
		.values({
			name: input.name,
			allowedProviders: input.allowedProviders ?? [],
			allowedModels: input.allowedModels ?? [],
			preferredProvider: input.preferredProvider ?? null,
			rateLimitPerMinute: input.rateLimitPerMinute ?? 0,
			dailyBudgetUsd: String(input.dailyBudgetUsd ?? 0),
			monthlyBudgetUsd: String(input.monthlyBudgetUsd ?? 0),
			cacheTtlSeconds: input.cacheTtlSeconds ?? null
		})
		.returning();
	return row;
}

export async function updatePolicy(
	id: string,
	patch: {
		name?: string;
		allowedProviders?: string[];
		allowedModels?: string[];
		preferredProvider?: string | null;
		rateLimitPerMinute?: number;
		dailyBudgetUsd?: number;
		monthlyBudgetUsd?: number;
		cacheTtlSeconds?: number | null;
	}
) {
	// numeric columns round-trip as strings in drizzle/pg
	const { dailyBudgetUsd, monthlyBudgetUsd, ...rest } = patch;
	const [row] = await db
		.update(policy)
		.set({
			...rest,
			...(dailyBudgetUsd !== undefined ? { dailyBudgetUsd: String(dailyBudgetUsd) } : {}),
			...(monthlyBudgetUsd !== undefined ? { monthlyBudgetUsd: String(monthlyBudgetUsd) } : {})
		})
		.where(eq(policy.id, id))
		.returning();
	return row ?? null;
}

/**
 * Delete a policy and audit it. Returns whether a row was removed, so callers
 * can tell a stale id from a real deletion; nothing is audited for an unknown id.
 */
export async function deletePolicy(id: string): Promise<boolean> {
	const [row] = await db.delete(policy).where(eq(policy.id, id)).returning({ name: policy.name });
	if (!row) return false;
	await audit({ action: 'policy.delete', status: 'ok', detail: row.name });
	return true;
}

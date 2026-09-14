/** Reusable limit & access presets. */
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { policy } from '$lib/server/db/schema';
import { audit } from '$lib/server/audit';

export function listPolicies() {
	return db.select().from(policy).orderBy(desc(policy.createdAt));
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
	// null = inherit instance default; true/false force tracing on/off
	tracingEnabled?: boolean | null;
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
			cacheTtlSeconds: input.cacheTtlSeconds ?? null,
			tracingEnabled: input.tracingEnabled ?? null
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
		tracingEnabled?: boolean | null;
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

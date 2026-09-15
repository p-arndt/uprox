/** Service (machine identity) CRUD. */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service, machineToken } from '$lib/server/db/schema';
import { type InlineConfigInput, inlineConfigColumns } from '$lib/server/inline-config';

/**
 * The name of the auto-provisioned catch-all service. Tokens created without an
 * explicit service land here, so a user can start issuing tokens before they
 * think about organising anything. It's an ordinary service in every other
 * respect — editable, soft-deletable, can carry its own limits/budget.
 */
export const DEFAULT_SERVICE_NAME = 'Default';

/**
 * Return the catch-all "Default" service, creating it on first use. Matches by
 * name among non-deleted services so a manually-created "Default" is reused
 * rather than duplicated. Not transactionally locked: a rare concurrent first
 * call could create two rows, which is harmless (both are valid services) and
 * self-heals on the next lookup picking the oldest.
 */
export async function getOrCreateDefaultService() {
	const [existing] = await db
		.select()
		.from(service)
		.where(and(eq(service.name, DEFAULT_SERVICE_NAME), isNull(service.deletedAt)))
		.orderBy(service.createdAt)
		.limit(1);
	if (existing) return existing;
	return createService({
		name: DEFAULT_SERVICE_NAME,
		description: 'Catch-all project for tokens created without one.'
	});
}

export function listServices() {
	return db
		.select()
		.from(service)
		.where(isNull(service.deletedAt))
		.orderBy(desc(service.createdAt));
}

export async function createService(
	input: {
		name: string;
		type?: string;
		description?: string;
		policyId?: string | null;
		providerSecretId?: string | null;
	} & InlineConfigInput
) {
	const [row] = await db
		.insert(service)
		.values({
			name: input.name,
			type: input.type || 'app',
			description: input.description || null,
			policyId: input.policyId || null,
			providerSecretId: input.providerSecretId || null,
			...inlineConfigColumns(input)
		})
		.returning();
	return row;
}

export async function updateService(
	id: string,
	patch: {
		name?: string;
		type?: string;
		description?: string | null;
		policyId?: string | null;
		providerSecretId?: string | null;
	} & InlineConfigInput
) {
	const {
		allowedProviders,
		allowedModels,
		preferredProvider,
		rateLimitPerMinute,
		dailyBudgetUsd,
		monthlyBudgetUsd,
		cacheTtlSeconds,
		tracingEnabled,
		...base
	} = patch;
	const set = {
		...base,
		...inlineConfigColumns({
			allowedProviders,
			allowedModels,
			preferredProvider,
			rateLimitPerMinute,
			dailyBudgetUsd,
			monthlyBudgetUsd,
			cacheTtlSeconds,
			tracingEnabled
		})
	};
	const [row] = await db
		.update(service)
		.set(set)
		.where(and(eq(service.id, id), isNull(service.deletedAt)))
		.returning();
	return row ?? null;
}

/**
 * Retire a service (soft delete). We stamp `deletedAt` rather than removing the
 * row so historical audit-log / usage rows keep resolving its name, and revoke
 * its still-active tokens in the same transaction so the retired service can no
 * longer authenticate — matching the old hard-delete-cascade behaviour where the
 * tokens disappeared. Already-deleted services are left untouched.
 */
export async function deleteService(id: string) {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.update(service)
			.set({ deletedAt: new Date() })
			.where(and(eq(service.id, id), isNull(service.deletedAt)))
			.returning({ id: service.id });
		if (!row) return;
		await tx
			.update(machineToken)
			.set({ revokedAt: new Date() })
			.where(and(eq(machineToken.serviceId, id), isNull(machineToken.revokedAt)));
	});
}

/** A single non-deleted service by id, or null. Powers the service detail page. */
export async function getService(id: string) {
	const [row] = await db
		.select()
		.from(service)
		.where(and(eq(service.id, id), isNull(service.deletedAt)))
		.limit(1);
	return row ?? null;
}

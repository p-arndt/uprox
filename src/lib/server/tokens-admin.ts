/** Machine token administration: issue, reveal, edit, revoke, delete. */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service, machineToken, policy } from '$lib/server/db/schema';
import { encrypt, decrypt } from '$lib/server/crypto';
import { issueToken } from '$lib/server/tokens';
import { audit, insertAudit } from '$lib/server/audit';
import { type InlineConfigInput, inlineConfigColumns } from '$lib/server/inline-config';
import { getOrCreateDefaultService } from '$lib/server/services';

/**
 * A single machine token by id with its service and (own) policy names, or null.
 * Powers the token detail page. Revoked tokens — and tokens whose service was
 * since soft-deleted — are still returned so historical usage stays attributable
 * (the page links here straight from the usage breakdowns).
 */
export async function getToken(id: string) {
	const [row] = await db
		.select({
			id: machineToken.id,
			name: machineToken.name,
			display: machineToken.display,
			scopes: machineToken.scopes,
			serviceId: machineToken.serviceId,
			serviceName: service.name,
			// the token's own policy (overrides the service policy when set)
			policyId: machineToken.policyId,
			policyName: policy.name,
			// true when the raw token can be revealed again (see machineToken.encryptedToken)
			recopyable: sql<boolean>`${machineToken.encryptedToken} is not null`,
			lastUsedAt: machineToken.lastUsedAt,
			expiresAt: machineToken.expiresAt,
			revokedAt: machineToken.revokedAt,
			createdAt: machineToken.createdAt
		})
		.from(machineToken)
		.innerJoin(service, eq(service.id, machineToken.serviceId))
		.leftJoin(policy, eq(policy.id, machineToken.policyId))
		.where(eq(machineToken.id, id))
		.limit(1);
	return row ?? null;
}

export function listTokens() {
	return (
		db
			.select({
				id: machineToken.id,
				name: machineToken.name,
				display: machineToken.display,
				scopes: machineToken.scopes,
				allowedModels: machineToken.allowedModels,
				serviceId: machineToken.serviceId,
				serviceName: service.name,
				// the token's optional preset
				policyId: machineToken.policyId,
				policyName: policy.name,
				// inline overrides, for the edit form's prefill
				allowedProviders: machineToken.allowedProviders,
				preferredProvider: machineToken.preferredProvider,
				rateLimitPerMinute: machineToken.rateLimitPerMinute,
				dailyBudgetUsd: machineToken.dailyBudgetUsd,
				monthlyBudgetUsd: machineToken.monthlyBudgetUsd,
				cacheTtlSeconds: machineToken.cacheTtlSeconds,
				// true when the raw token was kept (encrypted) and can be revealed again;
				// the ciphertext itself is never sent to the client
				recopyable: sql<boolean>`${machineToken.encryptedToken} is not null`,
				lastUsedAt: machineToken.lastUsedAt,
				expiresAt: machineToken.expiresAt,
				revokedAt: machineToken.revokedAt,
				createdAt: machineToken.createdAt
			})
			.from(machineToken)
			.innerJoin(service, eq(service.id, machineToken.serviceId))
			.leftJoin(policy, eq(policy.id, machineToken.policyId))
			// hide tokens belonging to retired (soft-deleted) services
			.where(isNull(service.deletedAt))
			.orderBy(desc(machineToken.createdAt))
	);
}

/**
 * Create a machine token. Returns the row plus the one-time plaintext secret
 * which is NOT stored anywhere — surface it to the user immediately.
 */
export async function createToken(
	userId: string,
	input: {
		// optional: when omitted, the token lands in the auto-provisioned Default
		// service so tokens can be issued before any service is set up
		serviceId?: string | null;
		name: string;
		scopes?: string[];
		// per-token model allowlist (narrows access); empty = no extra restriction
		allowedModels?: string[];
		// optional reusable preset attached to this token; null = none
		policyId?: string | null;
		expiresAt?: Date | null;
		// when true, also store the raw token encrypted so it can be revealed again
		// later (weaker than hash-only — see machineToken.encryptedToken). Default off.
		recopyable?: boolean;
	} & Omit<InlineConfigInput, 'allowedModels'>
) {
	// resolve the target service: the one given (must exist and be active), or the
	// auto-provisioned Default when none was specified
	const svc = input.serviceId
		? (
				await db
					.select()
					.from(service)
					.where(and(eq(service.id, input.serviceId), isNull(service.deletedAt)))
					.limit(1)
			)[0]
		: await getOrCreateDefaultService();
	if (!svc) throw new Error('Service not found');

	const issued = issueToken();
	// The token and its audit entry commit together: a token that exists without
	// its creation record (or a record for a token that was never stored) would
	// break the audit trail's guarantee. insertAudit throws, so a failed audit
	// write rolls the token back instead of being swallowed.
	const row = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(machineToken)
			.values({
				serviceId: svc.id,
				name: input.name,
				display: issued.display,
				hashedToken: issued.hashedToken,
				// only persisted when the issuer opted into re-copying
				encryptedToken: input.recopyable ? encrypt(issued.plaintext) : null,
				scopes: input.scopes ?? [],
				allowedModels: input.allowedModels ?? [],
				policyId: input.policyId ?? null,
				expiresAt: input.expiresAt ?? null,
				createdByUserId: userId,
				...inlineConfigColumns({
					allowedProviders: input.allowedProviders,
					preferredProvider: input.preferredProvider,
					rateLimitPerMinute: input.rateLimitPerMinute,
					dailyBudgetUsd: input.dailyBudgetUsd,
					monthlyBudgetUsd: input.monthlyBudgetUsd,
					cacheTtlSeconds: input.cacheTtlSeconds
				})
			})
			.returning();
		if (!created) throw new Error('Token insert returned no row');

		await insertAudit(tx, {
			action: 'token.create',
			status: 'ok',
			serviceId: svc.id,
			tokenId: created.id,
			detail: input.name
		});

		return created;
	});

	return { token: row, plaintext: issued.plaintext };
}

/**
 * Re-reveal the raw secret of a re-copyable token. Only works for tokens issued
 * with `recopyable` (their `encryptedToken` is set); returns null otherwise — a
 * hash-only token's plaintext is genuinely unrecoverable. Each reveal is audited
 * so re-copies stay traceable. Revoked tokens can still be revealed (the row is
 * dead for auth, but an operator may need the old value).
 */
export async function revealToken(id: string): Promise<{ name: string; plaintext: string } | null> {
	const [row] = await db
		.select({
			id: machineToken.id,
			name: machineToken.name,
			serviceId: machineToken.serviceId,
			encryptedToken: machineToken.encryptedToken
		})
		.from(machineToken)
		.where(eq(machineToken.id, id))
		.limit(1);
	if (!row?.encryptedToken) return null;

	const plaintext = decrypt(row.encryptedToken);
	await audit({
		action: 'token.reveal',
		status: 'ok',
		serviceId: row.serviceId,
		tokenId: row.id,
		detail: row.name
	});
	return { name: row.name, plaintext };
}

/**
 * Edit a live token in place. Tokens are long-lived and their secret can't be
 * regenerated, so the access controls (scopes, model allowlist, policy) and the
 * display name are editable without reissuing. Only the fields present in
 * `patch` are written. Revoked tokens are left untouched.
 */
export async function updateToken(
	id: string,
	patch: {
		name?: string;
		// reassign the token to another service (e.g. move it out of Default once
		// the user organises their tokens into real services)
		serviceId?: string;
		scopes?: string[];
		allowedModels?: string[];
		policyId?: string | null;
	} & Omit<InlineConfigInput, 'allowedModels'>
) {
	const set: Partial<typeof machineToken.$inferInsert> = {};
	if (patch.name !== undefined) set.name = patch.name;
	if (patch.serviceId !== undefined) set.serviceId = patch.serviceId;
	if (patch.scopes !== undefined) set.scopes = patch.scopes;
	if (patch.allowedModels !== undefined) set.allowedModels = patch.allowedModels;
	if (patch.policyId !== undefined) set.policyId = patch.policyId;
	Object.assign(
		set,
		inlineConfigColumns({
			allowedProviders: patch.allowedProviders,
			preferredProvider: patch.preferredProvider,
			rateLimitPerMinute: patch.rateLimitPerMinute,
			dailyBudgetUsd: patch.dailyBudgetUsd,
			monthlyBudgetUsd: patch.monthlyBudgetUsd,
			cacheTtlSeconds: patch.cacheTtlSeconds
		})
	);
	if (Object.keys(set).length === 0) return null;

	const [row] = await db
		.update(machineToken)
		.set(set)
		.where(and(eq(machineToken.id, id), isNull(machineToken.revokedAt)))
		.returning();
	if (row) {
		await audit({
			action: 'token.update',
			status: 'ok',
			serviceId: row.serviceId,
			tokenId: row.id,
			detail: row.name
		});
	}
	return row ?? null;
}

export async function revokeToken(id: string) {
	const [row] = await db
		.update(machineToken)
		.set({ revokedAt: new Date() })
		.where(eq(machineToken.id, id))
		.returning();
	if (row) {
		await audit({
			action: 'token.revoke',
			status: 'ok',
			serviceId: row.serviceId,
			tokenId: row.id,
			detail: row.name
		});
	}
	return row ?? null;
}

// Permanently remove a token row. Unlike revokeToken this is irreversible —
// the audit_log.token_id FK is ON DELETE SET NULL, so history survives but loses
// the token link. The audit record we write here therefore omits tokenId (the row
// is already gone) and keeps the name in detail for traceability.
export async function deleteToken(id: string) {
	const [row] = await db.delete(machineToken).where(eq(machineToken.id, id)).returning();
	if (row) {
		await audit({
			action: 'token.delete',
			status: 'ok',
			serviceId: row.serviceId,
			detail: row.name
		});
	}
	return row ?? null;
}

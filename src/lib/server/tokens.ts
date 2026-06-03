import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '$lib/server/db';
import { machineToken, service, policy, settings } from '$lib/server/db/schema';
import { sha256 } from '$lib/server/crypto';

export const TOKEN_PREFIX = 'uprox_live_';

export interface IssuedToken {
	/** The raw secret — shown to the user exactly once, never stored. */
	plaintext: string;
	/** Non-secret display string, safe to persist and render. */
	display: string;
	/** sha256 of the plaintext — what we store. */
	hashedToken: string;
}

/**
 * Mint a new opaque machine token. We generate 32 random bytes, base64url
 * them behind a recognizable prefix, and only ever persist the sha256 hash.
 */
export function issueToken(): IssuedToken {
	const secret = randomBytes(32).toString('base64url');
	const plaintext = `${TOKEN_PREFIX}${secret}`;
	return {
		plaintext,
		display: `${TOKEN_PREFIX}${secret.slice(0, 6)}…${secret.slice(-4)}`,
		hashedToken: sha256(plaintext)
	};
}

export interface ResolvedToken {
	tokenId: string;
	serviceId: string;
	serviceName: string;
	scopes: string[];
	/**
	 * Per-token model allowlist that narrows the effective policy (intersection —
	 * a model must satisfy both this and the policy). Empty = no extra restriction.
	 */
	allowedModels: string[];
	/** the upstream secret this service is pinned to, or null for the default */
	providerSecretId: string | null;
	/**
	 * The policy in force for this token: the token's own policy when it has one
	 * (it replaces the service policy), otherwise the service's policy, or null.
	 */
	policy: typeof policy.$inferSelect | null;
	/** instance-wide default cache TTL (seconds); policy.cacheTtlSeconds overrides it */
	defaultCacheTtlSeconds: number;
}

/**
 * Look up an active machine token by its raw value and resolve the service +
 * policy it grants access to. Returns null when the token is unknown, revoked,
 * or expired. Updates `lastUsedAt` as a side effect on success.
 */
export async function resolveToken(plaintext: string): Promise<ResolvedToken | null> {
	if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
	const hashed = sha256(plaintext);

	// Two policy joins: the service's policy and the token's own policy. The
	// token's policy, when set, replaces the service's for this request.
	const tokenPolicy = alias(policy, 'token_policy');
	const rows = await db
		.select({
			token: machineToken,
			service: service,
			servicePolicy: policy,
			tokenPolicy: tokenPolicy
		})
		.from(machineToken)
		.innerJoin(service, eq(service.id, machineToken.serviceId))
		.leftJoin(policy, eq(policy.id, service.policyId))
		.leftJoin(tokenPolicy, eq(tokenPolicy.id, machineToken.policyId))
		// reject tokens of a retired (soft-deleted) service, even if a token row
		// somehow outlived deleteService's revoke step
		.where(
			and(
				eq(machineToken.hashedToken, hashed),
				isNull(machineToken.revokedAt),
				isNull(service.deletedAt)
			)
		)
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	if (row.token.expiresAt && row.token.expiresAt.getTime() < Date.now()) {
		return null;
	}

	// instance-wide default cache TTL from the singleton settings row
	const [settingsRow] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);

	// best-effort last-used bookkeeping; don't block the request on it
	void db
		.update(machineToken)
		.set({ lastUsedAt: new Date() })
		.where(eq(machineToken.id, row.token.id))
		.catch(() => {});

	return {
		tokenId: row.token.id,
		serviceId: row.service.id,
		serviceName: row.service.name,
		scopes: row.token.scopes ?? [],
		allowedModels: row.token.allowedModels ?? [],
		providerSecretId: row.service.providerSecretId,
		// the token's own policy wins; fall back to the service's policy
		policy: row.tokenPolicy ?? row.servicePolicy,
		defaultCacheTtlSeconds: settingsRow?.cacheTtlSeconds ?? 0
	};
}

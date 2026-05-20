import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { machineToken, service, policy, orgSettings } from '$lib/server/db/schema';
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
	organizationId: string;
	serviceId: string;
	serviceName: string;
	scopes: string[];
	policy: typeof policy.$inferSelect | null;
	/** org-wide default cache TTL (seconds); policy.cacheTtlSeconds overrides it */
	orgCacheTtlSeconds: number;
}

/**
 * Look up an active machine token by its raw value and resolve the service +
 * policy it grants access to. Returns null when the token is unknown, revoked,
 * or expired. Updates `lastUsedAt` as a side effect on success.
 */
export async function resolveToken(plaintext: string): Promise<ResolvedToken | null> {
	if (!plaintext.startsWith(TOKEN_PREFIX)) return null;
	const hashed = sha256(plaintext);

	const rows = await db
		.select({
			token: machineToken,
			service: service,
			policy: policy,
			orgSettings: orgSettings
		})
		.from(machineToken)
		.innerJoin(service, eq(service.id, machineToken.serviceId))
		.leftJoin(policy, eq(policy.id, service.policyId))
		.leftJoin(orgSettings, eq(orgSettings.organizationId, machineToken.organizationId))
		.where(and(eq(machineToken.hashedToken, hashed), isNull(machineToken.revokedAt)))
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	if (row.token.expiresAt && row.token.expiresAt.getTime() < Date.now()) {
		return null;
	}

	// best-effort last-used bookkeeping; don't block the request on it
	void db
		.update(machineToken)
		.set({ lastUsedAt: new Date() })
		.where(eq(machineToken.id, row.token.id))
		.catch(() => {});

	return {
		tokenId: row.token.id,
		organizationId: row.token.organizationId,
		serviceId: row.service.id,
		serviceName: row.service.name,
		scopes: row.token.scopes ?? [],
		policy: row.policy,
		orgCacheTtlSeconds: row.orgSettings?.cacheTtlSeconds ?? 0
	};
}

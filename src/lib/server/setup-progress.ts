/** How far an org has got through setting up the gateway, for onboarding hints. */
import { isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { machineToken, providerSecret } from '$lib/server/db/schema';

export interface SetupProgress {
	providerKeys: number;
	activeTokens: number;
}

/** Counts of the two prerequisites for a first proxied request. */
export async function setupProgress(): Promise<SetupProgress> {
	const [[keys], [tokens]] = await Promise.all([
		db.select({ count: sql<number>`count(*)::int` }).from(providerSecret),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(machineToken)
			.where(isNull(machineToken.revokedAt))
	]);
	return { providerKeys: Number(keys?.count ?? 0), activeTokens: Number(tokens?.count ?? 0) };
}

/**
 * `/app?setup` keeps the setup checklist reachable after traffic exists, so the
 * cost analysis can link to it on an empty window without bouncing straight back.
 */
export const SETUP_CHECKLIST_PARAM = 'setup';

/**
 * Where `/app` should send the operator instead of the checklist: always the
 * cost analysis, the start page even on a fresh instance (its empty state links
 * back here), unless the checklist was asked for explicitly. Null keeps them on
 * the checklist.
 */
export function setupChecklistRedirect(url: URL): '/app/usage' | null {
	return url.searchParams.has(SETUP_CHECKLIST_PARAM) ? null : '/app/usage';
}

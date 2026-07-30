import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import { getToken, revealToken } from '$lib/server/data';
import { loadUsageAnalysis } from '$lib/server/usage-analysis';

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const token = await getToken(event.params.id);
	if (!token) error(404, 'Token not found');

	// Same cost-analysis workbench the org page renders, scoped to this token.
	// `service` and `token` are dropped: a token belongs to exactly one service
	// and is itself the scope, so both would collapse to a single row.
	const analysis = await loadUsageAnalysis(event, {
		tokenId: token.id,
		dimensions: ['model', 'provider', 'status'],
		donutDims: ['model', 'provider', 'status']
	});

	return {
		token: {
			id: token.id,
			name: token.name,
			display: token.display,
			scopes: token.scopes,
			serviceId: token.serviceId,
			serviceName: token.serviceName,
			policyId: token.policyId,
			policyName: token.policyName,
			recopyable: token.recopyable,
			createdAt: token.createdAt,
			lastUsedAt: token.lastUsedAt,
			expiresAt: token.expiresAt,
			revokedAt: token.revokedAt
		},
		...analysis
	};
};

export const actions: Actions = {
	reveal: async (event) => {
		await requirePermission(event, 'tokens:manage');
		const revealed = await revealToken(event.params.id);
		if (!revealed) return fail(400, { message: 'This token cannot be re-copied' });
		return { revealed };
	}
};

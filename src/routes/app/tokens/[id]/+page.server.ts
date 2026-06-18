import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireOrg, requirePermission } from '$lib/server/org';
import {
	getToken,
	revealToken,
	orgUsageByModel,
	orgUsageByProvider,
	orgUsageTotals,
	orgUsageSeries
} from '$lib/server/data';
import {
	USAGE_RANGES,
	resolveUsageRange,
	resolveSeriesBucket,
	normalizeBucket,
	shiftRangeBack
} from '$lib/usage-range';

const DAY_MS = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Default top-N for the breakdown tables; surfaced so the page can flag truncation. */
const BREAKDOWN_LIMIT = 50;

export const load: PageServerLoad = async (event) => {
	await requireOrg(event);
	const token = await getToken(event.params.id);
	if (!token) error(404, 'Token not found');

	const params = event.url.searchParams;
	const range = resolveUsageRange(params.get('range'), {
		from: params.get('from'),
		to: params.get('to')
	});
	const tokenId = token.id;
	const bucket = normalizeBucket(params.get('bucket'));
	const unit = resolveSeriesBucket(range, bucket);
	const prevRange = shiftRangeBack(range);

	// No by-service/by-token breakdowns here — a token belongs to exactly one
	// service, so those views collapse to a single row. Model and provider are the
	// dimensions that still vary within one token's traffic.
	const [totals, prevTotals, byModel, byProvider, series, prevSeries] = await Promise.all([
		orgUsageTotals(range, { tokenId }),
		// previous equal-length window — powers the headline deltas
		orgUsageTotals(prevRange, { tokenId }),
		orgUsageByModel(range, { tokenId, limit: BREAKDOWN_LIMIT }),
		orgUsageByProvider(range, { tokenId }),
		orgUsageSeries(range, { tokenId, unit }),
		orgUsageSeries(prevRange, { tokenId, unit })
	]);

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
		range: range.key,
		ranges: USAGE_RANGES,
		bucket,
		breakdownLimit: BREAKDOWN_LIMIT,
		customFrom: range.key === 'custom' ? ymd(range.start) : null,
		customTo:
			range.key === 'custom' && range.end ? ymd(new Date(range.end.getTime() - DAY_MS)) : null,
		totals,
		prevTotals,
		byModel,
		byProvider,
		series,
		prevPoints: prevSeries.points
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

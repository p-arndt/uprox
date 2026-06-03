import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireOrgApi, requirePermission } from '$lib/server/org';
import { listEffectiveModelPrices, createOrgModelPrice } from '$lib/server/pricing';

export const GET: RequestHandler = async (event) => {
	await requireOrgApi(event);
	return json(await listEffectiveModelPrices());
};

export const POST: RequestHandler = async (event) => {
	await requirePermission(event, 'pricing:manage');
	const body = await event.request.json();
	if (!body?.model) return json({ error: 'model is required' }, { status: 400 });
	const inputPerMtok = Number(body.inputPerMtok);
	const outputPerMtok = Number(body.outputPerMtok);
	if (
		!Number.isFinite(inputPerMtok) ||
		!Number.isFinite(outputPerMtok) ||
		inputPerMtok < 0 ||
		outputPerMtok < 0
	)
		return json(
			{ error: 'inputPerMtok and outputPerMtok must be non-negative numbers' },
			{ status: 400 }
		);
	// Optional provider prompt-cache rates: omitted/null leaves the input-price
	// multiplier fallback in charge; a present value must be a non-negative number.
	const parseOptional = (v: unknown): number | null | undefined => {
		if (v === undefined || v === null || v === '') return undefined;
		const n = Number(v);
		return Number.isFinite(n) && n >= 0 ? n : null;
	};
	const cacheReadPerMtok = parseOptional(body.cacheReadPerMtok);
	const cacheWritePerMtok = parseOptional(body.cacheWritePerMtok);
	if (cacheReadPerMtok === null || cacheWritePerMtok === null)
		return json(
			{ error: 'cacheReadPerMtok and cacheWritePerMtok must be non-negative numbers' },
			{ status: 400 }
		);
	const row = await createOrgModelPrice({
		model: String(body.model),
		provider: body.provider ? String(body.provider) : null,
		inputPerMtok,
		outputPerMtok,
		cacheReadPerMtok,
		cacheWritePerMtok
	});
	return json(row, { status: 201 });
};

/** The upstream HTTP exchange and its audited failure handling. */
import type { ProviderDef } from '$lib/server/providers';
import { reject, type RequestContext } from './context';
import type { UpstreamGrant } from './guards';

/**
 * Audit a failed upstream exchange (network error, reset mid-body, or the client
 * going away) and build the 502. A client abort is recorded as 499 so it isn't
 * mistaken for a provider outage.
 */
function upstreamFailure(
	ctx: RequestContext,
	provider: ProviderDef,
	err: unknown
): Promise<Response> {
	const aborted = ctx.event.request.signal.aborted;
	return reject(
		ctx,
		{
			provider: provider.id,
			statusCode: aborted ? 499 : 502,
			detail: aborted
				? 'client closed request'
				: err instanceof Error
					? err.message
					: 'upstream fetch failed',
			timed: true
		},
		ctx.envelope.error(502, 'Upstream provider request failed', 'upstream_unavailable')
	);
}

/**
 * Call the upstream, tied to the client request's abort signal so an abandoned
 * request stops the upstream call. A failure releases the reservation, is
 * audited and comes back as a 502 in the caller's envelope.
 */
export async function fetchUpstream(
	ctx: RequestContext,
	provider: ProviderDef,
	grant: UpstreamGrant,
	url: string,
	init: RequestInit
): Promise<{ ok: true; upstream: Response } | { ok: false; response: Response }> {
	try {
		return {
			ok: true,
			upstream: await fetch(url, { ...init, signal: ctx.event.request.signal })
		};
	} catch (err) {
		grant.release();
		return { ok: false, response: await upstreamFailure(ctx, provider, err) };
	}
}

/**
 * Read a buffered upstream body. A body that fails mid-read releases the
 * reservation, is audited and becomes a 502 instead of an unhandled error.
 */
export async function readUpstreamText(
	ctx: RequestContext,
	provider: ProviderDef,
	grant: UpstreamGrant,
	upstream: Response
): Promise<string | Response> {
	try {
		return await upstream.text();
	} catch (err) {
		grant.release();
		return upstreamFailure(ctx, provider, err);
	}
}

/** Pure derivations for the session trace page. */

/** A call's display name: its model, else its action without the `gateway.` prefix. */
export const callLabel = (c: { model?: string | null; action?: string | null }): string =>
	c.model || c.action?.replace(/^gateway\./, '') || 'request';

interface CallTotalsInput {
	costUsd?: string | number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	serviceName?: string | null;
}

/** Summed cost and tokens across a session's calls, plus the first known service name. */
export function sessionTotals(calls: CallTotalsInput[]) {
	return {
		cost: calls.reduce((s, c) => s + Number(c.costUsd ?? 0), 0),
		tokensIn: calls.reduce((s, c) => s + (c.inputTokens ?? 0), 0),
		tokensOut: calls.reduce((s, c) => s + (c.outputTokens ?? 0), 0),
		serviceName: calls.find((c) => c.serviceName)?.serviceName ?? null
	};
}

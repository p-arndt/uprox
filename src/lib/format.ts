/** Shared display formatting helpers for the dashboard. */

export function formatDateTime(value: Date | string | null | undefined): string {
	if (!value) return '—';
	const d = typeof value === 'string' ? new Date(value) : value;
	return d.toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
}

export function relativeTime(value: Date | string | null | undefined): string {
	if (!value) return 'never';
	const d = typeof value === 'string' ? new Date(value) : value;
	const diff = Date.now() - d.getTime();
	const sec = Math.round(diff / 1000);
	if (sec < 60) return 'just now';
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.round(hr / 24);
	if (day < 30) return `${day}d ago`;
	return formatDateTime(d);
}

/**
 * Format an LLM token count compactly (e.g. 1.2M, 47.3K, 812). LLM usage adds
 * up fast — tens of millions of tokens are routine for a busy service — so the
 * raw "12,485,201" reads as wall-of-digits in tight UI. Falls back to a plain
 * locale string below 10k where precision is still useful.
 */
export function formatTokens(value: number | string | null | undefined): string {
	const n = typeof value === 'string' ? Number(value) : (value ?? 0);
	if (!Number.isFinite(n) || n === 0) return '0';
	const abs = Math.abs(n);
	if (abs < 10_000) return n.toLocaleString();
	return n.toLocaleString(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1
	});
}

export function formatUsd(value: number | string | null | undefined): string {
	const n = typeof value === 'string' ? Number(value) : (value ?? 0);
	const abs = Math.abs(n || 0);
	// Sub-cent costs (e.g. a handful of gpt-5.4-nano tokens) would round to
	// "$0.00" at 4 decimals, so widen precision the smaller the amount gets.
	let maximumFractionDigits = 4;
	if (abs > 0 && abs < 0.0001) maximumFractionDigits = 8;
	else if (abs > 0 && abs < 0.01) maximumFractionDigits = 6;
	return `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits })}`;
}

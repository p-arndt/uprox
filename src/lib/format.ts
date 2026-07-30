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
/**
 * Every figure in the dashboard is pinned to en-US, matching {@link formatUsd}.
 * The viewer's own locale is deliberately NOT used: these numbers sit inline
 * with USD amounts, and a German or French browser would otherwise render
 * "2,3 Mio." and "1.100" in the same card as "$11.57" — three different
 * conventions for decimal and grouping separators in one glance.
 */
const LOCALE = 'en-US';

export function formatTokens(value: number | string | null | undefined): string {
	const n = typeof value === 'string' ? Number(value) : (value ?? 0);
	if (!Number.isFinite(n) || n === 0) return '0';
	const abs = Math.abs(n);
	if (abs < 10_000) return n.toLocaleString(LOCALE);
	return n.toLocaleString(LOCALE, {
		notation: 'compact',
		maximumFractionDigits: 1
	});
}

/**
 * A plain integer count (requests, denials, errors) with thousands separators.
 * Use instead of a bare `.toLocaleString()` so counts can't drift to the
 * viewer's locale while the currency beside them stays en-US.
 */
export function formatCount(value: number | string | null | undefined): string {
	const n = typeof value === 'string' ? Number(value) : (value ?? 0);
	if (!Number.isFinite(n)) return '0';
	return Math.round(n).toLocaleString(LOCALE);
}

/** Compact count for axis ticks and other tight spots (12.5K, 3.1M). */
export function formatCountCompact(value: number | string | null | undefined): string {
	const n = typeof value === 'string' ? Number(value) : (value ?? 0);
	if (!Number.isFinite(n)) return '0';
	if (Math.abs(n) < 10_000) return formatCount(n);
	return n.toLocaleString(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
}

/** A 0–1 ratio as a percentage string. */
export function formatPct(ratio: number, digits = 1): string {
	if (!Number.isFinite(ratio)) return '—';
	return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatUsd(value: number | string | null | undefined): string {
	const n = typeof value === 'string' ? Number(value) : (value ?? 0);
	const abs = Math.abs(n || 0);
	// Precision scales inversely with magnitude. A per-token price of $0.000483
	// needs every digit; a $155.56 monthly total does not, and showing it as
	// "$155.5646" reads as false precision on a figure that is already an
	// estimate. Anything at or above a dollar is therefore plain cents.
	let maximumFractionDigits = 2;
	if (abs > 0 && abs < 0.0001) maximumFractionDigits = 8;
	else if (abs > 0 && abs < 0.01) maximumFractionDigits = 6;
	else if (abs < 1) maximumFractionDigits = 4;
	// Pin to en-US so USD always reads with a dot decimal ("$0.000483", not the
	// "$0,000483" a comma-decimal locale would produce next to the `$` symbol).
	return `$${(n || 0).toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits })}`;
}

/**
 * USD condensed for tight contexts (axis ticks, legend entries) where the exact
 * cents matter less than the magnitude: $1.2M, $12.5K, $155.56.
 */
export function formatUsdCompact(value: number | string | null | undefined): string {
	const n = typeof value === 'string' ? Number(value) : (value ?? 0);
	if (!Number.isFinite(n)) return '$0';
	if (Math.abs(n) >= 10_000) {
		return `$${n.toLocaleString(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })}`;
	}
	return formatUsd(n);
}

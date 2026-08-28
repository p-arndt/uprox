/**
 * Sticky time window for the cost-analysis pages.
 *
 * The range/granularity controls are URL state (shareable, survives reload, Back
 * walks the history), but that only helps while you stay on the page: opening
 * /app/usage fresh — from the sidebar, a bookmark, a new tab — always landed on
 * the "today" default, so an operator who works in monthly figures re-picked the
 * month every single visit.
 *
 * So the last applied window is mirrored into a cookie and used as the default
 * whenever the URL carries no `range` param. It is per browser session cookie
 * rather than a row on the user, which keeps the whole feature migration-free
 * while still being per-user in practice (each operator has their own browser),
 * and it never overrides an explicit URL — a shared link still opens the window
 * it names.
 */

import type { Cookies } from '@sveltejs/kit';
import {
	normalizeBucket,
	normalizeRangeKey,
	type BucketChoice,
	type ResolvedRangeKey
} from '$lib/usage-range';

export const USAGE_WINDOW_COOKIE = 'uprox_usage_window';

/** A year: this is a UI preference, so it should outlive a login session. */
const MAX_AGE = 60 * 60 * 24 * 365;

export interface UsageWindowPref {
	range: ResolvedRangeKey;
	/** inclusive custom bounds (YYYY-MM-DD), only set when range === 'custom' */
	from: string | null;
	to: string | null;
	bucket: BucketChoice;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (v: unknown): string | null => (typeof v === 'string' && DATE_RE.test(v) ? v : null);

/**
 * Parse a stored window, returning null when the cookie is absent or unusable.
 * Every field is re-normalized on the way out: the cookie is client-writable, so
 * it is treated exactly like a query param.
 */
export function parseUsageWindow(raw: string | undefined): UsageWindowPref | null {
	if (!raw) return null;
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!data || typeof data !== 'object') return null;
	const o = data as Record<string, unknown>;

	const bucket = normalizeBucket(typeof o.bucket === 'string' ? o.bucket : null);
	if (o.range === 'custom') {
		const from = asDate(o.from);
		const to = asDate(o.to);
		// a half-written custom window can't be resolved, so it is not worth storing
		if (!from || !to) return null;
		return { range: 'custom', from, to, bucket };
	}
	// normalizeRangeKey coerces anything unknown to the default preset, which
	// would make a junk cookie indistinguishable from a real choice
	if (typeof o.range !== 'string' || normalizeRangeKey(o.range) !== o.range) return null;
	return { range: normalizeRangeKey(o.range), from: null, to: null, bucket };
}

export function readUsageWindow(cookies: Cookies): UsageWindowPref | null {
	return parseUsageWindow(cookies.get(USAGE_WINDOW_COOKIE));
}

function sameWindow(a: UsageWindowPref | null, b: UsageWindowPref): boolean {
	return !!a && a.range === b.range && a.from === b.from && a.to === b.to && a.bucket === b.bucket;
}

/** Persist the applied window, skipping the Set-Cookie when nothing changed. */
export function writeUsageWindow(
	cookies: Cookies,
	pref: UsageWindowPref,
	current: UsageWindowPref | null
): void {
	if (sameWindow(current, pref)) return;
	cookies.set(USAGE_WINDOW_COOKIE, JSON.stringify(pref), {
		path: '/',
		maxAge: MAX_AGE,
		sameSite: 'lax',
		// read on the server only; no need to expose it to scripts
		httpOnly: true
	});
}

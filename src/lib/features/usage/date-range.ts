/**
 * The one formatter for date ranges on the usage pages: the custom-range label,
 * the range picker's button and the "compared with" tooltips all read the same
 * way. Dates are the viewer's locale (unlike the figures, which stay en-US, see
 * format.ts) because a date is read, not reconciled against a column of numbers.
 *
 * Everything is formatted in UTC: the windows are UTC-aligned (see range.ts), and
 * rendering them in local time would shift a "Jan 1 – Jan 31" custom range to
 * "Dec 31 – Jan 30" for anyone west of Greenwich.
 */

const DAY_MS = 86_400_000;

function parseYmd(value: string): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!m) return null;
	return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fmt(locale: string | undefined, opts: Intl.DateTimeFormatOptions) {
	return new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' });
}

/**
 * An inclusive span of calendar days (`YYYY-MM-DD`), e.g. "Jan 1 – 31, 2026".
 * Falls back to the raw strings when either bound is malformed, so a hand-edited
 * URL still renders something recognisable.
 */
export function formatDayRange(from: string, to: string, locale?: string): string {
	const start = parseYmd(from);
	const end = parseYmd(to);
	if (!start || !end) return `${from} – ${to}`;
	const f = fmt(locale, { dateStyle: 'medium' });
	return start.getTime() === end.getTime() ? f.format(start) : f.formatRange(start, end);
}

/**
 * A resolved window given as ISO instants with an exclusive end. Day-aligned
 * windows read as calendar days (the exclusive end becomes the last included
 * day); anything else — a rolling "last 24h" — needs the time of day to say
 * which 24 hours it was.
 */
export function formatWindow(startIso: string, endIso: string, locale?: string): string {
	const start = new Date(startIso);
	const end = new Date(endIso);
	if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
	const dayAligned = start.getTime() % DAY_MS === 0 && end.getTime() % DAY_MS === 0;
	if (dayAligned && end > start) {
		const last = new Date(end.getTime() - DAY_MS);
		const f = fmt(locale, { dateStyle: 'medium' });
		return last.getTime() === start.getTime() ? f.format(start) : f.formatRange(start, last);
	}
	return `${fmt(locale, { dateStyle: 'medium', timeStyle: 'short' }).formatRange(start, end)} UTC`;
}

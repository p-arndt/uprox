/**
 * Small FormData field parsers shared by the route actions. Each takes the raw
 * `data.get(name)` value so call sites stay one-liners.
 */

type Field = FormDataEntryValue | null;

/** A checkbox (`on`) or a hidden boolean mirror (`true`). */
export function isOn(value: Field): boolean {
	return value === 'on' || value === 'true';
}

/** A required non-negative number; `null` when blank or invalid. */
export function parsePrice(value: Field): number | null {
	const n = Number(value?.toString().trim());
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * An optional non-negative number: `undefined` when left blank, the number when
 * valid, or `null` when present but not a non-negative number (a validation error).
 */
export function parseOptionalPrice(value: Field): number | null | undefined {
	const s = value?.toString().trim();
	if (!s) return undefined;
	const n = Number(s);
	return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A priority field as a finite integer, defaulting to 0. */
export function parsePriority(value: Field): number {
	const n = Number.parseInt(value?.toString() ?? '', 10);
	return Number.isFinite(n) ? n : 0;
}

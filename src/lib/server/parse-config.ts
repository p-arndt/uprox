/**
 * Parse the inline limit & access fields out of an untyped request body (JSON
 * PATCH or a form-action payload) into an {@link InlineConfigInput}. Only keys
 * actually present in the body are returned, so the result composes with the
 * PATCH "update only what's sent" semantics in updateService / updateToken.
 *
 * Tri-state convention shared with the UI: a field that is absent means "leave
 * unchanged", an explicit `null`/`''` means "clear the override (inherit)", and
 * any other value sets the override. An empty array is a real value — "allow
 * all" — distinct from `null` (inherit).
 */
import type { InlineConfigInput } from '$lib/server/inline-config';

function parseArray(v: unknown): string[] | null | undefined {
	if (v === undefined) return undefined;
	if (v === null) return null;
	if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
	return undefined;
}

function parseNum(v: unknown): number | null | undefined {
	if (v === undefined) return undefined;
	if (v === null || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseStr(v: unknown): string | null | undefined {
	if (v === undefined) return undefined;
	if (v === null || v === '') return null;
	return String(v);
}

export function parseInlineConfig(
	body: Record<string, unknown>,
	opts: { includeModels: true }
): InlineConfigInput;
export function parseInlineConfig(
	body: Record<string, unknown>,
	opts?: { includeModels?: false }
): Omit<InlineConfigInput, 'allowedModels'>;
export function parseInlineConfig(
	body: Record<string, unknown>,
	opts: { includeModels?: boolean } = {}
): InlineConfigInput {
	const out: InlineConfigInput = {};
	const set = <K extends keyof InlineConfigInput>(k: K, v: InlineConfigInput[K] | undefined) => {
		if (v !== undefined) out[k] = v;
	};

	set('allowedProviders', parseArray(body.allowedProviders));
	if (opts.includeModels) set('allowedModels', parseArray(body.allowedModels));
	set('preferredProvider', parseStr(body.preferredProvider));
	set('rateLimitPerMinute', parseNum(body.rateLimitPerMinute));
	set('dailyBudgetUsd', parseNum(body.dailyBudgetUsd));
	set('monthlyBudgetUsd', parseNum(body.monthlyBudgetUsd));
	set('cacheTtlSeconds', parseNum(body.cacheTtlSeconds));
	return out;
}

/** Split a comma-separated form field (e.g. model patterns) into a clean list. */
export function splitList(raw: FormDataEntryValue | null): string[] {
	return (raw?.toString() ?? '')
		.split(',')
		.map((m) => m.trim())
		.filter(Boolean);
}

/**
 * Pull the inline limit & access fields out of a form submission (the shared
 * inline-limits-fields component). `allowedModels` is a comma-separated text
 * field and is only read when `includeModels` is set.
 */
export function inlineFromForm(data: FormData, opts: { includeModels: true }): InlineConfigInput;
export function inlineFromForm(
	data: FormData,
	opts?: { includeModels?: false }
): Omit<InlineConfigInput, 'allowedModels'>;
export function inlineFromForm(
	data: FormData,
	opts: { includeModels?: boolean } = {}
): InlineConfigInput {
	const body = {
		allowedProviders: data.getAll('allowedProviders').map((p) => p.toString()),
		allowedModels: opts.includeModels ? splitList(data.get('allowedModels')) : undefined,
		preferredProvider: data.get('preferredProvider'),
		rateLimitPerMinute: data.get('rateLimitPerMinute'),
		dailyBudgetUsd: data.get('dailyBudgetUsd'),
		monthlyBudgetUsd: data.get('monthlyBudgetUsd'),
		cacheTtlSeconds: data.get('cacheTtlSeconds')
	};
	return opts.includeModels
		? parseInlineConfig(body, { includeModels: true })
		: parseInlineConfig(body);
}

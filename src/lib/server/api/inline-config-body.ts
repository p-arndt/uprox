/**
 * JSON parsing of the inline limit & access overrides shared by services and
 * tokens. Same tri-state convention as parse-config.ts (absent = unchanged,
 * null = inherit), but invalid values are rejected with a 400 instead of being
 * silently dropped. `allowedModels` is parsed by the caller because its column
 * differs between services (nullable) and tokens (non-null).
 */
import type { InlineConfigInput } from '$lib/server/inline-config';
import {
	definedOnly,
	optionalNumber,
	optionalString,
	optionalStringArray,
	type JsonBody
} from '$lib/server/api/fields';
import { badRequest } from '$lib/server/api/errors';
import { modelPatternsError } from '$lib/model-patterns';

/** Passes a parsed model allowlist through, rejecting patterns the matcher can't honor. */
export function checkedModelPatterns<T extends string[] | null | undefined>(list: T): T {
	const err = list ? modelPatternsError(list) : null;
	if (err) throw badRequest(err, 'allowedModels');
	return list;
}

export type InlineConfigBody = Omit<InlineConfigInput, 'allowedModels'>;

export function parseInlineConfigBody(body: JsonBody): InlineConfigBody {
	return definedOnly<InlineConfigBody>({
		allowedProviders: optionalStringArray(body, 'allowedProviders'),
		preferredProvider: optionalString(body, 'preferredProvider'),
		rateLimitPerMinute: optionalNumber(body, 'rateLimitPerMinute', { integer: true }),
		dailyBudgetUsd: optionalNumber(body, 'dailyBudgetUsd'),
		monthlyBudgetUsd: optionalNumber(body, 'monthlyBudgetUsd'),
		cacheTtlSeconds: optionalNumber(body, 'cacheTtlSeconds', { integer: true })
	});
}

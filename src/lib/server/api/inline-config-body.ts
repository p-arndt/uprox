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

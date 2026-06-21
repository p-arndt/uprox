import { describe, it, expect } from 'vitest';
import { resolveEffectiveConfig, type ResolveInput } from '$lib/server/effective-config';

// Loose row builders — resolveEffectiveConfig only reads the config columns, so
// we cast partial literals to the row types to keep the cases readable.
const svc = (over: Record<string, unknown> = {}) =>
	({
		allowedProviders: null,
		allowedModels: null,
		preferredProvider: null,
		rateLimitPerMinute: null,
		dailyBudgetUsd: null,
		monthlyBudgetUsd: null,
		cacheTtlSeconds: null,
		tracingEnabled: null,
		...over
	}) as unknown as ResolveInput['service'];

const tok = (over: Record<string, unknown> = {}) =>
	({
		allowedModels: [],
		allowedProviders: null,
		preferredProvider: null,
		rateLimitPerMinute: null,
		dailyBudgetUsd: null,
		monthlyBudgetUsd: null,
		cacheTtlSeconds: null,
		tracingEnabled: null,
		...over
	}) as unknown as ResolveInput['token'];

const preset = (over: Record<string, unknown> = {}) =>
	({
		allowedProviders: [],
		allowedModels: [],
		preferredProvider: null,
		rateLimitPerMinute: 0,
		dailyBudgetUsd: '0',
		monthlyBudgetUsd: '0',
		cacheTtlSeconds: null,
		tracingEnabled: null,
		...over
	}) as unknown as NonNullable<ResolveInput['tokenPolicy']>;

const defaults = {
	cacheTtlSeconds: 60,
	tracingEnabled: false,
	dailyBudgetUsd: 0,
	monthlyBudgetUsd: 0
};

const resolve = (over: Partial<ResolveInput> = {}) =>
	resolveEffectiveConfig({
		token: tok(),
		service: svc(),
		tokenPolicy: null,
		servicePolicy: null,
		defaults,
		...over
	});

describe('scalar override cascade (first defined wins)', () => {
	it('falls back to the instance default when nothing is set', () => {
		const eff = resolve();
		expect(eff.rateLimitPerMinute).toBe(0);
		expect(eff.cacheTtlSeconds).toBe(60);
		expect(eff.tracingEnabled).toBe(false);
	});

	it('a service inline value overrides its preset and the default', () => {
		const eff = resolve({
			service: svc({ rateLimitPerMinute: 30 }),
			servicePolicy: preset({ rateLimitPerMinute: 99 })
		});
		expect(eff.rateLimitPerMinute).toBe(30);
	});

	it('a token inline value outranks everything below it', () => {
		const eff = resolve({
			token: tok({ rateLimitPerMinute: 10 }),
			tokenPolicy: preset({ rateLimitPerMinute: 20 }),
			service: svc({ rateLimitPerMinute: 30 }),
			servicePolicy: preset({ rateLimitPerMinute: 40 })
		});
		expect(eff.rateLimitPerMinute).toBe(10);
	});

	it('a token preset outranks the service layers', () => {
		const eff = resolve({
			tokenPolicy: preset({ rateLimitPerMinute: 20 }),
			service: svc({ rateLimitPerMinute: 30 })
		});
		expect(eff.rateLimitPerMinute).toBe(20);
	});

	it('treats an explicit 0 as a real override (unlimited), not "unset"', () => {
		const eff = resolve({
			token: tok({ rateLimitPerMinute: 0 }),
			service: svc({ rateLimitPerMinute: 30 })
		});
		expect(eff.rateLimitPerMinute).toBe(0);
	});

	it('cache TTL of 0 (force off) overrides the non-zero instance default', () => {
		const eff = resolve({ service: svc({ cacheTtlSeconds: 0 }) });
		expect(eff.cacheTtlSeconds).toBe(0);
	});

	it('tracing false overrides a true coming from a lower layer', () => {
		const eff = resolve({
			token: tok({ tracingEnabled: false }),
			service: svc({ tracingEnabled: true })
		});
		expect(eff.tracingEnabled).toBe(false);
	});
});

describe('allowlist intersection', () => {
	it('collects only the non-empty lists across all layers', () => {
		const eff = resolve({
			token: tok({ allowedModels: ['gpt-4o'] }),
			service: svc({ allowedModels: [] }), // empty contributes nothing
			servicePolicy: preset({ allowedModels: ['gpt-4o', 'gpt-4o-mini'] })
		});
		expect(eff.modelLists).toEqual([['gpt-4o'], ['gpt-4o', 'gpt-4o-mini']]);
	});

	it('produces no lists when every layer is empty/null (allow all)', () => {
		expect(resolve().modelLists).toEqual([]);
		expect(resolve().providerLists).toEqual([]);
	});
});

describe('dual budgets', () => {
	it('resolves the token bucket from token inline then token preset', () => {
		const eff = resolve({
			token: tok({ dailyBudgetUsd: '5' }),
			tokenPolicy: preset({ dailyBudgetUsd: '99' }),
			service: svc({ dailyBudgetUsd: '100' })
		});
		expect(eff.tokenBudget.dailyBudgetUsd).toBe(5);
		// the token bucket never inherits from the service scope
		expect(eff.serviceBudget.dailyBudgetUsd).toBe(100);
	});

	it('defaults each budget to 0 (unlimited) when unset', () => {
		const eff = resolve();
		expect(eff.tokenBudget).toEqual({ dailyBudgetUsd: 0, monthlyBudgetUsd: 0 });
		expect(eff.serviceBudget).toEqual({ dailyBudgetUsd: 0, monthlyBudgetUsd: 0 });
	});

	it('keeps the token and service budgets independent', () => {
		const eff = resolve({
			token: tok({ monthlyBudgetUsd: '20' }),
			service: svc({ monthlyBudgetUsd: '500' })
		});
		expect(eff.tokenBudget.monthlyBudgetUsd).toBe(20);
		expect(eff.serviceBudget.monthlyBudgetUsd).toBe(500);
	});

	it('carries the instance budget straight from the defaults (no cascade)', () => {
		const eff = resolve({
			defaults: { ...defaults, dailyBudgetUsd: 250, monthlyBudgetUsd: 4000 },
			// token/service budgets stay independent of the instance ceiling
			token: tok({ dailyBudgetUsd: '5' }),
			service: svc({ dailyBudgetUsd: '100' })
		});
		expect(eff.instanceBudget).toEqual({ dailyBudgetUsd: 250, monthlyBudgetUsd: 4000 });
		expect(eff.tokenBudget.dailyBudgetUsd).toBe(5);
		expect(eff.serviceBudget.dailyBudgetUsd).toBe(100);
	});

	it('defaults the instance budget to 0 (unlimited) when unset', () => {
		expect(resolve().instanceBudget).toEqual({ dailyBudgetUsd: 0, monthlyBudgetUsd: 0 });
	});
});

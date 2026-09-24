import { describe, expect, it } from 'vitest';
import type { Token } from '../../src/lib/features/tokens/tokens';
import {
	groupTokens,
	matchesQuery,
	matchesStatus,
	TOKEN_SORTERS
} from '../../src/lib/features/tokens/token-table';

const past = new Date(Date.now() - 86_400_000).toISOString();

function token(over: Partial<Token>): Token {
	return {
		id: over.name ?? 'id',
		name: 'tok',
		display: 'upx_abc…wxyz',
		scopes: [],
		allowedModels: [],
		serviceId: 'svc-default',
		serviceName: 'Default',
		policyId: null,
		policyName: null,
		servicePolicyName: null,
		allowedProviders: null,
		preferredProvider: null,
		rateLimitPerMinute: null,
		dailyBudgetUsd: null,
		monthlyBudgetUsd: null,
		cacheTtlSeconds: null,
		recopyable: false,
		lastUsedAt: null,
		expiresAt: null,
		revokedAt: null,
		createdAt: past,
		...over
	};
}

const active = token({ name: 'active' });
const expired = token({ name: 'expired', expiresAt: past });
const revoked = token({ name: 'revoked', revokedAt: past });

describe('matchesStatus', () => {
	it('hides only revoked tokens by default', () => {
		const all = [active, expired, revoked];
		expect(all.filter((t) => matchesStatus(t, 'current')).map((t) => t.name)).toEqual([
			'active',
			'expired'
		]);
		expect(all.filter((t) => matchesStatus(t, 'all'))).toHaveLength(3);
	});

	it('narrows to a single lifecycle state', () => {
		expect(matchesStatus(expired, 'expired')).toBe(true);
		expect(matchesStatus(expired, 'active')).toBe(false);
		expect(matchesStatus(revoked, 'revoked')).toBe(true);
	});
});

describe('matchesQuery', () => {
	it('matches service, inherited preset, scopes and model patterns', () => {
		const t = token({
			serviceName: 'Billing',
			servicePolicyName: 'Cheap models',
			scopes: ['embeddings'],
			allowedModels: ['gpt-4o*']
		});
		expect(matchesQuery(t, 'billing')).toBe(true);
		expect(matchesQuery(t, 'cheap')).toBe(true);
		expect(matchesQuery(t, 'embeddings')).toBe(true);
		expect(matchesQuery(t, 'gpt-4o')).toBe(true);
		expect(matchesQuery(t, 'realtime')).toBe(false);
	});
});

describe('groupTokens', () => {
	it('returns one unlabeled group when not grouping', () => {
		expect(groupTokens([active, revoked], 'none')).toEqual([
			{ key: 'all', label: '', tokens: [active, revoked] }
		]);
	});

	it('groups by service, sorted by name, keeping row order and the service id', () => {
		const a = token({ name: 'a', serviceId: 's2', serviceName: 'Zeta' });
		const b = token({ name: 'b', serviceId: 's1', serviceName: 'Alpha' });
		const c = token({ name: 'c', serviceId: 's2', serviceName: 'Zeta' });
		const groups = groupTokens([a, b, c], 'service');
		expect(groups.map((g) => [g.label, g.serviceId, g.tokens.map((t) => t.name)])).toEqual([
			['Alpha', 's1', ['b']],
			['Zeta', 's2', ['a', 'c']]
		]);
	});

	it('orders status groups by lifecycle, not alphabetically', () => {
		expect(groupTokens([revoked, expired, active], 'status').map((g) => g.label)).toEqual([
			'active',
			'expired',
			'revoked'
		]);
	});

	it('groups by the effective preset and puts tokens without one last', () => {
		const own = token({ name: 'own', policyName: 'Strict', servicePolicyName: 'Base' });
		const inherited = token({ name: 'inherited', servicePolicyName: 'Base' });
		const none = token({ name: 'none' });
		expect(groupTokens([none, own, inherited], 'preset').map((g) => g.label)).toEqual([
			'Base',
			'Strict',
			'No preset'
		]);
	});
});

describe('TOKEN_SORTERS', () => {
	it('sorts never-used tokens before used ones on last used ascending', () => {
		const used = token({ name: 'used', lastUsedAt: past });
		expect([used, active].sort(TOKEN_SORTERS.lastUsed).map((t) => t.name)).toEqual([
			'active',
			'used'
		]);
	});

	it('breaks service ties by token name', () => {
		const b = token({ name: 'b', serviceName: 'S' });
		const a = token({ name: 'a', serviceName: 'S' });
		expect([b, a].sort(TOKEN_SORTERS.service).map((t) => t.name)).toEqual(['a', 'b']);
	});
});

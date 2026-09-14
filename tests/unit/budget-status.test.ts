import { describe, it, expect, vi, beforeEach, assert } from 'vitest';

// orgBudgetStatus reads one row per budgeted service with the service's inline
// ceilings and its policy's ceilings side by side. We stub the drizzle builder
// chain so the rows are fully controlled and assert that the displayed ceiling
// follows the same inline → policy precedence the gateway enforces.
let rows: Array<Record<string, unknown>> = [];

vi.mock('$lib/server/db', () => {
	const builder = {
		from: () => builder,
		leftJoin: () => builder,
		innerJoin: () => builder,
		where: () => builder,
		groupBy: () => Promise.resolve(rows)
	};
	return { db: { select: () => builder } };
});

import { orgBudgetStatus } from '$lib/server/budget-status';

const row = (over: Record<string, unknown> = {}) => ({
	serviceId: 'svc-1',
	serviceName: 'api',
	policyName: null,
	serviceDailyBudget: null,
	serviceMonthlyBudget: null,
	policyDailyBudget: null,
	policyMonthlyBudget: null,
	dailySpent: '2.5',
	monthlySpent: '40',
	...over
});

beforeEach(() => {
	rows = [];
});

describe('orgBudgetStatus', () => {
	it('reports an inline service budget when the service has no policy', async () => {
		rows = [row({ serviceDailyBudget: '10.0000', serviceMonthlyBudget: '100.0000' })];

		const [status] = await orgBudgetStatus();
		assert(status);

		expect(status.daily).toEqual({ budgetUsd: 10, spentUsd: 2.5 });
		expect(status.monthly).toEqual({ budgetUsd: 100, spentUsd: 40 });
		expect(status.policyName).toBe('service limit');
	});

	it('lets the inline value override the policy, per window', async () => {
		rows = [
			row({
				policyName: 'standard',
				serviceDailyBudget: '5.0000',
				policyDailyBudget: '50.0000',
				policyMonthlyBudget: '500.0000'
			})
		];

		const [status] = await orgBudgetStatus();
		assert(status);

		expect(status.daily).toEqual({ budgetUsd: 5, spentUsd: 2.5 });
		// monthly has no inline value, so it falls through to the policy
		expect(status.monthly).toEqual({ budgetUsd: 500, spentUsd: 40 });
		expect(status.policyName).toBe('standard');
	});

	it('treats an explicit inline 0 as unlimited, even when the policy sets a ceiling', async () => {
		rows = [
			row({
				policyName: 'standard',
				serviceDailyBudget: '0.0000',
				serviceMonthlyBudget: '20.0000',
				policyDailyBudget: '50.0000',
				policyMonthlyBudget: '500.0000'
			})
		];

		const [status] = await orgBudgetStatus();
		assert(status);

		expect(status.daily).toBeNull();
		expect(status.monthly).toEqual({ budgetUsd: 20, spentUsd: 40 });
		// no shown ceiling comes from the policy
		expect(status.policyName).toBe('service limit');
	});

	it('falls back to the policy ceilings when the service sets none', async () => {
		rows = [row({ policyName: 'standard', policyDailyBudget: '0', policyMonthlyBudget: '300' })];

		const [status] = await orgBudgetStatus();
		assert(status);

		expect(status.daily).toBeNull();
		expect(status.monthly).toEqual({ budgetUsd: 300, spentUsd: 40 });
		expect(status.policyName).toBe('standard');
	});
});

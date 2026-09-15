import { describe, it, expect } from 'vitest';
import { budgetRows, type BudgetStatus } from '$lib/features/budget/budget';

const status = (over: Partial<BudgetStatus>): BudgetStatus => ({
	serviceId: 's1',
	serviceName: 'Support',
	policyName: 'Default',
	daily: null,
	monthly: null,
	...over
});

describe('budgetRows', () => {
	it('emits one row per capped window, daily first', () => {
		const rows = budgetRows([
			status({
				daily: { budgetUsd: 10, spentUsd: 5 },
				monthly: { budgetUsd: 100, spentUsd: 120 }
			})
		]);
		expect(rows).toEqual([
			{
				key: 's1-daily',
				serviceName: 'Support',
				window: 'daily',
				spentUsd: 5,
				budgetUsd: 10,
				fraction: 0.5
			},
			{
				key: 's1-monthly',
				serviceName: 'Support',
				window: 'monthly',
				spentUsd: 120,
				budgetUsd: 100,
				fraction: 1.2
			}
		]);
	});

	it('skips missing and zero (unlimited) ceilings', () => {
		expect(budgetRows([status({ daily: { budgetUsd: 0, spentUsd: 3 } })])).toEqual([]);
		expect(budgetRows([])).toEqual([]);
	});
});

import { describe, it, expect } from 'vitest';
import { budgetLevel, budgetWarnings, BUDGET_WARN_THRESHOLD, type BudgetStatus } from '$lib/budget';

const svc = (over: Partial<BudgetStatus> = {}): BudgetStatus => ({
	serviceId: 's1',
	serviceName: 'api',
	policyName: 'standard',
	daily: null,
	monthly: null,
	...over
});

describe('budgetLevel', () => {
	it('classifies below threshold as ok', () => {
		expect(budgetLevel(0)).toBe('ok');
		expect(budgetLevel(0.79)).toBe('ok');
	});

	it('classifies threshold..1 as warn', () => {
		expect(budgetLevel(BUDGET_WARN_THRESHOLD)).toBe('warn');
		expect(budgetLevel(0.95)).toBe('warn');
	});

	it('classifies at/over the ceiling as over', () => {
		expect(budgetLevel(1)).toBe('over');
		expect(budgetLevel(1.4)).toBe('over');
	});
});

describe('budgetWarnings', () => {
	it('ignores services comfortably under budget', () => {
		const out = budgetWarnings([
			svc({ daily: { budgetUsd: 100, spentUsd: 10 } }),
			svc({ monthly: { budgetUsd: 100, spentUsd: 50 } })
		]);
		expect(out).toEqual([]);
	});

	it('flags a service crossing the warn threshold', () => {
		const out = budgetWarnings([svc({ daily: { budgetUsd: 100, spentUsd: 85 } })]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ level: 'warn', window: 'daily', spentUsd: 85, budgetUsd: 100 });
	});

	it('flags a service over its ceiling as over', () => {
		const out = budgetWarnings([svc({ monthly: { budgetUsd: 20, spentUsd: 25 } })]);
		expect(out[0]).toMatchObject({ level: 'over', window: 'monthly' });
		expect(out[0].fraction).toBeCloseTo(1.25);
	});

	it('reports the most-utilized of the two windows for a service', () => {
		// daily is at 90%, monthly at 50% — daily should drive the warning
		const out = budgetWarnings([
			svc({
				daily: { budgetUsd: 10, spentUsd: 9 },
				monthly: { budgetUsd: 100, spentUsd: 50 }
			})
		]);
		expect(out).toHaveLength(1);
		expect(out[0].window).toBe('daily');
	});

	it('sorts the loudest (highest utilization) warning first', () => {
		const out = budgetWarnings([
			svc({ serviceId: 'a', daily: { budgetUsd: 100, spentUsd: 85 } }),
			svc({ serviceId: 'b', daily: { budgetUsd: 100, spentUsd: 130 } })
		]);
		expect(out.map((w) => w.serviceId)).toEqual(['b', 'a']);
	});

	it('respects a custom threshold', () => {
		const statuses = [svc({ daily: { budgetUsd: 100, spentUsd: 60 } })];
		expect(budgetWarnings(statuses)).toEqual([]);
		expect(budgetWarnings(statuses, 0.5)).toHaveLength(1);
	});
});

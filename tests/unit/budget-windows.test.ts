import { describe, expect, it } from 'vitest';
import { budgetLevel, startOfUtcDay, startOfUtcMonth } from '$lib/features/budget/budget';

describe('UTC budget windows', () => {
	it('truncates to the start of the UTC day', () => {
		expect(startOfUtcDay(new Date('2026-03-15T23:59:59.999Z')).toISOString()).toBe(
			'2026-03-15T00:00:00.000Z'
		);
	});

	it('truncates to the first of the UTC month', () => {
		expect(startOfUtcMonth(new Date('2026-03-01T00:00:00.000Z')).toISOString()).toBe(
			'2026-03-01T00:00:00.000Z'
		);
		expect(startOfUtcMonth(new Date('2026-12-31T23:00:00.000Z')).toISOString()).toBe(
			'2026-12-01T00:00:00.000Z'
		);
	});
});

describe('budgetLevel with a percent-based threshold', () => {
	it('matches the alert thresholds at their boundaries', () => {
		expect(budgetLevel(0.5, 50 / 100)).toBe('warn');
		expect(budgetLevel(0.49, 50 / 100)).toBe('ok');
		expect(budgetLevel(1, 100 / 100)).toBe('over');
		expect(budgetLevel(0.99, 100 / 100)).toBe('ok');
	});
});

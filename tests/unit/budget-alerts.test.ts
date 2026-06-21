import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * budget-alerts.ts is a best-effort email side-channel that touches settings, the
 * spend sum, recipients, and the dedup ledger. We stub every dependency so the
 * test asserts the *routing* logic — which scope an alert is recorded under and
 * what headline subject it carries — without any real db/email/network.
 */

const settings = {
	budgetAlertsEnabled: true,
	budgetAlertThresholdPct: 80,
	budgetAlertEmail: null as string | null
};
vi.mock('$lib/server/data', () => ({ getSettings: () => Promise.resolve(settings) }));

// Controllable realized spend for both windows.
let spend = {
	dayStart: new Date('2026-01-01T00:00:00Z'),
	monthStart: new Date('2026-01-01T00:00:00Z'),
	dailySpent: 0,
	monthlySpent: 0
};
const currentSpend = vi.fn((..._args: unknown[]) => Promise.resolve(spend));
vi.mock('$lib/server/budget', () => ({ currentSpend: (...a: unknown[]) => currentSpend(...a) }));

const sendBudgetAlertEmail = vi.fn((_data: unknown) => Promise.resolve());
vi.mock('$lib/server/email', () => ({
	sendBudgetAlertEmail: (data: unknown) => sendBudgetAlertEmail(data)
}));

// db: the first select() is the dedup-ledger lookup (returns `existingRows`), any
// later select() is the recipients lookup; insert captures the written row.
let selectCall = 0;
let existingRows: Array<Record<string, unknown>> = [];
let insertedValues: Record<string, unknown> | null = null;
vi.mock('$lib/server/db', () => {
	const select = () => {
		const idx = selectCall++;
		const builder = {
			from: () => builder,
			where: () => builder,
			then: (resolve: (rows: unknown[]) => unknown) =>
				resolve(idx === 0 ? existingRows : [{ email: 'admin@example.com' }])
		};
		return builder;
	};
	const insert = () => ({
		values: (v: Record<string, unknown>) => {
			insertedValues = v;
			return { onConflictDoUpdate: () => Promise.resolve() };
		}
	});
	return { db: { select, insert } };
});

import { maybeSendBudgetAlert, maybeSendInstanceBudgetAlert } from '$lib/server/budget-alerts';

beforeEach(() => {
	selectCall = 0;
	existingRows = [];
	insertedValues = null;
	spend = { ...spend, dailySpent: 0, monthlySpent: 0 };
	sendBudgetAlertEmail.mockClear();
	currentSpend.mockClear();
});

describe('budget alert routing by scope', () => {
	it('records an instance alert under the instance scope with an "Instance" subject', async () => {
		spend.dailySpent = 100; // at the ceiling → "over"
		await maybeSendInstanceBudgetAlert({ dailyBudgetUsd: 100, monthlyBudgetUsd: 0 });

		expect(currentSpend).toHaveBeenCalledWith('instance', 'instance');
		expect(sendBudgetAlertEmail).toHaveBeenCalledTimes(1);
		expect(sendBudgetAlertEmail.mock.calls[0][0]).toMatchObject({
			subject: 'Instance',
			window: 'daily',
			level: 'over'
		});
		expect(insertedValues).toMatchObject({
			scope: 'instance',
			scopeId: 'instance',
			window: 'daily'
		});
	});

	it('records a service alert under the service scope with the service name', async () => {
		spend.monthlySpent = 90; // 90% of 100 → warn
		await maybeSendBudgetAlert('svc-1', 'support-agent', {
			dailyBudgetUsd: 0,
			monthlyBudgetUsd: 100
		});

		expect(currentSpend).toHaveBeenCalledWith('service', 'svc-1');
		expect(sendBudgetAlertEmail.mock.calls[0][0]).toMatchObject({
			subject: 'support-agent',
			window: 'monthly',
			level: 'warn'
		});
		expect(insertedValues).toMatchObject({ scope: 'service', scopeId: 'svc-1', window: 'monthly' });
	});

	it('stays silent below the warn threshold', async () => {
		spend.dailySpent = 50; // 50% of 100 → no alert
		await maybeSendInstanceBudgetAlert({ dailyBudgetUsd: 100, monthlyBudgetUsd: 0 });
		expect(sendBudgetAlertEmail).not.toHaveBeenCalled();
		expect(insertedValues).toBeNull();
	});

	it('suppresses a re-send when the ledger already recorded this level for the window', async () => {
		spend.dailySpent = 100;
		existingRows = [{ window: 'daily', lastLevel: 'over', windowStart: spend.dayStart }];
		await maybeSendInstanceBudgetAlert({ dailyBudgetUsd: 100, monthlyBudgetUsd: 0 });
		expect(sendBudgetAlertEmail).not.toHaveBeenCalled();
	});
});

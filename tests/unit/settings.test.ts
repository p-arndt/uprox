import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// db: select() resolves to `row` (or no rows) and counts reads; insert() captures
// the upserted values and conflict set.
let row: Record<string, unknown> | undefined;
let selects = 0;
let inserted: { values: unknown; set: unknown } | undefined;

vi.mock('$lib/server/db', () => {
	const select = () => {
		selects++;
		const builder = {
			from: () => builder,
			where: () => builder,
			limit: () => Promise.resolve(row ? [row] : [])
		};
		return builder;
	};
	const insert = () => ({
		values: (values: unknown) => ({
			onConflictDoUpdate: ({ set }: { set: unknown }) => {
				inserted = { values, set };
				return Promise.resolve();
			}
		})
	});
	return { db: { select, insert } };
});

import { getSettings, invalidateSettingsCache, updateSettings } from '$lib/server/settings';

beforeEach(() => {
	row = undefined;
	selects = 0;
	inserted = undefined;
	invalidateSettingsCache();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('getSettings', () => {
	it('falls back to defaults when no row exists', async () => {
		expect(await getSettings()).toEqual({
			cacheTtlSeconds: 0,
			membersCanManageTokens: false,
			membersCanManageServices: false,
			tokensRecopyableDefault: false,
			dailyBudgetUsd: null,
			monthlyBudgetUsd: null,
			budgetAlertsEnabled: false,
			budgetAlertThresholdPct: 80,
			budgetAlertEmail: null,
			ssoSignupEnabled: true
		});
	});

	it('maps stored values, converting numeric budgets', async () => {
		row = {
			id: 1,
			cacheTtlSeconds: 60,
			membersCanManageTokens: true,
			dailyBudgetUsd: '12.50',
			monthlyBudgetUsd: null,
			budgetAlertThresholdPct: 90,
			budgetAlertEmail: 'ops@example.com'
		};

		expect(await getSettings()).toMatchObject({
			cacheTtlSeconds: 60,
			membersCanManageTokens: true,
			membersCanManageServices: false,
			dailyBudgetUsd: 12.5,
			monthlyBudgetUsd: null,
			budgetAlertThresholdPct: 90,
			budgetAlertEmail: 'ops@example.com'
		});
	});

	it('serves repeated reads from the cache and hands out independent copies', async () => {
		const first = await getSettings();
		first.cacheTtlSeconds = 999;
		const second = await getSettings();

		expect(selects).toBe(1);
		expect(second.cacheTtlSeconds).toBe(0);
	});

	it('reads again once the TTL has passed', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		await getSettings();
		vi.setSystemTime(new Date('2026-01-01T00:00:04Z'));
		await getSettings();
		expect(selects).toBe(1);

		vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
		await getSettings();
		expect(selects).toBe(2);
	});
});

describe('updateSettings', () => {
	it('invalidates the cache so the next read sees the write', async () => {
		await getSettings();
		row = { id: 1, ssoSignupEnabled: false };
		await updateSettings({ ssoSignupEnabled: false });

		expect((await getSettings()).ssoSignupEnabled).toBe(false);
		expect(selects).toBe(2);
	});

	it('writes only the given fields, normalized', async () => {
		await updateSettings({
			cacheTtlSeconds: -5,
			dailyBudgetUsd: 0,
			monthlyBudgetUsd: 250,
			budgetAlertThresholdPct: 150,
			budgetAlertEmail: '  '
		});

		const expected = {
			cacheTtlSeconds: 0,
			dailyBudgetUsd: null,
			monthlyBudgetUsd: '250',
			budgetAlertThresholdPct: 100,
			budgetAlertEmail: null
		};
		expect(inserted).toEqual({ values: { id: 1, ...expected }, set: expected });
	});

	it('clamps the alert threshold from below and falls back on NaN', async () => {
		await updateSettings({ budgetAlertThresholdPct: 0.5 });
		expect(inserted?.set).toEqual({ budgetAlertThresholdPct: 1 });

		await updateSettings({ budgetAlertThresholdPct: Number.NaN });
		expect(inserted?.set).toEqual({ budgetAlertThresholdPct: 80 });
	});
});

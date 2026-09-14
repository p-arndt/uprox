import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { getSettings, invalidateSettingsCache, updateSettings } from '$lib/server/settings';

describe('settings round trip (real SQL)', () => {
	beforeEach(async () => {
		await db.execute(sql`delete from settings`);
		invalidateSettingsCache();
	});

	it('creates the row on first write and merges later partial writes', async () => {
		await updateSettings({ cacheTtlSeconds: 120, dailyBudgetUsd: 25.5 });
		await updateSettings({ budgetAlertsEnabled: true, budgetAlertEmail: ' ops@example.com ' });

		expect(await getSettings()).toMatchObject({
			cacheTtlSeconds: 120,
			dailyBudgetUsd: 25.5,
			monthlyBudgetUsd: null,
			budgetAlertsEnabled: true,
			budgetAlertEmail: 'ops@example.com'
		});
	});

	it('clears a budget with a non-positive value', async () => {
		await updateSettings({ monthlyBudgetUsd: 100 });
		expect((await getSettings()).monthlyBudgetUsd).toBe(100);

		await updateSettings({ monthlyBudgetUsd: 0 });
		expect((await getSettings()).monthlyBudgetUsd).toBeNull();
	});
});

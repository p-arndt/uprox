import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '$lib/server/db';
import { budgetAlertState } from '$lib/server/db/schema';

const windowStart = new Date('2026-01-01T00:00:00Z');

describe('budget_alert_state primary key (real SQL)', () => {
	beforeEach(async () => {
		await db.delete(budgetAlertState);
	});

	it('upserts on the (scope, scopeId, window) key like budget-alerts does', async () => {
		const upsert = (lastLevel: string) =>
			db
				.insert(budgetAlertState)
				.values({ scope: 'service', scopeId: 's1', window: 'daily', lastLevel, windowStart })
				.onConflictDoUpdate({
					target: [budgetAlertState.scope, budgetAlertState.scopeId, budgetAlertState.window],
					set: { lastLevel }
				});

		await upsert('warn');
		await upsert('over');

		const rows = await db.select().from(budgetAlertState);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ scopeId: 's1', window: 'daily', lastLevel: 'over' });
	});

	it('rejects a duplicate key and allows other windows and scopes', async () => {
		const row = {
			scope: 'service',
			scopeId: 's1',
			window: 'daily',
			lastLevel: 'warn',
			windowStart
		};
		await db.insert(budgetAlertState).values(row);
		await db.insert(budgetAlertState).values({ ...row, window: 'monthly' });
		await db.insert(budgetAlertState).values({ ...row, scope: 'instance', scopeId: 'instance' });

		await expect(db.insert(budgetAlertState).values(row)).rejects.toThrow();
	});
});

/**
 * Per-service spend enforcement. Budgets are configured on a policy (daily and
 * monthly USD ceilings) and enforced against the spend of the *service* making
 * the request — so two services sharing a policy each get their own bucket.
 *
 * Spend is summed from the audit log (the same `costUsd` we already record per
 * request), which keeps budgets durable across restarts and consistent with
 * what the dashboard reports. Calendar windows are UTC: "daily" resets at
 * 00:00 UTC, "monthly" on the 1st.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { auditLog } from '$lib/server/db/schema';

export interface BudgetLimits {
	dailyBudgetUsd: string | number;
	monthlyBudgetUsd: string | number;
}

export type BudgetResult = { ok: true } | { ok: false; reason: string };

function startOfUtcDay(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfUtcMonth(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Sum gateway spend (USD) for a service since `since`. */
async function spendSince(serviceId: string, since: Date): Promise<number> {
	const [row] = await db
		.select({ total: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)` })
		.from(auditLog)
		.where(and(eq(auditLog.serviceId, serviceId), gte(auditLog.createdAt, since)));
	return Number(row?.total ?? 0);
}

/**
 * Check whether `serviceId` is still within its policy's spend ceilings.
 * A ceiling of 0 (or unset) means unlimited and is skipped — so when neither
 * budget is set we never touch the database.
 */
export async function checkBudget(serviceId: string, limits: BudgetLimits): Promise<BudgetResult> {
	const daily = Number(limits.dailyBudgetUsd ?? 0);
	const monthly = Number(limits.monthlyBudgetUsd ?? 0);
	if (daily <= 0 && monthly <= 0) return { ok: true };

	if (monthly > 0) {
		const spent = await spendSince(serviceId, startOfUtcMonth());
		if (spent >= monthly) {
			return {
				ok: false,
				reason: `monthly budget exhausted ($${spent.toFixed(4)} of $${monthly.toFixed(2)})`
			};
		}
	}

	if (daily > 0) {
		const spent = await spendSince(serviceId, startOfUtcDay());
		if (spent >= daily) {
			return {
				ok: false,
				reason: `daily budget exhausted ($${spent.toFixed(4)} of $${daily.toFixed(2)})`
			};
		}
	}

	return { ok: true };
}

/** Current spend standing against service and instance budgets. */
import { and, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { service, policy, auditLog } from '$lib/server/db/schema';
import type { BudgetStatus } from '$lib/budget';
import { getSettings } from '$lib/server/settings';

/**
 * Current spend standing for every service whose policy sets a daily or monthly
 * ceiling — the input to the budget soft-warnings on the overview and usage
 * pages. Windows are the same fixed UTC calendar buckets the gateway enforces
 * against (see budget.ts): "daily" since 00:00 UTC, "monthly" since the 1st. The
 * day/month boundaries are computed here and passed as parameters so this read
 * matches enforcement exactly. Only services actually carrying a ceiling are
 * returned; classifying warn/over from these numbers is left to `budgetWarnings`.
 */
export async function orgBudgetStatus(): Promise<BudgetStatus[]> {
	const now = new Date();
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

	// Built with the query builder rather than a raw `db.execute`: that's the only
	// path that binds a Date parameter through the column's type mapping (the same
	// `gte(createdAt, …)` the gateway enforces with — see budget.ts). A raw `sql`
	// template can't serialize a Date on its own and throws at execution. The left
	// join is scoped to the month window (the wider of the two); the daily figure
	// is a narrower filtered aggregate within those rows.
	//
	// The ceiling is resolved exactly like enforcement does (see resolveBudget in
	// effective-config.ts): the service's inline value when set — including an
	// explicit 0, meaning unlimited — else its policy's. The policy is therefore a
	// left join: a service can carry an inline budget without any policy.
	const effectiveDaily = sql`coalesce(${service.dailyBudgetUsd}, ${policy.dailyBudgetUsd})`;
	const effectiveMonthly = sql`coalesce(${service.monthlyBudgetUsd}, ${policy.monthlyBudgetUsd})`;
	const rows = await db
		.select({
			serviceId: service.id,
			serviceName: service.name,
			policyName: policy.name,
			serviceDailyBudget: service.dailyBudgetUsd,
			serviceMonthlyBudget: service.monthlyBudgetUsd,
			policyDailyBudget: policy.dailyBudgetUsd,
			policyMonthlyBudget: policy.monthlyBudgetUsd,
			dailySpent: sql<string>`coalesce(sum(${auditLog.costUsd}) filter (where ${gte(auditLog.createdAt, dayStart)}), 0)`,
			monthlySpent: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)`
		})
		.from(service)
		.leftJoin(policy, eq(policy.id, service.policyId))
		.leftJoin(
			auditLog,
			and(
				eq(auditLog.serviceId, service.id),
				sql`${auditLog.action} like 'gateway.%'`,
				gte(auditLog.createdAt, monthStart)
			)
		)
		.where(and(isNull(service.deletedAt), sql`(${effectiveDaily} > 0 or ${effectiveMonthly} > 0)`))
		.groupBy(
			service.id,
			service.name,
			service.dailyBudgetUsd,
			service.monthlyBudgetUsd,
			policy.name,
			policy.dailyBudgetUsd,
			policy.monthlyBudgetUsd
		);

	return rows.map((r) => {
		const dailyFromService = r.serviceDailyBudget != null;
		const monthlyFromService = r.serviceMonthlyBudget != null;
		const dailyBudget = Number(
			(dailyFromService ? r.serviceDailyBudget : r.policyDailyBudget) ?? 0
		);
		const monthlyBudget = Number(
			(monthlyFromService ? r.serviceMonthlyBudget : r.policyMonthlyBudget) ?? 0
		);
		// Name the policy only when a shown ceiling actually comes from it; a
		// ceiling set on the service itself is labelled as such.
		const usesPolicy =
			r.policyName != null &&
			((dailyBudget > 0 && !dailyFromService) || (monthlyBudget > 0 && !monthlyFromService));
		return {
			serviceId: r.serviceId,
			serviceName: r.serviceName,
			policyName: usesPolicy ? (r.policyName as string) : 'service limit',
			daily:
				dailyBudget > 0 ? { budgetUsd: dailyBudget, spentUsd: Number(r.dailySpent ?? 0) } : null,
			monthly:
				monthlyBudget > 0
					? { budgetUsd: monthlyBudget, spentUsd: Number(r.monthlySpent ?? 0) }
					: null
		};
	});
}

/**
 * The instance-wide spend ceiling and how close the org is to it this period.
 * Returns a single BudgetStatus (scope id 'instance') so it renders through the
 * same gauge/alert as services, or null when no instance budget is configured.
 * Spend is summed across ALL gateway traffic — matching what budget.ts enforces
 * for the 'instance' scope, not filtered per service.
 */
export async function instanceBudgetStatus(): Promise<BudgetStatus | null> {
	const settings = await getSettings();
	const dailyBudget = settings.dailyBudgetUsd ?? 0;
	const monthlyBudget = settings.monthlyBudgetUsd ?? 0;
	if (dailyBudget <= 0 && monthlyBudget <= 0) return null;

	const now = new Date();
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

	const [row] = await db
		.select({
			dailySpent: sql<string>`coalesce(sum(${auditLog.costUsd}) filter (where ${gte(auditLog.createdAt, dayStart)}), 0)`,
			monthlySpent: sql<string>`coalesce(sum(${auditLog.costUsd}), 0)`
		})
		.from(auditLog)
		.where(gte(auditLog.createdAt, monthStart));

	return {
		serviceId: 'instance',
		serviceName: 'Instance',
		policyName: 'all services',
		daily:
			dailyBudget > 0 ? { budgetUsd: dailyBudget, spentUsd: Number(row?.dailySpent ?? 0) } : null,
		monthly:
			monthlyBudget > 0
				? { budgetUsd: monthlyBudget, spentUsd: Number(row?.monthlySpent ?? 0) }
				: null
	};
}

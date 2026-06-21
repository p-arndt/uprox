/**
 * Budget alerting. The gateway calls {@link maybeSendBudgetAlert} (per service)
 * and {@link maybeSendInstanceBudgetAlert} (org-wide) as fire-and-forget steps on
 * every budgeted request; this module decides whether that scope has crossed the
 * instance's warn threshold (or its ceiling) and, if so, emails the instance's
 * owners/admins (plus an optional notification address).
 *
 * Re-sends are suppressed by the `budget_alert_state` ledger: one row per
 * (scope, scopeId, window) tracks the highest level already emailed for the
 * current spend window, so we only mail again when the window rolls over or the
 * level escalates from warn to over. Everything here is best-effort and never
 * throws — alerting must not affect the request it observes.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { budgetAlertState, user } from '$lib/server/db/schema';
import { getSettings } from '$lib/server/data';
import { currentSpend, type BudgetLimits, type BudgetScope } from '$lib/server/budget';
import { sendBudgetAlertEmail } from '$lib/server/email';

type Level = 'warn' | 'over';
const RANK: Record<Level, number> = { warn: 1, over: 2 };

function levelFor(fraction: number, thresholdPct: number): Level | null {
	if (fraction >= 1) return 'over';
	if (fraction >= thresholdPct / 100) return 'warn';
	return null;
}

/** Owner/admin emails for the instance, plus the optional configured alert address. */
async function recipientsFor(extra: string | null): Promise<string[]> {
	const rows = await db
		.select({ email: user.email })
		.from(user)
		.where(inArray(user.role, ['owner', 'admin']));
	const emails = new Set(rows.map((r) => r.email).filter(Boolean));
	if (extra) emails.add(extra);
	return [...emails];
}

/**
 * Evaluate one budget bucket's standing and email an alert if it has newly
 * crossed the warn threshold or its ceiling. `subject` is what shows in the
 * email headline (a service name, or "Instance"). No-ops when alerts are
 * disabled or no budget is set. Safe to call without awaiting.
 */
async function evaluateBudgetAlert(
	scope: BudgetScope,
	scopeId: string,
	subject: string,
	limits: BudgetLimits
): Promise<void> {
	try {
		const settings = await getSettings();
		if (!settings.budgetAlertsEnabled) return;

		const dailyBudget = Number(limits.dailyBudgetUsd ?? 0);
		const monthlyBudget = Number(limits.monthlyBudgetUsd ?? 0);
		if (dailyBudget <= 0 && monthlyBudget <= 0) return;

		const spend = await currentSpend(scope, scopeId);
		const windows = [
			{
				name: 'daily' as const,
				budget: dailyBudget,
				spent: spend.dailySpent,
				start: spend.dayStart
			},
			{
				name: 'monthly' as const,
				budget: monthlyBudget,
				spent: spend.monthlySpent,
				start: spend.monthStart
			}
		].filter((w) => w.budget > 0);

		const existing = await db
			.select()
			.from(budgetAlertState)
			.where(and(eq(budgetAlertState.scope, scope), eq(budgetAlertState.scopeId, scopeId)));

		let recipients: string[] | null = null;
		const orgName = env.ORG_NAME?.trim() || 'uprox';

		for (const w of windows) {
			const fraction = w.spent / w.budget;
			const level = levelFor(fraction, settings.budgetAlertThresholdPct);
			if (!level) continue;

			const prior = existing.find((r) => r.window === w.name);
			const windowRolledOver = !prior || prior.windowStart.getTime() !== w.start.getTime();
			const escalated = prior ? RANK[level] > RANK[prior.lastLevel as Level] : false;
			if (!windowRolledOver && !escalated) continue;

			// resolve recipients lazily, only once we know we'll send
			if (recipients === null) {
				recipients = await recipientsFor(settings.budgetAlertEmail);
			}

			await sendBudgetAlertEmail({
				to: recipients,
				orgName,
				subject,
				window: w.name,
				level,
				spentUsd: w.spent,
				budgetUsd: w.budget,
				pct: Math.round(fraction * 100),
				usageUrl: env.ORIGIN ? `${env.ORIGIN}/app/usage` : null
			});

			await db
				.insert(budgetAlertState)
				.values({
					scope,
					scopeId,
					window: w.name,
					lastLevel: level,
					windowStart: w.start
				})
				.onConflictDoUpdate({
					target: [budgetAlertState.scope, budgetAlertState.scopeId, budgetAlertState.window],
					set: { lastLevel: level, windowStart: w.start, sentAt: new Date() }
				});
		}
	} catch (err) {
		console.error('[budget-alerts] failed to evaluate/send', err);
	}
}

/** Alert when a service crosses its aggregate (service-wide) budget. */
export function maybeSendBudgetAlert(
	serviceId: string,
	serviceName: string,
	limits: BudgetLimits
): Promise<void> {
	return evaluateBudgetAlert('service', serviceId, serviceName, limits);
}

/** Alert when the instance-wide ceiling (across all services/tokens) is crossed. */
export function maybeSendInstanceBudgetAlert(limits: BudgetLimits): Promise<void> {
	return evaluateBudgetAlert('instance', 'instance', 'Instance', limits);
}

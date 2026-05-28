/**
 * Org-wide budget alerting. The gateway calls {@link maybeSendBudgetAlert} as a
 * fire-and-forget step on every budgeted request; this module decides whether the
 * service has crossed its org's warn threshold (or its ceiling) and, if so, emails
 * the org's owners/admins (plus an optional notification address).
 *
 * Re-sends are suppressed by the `budget_alert_state` ledger: one row per
 * (service, window) tracks the highest level already emailed for the current
 * spend window, so we only mail again when the window rolls over or the level
 * escalates from warn to over. Everything here is best-effort and never throws —
 * alerting must not affect the request it observes.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { budgetAlertState, member, user, organization } from '$lib/server/db/schema';
import { getOrgSettings } from '$lib/server/data';
import { currentSpend, type BudgetLimits } from '$lib/server/budget';
import { sendBudgetAlertEmail } from '$lib/server/email';

type Level = 'warn' | 'over';
const RANK: Record<Level, number> = { warn: 1, over: 2 };

function levelFor(fraction: number, thresholdPct: number): Level | null {
	if (fraction >= 1) return 'over';
	if (fraction >= thresholdPct / 100) return 'warn';
	return null;
}

/** Owner/admin emails for the org, plus the optional configured alert address. */
async function recipientsFor(orgId: string, extra: string | null): Promise<string[]> {
	const rows = await db
		.select({ email: user.email })
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(and(eq(member.organizationId, orgId), inArray(member.role, ['owner', 'admin'])));
	const emails = new Set(rows.map((r) => r.email).filter(Boolean));
	if (extra) emails.add(extra);
	return [...emails];
}

/**
 * Evaluate a service's budget standing and email an alert if it has newly
 * crossed the org's warn threshold or its ceiling. No-ops when alerts are
 * disabled or no budget is set. Safe to call without awaiting.
 */
export async function maybeSendBudgetAlert(
	orgId: string,
	serviceId: string,
	serviceName: string,
	limits: BudgetLimits
): Promise<void> {
	try {
		const settings = await getOrgSettings(orgId);
		if (!settings.budgetAlertsEnabled) return;

		const dailyBudget = Number(limits.dailyBudgetUsd ?? 0);
		const monthlyBudget = Number(limits.monthlyBudgetUsd ?? 0);
		if (dailyBudget <= 0 && monthlyBudget <= 0) return;

		const spend = await currentSpend(serviceId);
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
			.where(eq(budgetAlertState.serviceId, serviceId));

		let recipients: string[] | null = null;
		let orgName: string | null = null;

		for (const w of windows) {
			const fraction = w.spent / w.budget;
			const level = levelFor(fraction, settings.budgetAlertThresholdPct);
			if (!level) continue;

			const prior = existing.find((r) => r.window === w.name);
			const windowRolledOver = !prior || prior.windowStart.getTime() !== w.start.getTime();
			const escalated = prior ? RANK[level] > RANK[prior.lastLevel as Level] : false;
			if (!windowRolledOver && !escalated) continue;

			// resolve recipients/org name lazily, only once we know we'll send
			if (recipients === null) {
				recipients = await recipientsFor(orgId, settings.budgetAlertEmail);
				const [org] = await db
					.select({ name: organization.name })
					.from(organization)
					.where(eq(organization.id, orgId))
					.limit(1);
				orgName = org?.name ?? 'your organization';
			}

			await sendBudgetAlertEmail({
				to: recipients,
				orgName: orgName ?? 'your organization',
				serviceName,
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
					serviceId,
					window: w.name,
					lastLevel: level,
					windowStart: w.start
				})
				.onConflictDoUpdate({
					target: [budgetAlertState.serviceId, budgetAlertState.window],
					set: { lastLevel: level, windowStart: w.start, sentAt: new Date() }
				});
		}
	} catch (err) {
		console.error('[budget-alerts] failed to evaluate/send', err);
	}
}

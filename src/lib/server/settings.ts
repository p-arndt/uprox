/** The instance settings singleton. */
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { settings } from '$lib/server/db/schema';

export interface Settings {
	cacheTtlSeconds: number;
	membersCanManageTokens: boolean;
	membersCanManageServices: boolean;
	tokensRecopyableDefault: boolean;
	// instance-wide spend ceilings across all services/tokens; null = unlimited
	dailyBudgetUsd: number | null;
	monthlyBudgetUsd: number | null;
	budgetAlertsEnabled: boolean;
	budgetAlertThresholdPct: number;
	budgetAlertEmail: string | null;
	tracingEnabled: boolean;
	tracingRetentionDays: number;
}

/** Read instance settings, falling back to defaults when no row exists yet. */
export async function getSettings(): Promise<Settings> {
	const [row] = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
	return {
		cacheTtlSeconds: row?.cacheTtlSeconds ?? 0,
		membersCanManageTokens: row?.membersCanManageTokens ?? false,
		membersCanManageServices: row?.membersCanManageServices ?? false,
		tokensRecopyableDefault: row?.tokensRecopyableDefault ?? false,
		dailyBudgetUsd: row?.dailyBudgetUsd != null ? Number(row.dailyBudgetUsd) : null,
		monthlyBudgetUsd: row?.monthlyBudgetUsd != null ? Number(row.monthlyBudgetUsd) : null,
		budgetAlertsEnabled: row?.budgetAlertsEnabled ?? false,
		budgetAlertThresholdPct: row?.budgetAlertThresholdPct ?? 80,
		budgetAlertEmail: row?.budgetAlertEmail ?? null,
		tracingEnabled: row?.tracingEnabled ?? false,
		tracingRetentionDays: row?.tracingRetentionDays ?? 30
	};
}

/**
 * Upsert instance gateway settings. Only the fields present in `input` are
 * written, so callers can update the cache TTL and the member-permission
 * toggles independently.
 */
export async function updateSettings(input: Partial<Settings>) {
	const set: Partial<typeof settings.$inferInsert> = {};
	if (input.cacheTtlSeconds !== undefined) {
		set.cacheTtlSeconds = Math.max(0, Math.floor(input.cacheTtlSeconds) || 0);
	}
	if (input.membersCanManageTokens !== undefined) {
		set.membersCanManageTokens = input.membersCanManageTokens;
	}
	if (input.membersCanManageServices !== undefined) {
		set.membersCanManageServices = input.membersCanManageServices;
	}
	if (input.tokensRecopyableDefault !== undefined) {
		set.tokensRecopyableDefault = input.tokensRecopyableDefault;
	}
	// budgets: null or a non-positive number clears the ceiling (unlimited)
	if (input.dailyBudgetUsd !== undefined) {
		set.dailyBudgetUsd =
			input.dailyBudgetUsd && input.dailyBudgetUsd > 0 ? String(input.dailyBudgetUsd) : null;
	}
	if (input.monthlyBudgetUsd !== undefined) {
		set.monthlyBudgetUsd =
			input.monthlyBudgetUsd && input.monthlyBudgetUsd > 0 ? String(input.monthlyBudgetUsd) : null;
	}
	if (input.budgetAlertsEnabled !== undefined) {
		set.budgetAlertsEnabled = input.budgetAlertsEnabled;
	}
	if (input.budgetAlertThresholdPct !== undefined) {
		// clamp to a sane 1–100% band; out-of-range or NaN falls back to 80
		const pct = Math.floor(input.budgetAlertThresholdPct);
		set.budgetAlertThresholdPct = Number.isFinite(pct) ? Math.min(100, Math.max(1, pct)) : 80;
	}
	if (input.budgetAlertEmail !== undefined) {
		set.budgetAlertEmail = input.budgetAlertEmail?.trim() || null;
	}
	if (input.tracingEnabled !== undefined) {
		set.tracingEnabled = input.tracingEnabled;
	}
	if (input.tracingRetentionDays !== undefined) {
		// at least 1 day; out-of-range or NaN falls back to the 30-day default
		const days = Math.floor(input.tracingRetentionDays);
		set.tracingRetentionDays = Number.isFinite(days) ? Math.max(1, days) : 30;
	}
	await db
		.insert(settings)
		.values({ id: 1, ...set })
		.onConflictDoUpdate({
			target: settings.id,
			set
		});
}

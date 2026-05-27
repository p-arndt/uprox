/**
 * Client-safe budget presentation helpers, shared by the overview and usage
 * pages. Pure functions only — no DB access — so they're trivially testable and
 * usable in components. The spend/ceiling numbers come from the server (see
 * `orgBudgetStatus` in `$lib/server/data`); this module only decides *how close*
 * a service is to its ceiling and turns that into a display warning.
 */

/** One spend window (daily or monthly) for a service: ceiling and spend-so-far. */
export interface BudgetWindow {
	budgetUsd: number;
	spentUsd: number;
}

/** A service's current standing against its policy's spend ceilings. */
export interface BudgetStatus {
	serviceId: string;
	serviceName: string;
	policyName: string;
	// null when that window has no ceiling (0 = unlimited)
	daily: BudgetWindow | null;
	monthly: BudgetWindow | null;
}

export type BudgetLevel = 'ok' | 'warn' | 'over';

/**
 * A service flagged as approaching or past a spend ceiling, already reduced to
 * the single most-utilized window so the UI can render one line per service.
 */
export interface BudgetWarning {
	serviceId: string;
	serviceName: string;
	policyName: string;
	level: 'warn' | 'over';
	window: 'daily' | 'monthly';
	budgetUsd: number;
	spentUsd: number;
	/** spent / budget — may exceed 1 when over the ceiling */
	fraction: number;
}

/** Default soft-warning threshold: flag a service once it crosses 80% of a ceiling. */
export const BUDGET_WARN_THRESHOLD = 0.8;

/** Classify a utilization fraction (spent/budget) into a display level. */
export function budgetLevel(fraction: number, threshold = BUDGET_WARN_THRESHOLD): BudgetLevel {
	if (fraction >= 1) return 'over';
	if (fraction >= threshold) return 'warn';
	return 'ok';
}

function fractionOf(w: BudgetWindow | null): number {
	if (!w || w.budgetUsd <= 0) return 0;
	return w.spentUsd / w.budgetUsd;
}

/**
 * Reduce per-service budget standings to the set worth surfacing. For each
 * service we take whichever window (daily or monthly) is closest to its ceiling
 * and emit a warning when that window is at/over the threshold. Result is sorted
 * most-utilized first, so the loudest alert leads.
 */
export function budgetWarnings(
	statuses: BudgetStatus[],
	threshold = BUDGET_WARN_THRESHOLD
): BudgetWarning[] {
	const warnings: BudgetWarning[] = [];
	for (const s of statuses) {
		const dailyFraction = fractionOf(s.daily);
		const monthlyFraction = fractionOf(s.monthly);
		const useDaily = dailyFraction >= monthlyFraction;
		const window = useDaily ? s.daily : s.monthly;
		const fraction = useDaily ? dailyFraction : monthlyFraction;
		if (!window) continue;
		const level = budgetLevel(fraction, threshold);
		if (level === 'ok') continue;
		warnings.push({
			serviceId: s.serviceId,
			serviceName: s.serviceName,
			policyName: s.policyName,
			level,
			window: useDaily ? 'daily' : 'monthly',
			budgetUsd: window.budgetUsd,
			spentUsd: window.spentUsd,
			fraction
		});
	}
	return warnings.sort((a, b) => b.fraction - a.fraction);
}

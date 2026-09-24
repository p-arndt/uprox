/**
 * Client-safe budget presentation helpers, shared by the overview and usage
 * pages. Pure functions only — no DB access — so they're trivially testable and
 * usable in components. The spend/ceiling numbers come from the server (see
 * `orgBudgetStatus` in `$lib/server/budget-status`); this module only decides *how close*
 * a service is to its ceiling and turns that into a display warning.
 */

/**
 * Start of the UTC day containing `now` — the boundary the daily budget resets
 * on. Shared by enforcement, alerts and the dashboard status so all three sum
 * spend over exactly the same window.
 */
export function startOfUtcDay(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Start of the UTC month containing `now` — the boundary the monthly budget resets on. */
export function startOfUtcMonth(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

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
	/** the instance-wide ceiling rather than a service's (see instanceBudgetStatus) */
	instance?: boolean;
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
	instance: boolean;
	level: 'warn' | 'over';
	window: 'daily' | 'monthly';
	budgetUsd: number;
	spentUsd: number;
	/** spent / budget — may exceed 1 when over the ceiling */
	fraction: number;
}

/** Default soft-warning threshold: flag a service once it crosses 80% of a ceiling. */
export const BUDGET_WARN_THRESHOLD = 0.8;

/**
 * Classify a utilization fraction (spent/budget) against a warn threshold, also
 * a fraction: 'over' at or past the ceiling, 'warn' at or past the threshold.
 * The single classifier shared by the dashboard warnings and the budget alert
 * emails (which store the threshold as a percent and divide by 100).
 */
export function budgetLevel(fraction: number, threshold = BUDGET_WARN_THRESHOLD): BudgetLevel {
	if (fraction >= 1) return 'over';
	if (fraction >= threshold) return 'warn';
	return 'ok';
}

function fractionOf(w: BudgetWindow | null): number {
	if (!w || w.budgetUsd <= 0) return 0;
	return w.spentUsd / w.budgetUsd;
}

/** One gauge row: a single capped window of one service. */
export interface BudgetRow {
	key: string;
	serviceName: string;
	window: 'daily' | 'monthly';
	spentUsd: number;
	budgetUsd: number;
	/** spent / budget — may exceed 1 when over the ceiling */
	fraction: number;
}

/**
 * Flatten standings into one row per window that actually has a ceiling, daily
 * before monthly within a service. Uncapped windows are skipped.
 */
export function budgetRows(statuses: BudgetStatus[]): BudgetRow[] {
	return statuses.flatMap((s) =>
		(['daily', 'monthly'] as const).flatMap((window) => {
			const w = s[window];
			if (!w || w.budgetUsd <= 0) return [];
			return [
				{
					key: `${s.serviceId}-${window}`,
					serviceName: s.serviceName,
					window,
					spentUsd: w.spentUsd,
					budgetUsd: w.budgetUsd,
					fraction: fractionOf(w)
				}
			];
		})
	);
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
			instance: s.instance === true,
			level,
			window: useDaily ? 'daily' : 'monthly',
			budgetUsd: window.budgetUsd,
			spentUsd: window.spentUsd,
			fraction
		});
	}
	return warnings.sort((a, b) => b.fraction - a.fraction);
}

/**
 * The budget banner's heading, derived from what it lists so it never says
 * "Service over budget" above an instance ceiling, or names one service when
 * three are listed. Leads with the worst news: the instance ceiling blocks every
 * service at once, so it outranks any number of individual ones.
 */
export function budgetAlertTitle(warnings: BudgetWarning[]): string {
	const over = warnings.filter((w) => w.level === 'over');
	const pool = over.length > 0 ? over : warnings;
	const [first] = pool;
	if (!first) return '';
	const verb = over.length > 0 ? 'over budget' : 'approaching budget';
	if (pool.some((w) => w.instance)) {
		return over.length > 0 ? 'Instance budget exceeded' : 'Instance approaching budget';
	}
	if (pool.length === 1) return `Service ${first.serviceName} ${verb}`;
	return `${pool.length} services ${verb}`;
}

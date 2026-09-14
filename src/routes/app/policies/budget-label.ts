/** A preset's budget ceilings as a short label, e.g. "$5/day · $100/mo". */
export function formatBudget(daily: string | number, monthly: string | number): string {
	const d = Number(daily);
	const m = Number(monthly);
	const parts: string[] = [];
	if (d > 0) parts.push(`$${d}/day`);
	if (m > 0) parts.push(`$${m}/mo`);
	return parts.length ? parts.join(' · ') : 'No budget';
}

<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { budgetLevel, type BudgetStatus, type BudgetWindow } from '$lib/budget';
	import { formatUsd } from '$lib/format';

	// Always-on spend-vs-ceiling gauges (cf. the OpenAI "June spend $2.44 / $10.00"
	// card). Distinct from budget-alert.svelte, which only shouts once a service is
	// at/over the warn threshold — this stays visible for any service carrying a
	// daily or monthly ceiling, so the headroom is glanceable before it's a problem.
	// Renders nothing when no ceilings are configured.

	let {
		statuses,
		threshold,
		showServiceName = true,
		title = 'Budgets',
		description = 'Spend against policy ceilings this period'
	}: {
		statuses: BudgetStatus[];
		/** matches the org's configured alert threshold; defaults to the shared 80% */
		threshold?: number;
		/** drop the service name when the surrounding page already identifies it */
		showServiceName?: boolean;
		/** card heading + subtext, so the same gauge serves service & instance scopes */
		title?: string;
		description?: string;
	} = $props();

	type Row = {
		key: string;
		serviceName: string;
		window: 'daily' | 'monthly';
		spentUsd: number;
		budgetUsd: number;
		fraction: number;
	};

	function rowsFor(s: BudgetStatus): Row[] {
		const out: Row[] = [];
		const add = (window: 'daily' | 'monthly', w: BudgetWindow | null) => {
			if (!w || w.budgetUsd <= 0) return;
			out.push({
				key: `${s.serviceId}-${window}`,
				serviceName: s.serviceName,
				window,
				spentUsd: w.spentUsd,
				budgetUsd: w.budgetUsd,
				fraction: w.spentUsd / w.budgetUsd
			});
		};
		add('daily', s.daily);
		add('monthly', s.monthly);
		return out;
	}

	const rows = $derived(statuses.flatMap(rowsFor));

	// Healthy → calm green; approaching → amber; over → destructive, matching the
	// alert banner's semantics so a service reads the same in both places.
	const FILL: Record<string, string> = {
		ok: 'bg-emerald-500',
		warn: 'bg-amber-500',
		over: 'bg-destructive'
	};
</script>

{#if rows.length > 0}
	<Card.Root>
		<Card.Header class="pb-3">
			<Card.Title class="text-base">{title}</Card.Title>
			<Card.Description>{description}</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#each rows as r (r.key)}
				{@const level = budgetLevel(r.fraction, threshold)}
				{@const pct = Math.min(100, Math.round(r.fraction * 100))}
				<div>
					<div class="flex items-baseline justify-between gap-2 text-sm">
						<span class="flex min-w-0 items-baseline gap-2">
							{#if showServiceName}
								<span class="truncate font-medium">{r.serviceName}</span>
							{/if}
							<span class="shrink-0 text-xs text-muted-foreground capitalize">{r.window}</span>
						</span>
						<span class="shrink-0 tabular-nums">
							<span
								class={level === 'over'
									? 'font-semibold text-destructive'
									: level === 'warn'
										? 'font-semibold text-amber-600 dark:text-amber-400'
										: 'font-medium'}
							>
								{formatUsd(r.spentUsd)}
							</span>
							<span class="text-muted-foreground">/ {formatUsd(r.budgetUsd)}</span>
						</span>
					</div>
					<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
						<div class="h-full rounded-full {FILL[level]}" style="width: {Math.max(2, pct)}%"></div>
					</div>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
{/if}

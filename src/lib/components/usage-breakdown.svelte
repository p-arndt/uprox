<script lang="ts" module>
	import type { LucideIcon } from '@lucide/svelte';

	/**
	 * The fields every breakdown row carries. The required figures drive the bars
	 * and footer; the optional fields are the labels each dimension renders through
	 * the `rowLabel` snippet (a service has `serviceId`, a model has `model`, etc.),
	 * so one row type covers all dimensions without per-section generics.
	 */
	export type BreakdownRow = {
		costUsd: number;
		requests: number;
		inputTokens: number;
		outputTokens: number;
		denied: number;
		serviceId?: string | null;
		serviceName?: string | null;
		model?: string;
		provider?: string | null;
		tokenId?: string | null;
		tokenName?: string | null;
		tokenDisplay?: string | null;
	};

	export type BreakdownSection = {
		key: string;
		label: string;
		icon: LucideIcon;
		rows: BreakdownRow[];
		/** true when the server clipped the list to the top-N */
		truncated?: boolean;
		/** shown in place of rows when the section has no traffic */
		emptyText?: string;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { formatUsd, formatTokens } from '$lib/format';

	let {
		sections,
		breakdownLimit,
		rowLabel,
		title = 'Breakdown',
		description = 'Where spend and token volume are concentrated'
	}: {
		sections: BreakdownSection[];
		breakdownLimit: number;
		/** renders the left-hand label for a row, given the row and its section key */
		rowLabel: Snippet<[BreakdownRow, string]>;
		title?: string;
		description?: string;
	} = $props();

	type SortKey = 'cost' | 'requests' | 'tokens';
	let sortBy = $state<SortKey>('cost');
	const SORTS: { key: SortKey; label: string }[] = [
		{ key: 'cost', label: 'Spend' },
		{ key: 'requests', label: 'Requests' },
		{ key: 'tokens', label: 'Tokens' }
	];

	// User-selected tab, falling back to the first section until one is picked.
	// Derived (not a $state initializer) so it tracks `sections` without the
	// "captures only the initial value" warning.
	let picked = $state('');
	const active = $derived(picked || (sections[0]?.key ?? ''));

	const tokensOf = (r: BreakdownRow) => r.inputTokens + r.outputTokens;
	const metricOf = (r: BreakdownRow) =>
		sortBy === 'cost' ? r.costUsd : sortBy === 'requests' ? r.requests : tokensOf(r);

	function sortRows(rows: readonly BreakdownRow[]): BreakdownRow[] {
		return [...rows].sort((a, b) => metricOf(b) - metricOf(a));
	}
	function primaryValue(r: BreakdownRow): string {
		if (sortBy === 'cost') return formatUsd(r.costUsd);
		if (sortBy === 'requests') return `${r.requests.toLocaleString()} req`;
		return `${formatTokens(tokensOf(r))} tok`;
	}
	function barPct(r: BreakdownRow, total: number): number {
		const v = metricOf(r);
		return Math.max(2, Math.round((total > 0 ? v / total : 0) * 100));
	}

	// Rank → palette colour, so the leading rows stand apart instead of one flat
	// purple. Beyond the palette, fall back to the lead colour.
	const RANK_COLORS = [
		'var(--color-chart-1)',
		'var(--color-chart-2)',
		'var(--color-chart-3)',
		'var(--color-chart-4)',
		'var(--color-chart-5)'
	];
	const barColor = (rank: number) =>
		rank < RANK_COLORS.length ? RANK_COLORS[rank] : 'var(--color-chart-1)';
</script>

<Card.Root>
	<Tabs.Root value={active} onValueChange={(v) => (picked = v)}>
		<Card.Header
			class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0"
		>
			<div>
				<Card.Title>{title}</Card.Title>
				<Card.Description>{description}</Card.Description>
			</div>
			<div class="flex flex-wrap items-center gap-2">
				<span class="text-xs font-medium text-muted-foreground">Sort by</span>
				<div class="flex shrink-0 gap-1 rounded-lg border p-0.5">
					{#each SORTS as s (s.key)}
						<button
							type="button"
							onclick={() => (sortBy = s.key)}
							class="rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors {s.key === sortBy
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							{s.label}
						</button>
					{/each}
				</div>
			</div>
		</Card.Header>
		<Card.Content class="space-y-4">
			<Tabs.List class="w-full justify-start">
				{#each sections as s (s.key)}
					{@const Icon = s.icon}
					<Tabs.Trigger value={s.key}><Icon class="size-3.5" /> {s.label}</Tabs.Trigger>
				{/each}
			</Tabs.List>

			{#each sections as s (s.key)}
				{@const sorted = sortRows(s.rows)}
				{@const total = s.rows.reduce((sum, r) => sum + metricOf(r), 0)}
				<Tabs.Content value={s.key} class="mt-0 space-y-3">
					{#if s.rows.length === 0 && s.emptyText}
						<p class="py-6 text-center text-sm text-muted-foreground">{s.emptyText}</p>
					{/if}
					{#each sorted as row, i (i)}
						<div>
							<div class="flex items-baseline justify-between gap-2 text-sm">
								<span class="flex min-w-0 items-baseline gap-2">
									{@render rowLabel(row, s.key)}
								</span>
								<span class="shrink-0 tabular-nums">{primaryValue(row)}</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full"
									style="width: {barPct(row, total)}%; background-color: {barColor(i)}"
								></div>
							</div>
							<div class="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
								<span>{row.requests.toLocaleString()} requests</span>
								<span class="flex items-center gap-2">
									{#if row.inputTokens > 0 || row.outputTokens > 0}
										<span title="input / output tokens">
											{formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out
										</span>
									{/if}
									{#if row.denied > 0}
										<span class="text-destructive">{row.denied.toLocaleString()} denied</span>
									{/if}
								</span>
							</div>
						</div>
					{/each}
					{#if s.truncated}
						<p class="pt-1 text-xs text-muted-foreground">
							Showing the top {breakdownLimit} by request volume.
						</p>
					{/if}
				</Tabs.Content>
			{/each}
		</Card.Content>
	</Tabs.Root>
</Card.Root>

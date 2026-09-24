<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import DeltaPill from '$lib/components/data/delta-pill.svelte';
	import Sparkline from '$lib/components/data/sparkline.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { UsageTotals, UsageSeries } from '$lib/features/usage/types';
	import { headlineCells } from '$lib/features/usage/headline';

	// One summary band, not two rows of assorted cards. Spend, volume and health
	// used to live in a 4-card grid plus a separate reliability strip further
	// down the page — two visual languages for figures that answer the same
	// question ("what happened in this window?"). They are one row of cells in
	// one card now, so reading across them is a single horizontal scan.

	let {
		totals,
		prevTotals,
		comparison = 'ready',
		comparedWith,
		series
	}: {
		totals: UsageTotals;
		/** previous window; null while it streams in or when it failed */
		prevTotals: UsageTotals | null;
		comparison?: 'pending' | 'ready' | 'failed';
		/** the previous window's exact dates, for the "vs previous period" tooltip */
		comparedWith: string;
		series: UsageSeries;
	} = $props();

	const cells = $derived(headlineCells(totals, prevTotals, series.points));
</script>

<Card.Root class="overflow-hidden py-0">
	<!-- Six cells: 2, 3 and 6 columns all divide them evenly, so no breakpoint
	     leaves a lone cell stranded on its own row. -->
	<div class="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-3 xl:grid-cols-6">
		{#each cells as c (c.label)}
			<div class="flex flex-col gap-1 p-4 {c.alert ? 'bg-destructive/5' : ''}">
				<p
					class="text-xs font-medium tracking-wide uppercase {c.alert
						? 'text-destructive'
						: 'text-muted-foreground'}"
				>
					{c.label}
				</p>
				<p class="text-2xl font-semibold tabular-nums {c.alert ? 'text-destructive' : ''}">
					{c.value}
				</p>
				<!-- fixed height: the cells without a period-over-period baseline
				     would otherwise sit a line higher than the others and break the scan -->
				<div class="flex h-5 items-center gap-2">
					{#if c.delta !== undefined}
						<DeltaPill value={c.delta} tone={c.tone ?? 'neutral'} />
						<Tooltip.Provider delayDuration={120}>
							<Tooltip.Root>
								<Tooltip.Trigger
									class="cursor-help text-xs text-muted-foreground underline decoration-dotted underline-offset-2"
								>
									vs previous period
								</Tooltip.Trigger>
								<Tooltip.Content side="bottom">Compared with {comparedWith}</Tooltip.Content>
							</Tooltip.Root>
						</Tooltip.Provider>
					{:else if c.compares && comparison === 'pending'}
						<Skeleton class="h-4 w-28 rounded-md" aria-hidden="true" />
					{:else if c.compares && comparison === 'failed'}
						<span class="text-xs text-muted-foreground">Comparison unavailable</span>
					{/if}
				</div>
				<p class="text-xs text-muted-foreground tabular-nums">{c.note}</p>
				<!-- the spacer keeps every cell's baseline grid identical, so the
				     figures line up even though only three carry a trend line -->
				<div class="mt-auto pt-2">
					{#if c.spark}
						<Sparkline values={c.spark} class="h-7" />
					{:else}
						<div class="h-7" aria-hidden="true"></div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</Card.Root>

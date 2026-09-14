<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import DeltaPill from '$lib/components/delta-pill.svelte';
	import Sparkline from '$lib/components/sparkline.svelte';
	import type { UsageTotals, UsageSeries } from '$lib/features/usage/types';
	import { headlineCells } from '$lib/features/usage/headline';

	// One summary band, not two rows of assorted cards. Spend, volume and health
	// used to live in a 4-card grid plus a separate reliability strip further
	// down the page — two visual languages for figures that answer the same
	// question ("what happened in this window?"), and errors/denials were stated
	// in both. They are one row of cells in one card now, so reading across them
	// is a single horizontal scan.

	let {
		totals,
		prevTotals,
		series,
		rangeLabel
	}: {
		totals: UsageTotals;
		prevTotals: UsageTotals;
		series: UsageSeries;
		rangeLabel: string;
	} = $props();

	const cells = $derived(headlineCells(totals, prevTotals, series.points));
</script>

<Card.Root class="overflow-hidden py-0">
	<div class="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-5">
		{#each cells as c (c.label)}
			<div class="flex flex-col gap-1 p-4">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{c.label}</p>
				<p class="text-2xl font-semibold tabular-nums">{c.value}</p>
				<!-- fixed height: cache rate and latency have no period-over-period
				     baseline, and without the reserved row their notes would sit a
				     line higher than the other three and break the scan -->
				<div class="flex h-5 items-center gap-2">
					{#if c.delta !== undefined}
						<DeltaPill value={c.delta} tone={c.tone ?? 'neutral'} />
						<span class="text-xs text-muted-foreground">vs prev {rangeLabel}</span>
					{/if}
				</div>
				<p class="text-xs text-muted-foreground tabular-nums">{c.note}</p>
				<!-- the spacer keeps every cell's baseline grid identical, so the five
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

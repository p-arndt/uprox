<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import DeltaPill from '$lib/components/delta-pill.svelte';
	import Sparkline from '$lib/components/sparkline.svelte';
	import type { UsageTotals, UsageSeries } from '$lib/server/data';
	import { formatUsd, formatTokens, formatCount } from '$lib/format';
	import { cacheRate } from '$lib/cache-rate';

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

	const totalTokens = $derived(totals.inputTokens + totals.outputTokens);
	const tokenCacheRate = $derived(cacheRate(totals).rate);
	const avgCostPerReq = $derived(totals.requests > 0 ? totals.costUsd / totals.requests : 0);
	const errorRate = $derived(totals.requests > 0 ? totals.errors / totals.requests : 0);

	// Period-over-period against the immediately-preceding equal-length window.
	// Null when there's no prior baseline to divide by.
	function pctDelta(cur: number, prior: number): number | null {
		if (!prior || prior <= 0) return null;
		return ((cur - prior) / prior) * 100;
	}

	function formatMs(ms: number | null): string {
		if (ms == null) return '—';
		return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
	}

	type Cell = {
		label: string;
		value: string;
		/** signed % vs the previous window, or null where a delta is meaningless */
		delta?: number | null;
		tone?: 'cost' | 'neutral';
		/** the qualifier under the figure — where the number came from */
		note: string;
		/** per-bucket values; cells without a meaningful trend line omit it */
		spark?: number[];
	};

	const cells = $derived<Cell[]>([
		{
			label: 'Spend',
			value: formatUsd(totals.costUsd),
			delta: pctDelta(totals.costUsd, prevTotals.costUsd),
			tone: 'cost',
			note: `${formatUsd(avgCostPerReq)} avg / request`,
			spark: series.points.map((p) => p.costUsd)
		},
		{
			label: 'Requests',
			value: formatCount(totals.requests),
			delta: pctDelta(totals.requests, prevTotals.requests),
			note: `${(errorRate * 100).toFixed(1)}% errors · ${formatCount(totals.denied)} denied`,
			spark: series.points.map((p) => p.requests)
		},
		{
			label: 'Tokens',
			value: formatTokens(totalTokens),
			delta: pctDelta(totalTokens, prevTotals.inputTokens + prevTotals.outputTokens),
			note: `${formatTokens(totals.inputTokens)} in · ${formatTokens(totals.outputTokens)} out`,
			spark: series.points.map((p) => p.inputTokens + p.outputTokens)
		},
		{
			label: 'Cache rate',
			value: `${(tokenCacheRate * 100).toFixed(1)}%`,
			note: `${formatTokens(totals.savedInputTokens)} uprox · ${formatTokens(totals.providerCachedTokens)} provider`
		},
		{
			label: 'Latency p95',
			value: formatMs(totals.latencyP95),
			note: `p50 ${formatMs(totals.latencyP50)}`
		}
	]);
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

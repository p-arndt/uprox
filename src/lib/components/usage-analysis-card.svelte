<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import UsageStackedChart from '$lib/components/usage-stacked-chart.svelte';
	import UsageLegend from '$lib/components/usage-legend.svelte';
	import { BUCKET_OPTIONS } from '$lib/usage-range';
	import { dimensionLabel, type UsageDimension } from '$lib/usage-group';
	import type { GroupedSeriesResult } from '$lib/server/data';
	import type { ResolvedPathname } from '$app/types';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

	// The chart card: metric switcher, display options, the stacked chart, its
	// legend, and the granularity control directly under the axis it changes.

	let {
		grouped,
		groupBy,
		rangeLabel,
		bucket,
		bucketHref
	}: {
		grouped: GroupedSeriesResult;
		groupBy: UsageDimension;
		rangeLabel: string;
		bucket: string;
		bucketHref: (key: string) => ResolvedPathname;
	} = $props();

	type Metric = 'cost' | 'requests' | 'tokens';
	let metric = $state<Metric>('cost');
	const ALL_METRICS: { key: Metric; label: string }[] = [
		{ key: 'cost', label: 'Spend' },
		{ key: 'requests', label: 'Requests' },
		{ key: 'tokens', label: 'Tokens' }
	];
	// A request contributes to several meters at once, so it can't be attributed
	// to one — the requests metric is dropped rather than shown as zero.
	const METRICS = $derived(
		groupBy === 'meter' ? ALL_METRICS.filter((m) => m.key !== 'requests') : ALL_METRICS
	);
	$effect(() => {
		if (groupBy === 'meter' && metric === 'requests') metric = 'cost';
	});

	type ChartType = 'bars' | 'area';
	let chartType = $state<ChartType>('bars');
	let normalized = $state(false);
	let cumulative = $state(false);
	let highlighted = $state<string | null>(null);
	// Series toggled off from the legend. Owned here so the chart and the legend
	// share one source of truth; reset whenever the grouping changes, since the
	// keys of the old dimension mean nothing to the new one.
	let hidden = $state<string[]>([]);
	$effect(() => {
		groupBy;
		hidden = [];
	});

	// Normalized and cumulative are mutually exclusive: a running total rescaled
	// to 100% per bucket is a chart of nothing. Turning one on clears the other.
	function setNormalized(v: boolean) {
		normalized = v;
		if (v) cumulative = false;
	}
	function setCumulative(v: boolean) {
		cumulative = v;
		if (v) normalized = false;
	}

	const UNIT_ADVERB: Record<string, string> = {
		hour: 'hourly',
		day: 'daily',
		week: 'weekly',
		month: 'monthly'
	};

	const metricLabel = $derived(METRICS.find((m) => m.key === metric)?.label ?? 'Spend');
	const shape = $derived(
		normalized
			? '100% stacked'
			: cumulative
				? 'accumulated'
				: (UNIT_ADVERB[grouped.unit] ?? grouped.unit)
	);
	const optionsActive = $derived(chartType !== 'bars' || normalized || cumulative);
</script>

<Card.Root>
	<Card.Header
		class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0"
	>
		<div>
			<Card.Title>{metricLabel} over time</Card.Title>
			<Card.Description>
				{shape} · by {dimensionLabel(groupBy).toLowerCase()} · {rangeLabel}
			</Card.Description>
		</div>
		<div class="flex shrink-0 items-center gap-2">
			<div class="flex gap-1 rounded-lg border p-0.5">
				{#each METRICS as m (m.key)}
					<button
						type="button"
						onclick={() => (metric = m.key)}
						class="rounded-md px-3 py-1 text-sm font-medium transition-colors {m.key === metric
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						{m.label}
					</button>
				{/each}
			</div>
			<Popover.Root>
				<Popover.Trigger
					class="flex size-8 items-center justify-center rounded-lg border transition-colors hover:bg-accent {optionsActive
						? 'text-accent-foreground'
						: 'text-muted-foreground'}"
					title="Chart options"
				>
					<SlidersHorizontal class="size-4" />
				</Popover.Trigger>
				<Popover.Content align="end" class="w-60 space-y-3">
					<div class="space-y-1.5">
						<span class="text-xs font-medium text-muted-foreground">Chart type</span>
						<div class="flex gap-1 rounded-lg border p-0.5">
							{#each [{ key: 'bars', label: 'Columns' }, { key: 'area', label: 'Area' }] as c (c.key)}
								<button
									type="button"
									onclick={() => (chartType = c.key as ChartType)}
									class="flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors {c.key ===
									chartType
										? 'bg-accent text-accent-foreground'
										: 'text-muted-foreground hover:text-foreground'}"
								>
									{c.label}
								</button>
							{/each}
						</div>
					</div>
					<div class="flex items-center justify-between">
						<Label for="accumulated" class="text-sm font-normal">Accumulated</Label>
						<Switch
							id="accumulated"
							size="sm"
							checked={cumulative}
							onCheckedChange={setCumulative}
						/>
					</div>
					<div class="flex items-center justify-between">
						<Label for="normalized" class="text-sm font-normal">Show as 100%</Label>
						<Switch
							id="normalized"
							size="sm"
							checked={normalized}
							onCheckedChange={setNormalized}
						/>
					</div>
				</Popover.Content>
			</Popover.Root>
		</div>
	</Card.Header>

	<Card.Content class="space-y-3">
		<UsageStackedChart
			buckets={grouped.buckets}
			series={grouped.series}
			unit={grouped.unit}
			dim={groupBy}
			{metric}
			type={chartType}
			{normalized}
			{cumulative}
			{highlighted}
			{hidden}
		/>

		{#if grouped.series.length > 1}
			<UsageLegend series={grouped.series} dim={groupBy} {metric} bind:highlighted bind:hidden />
		{/if}

		{#if grouped.hasOthers}
			<p class="text-xs text-muted-foreground">
				Series past the top {grouped.series.length - 1} are combined into “Others”.
			</p>
		{/if}

		<!-- Granularity sits under the axis it controls. -->
		<div class="flex flex-wrap items-center gap-2 border-t pt-3">
			<span class="text-xs font-medium text-muted-foreground">Granularity</span>
			<div class="flex shrink-0 flex-wrap gap-1 rounded-lg border p-0.5">
				{#each BUCKET_OPTIONS as b (b.key)}
					<a
						href={bucketHref(b.key)}
						data-sveltekit-noscroll
						class="rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors {b.key === bucket
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						{b.label}
					</a>
				{/each}
			</div>
		</div>
	</Card.Content>
</Card.Root>

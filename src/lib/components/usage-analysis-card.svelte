<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import UsageStackedChart from '$lib/components/usage-stacked-chart.svelte';
	import UsageLegend from '$lib/components/usage-legend.svelte';
	import { BUCKET_OPTIONS } from '$lib/usage-range';
	import { dimensionLabel, isDerivedDimension, type UsageDimension } from '$lib/usage-group';
	import type { GroupedSeriesResult } from '$lib/server/data';
	import type { UsageMetric } from '$lib/features/usage/metric';
	import type { ChartMode } from '$lib/features/usage/chart-math';
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

	let pickedMetric = $state<UsageMetric>('cost');
	const ALL_METRICS: { key: UsageMetric; label: string }[] = [
		{ key: 'cost', label: 'Spend' },
		{ key: 'requests', label: 'Requests' },
		{ key: 'tokens', label: 'Tokens' }
	];
	// A request contributes to several meters — and so to several billing lines —
	// at once, so it can't be attributed to one. On those groupings the requests
	// metric is dropped rather than shown as a flat zero.
	const derivedDimension = $derived(isDerivedDimension(groupBy));
	const METRICS = $derived(
		derivedDimension ? ALL_METRICS.filter((m) => m.key !== 'requests') : ALL_METRICS
	);
	const metric = $derived<UsageMetric>(
		derivedDimension && pickedMetric === 'requests' ? 'cost' : pickedMetric
	);

	type ChartType = 'bars' | 'area';
	let chartType = $state<ChartType>('bars');
	// Normalized and cumulative are mutually exclusive — a running total rescaled
	// to 100% per bucket is a chart of nothing — so they are one mode, and
	// turning one switch on implicitly turns the other off.
	let mode = $state<ChartMode>('absolute');
	let highlighted = $state<string | null>(null);
	// Series toggled off from the legend. Owned here so the chart and the legend
	// share one source of truth; reset whenever the grouping changes, since the
	// keys of the old dimension mean nothing to the new one.
	let hidden = $derived.by<string[]>(() => {
		void groupBy;
		return [];
	});

	function setMode(target: Exclude<ChartMode, 'absolute'>, on: boolean) {
		if (on) mode = target;
		else if (mode === target) mode = 'absolute';
	}

	const UNIT_ADVERB: Record<string, string> = {
		hour: 'hourly',
		day: 'daily',
		week: 'weekly',
		month: 'monthly'
	};

	const metricLabel = $derived(METRICS.find((m) => m.key === metric)?.label ?? 'Spend');
	const shape = $derived(
		mode === 'normalized'
			? '100% stacked'
			: mode === 'cumulative'
				? 'accumulated'
				: (UNIT_ADVERB[grouped.unit] ?? grouped.unit)
	);
	const optionsActive = $derived(chartType !== 'bars' || mode !== 'absolute');
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
						onclick={() => (pickedMetric = m.key)}
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
							checked={mode === 'cumulative'}
							onCheckedChange={(v) => setMode('cumulative', v)}
						/>
					</div>
					<div class="flex items-center justify-between">
						<Label for="normalized" class="text-sm font-normal">Show as 100%</Label>
						<Switch
							id="normalized"
							size="sm"
							checked={mode === 'normalized'}
							onCheckedChange={(v) => setMode('normalized', v)}
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
			{mode}
			{highlighted}
			{hidden}
		/>

		{#if grouped.series.length > 1}
			<UsageLegend series={grouped.series} dim={groupBy} {metric} bind:highlighted
				bind:hidden={() => hidden, (v) => (hidden = v)}
			/>
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

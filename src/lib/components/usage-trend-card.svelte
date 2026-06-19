<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import UsageChart from '$lib/components/usage-chart.svelte';
	import { BUCKET_OPTIONS } from '$lib/usage-range';
	import type { UsageSeriesPoint } from '$lib/server/data';
	import type { SeriesBucket } from '$lib/usage-range';
	import type { ResolvedPathname } from '$app/types';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';

	let {
		points,
		unit,
		prevPoints,
		rangeLabel,
		bucket,
		bucketHref
	}: {
		points: UsageSeriesPoint[];
		unit: SeriesBucket;
		/** previous equal-length window, for the compare overlay */
		prevPoints: UsageSeriesPoint[];
		rangeLabel: string;
		/** the currently-selected granularity key (e.g. 'auto', 'day') */
		bucket: string;
		/** builds the URL for a granularity option, preserving other params */
		bucketHref: (key: string) => ResolvedPathname;
	} = $props();

	type Metric = 'cost' | 'requests' | 'tokens';
	let metric = $state<Metric>('cost');
	const METRICS: { key: Metric; label: string }[] = [
		{ key: 'cost', label: 'Spend' },
		{ key: 'requests', label: 'Requests' },
		{ key: 'tokens', label: 'Tokens' }
	];

	type ChartType = 'bar' | 'line' | 'area';
	let chartType = $state<ChartType>('bar');
	const CHART_TYPES: { key: ChartType; label: string }[] = [
		{ key: 'bar', label: 'Bars' },
		{ key: 'line', label: 'Line' },
		{ key: 'area', label: 'Area' }
	];
	let cumulative = $state(false);
	let compare = $state(false);

	const UNIT_ADVERB: Record<string, string> = {
		hour: 'hourly',
		day: 'daily',
		week: 'weekly',
		month: 'monthly'
	};
	const metricLabel = $derived(
		metric === 'cost' ? 'Spend' : metric === 'requests' ? 'Requests' : 'Tokens'
	);
	const chartOptionsActive = $derived(chartType !== 'bar' || cumulative || compare);
</script>

<Card.Root>
	<Card.Header class="flex flex-row items-start justify-between space-y-0">
		<div>
			<Card.Title>Trend over time</Card.Title>
			<Card.Description>
				{metricLabel} · {cumulative ? 'cumulative' : (UNIT_ADVERB[unit] ?? unit)} · {rangeLabel}
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
					class="flex size-8 items-center justify-center rounded-lg border transition-colors hover:bg-accent {chartOptionsActive
						? 'text-accent-foreground'
						: 'text-muted-foreground'}"
					title="Chart options"
				>
					<SlidersHorizontal class="size-4" />
				</Popover.Trigger>
				<Popover.Content align="end" class="w-56 space-y-3">
					<div class="space-y-1.5">
						<span class="text-xs font-medium text-muted-foreground">Chart type</span>
						<div class="flex gap-1 rounded-lg border p-0.5">
							{#each CHART_TYPES as c (c.key)}
								<button
									type="button"
									onclick={() => (chartType = c.key)}
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
						<Label for="cumulative" class="text-sm font-normal">Cumulative</Label>
						<Switch id="cumulative" size="sm" bind:checked={cumulative} />
					</div>
					<div class="flex items-center justify-between">
						<Label for="compare" class="text-sm font-normal">Compare to previous</Label>
						<Switch id="compare" size="sm" bind:checked={compare} />
					</div>
				</Popover.Content>
			</Popover.Root>
		</div>
	</Card.Header>
	<Card.Content class="space-y-3">
		<UsageChart
			{points}
			{unit}
			{metric}
			type={chartType}
			{cumulative}
			comparePoints={compare ? prevPoints : null}
		/>
		<!-- Granularity sits under the chart it controls. -->
		<div class="flex flex-wrap items-center gap-2 pt-1">
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

<script lang="ts">
	import type { GroupedSeries } from '$lib/server/data';
	import type { SeriesBucket } from '$lib/usage-range';
	import { colorForSeries } from '$lib/usage-colors';
	import { formatMetric, type UsageMetric } from '$lib/features/usage/metric';
	import {
		areaPath,
		axisLabel,
		axisScale,
		bucketCenterPct,
		bucketLabel,
		bucketTotals,
		hoverRows as buildHoverRows,
		segmentHeights,
		tickEvery as tickEveryFor,
		topSegmentIndex,
		valueMatrix,
		type ChartMode
	} from '$lib/features/usage/chart-math';

	// The cost-analysis chart: traffic over time, split into a coloured band per
	// series. Bars are real DOM elements rather than SVG rects because the mark
	// spec calls for a 2px surface gap between stacked segments and a 4px radius
	// on the stack top — both of which a `preserveAspectRatio="none"` viewBox
	// would smear horizontally. The area variant stays in SVG, where it belongs.
	// All numbers come from chart-math; this component only lays them out.

	type ChartType = 'bars' | 'area';

	let {
		buckets,
		series,
		unit,
		dim,
		metric = 'cost',
		type = 'bars',
		mode = 'absolute',
		highlighted = null,
		hidden = []
	}: {
		buckets: string[];
		/** ordered largest-first; index is the colour rank */
		series: GroupedSeries[];
		unit: SeriesBucket;
		/** the grouping dimension, so status series get the semantic palette */
		dim: string;
		metric?: UsageMetric;
		type?: ChartType;
		/** absolute values, 100% stacked per bucket, or the running total */
		mode?: ChartMode;
		/** dims every other series — driven by legend hover */
		highlighted?: string | null;
		/** series keys toggled off from the legend; excluded from stack and scale */
		hidden?: string[];
	} = $props();

	// The series actually drawn, each keeping the rank it had in the full list.
	// Colour follows the entity, not its position among the survivors: hiding a
	// series must never repaint the others, or the legend would stop matching the
	// bars the moment you toggled something.
	const vis = $derived(
		series.map((s, rank) => ({ s, rank })).filter(({ s }) => !hidden.includes(s.key))
	);
	const colors = $derived(vis.map(({ s, rank }) => colorForSeries(dim, s.key, rank)));

	const values = $derived(
		valueMatrix(
			vis.map(({ s }) => s),
			buckets.length,
			metric,
			mode
		)
	);
	const totals = $derived(bucketTotals(values, buckets.length));
	const scale = $derived(axisScale(totals, mode));
	const heights = $derived(segmentHeights(values, totals, scale.peak, mode));
	const tickEvery = $derived(tickEveryFor(buckets.length));
	const empty = $derived(buckets.length === 0 || totals.every((v) => v <= 0));
	const normalized = $derived(mode === 'normalized');

	let hovered = $state<number | null>(null);

	const hoverRows = $derived(
		hovered === null
			? []
			: buildHoverRows(
					vis.map(({ s }) => s),
					colors,
					values,
					totals,
					hovered
				)
	);

	const bucketAria = (bi: number) =>
		`${bucketLabel(buckets[bi], unit)}: ${formatMetric(totals[bi], metric)}`;
</script>

{#snippet hitColumn(bi: number, extraClass: string)}
	<!-- shared hover wiring for both variants -->
	<button
		type="button"
		class="{extraClass} cursor-default border-0 bg-transparent {hovered === bi
			? 'bg-foreground/[0.04]'
			: ''}"
		onmouseenter={() => (hovered = bi)}
		onmouseleave={() => (hovered = null)}
		onfocus={() => (hovered = bi)}
		onblur={() => (hovered = null)}
		aria-label={bucketAria(bi)}
	>
		{#if type === 'bars'}
			{@const top = topSegmentIndex(heights, bi)}
			{#each vis as { s }, si (s.key)}
				{@const h = heights[si]?.[bi] ?? 0}
				{#if h > 0}
					<div
						class="w-full shrink-0 transition-opacity"
						style="height: {h}%; background-color: {colors[si]};
							{si === top ? 'border-top-left-radius:4px;border-top-right-radius:4px;' : ''}
							{si !== top ? 'margin-top:2px;' : ''}
							opacity: {highlighted && highlighted !== s.key ? 0.25 : 1}"
					></div>
				{/if}
			{/each}
		{/if}
	</button>
{/snippet}

{#if empty}
	<div class="flex h-64 items-center justify-center text-sm text-muted-foreground">
		<!-- Metric-specific: `totals` sums the SELECTED metric, so a window of
		     denied-only or unpriced traffic has zero spend while still having
		     requests. Saying "no activity" would contradict the headline card. -->
		No {metric === 'cost' ? 'spend' : metric} in this window
	</div>
{:else}
	<div class="flex gap-2">
		<!-- y-axis, aligned to the gridlines in the plot -->
		<div class="relative h-64 w-16 shrink-0">
			{#each scale.ticks as v, i (i)}
				<span
					class="absolute right-0 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
					style="top: {(i / (scale.ticks.length - 1)) * 100}%"
				>
					{axisLabel(v, metric, mode)}
				</span>
			{/each}
		</div>

		<div class="relative h-64 flex-1">
			<!-- recessive gridlines; the baseline is the only one at full strength -->
			<div class="pointer-events-none absolute inset-0">
				{#each scale.ticks, i (i)}
					<div
						class="absolute right-0 left-0 border-t {i === scale.ticks.length - 1
							? 'border-border'
							: 'border-border/40'}"
						style="top: {(i / (scale.ticks.length - 1)) * 100}%"
					></div>
				{/each}
			</div>

			{#if type === 'bars'}
				<!-- One column per bucket; segments stack bottom-up inside it. -->
				<div class="absolute inset-0 flex items-end gap-px">
					{#each buckets as b, bi (b)}
						{@render hitColumn(
							bi,
							'group relative flex h-full flex-1 flex-col-reverse justify-start p-0'
						)}
					{/each}
				</div>
			{:else}
				<svg
					class="absolute inset-0 h-full w-full"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					{#each vis as { s }, si (s.key)}
						<path
							d={areaPath(heights, si, buckets.length)}
							fill={colors[si]}
							opacity={highlighted && highlighted !== s.key ? 0.2 : 0.85}
						/>
					{/each}
				</svg>
				<!-- transparent hit columns, so hover works the same in both variants -->
				<div class="absolute inset-0 flex">
					{#each buckets as b, bi (b)}
						{@render hitColumn(bi, 'h-full flex-1')}
					{/each}
				</div>
			{/if}

			<!-- crosshair on the hovered bucket -->
			{#if hovered !== null}
				<div
					class="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/20"
					style="left: {bucketCenterPct(hovered, buckets.length)}%"
				></div>
			{/if}
		</div>
	</div>

	<!-- x-axis ticks -->
	<div class="mt-1 flex gap-2">
		<div class="w-16 shrink-0"></div>
		<div class="relative h-4 flex-1">
			{#each buckets as b, i (b)}
				{#if i % tickEvery === 0}
					<span
						class="absolute -translate-x-1/2 text-[10px] whitespace-nowrap text-muted-foreground"
						style="left: {bucketCenterPct(i, buckets.length)}%"
					>
						{bucketLabel(b, unit)}
					</span>
				{/if}
			{/each}
		</div>
	</div>

	<!-- Tooltip. Rendered outside the plot so it can't be clipped by it, and
	     side-flipped past the midpoint so it never runs off the card. -->
	{#if hovered !== null && hoverRows.length > 0}
		{@const pct = bucketCenterPct(hovered, buckets.length)}
		{@const leftSide = hovered < buckets.length / 2}
		<div class="pointer-events-none relative">
			<div
				class="absolute z-20 w-72 rounded-lg border bg-popover p-2.5 shadow-lg"
				style="{leftSide ? 'left' : 'right'}: calc({leftSide ? pct : 100 - pct}% + 1rem); bottom: 0.5rem;"
			>
				<div class="mb-1.5 flex items-baseline justify-between gap-2">
					<span class="text-xs font-medium">{bucketLabel(buckets[hovered], unit)}</span>
					<span class="text-xs text-muted-foreground tabular-nums">
						{formatMetric(totals[hovered], metric)}
					</span>
				</div>
				<div class="space-y-1">
					{#each hoverRows.slice(0, 10) as r (r.key)}
						<div class="flex items-center gap-1.5 text-xs">
							<span
								class="size-2 shrink-0 rounded-[2px]"
								style="background-color: {r.color}"
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1 truncate text-muted-foreground">{r.label}</span>
							<span class="shrink-0 tabular-nums">
								{normalized ? `${(r.share * 100).toFixed(1)}%` : formatMetric(r.value, metric)}
							</span>
						</div>
					{/each}
					{#if hoverRows.length > 10}
						<p class="pt-0.5 text-[10px] text-muted-foreground">
							+{hoverRows.length - 10} more
						</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}
{/if}

<script lang="ts">
	import type { UsageSeriesPoint } from '$lib/server/data';
	import type { SeriesBucket } from '$lib/usage-range';
	import { formatUsd, formatTokens } from '$lib/format';

	type Metric = 'cost' | 'requests' | 'tokens';
	type ChartType = 'bar' | 'line' | 'area';

	let {
		points,
		unit,
		metric,
		type = 'bar',
		cumulative = false,
		comparePoints = null
	}: {
		points: UsageSeriesPoint[];
		unit: SeriesBucket;
		metric: Metric;
		/** bar (default), line, or filled area */
		type?: ChartType;
		/** plot the running total across the window instead of per-bucket values */
		cumulative?: boolean;
		/** the immediately-preceding equal-length window, overlaid for comparison */
		comparePoints?: UsageSeriesPoint[] | null;
	} = $props();

	const MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];

	// Buckets are UTC-aligned (see orgUsageSeries), so format them in UTC too —
	// formatting in the viewer's local zone would smear the sub-day buckets.
	function bucketLabel(iso: string): string {
		const d = new Date(iso);
		const md = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
		if (unit === 'hour') return `${md} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
		if (unit === 'month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
		if (unit === 'week') return `wk ${md}`;
		return md;
	}

	// The raw per-bucket value for the active metric.
	function rawValue(p: UsageSeriesPoint): number {
		if (metric === 'cost') return p.costUsd;
		if (metric === 'requests') return p.requests;
		return p.inputTokens + p.outputTokens;
	}

	function formatValue(v: number): string {
		if (metric === 'cost') return formatUsd(v);
		if (metric === 'requests') return Math.round(v).toLocaleString();
		return formatTokens(v);
	}

	// Apply the running-total transform when cumulative is on.
	function accumulate(arr: number[]): number[] {
		if (!cumulative) return arr;
		let s = 0;
		return arr.map((v) => (s += v));
	}

	const values = $derived(accumulate(points.map(rawValue)));
	const compareValues = $derived(comparePoints ? accumulate(comparePoints.map(rawValue)) : null);
	// Scale to the actual peak across both series (honest comparison); only fall
	// back to 1 when everything is zero, so we never divide by zero. NOTE: no
	// artificial floor — flooring cost at 1 would flatten sub-cent spend to nothing.
	const rawMax = $derived(Math.max(0, ...values, ...(compareValues ?? [])));
	const peak = $derived(rawMax > 0 ? rawMax : 1);

	const n = $derived(points.length);
	const band = $derived(n > 0 ? 100 / n : 100);
	const xCenter = (i: number) => (i + 0.5) * band;
	const yOf = (v: number) => 100 - (v / peak) * 100;

	// Empty buckets render flat against the baseline (no stub) so a sparse window
	// reads as "mostly quiet" rather than a row of noise; non-empty buckets carry a
	// small minimum so a tiny value is still a visible tick.
	function barHeight(v: number): number {
		if (v <= 0) return 0;
		return cumulative ? (v / peak) * 100 : Math.max(1.5, (v / peak) * 100);
	}

	function linePath(vals: number[]): string {
		return vals
			.map((v, i) => `${i === 0 ? 'M' : 'L'}${xCenter(i).toFixed(3)},${yOf(v).toFixed(3)}`)
			.join(' ');
	}
	function areaPath(vals: number[]): string {
		if (vals.length === 0) return '';
		return `${linePath(vals)} L${xCenter(vals.length - 1).toFixed(3)},100 L${xCenter(0).toFixed(3)},100 Z`;
	}

	// Denied share is only meaningful as a per-bucket stack on the requests bars.
	const showDenied = $derived(type === 'bar' && metric === 'requests' && !cumulative);

	let hovered = $state<number | null>(null);
	const active = $derived(hovered !== null ? points[hovered] : null);
	const activePrev = $derived(
		hovered !== null && comparePoints ? (comparePoints[hovered] ?? null) : null
	);
	// Delta of the plotted (possibly cumulative) value vs the previous period.
	const activeDelta = $derived.by(() => {
		if (hovered === null || !compareValues) return null;
		const cur = values[hovered];
		const prev = compareValues[hovered];
		if (prev === undefined || prev <= 0) return null;
		return ((cur - prev) / prev) * 100;
	});

	// Three y-axis reference levels: peak, midpoint, zero.
	const yLabels = $derived([peak, peak / 2, 0]);

	// Axis ticks: first, middle, last — enough orientation without crowding.
	const ticks = $derived(
		points.length === 0
			? []
			: [0, (points.length - 1) >> 1, points.length - 1]
					.filter((i, idx, a) => a.indexOf(i) === idx)
					.map((i) => ({ i, p: points[i] }))
	);

	const totalLabel = $derived(cumulative ? null : formatValue(values.reduce((s, v) => s + v, 0)));
</script>

<div class="space-y-1.5">
	<div
		class="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground"
	>
		<span>{cumulative ? 'cumulative total' : `per ${unit}`}</span>
		{#if totalLabel}
			<span class="tabular-nums normal-case">{totalLabel} total</span>
		{/if}
	</div>

	<div class="flex gap-2">
		<!-- y-axis labels, aligned to the gridlines in the plot -->
		<div class="relative h-44 w-14 shrink-0">
			{#each yLabels as v, i (i)}
				<span
					class="absolute right-0 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
					style="top: {(i / (yLabels.length - 1)) * 100}%"
				>
					{formatValue(v)}
				</span>
			{/each}
		</div>

		<!-- plot -->
		<div class="relative h-44 flex-1">
			<!-- horizontal gridlines at each y-axis level -->
			<div class="pointer-events-none absolute inset-0">
				{#each yLabels as _, i (i)}
					<div
						class="absolute right-0 left-0 border-t {i === yLabels.length - 1
							? 'border-border'
							: 'border-border/40'}"
						style="top: {(i / (yLabels.length - 1)) * 100}%"
					></div>
				{/each}
			</div>

			<!-- Floating tooltip for the hovered bucket. -->
			{#if active && hovered !== null}
				<div
					class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-md"
					style="left: {Math.min(
						85,
						Math.max(15, ((hovered + 0.5) / points.length) * 100)
					)}%; top: 0;"
				>
					<div class="font-medium">{bucketLabel(active.bucket)}</div>
					<div class="text-muted-foreground tabular-nums">
						{#if metric === 'cost'}
							{formatUsd(values[hovered])} · {active.requests.toLocaleString()} req
						{:else if metric === 'requests'}
							{values[hovered].toLocaleString()} requests{#if active.denied > 0}
								· <span class="text-destructive">{active.denied.toLocaleString()} denied</span>{/if}
						{:else}
							{formatTokens(active.inputTokens)} in · {formatTokens(active.outputTokens)} out
						{/if}
					</div>
					{#if activePrev && activeDelta !== null}
						<div class="tabular-nums">
							<span class="text-muted-foreground">prev {formatValue(compareValues![hovered])}</span>
							<span class={activeDelta > 0 ? 'text-destructive' : 'text-emerald-500'}>
								{activeDelta > 0 ? '+' : ''}{activeDelta.toFixed(1)}%
							</span>
						</div>
					{/if}
				</div>
			{/if}

			<!-- The chart itself. preserveAspectRatio="none" lets the 0–100 viewBox
			     stretch to the container; non-scaling-stroke keeps line widths even. -->
			<svg
				class="absolute inset-0 h-full w-full"
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				aria-hidden="true"
			>
				{#if comparePoints}
					<!-- Previous period: faint dashed line behind the current series. -->
					<path
						d={linePath(compareValues ?? [])}
						fill="none"
						class="stroke-muted-foreground/40"
						stroke-width="1.25"
						stroke-dasharray="3 2"
						vector-effect="non-scaling-stroke"
					/>
				{/if}

				{#if type === 'bar'}
					{#each points as p, i (p.bucket)}
						{@const h = barHeight(values[i])}
						{@const reqDenied = p.requests > 0 ? p.denied / p.requests : 0}
						{#if h > 0}
							<rect
								x={(i * band + band * 0.15).toFixed(3)}
								y={(100 - h).toFixed(3)}
								width={(band * 0.7).toFixed(3)}
								height={h.toFixed(3)}
								rx="0.4"
								class="transition-[fill] {hovered === i ? 'fill-chart-1' : 'fill-chart-1/70'}"
							/>
							{#if showDenied && reqDenied > 0}
								<rect
									x={(i * band + band * 0.15).toFixed(3)}
									y={(100 - h).toFixed(3)}
									width={(band * 0.7).toFixed(3)}
									height={(h * reqDenied).toFixed(3)}
									class="fill-destructive/80"
								/>
							{/if}
						{/if}
					{/each}
				{:else}
					{#if type === 'area'}
						<path d={areaPath(values)} class="fill-chart-1/15" />
					{/if}
					<path
						d={linePath(values)}
						fill="none"
						class="stroke-chart-1"
						stroke-width="1.5"
						stroke-linejoin="round"
						stroke-linecap="round"
						vector-effect="non-scaling-stroke"
					/>
					{#if hovered !== null && values[hovered] > 0}
						<circle
							cx={xCenter(hovered)}
							cy={yOf(values[hovered])}
							r="2.5"
							class="fill-chart-1"
							vector-effect="non-scaling-stroke"
						/>
					{/if}
				{/if}
			</svg>

			<!-- Transparent hit columns drive the hover state regardless of chart type. -->
			<div class="absolute inset-0 flex">
				{#each points as p, i (p.bucket)}
					<button
						type="button"
						class="h-full flex-1 cursor-default border-0 bg-transparent {hovered === i
							? 'bg-foreground/[0.03]'
							: ''}"
						onmouseenter={() => (hovered = i)}
						onmouseleave={() => (hovered = null)}
						onfocus={() => (hovered = i)}
						onblur={() => (hovered = null)}
						aria-label="{bucketLabel(p.bucket)}: {formatValue(values[i])}"
					></button>
				{/each}
			</div>
		</div>
	</div>

	{#if ticks.length > 0}
		<div class="flex">
			<div class="w-14 shrink-0"></div>
			<div class="flex flex-1 justify-between text-[10px] text-muted-foreground">
				{#each ticks as t (t.i)}
					<span>{bucketLabel(t.p.bucket)}</span>
				{/each}
			</div>
		</div>
	{/if}
</div>

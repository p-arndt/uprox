<script lang="ts">
	import type { GroupedSeries } from '$lib/server/data';
	import type { SeriesBucket } from '$lib/usage-range';
	import { formatUsd, formatTokens, formatCount } from '$lib/format';
	import { colorForSeries } from '$lib/usage-colors';

	// The cost-analysis chart: traffic over time, split into a coloured band per
	// series. Bars are real DOM elements rather than SVG rects because the mark
	// spec calls for a 2px surface gap between stacked segments and a 4px radius
	// on the stack top — both of which a `preserveAspectRatio="none"` viewBox
	// would smear horizontally. The area variant stays in SVG, where it belongs.

	type Metric = 'cost' | 'requests' | 'tokens';
	type ChartType = 'bars' | 'area';

	let {
		buckets,
		series,
		unit,
		dim,
		metric = 'cost',
		type = 'bars',
		normalized = false,
		cumulative = false,
		highlighted = null,
		hidden = []
	}: {
		buckets: string[];
		/** ordered largest-first; index is the colour rank */
		series: GroupedSeries[];
		unit: SeriesBucket;
		/** the grouping dimension, so status series get the semantic palette */
		dim: string;
		metric?: Metric;
		type?: ChartType;
		/** plot each bucket as a share of its own total (100% stacked) */
		normalized?: boolean;
		/** plot the running total across the window */
		cumulative?: boolean;
		/** dims every other series — driven by legend hover */
		highlighted?: string | null;
		/** series keys toggled off from the legend; excluded from stack and scale */
		hidden?: string[];
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

	// Buckets are UTC-aligned server-side, so they're formatted in UTC too —
	// formatting in the viewer's zone would smear the sub-day buckets.
	function bucketLabel(iso: string): string {
		const d = new Date(iso);
		const md = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
		if (unit === 'hour') return `${md} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
		if (unit === 'month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
		if (unit === 'week') return `wk ${md}`;
		return md;
	}

	function rawValue(s: GroupedSeries, i: number): number {
		const p = s.points[i];
		if (!p) return 0;
		if (metric === 'cost') return p.costUsd;
		if (metric === 'requests') return p.requests;
		return p.tokens;
	}

	function formatValue(v: number): string {
		if (metric === 'cost') return formatUsd(v);
		if (metric === 'requests') return formatCount(Math.round(v));
		return formatTokens(v);
	}

	// The series actually drawn, each keeping the rank it had in the full list.
	// Colour follows the entity, not its position among the survivors: hiding a
	// series must never repaint the others, or the legend would stop matching the
	// bars the moment you toggled something.
	const vis = $derived(
		series.map((s, rank) => ({ s, rank })).filter(({ s }) => !hidden.includes(s.key))
	);

	// values[visibleIndex][bucketIndex], after the cumulative transform. Everything
	// downstream (stack geometry, axis, tooltip) reads this one matrix, so the
	// toggles can never leave the chart and its labels disagreeing.
	const values = $derived(
		vis.map(({ s }) => {
			const row = buckets.map((_, i) => rawValue(s, i));
			if (!cumulative) return row;
			let acc = 0;
			return row.map((v) => (acc += v));
		})
	);

	const bucketTotals = $derived(
		buckets.map((_, i) => values.reduce((sum, row) => sum + (row[i] ?? 0), 0))
	);

	/**
	 * Round a raw axis step up to the nearest "readable" number — 1, 2, 2.5 or 5
	 * times a power of ten. Without this the axis reads $6.459 / $4.8443 /
	 * $3.2295, which is the peak divided into quarters: technically accurate and
	 * useless for estimating a bar's value at a glance.
	 */
	function niceStep(raw: number): number {
		if (raw <= 0) return 1;
		const exp = Math.floor(Math.log10(raw));
		const pow = Math.pow(10, exp);
		const f = raw / pow;
		const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
		return nice * pow;
	}

	/** Number of gridline intervals; 4 gives 5 labels including zero. */
	const TICKS = 4;

	// Normalized mode rescales each bucket to its own total, so the axis is a
	// fixed 0-100%; otherwise round the tallest stack up to a nice step.
	const step = $derived.by(() => {
		if (normalized) return 25;
		const dataMax = Math.max(0, ...bucketTotals);
		return niceStep((dataMax > 0 ? dataMax : 1) / TICKS);
	});

	// The axis top is a whole number of steps, so every gridline lands on a round
	// value and the bars keep a little headroom instead of touching the ceiling.
	const peak = $derived(normalized ? 100 : step * TICKS);

	/** A segment's height as a percentage of the plot area. */
	function heightPct(seriesIdx: number, bucketIdx: number): number {
		const v = values[seriesIdx]?.[bucketIdx] ?? 0;
		if (v <= 0) return 0;
		if (normalized) {
			const total = bucketTotals[bucketIdx];
			return total > 0 ? (v / total) * 100 : 0;
		}
		return (v / peak) * 100;
	}

	const colors = $derived(vis.map(({ s, rank }) => colorForSeries(dim, s.key, rank)));

	/** Topmost non-empty visible series in a bucket — gets the rounded cap. */
	function topIndex(bucketIdx: number): number {
		for (let i = vis.length - 1; i >= 0; i--) if (heightPct(i, bucketIdx) > 0) return i;
		return -1;
	}

	let hovered = $state<number | null>(null);

	// Tooltip rows for the hovered bucket: every series that actually contributed,
	// largest first, so a 12-series stack doesn't produce a wall of zeroes.
	const hoverRows = $derived.by(() => {
		if (hovered === null) return [];
		return vis
			.map(({ s }, i) => ({
				key: s.key,
				label: s.label,
				color: colors[i],
				value: values[i]?.[hovered!] ?? 0,
				share: bucketTotals[hovered!] > 0 ? (values[i]![hovered!] ?? 0) / bucketTotals[hovered!] : 0
			}))
			.filter((r) => r.value > 0)
			.sort((a, b) => b.value - a.value);
	});

	// Gridlines top-down, every one a whole multiple of the step.
	const yLabels = $derived(
		Array.from({ length: TICKS + 1 }, (_, i) => (TICKS - i) * (normalized ? 25 : step))
	);

	/**
	 * Axis-tick formatting. Deliberately not `formatUsd`, whose 4 decimals are
	 * right for an exact headline figure and wrong for a tick — an axis wants the
	 * shortest label that still identifies the level.
	 */
	function axisText(v: number): string {
		if (normalized) return `${Math.round(v)}%`;
		if (metric === 'cost') {
			if (v === 0) return '$0';
			if (v >= 1000)
				return `$${v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })}`;
			// enough precision for the step size, without trailing zeroes
			const decimals = v < 0.1 ? 3 : v < 1 ? 2 : v < 10 ? 2 : 0;
			return `$${Number(v.toFixed(decimals)).toLocaleString('en-US')}`;
		}
		if (metric === 'requests') {
			return v >= 10_000
				? v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })
				: formatCount(Math.round(v));
		}
		return formatTokens(v);
	}

	// Roughly one label per ~8 buckets, so a 90-day window doesn't overprint.
	const tickEvery = $derived(Math.max(1, Math.ceil(buckets.length / 8)));

	const empty = $derived(buckets.length === 0 || bucketTotals.every((v) => v <= 0));

	// SVG geometry for the area variant. The 0-100 viewBox stretches to the
	// container, which is fine for fills (unlike the gaps and radii bars need).
	const band = $derived(buckets.length > 0 ? 100 / buckets.length : 100);
	const xAt = (i: number) => (i + 0.5) * band;

	/** Cumulative upper edge of the stack through series `idx`, as y coordinates. */
	function stackEdge(idx: number): number[] {
		return buckets.map((_, b) => {
			let acc = 0;
			for (let s = 0; s <= idx; s++) acc += heightPct(s, b);
			return 100 - acc;
		});
	}

	function areaPath(idx: number): string {
		const upper = stackEdge(idx);
		const lower = idx === 0 ? buckets.map(() => 100) : stackEdge(idx - 1);
		if (upper.length === 0) return '';
		const fwd = upper.map((y, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(2)},${y.toFixed(2)}`);
		const back = lower
			.map((y, i) => ({ y, i }))
			.reverse()
			.map(({ y, i }) => `L${xAt(i).toFixed(2)},${y.toFixed(2)}`);
		return `${fwd.join(' ')} ${back.join(' ')} Z`;
	}
</script>

{#if empty}
	<div class="flex h-64 items-center justify-center text-sm text-muted-foreground">
		<!-- Metric-specific: `bucketTotals` sums the SELECTED metric, so a window of
		     denied-only or unpriced traffic has zero spend while still having
		     requests. Saying "no activity" would contradict the headline card. -->
		No {metric === 'cost' ? 'spend' : metric} in this window
	</div>
{:else}
	<div class="flex gap-2">
		<!-- y-axis, aligned to the gridlines in the plot -->
		<div class="relative h-64 w-16 shrink-0">
			{#each yLabels as v, i (i)}
				<span
					class="absolute right-0 -translate-y-1/2 text-[10px] text-muted-foreground tabular-nums"
					style="top: {(i / (yLabels.length - 1)) * 100}%"
				>
					{axisText(v)}
				</span>
			{/each}
		</div>

		<div class="relative h-64 flex-1">
			<!-- recessive gridlines; the baseline is the only one at full strength -->
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

			{#if type === 'bars'}
				<!-- One column per bucket; segments stack bottom-up inside it. -->
				<div class="absolute inset-0 flex items-end gap-px">
					{#each buckets as b, bi (b)}
						{@const top = topIndex(bi)}
						<button
							type="button"
							class="group relative flex h-full flex-1 cursor-default flex-col-reverse justify-start border-0 bg-transparent p-0 {hovered ===
							bi
								? 'bg-foreground/[0.04]'
								: ''}"
							onmouseenter={() => (hovered = bi)}
							onmouseleave={() => (hovered = null)}
							onfocus={() => (hovered = bi)}
							onblur={() => (hovered = null)}
							aria-label="{bucketLabel(b)}: {formatValue(bucketTotals[bi])}"
						>
							{#each vis as { s }, si (s.key)}
								{@const h = heightPct(si, bi)}
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
						</button>
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
							d={areaPath(si)}
							fill={colors[si]}
							opacity={highlighted && highlighted !== s.key ? 0.2 : 0.85}
						/>
					{/each}
				</svg>
				<!-- transparent hit columns, so hover works the same in both variants -->
				<div class="absolute inset-0 flex">
					{#each buckets as b, bi (b)}
						<button
							type="button"
							class="h-full flex-1 cursor-default border-0 bg-transparent {hovered === bi
								? 'bg-foreground/[0.04]'
								: ''}"
							onmouseenter={() => (hovered = bi)}
							onmouseleave={() => (hovered = null)}
							onfocus={() => (hovered = bi)}
							onblur={() => (hovered = null)}
							aria-label="{bucketLabel(b)}: {formatValue(bucketTotals[bi])}"
						></button>
					{/each}
				</div>
			{/if}

			<!-- crosshair on the hovered bucket -->
			{#if hovered !== null}
				<div
					class="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground/20"
					style="left: {((hovered + 0.5) / buckets.length) * 100}%"
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
						style="left: {((i + 0.5) / buckets.length) * 100}%"
					>
						{bucketLabel(b)}
					</span>
				{/if}
			{/each}
		</div>
	</div>

	<!-- Tooltip. Rendered outside the plot so it can't be clipped by it, and
	     side-flipped past the midpoint so it never runs off the card. -->
	{#if hovered !== null && hoverRows.length > 0}
		<div class="pointer-events-none relative">
			<div
				class="absolute z-20 w-60 rounded-lg border bg-popover p-2.5 shadow-lg"
				style="{hovered < buckets.length / 2 ? 'left' : 'right'}: {(() => {
					const pct = ((hovered + 0.5) / buckets.length) * 100;
					return hovered < buckets.length / 2
						? `calc(${pct}% + 1rem)`
						: `calc(${100 - pct}% + 1rem)`;
				})()}; bottom: 0.5rem;"
			>
				<div class="mb-1.5 flex items-baseline justify-between gap-2">
					<span class="text-xs font-medium">{bucketLabel(buckets[hovered])}</span>
					<span class="text-xs text-muted-foreground tabular-nums">
						{formatValue(bucketTotals[hovered])}
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
								{normalized ? `${(r.share * 100).toFixed(1)}%` : formatValue(r.value)}
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

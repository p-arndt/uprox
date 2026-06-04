<script lang="ts">
	import type { UsageSeriesPoint } from '$lib/server/data';
	import { formatUsd, formatTokens } from '$lib/format';

	type Metric = 'cost' | 'requests' | 'tokens';

	let {
		points,
		unit,
		metric
	}: {
		points: UsageSeriesPoint[];
		unit: 'hour' | 'day';
		metric: Metric;
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
	// formatting in the viewer's local zone would smear the hourly buckets.
	function bucketLabel(iso: string): string {
		const d = new Date(iso);
		const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
		if (unit === 'day') return base;
		return `${base} ${String(d.getUTCHours()).padStart(2, '0')}:00`;
	}

	// The plotted height of a bucket for the active metric.
	function value(p: UsageSeriesPoint): number {
		if (metric === 'cost') return p.costUsd;
		if (metric === 'requests') return p.requests;
		return p.inputTokens + p.outputTokens;
	}

	function formatValue(v: number): string {
		if (metric === 'cost') return formatUsd(v);
		if (metric === 'requests') return v.toLocaleString();
		return formatTokens(v);
	}

	const peak = $derived(Math.max(1, ...points.map(value)));

	// Bars carry a small floor so empty buckets still register a baseline tick,
	// matching the overview sparkline.
	function heightPct(v: number): number {
		return v > 0 ? Math.max(4, (v / peak) * 100) : 2;
	}

	let hovered = $state<number | null>(null);
	const active = $derived(hovered !== null ? points[hovered] : null);

	// Axis ticks: first, middle, last — enough orientation without crowding.
	const ticks = $derived(
		points.length === 0
			? []
			: [
					{ i: 0, p: points[0] },
					{ i: (points.length - 1) >> 1, p: points[(points.length - 1) >> 1] },
					{ i: points.length - 1, p: points[points.length - 1] }
				]
	);
</script>

<div class="space-y-2">
	<div class="flex items-start justify-between text-xs text-muted-foreground tabular-nums">
		<span>{formatValue(peak)}</span>
		<span class="text-[10px] uppercase tracking-wide">per {unit}</span>
	</div>

	<div class="relative h-48">
		<!-- Floating tooltip for the hovered bucket. -->
		{#if active && hovered !== null}
			<div
				class="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap shadow-md"
				style="left: {((hovered + 0.5) / points.length) * 100}%; top: 0;"
			>
				<div class="font-medium">{bucketLabel(active.bucket)}</div>
				<div class="text-muted-foreground tabular-nums">
					{#if metric === 'cost'}
						{formatUsd(active.costUsd)} · {active.requests.toLocaleString()} req
					{:else if metric === 'requests'}
						{active.requests.toLocaleString()} requests{#if active.denied > 0}
							· <span class="text-destructive">{active.denied.toLocaleString()} denied</span>{/if}
					{:else}
						{formatTokens(active.inputTokens)} in · {formatTokens(active.outputTokens)} out
					{/if}
				</div>
			</div>
		{/if}

		<div class="flex h-full items-end gap-px">
			{#each points as p, i (p.bucket)}
				{@const reqDeniedPct = p.requests > 0 ? (p.denied / p.requests) * 100 : 0}
				<button
					type="button"
					class="group flex h-full flex-1 cursor-default flex-col justify-end"
					onmouseenter={() => (hovered = i)}
					onmouseleave={() => (hovered = null)}
					onfocus={() => (hovered = i)}
					onblur={() => (hovered = null)}
					aria-label="{bucketLabel(p.bucket)}: {formatValue(value(p))}"
				>
					<div
						class="w-full overflow-hidden rounded-sm bg-accent-foreground/60 transition-colors group-hover:bg-accent-foreground/90"
						style="height: {heightPct(value(p))}%"
					>
						{#if metric === 'requests' && p.denied > 0}
							<!-- denied share stacked at the top of the requests bar -->
							<div class="w-full bg-destructive/70" style="height: {reqDeniedPct}%"></div>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	</div>

	{#if ticks.length > 0}
		<div class="flex justify-between text-[10px] text-muted-foreground">
			{#each ticks as t (t.i)}
				<span>{bucketLabel(t.p.bucket)}</span>
			{/each}
		</div>
	{/if}
</div>

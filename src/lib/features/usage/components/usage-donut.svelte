<script lang="ts">
	import type { DimensionUsageRow } from '$lib/features/usage/types';
	import { formatMetric, type UsageMetric } from '$lib/features/usage/metric';
	import {
		DONUT_CIRCUMFERENCE,
		DONUT_RADIUS,
		donutArcs,
		donutSlices
	} from '$lib/features/usage/donut';

	// A dimension's composition over the window: ring on the left, ranked
	// direct-labelled values on the right. The label column is not decoration —
	// it is the relief for the light-mode palette slots that fall under 3:1
	// against the card, and it makes the ring readable without a colour match.

	let {
		rows,
		dim,
		metric = 'cost',
		limit = 5,
		scopeTotal = null
	}: {
		rows: DimensionUsageRow[];
		dim: string;
		metric?: UsageMetric;
		/** how many slices get their own colour before the tail becomes "Others" */
		limit?: number;
		/**
		 * The window's true total for this metric. `rows` is a server-side top-N,
		 * so summing it would under-count whenever the dimension has more values
		 * than that limit — the ring would then disagree with the headline card on
		 * the same page. Pass the scope total to keep them reconciled; the
		 * difference lands in the "Others" slice.
		 */
		scopeTotal?: number | null;
	} = $props();

	// Rank by the displayed metric and fold the tail into "Others"; see donut.ts.
	const folded = $derived(donutSlices(rows, dim, metric, limit, scopeTotal));
	const total = $derived(folded.total);
	const arcs = $derived(donutArcs(folded.slices, total));
	const format = (v: number) => formatMetric(v, metric);
</script>

{#if total <= 0}
	<p class="py-8 text-center text-sm text-muted-foreground">No activity</p>
{:else}
	<div class="flex items-center gap-4">
		<div class="relative size-28 shrink-0">
			<svg viewBox="0 0 40 40" class="size-full -rotate-90">
				{#each arcs as a (a.key)}
					<circle
						cx="20"
						cy="20"
						r={DONUT_RADIUS}
						fill="none"
						stroke={a.color}
						stroke-width="6"
						stroke-dasharray="{a.dash} {DONUT_CIRCUMFERENCE - a.dash}"
						stroke-dashoffset={-a.offset}
					>
						<title>{a.label}: {format(a.value)} ({a.pct.toFixed(1)}%)</title>
					</circle>
				{/each}
			</svg>
			<!-- total in the hole: the ring's own headline -->
			<div class="absolute inset-0 flex flex-col items-center justify-center">
				<span class="text-sm font-semibold tabular-nums">{format(total)}</span>
			</div>
		</div>

		<!-- Direct labels. Values are text-coloured; the swatch carries identity. -->
		<ul class="min-w-0 flex-1 space-y-1">
			{#each arcs as a (a.key)}
				<li class="flex items-center gap-2 text-xs">
					<span
						class="size-2.5 shrink-0 rounded-[3px]"
						style="background-color: {a.color}"
						aria-hidden="true"
					></span>
					<span class="min-w-0 flex-1 truncate" title={a.label}>{a.label}</span>
					<span class="shrink-0 tabular-nums">{format(a.value)}</span>
					<span class="w-10 shrink-0 text-right text-muted-foreground tabular-nums">
						{a.pct.toFixed(0)}%
					</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

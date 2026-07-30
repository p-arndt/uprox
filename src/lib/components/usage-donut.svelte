<script lang="ts">
	import type { DimensionUsageRow } from '$lib/server/data';
	import { colorForSeries, OTHERS_COLOR } from '$lib/usage-colors';
	import { formatUsd, formatTokens, formatCount } from '$lib/format';

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
		metric?: 'cost' | 'requests' | 'tokens';
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

	const valueOf = (r: DimensionUsageRow) =>
		metric === 'cost'
			? r.costUsd
			: metric === 'requests'
				? r.requests
				: r.inputTokens + r.outputTokens;

	const format = (v: number) =>
		metric === 'cost' ? formatUsd(v) : metric === 'requests' ? formatCount(v) : formatTokens(v);

	// Rank by the displayed metric, not by the server's cost ordering — a donut
	// showing requests must be sorted by requests or the ring and the list would
	// disagree about which slice is biggest.
	const ranked = $derived([...rows].sort((a, b) => valueOf(b) - valueOf(a)));
	const rowsTotal = $derived(ranked.reduce((s, r) => s + valueOf(r), 0));
	// Prefer the authoritative total; fall back to the rows when none was given.
	const total = $derived(scopeTotal != null && scopeTotal > 0 ? scopeTotal : rowsTotal);

	// Everything past the cut collapses into one neutral slice rather than
	// recycling a hue — a repeated colour would claim two entities are the same.
	const slices = $derived.by(() => {
		const head = ranked.slice(0, limit).filter((r) => valueOf(r) > 0);
		// Everything not in `head`: the ranked rows past the cut PLUS whatever the
		// server's top-N never returned (total − rows), so the ring always closes.
		const headValue = head.reduce((s, r) => s + valueOf(r), 0);
		const tailValue = Math.max(0, total - headValue);
		const out = head.map((r, i) => ({
			key: r.key,
			label: r.label,
			value: valueOf(r),
			color: colorForSeries(dim, r.key, i)
		}));
		if (tailValue > 0) {
			out.push({
				key: '__tail__',
				label: ranked.length > head.length ? `Others (${ranked.length - head.length}+)` : 'Others',
				value: tailValue,
				color: OTHERS_COLOR
			});
		}
		return out;
	});

	// Ring geometry via stroke-dasharray on a single circle per slice: r=15.9155
	// makes the circumference exactly 100, so a percentage IS the dash length.
	const R = 15.9155;
	const CIRC = 100;
	const arcs = $derived.by(() => {
		let offset = 0;
		return slices.map((s) => {
			const pct = total > 0 ? (s.value / total) * 100 : 0;
			// 0.6 of the gap on each side keeps a 2px-ish surface gap between arcs
			const dash = Math.max(0, pct - 0.6);
			const arc = { ...s, pct, dash, offset };
			offset += pct;
			return arc;
		});
	});
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
						r={R}
						fill="none"
						stroke={a.color}
						stroke-width="6"
						stroke-dasharray="{a.dash} {CIRC - a.dash}"
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

<script lang="ts">
	import type { GroupedSeries } from '$lib/server/data';
	import { colorForSeries } from '$lib/usage-colors';
	import { formatUsd, formatTokens, formatCount } from '$lib/format';

	// Always present whenever the chart carries two or more series: three of the
	// light-mode palette slots sit below 3:1 against the card, so these text
	// labels are what makes the chart legible rather than a nicety.
	//
	// Hovering an entry highlights that band; clicking toggles it out of the
	// chart, which also rescales the axis — the usual way to read a small series
	// that a dominant one flattens against the baseline.

	let {
		series,
		dim,
		metric = 'cost',
		highlighted = $bindable(null),
		hidden = $bindable([])
	}: {
		series: GroupedSeries[];
		dim: string;
		metric?: 'cost' | 'requests' | 'tokens';
		highlighted?: string | null;
		/** series keys toggled off, owned by the parent so the chart sees them too */
		hidden?: string[];
	} = $props();

	function valueOf(s: GroupedSeries): string {
		if (metric === 'cost') return formatUsd(s.costUsd);
		if (metric === 'requests') return formatCount(s.requests);
		return formatTokens(s.tokens);
	}

	function toggle(key: string) {
		// Never hide the last visible series: an empty plot reads as broken rather
		// than filtered, and the axis would have nothing to scale against.
		if (!hidden.includes(key) && hidden.length >= series.length - 1) return;
		hidden = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
	}
</script>

<div class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
	<ul class="flex flex-wrap gap-x-4 gap-y-1.5">
		{#each series as s, i (s.key)}
			{@const off = hidden.includes(s.key)}
			{@const color = colorForSeries(dim, s.key, i)}
			<!-- Hovering a hidden entry deliberately leaves `highlighted` null: there
			     is no band to bring forward, so the only visible effect would be
			     dimming every other series and washing out the whole chart. -->
			<li>
				<button
					type="button"
					onclick={() => toggle(s.key)}
					onmouseenter={() => (highlighted = off ? null : s.key)}
					onmouseleave={() => (highlighted = null)}
					onfocus={() => (highlighted = off ? null : s.key)}
					onblur={() => (highlighted = null)}
					aria-pressed={!off}
					title={off ? `Show ${s.label}` : `Hide ${s.label}`}
					class="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs transition-opacity hover:bg-muted/60"
					style="opacity: {off ? 0.45 : highlighted && highlighted !== s.key ? 0.45 : 1}"
				>
					<!-- Hollow swatch + strikethrough when off, so "hidden" doesn't rely
					     on opacity alone — the hover-dim state uses that too. -->
					<span
						class="size-2.5 shrink-0 rounded-[3px] border"
						style="background-color: {off ? 'transparent' : color}; border-color: {color}"
						aria-hidden="true"
					></span>
					<span class="max-w-48 truncate {off ? 'line-through' : ''}">{s.label}</span>
					<span class="text-muted-foreground tabular-nums">{valueOf(s)}</span>
				</button>
			</li>
		{/each}
	</ul>

	{#if hidden.length > 0}
		<button
			type="button"
			class="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
			onclick={() => (hidden = [])}
		>
			Show all
		</button>
	{/if}
</div>

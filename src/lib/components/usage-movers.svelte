<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { UsageMover } from '$lib/server/data';
	import { dimensionLabel, type UsageDimension } from '$lib/usage-group';
	import { formatUsd } from '$lib/format';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import TrendingDown from '@lucide/svelte/icons/trending-down';

	// "What changed" — the series whose spend moved most against the previous
	// equal-length window. Ranked by absolute dollars, because a percentage
	// ranking floats trivia to the top (a $0.01 → $0.05 model is +400%).

	let {
		movers,
		dim,
		rangeLabel
	}: {
		movers: UsageMover[];
		dim: UsageDimension;
		rangeLabel: string;
	} = $props();

	// Bars are scaled to the largest move in either direction, so increases and
	// decreases stay visually comparable on one shared scale.
	const maxAbs = $derived(Math.max(0, ...movers.map((m) => Math.abs(m.deltaUsd))));
	const width = (m: UsageMover) => (maxAbs > 0 ? (Math.abs(m.deltaUsd) / maxAbs) * 100 : 0);

	const net = $derived(movers.reduce((a, m) => a + m.deltaUsd, 0));
</script>

<Card.Root>
	<Card.Header class="pb-3">
		<Card.Title>What changed</Card.Title>
		<Card.Description>
			Biggest {dimensionLabel(dim).toLowerCase()} spend moves vs the previous {rangeLabel.toLowerCase()},
			ranked by dollar change.
		</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if movers.length === 0}
			<p class="py-6 text-center text-sm text-muted-foreground">
				No change against the previous period.
			</p>
		{:else}
			<ul class="space-y-2.5">
				{#each movers as m (m.key)}
					{@const up = m.deltaUsd > 0}
					<li class="space-y-1">
						<div class="flex items-baseline gap-2 text-sm">
							<span class="min-w-0 flex-1 truncate font-medium" title={m.label}>{m.label}</span>
							{#if m.isNew}
								<Badge variant="outline" class="shrink-0 text-[10px]">new</Badge>
							{:else if m.isGone}
								<Badge variant="outline" class="shrink-0 text-[10px]">stopped</Badge>
							{/if}
							<span
								class="shrink-0 font-medium tabular-nums {up
									? 'text-destructive'
									: 'text-emerald-500'}"
							>
								{up ? '+' : '−'}{formatUsd(Math.abs(m.deltaUsd))}
							</span>
							<span class="w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
								{#if m.deltaPct === null}
									—
								{:else}
									{m.deltaPct > 0 ? '+' : ''}{m.deltaPct.toFixed(0)}%
								{/if}
							</span>
						</div>
						<!-- Diverging bar from a centre line: increases grow right, decreases
						     left, so direction is readable without reading the number. -->
						<div class="flex h-1.5 items-center">
							<div class="flex h-full w-1/2 justify-end">
								{#if !up}
									<div
										class="h-full rounded-l-full bg-emerald-500"
										style="width: {width(m)}%"
									></div>
								{/if}
							</div>
							<div class="h-full w-px bg-border"></div>
							<div class="flex h-full w-1/2">
								{#if up}
									<div
										class="h-full rounded-r-full bg-destructive"
										style="width: {width(m)}%"
									></div>
								{/if}
							</div>
						</div>
						<div class="flex justify-between text-xs text-muted-foreground tabular-nums">
							<span class="flex items-center gap-1">
								{#if up}
									<TrendingUp class="size-3" />
								{:else}
									<TrendingDown class="size-3" />
								{/if}
								{formatUsd(m.previousUsd)} → {formatUsd(m.currentUsd)}
							</span>
						</div>
					</li>
				{/each}
			</ul>
			<p class="mt-4 border-t pt-3 text-sm">
				<span class="text-muted-foreground">Net change across these</span>
				<span
					class="ml-1 font-semibold tabular-nums {net > 0
						? 'text-destructive'
						: 'text-emerald-500'}"
				>
					{net > 0 ? '+' : '−'}{formatUsd(Math.abs(net))}
				</span>
			</p>
		{/if}
	</Card.Content>
</Card.Root>

<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import type { UsageMover } from '$lib/features/usage/types';
	import { dimensionLabel, type UsageDimension } from '$lib/features/usage/group';
	import { formatUsd } from '$lib/format';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import TrendingDown from '@lucide/svelte/icons/trending-down';

	// "What changed" — the series whose spend moved most against the previous
	// equal-length window. Ranked by absolute dollars, because a percentage
	// ranking floats trivia to the top (a $0.01 → $0.05 model is +400%).

	let {
		movers,
		dim,
		comparedWith
	}: {
		movers: UsageMover[];
		dim: UsageDimension;
		/** the previous window's exact dates */
		comparedWith: string;
	} = $props();

	// Bars are scaled to the largest move in either direction, so increases and
	// decreases stay visually comparable on one shared scale.
	const maxAbs = $derived(Math.max(0, ...movers.map((m) => Math.abs(m.deltaUsd))));
	const width = (m: UsageMover) => (maxAbs > 0 ? (Math.abs(m.deltaUsd) / maxAbs) * 100 : 0);

	const net = $derived(movers.reduce((a, m) => a + m.deltaUsd, 0));
	// Summed floats rarely land on exactly 0, so "no net change" is judged at
	// the precision the figure is printed with.
	const netFlat = $derived(Math.abs(net) < 0.005);

	// emerald-600 on light, -400 on dark: -500 fell short of text contrast on
	// the light card
	const DOWN_TEXT = 'text-emerald-600 dark:text-emerald-400';
	const DOWN_BAR = 'bg-emerald-600 dark:bg-emerald-400';
</script>

<Card.Root>
	<Card.Header class="pb-3">
		<Card.Title>What changed</Card.Title>
		<Card.Description>
			Biggest {dimensionLabel(dim).toLowerCase()} spend moves vs the previous period ({comparedWith}),
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
							<span class="shrink-0 font-medium tabular-nums {up ? 'text-destructive' : DOWN_TEXT}">
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
									<div class="h-full rounded-l-full {DOWN_BAR}" style="width: {width(m)}%"></div>
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
					class="ml-1 font-semibold tabular-nums {netFlat
						? 'text-muted-foreground'
						: net > 0
							? 'text-destructive'
							: DOWN_TEXT}"
				>
					{#if netFlat}±{formatUsd(0)}{:else}{net > 0 ? '+' : '−'}{formatUsd(Math.abs(net))}{/if}
				</span>
			</p>
		{/if}
	</Card.Content>
</Card.Root>

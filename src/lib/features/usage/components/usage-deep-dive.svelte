<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import UsageDetailTable from '$lib/features/usage/components/usage-detail-table.svelte';
	import UsageMovers from '$lib/features/usage/components/usage-movers.svelte';
	import UsageDonutRow from '$lib/features/usage/components/usage-donut-row.svelte';
	import UsageModelEfficiency from '$lib/features/usage/components/usage-model-efficiency.svelte';
	import UsageTokenMeters from '$lib/features/usage/components/usage-token-meters.svelte';
	import UsageStreamedPanel from '$lib/features/usage/components/usage-streamed-panel.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { dimensionLabel, type UsageDimension } from '$lib/features/usage/group';
	import { latest } from '$lib/features/usage/view.svelte';
	import type { UsageAnalysis } from '$lib/features/usage/types';
	import type { DimensionUsageRow } from '$lib/features/usage/types';

	// Everything below the chart, behind one tab bar.
	//
	// These five panels used to stack: five full-width cards, four of them
	// tables, about three screens of scrolling. They are alternative *answers to
	// the same question* — "break this window down for me" — not five steps of
	// one story, so showing all of them at once forced the reader to scroll past
	// four things to reach the one they wanted. Ranked breakdown stays the
	// default because it is the answer people come for; the rest are one click
	// away, and each keeps its own heading so a tab never lands you somewhere
	// unlabelled.

	let {
		analysis,
		rangeLabel,
		rowLabel
	}: {
		analysis: UsageAnalysis;
		rangeLabel: string;
		rowLabel?: Snippet<[DimensionUsageRow, UsageDimension]>;
	} = $props();

	// The secondary panels stream in after first paint.
	const movers = latest(() => analysis.movers);
	const donuts = latest(() => analysis.donuts);
	const efficiency = latest(() => analysis.efficiency);
	const meters = latest(() => analysis.meters);

	/** A streamed tab is offered while loading or failed, and once it has rows. */
	const offer = (s: { value: unknown[]; failed: boolean } | undefined) =>
		s === undefined || s.failed || s.value.length > 0;

	// A tab that would open onto an empty panel is not offered at all, so the bar
	// only ever advertises breakdowns this window can actually show.
	const tabs = $derived(
		[
			{ key: 'breakdown', label: 'Breakdown', show: true },
			{ key: 'movers', label: 'What changed', show: offer(movers.current) },
			{ key: 'composition', label: 'Composition', show: offer(donuts.current) },
			{ key: 'efficiency', label: 'Model efficiency', show: offer(efficiency.current) },
			{ key: 'meters', label: 'Token meters', show: true }
		].filter((t) => t.show)
	);

	let picked = $state('breakdown');
	// The grouping can remove the tab that's open (movers and composition are
	// derived per-dimension), which would otherwise leave the bar with nothing
	// selected and a blank panel below it; fall back to the breakdown then.
	const active = $derived(tabs.some((t) => t.key === picked) ? picked : 'breakdown');
</script>

<Tabs.Root bind:value={() => active, (v) => (picked = v)} class="min-w-0 gap-4">
	<Tabs.List class="max-w-full overflow-x-auto">
		{#each tabs as t (t.key)}
			<Tabs.Trigger value={t.key} class="whitespace-nowrap">{t.label}</Tabs.Trigger>
		{/each}
	</Tabs.List>

	<Tabs.Content value="breakdown">
		<Card.Root>
			<Card.Header>
				<Card.Title>Detail by {dimensionLabel(analysis.groupBy).toLowerCase()}</Card.Title>
				<Card.Description>
					{#if analysis.groupBy === 'line'}
						Every rate-card line in the window — model, the card it billed against, and the meter —
						ranked by spend. The unit price is derived from the line's own spend and volume, so it
						can be checked against the pricing page.
					{:else}
						Every series in the window, ranked by spend. Share is of total spend in scope.
					{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<UsageDetailTable
					rows={analysis.breakdown}
					dim={analysis.groupBy}
					total={analysis.totals.costUsd}
					{rowLabel}
					truncated={analysis.breakdownTruncated}
					limit={analysis.breakdownLimit}
				/>
			</Card.Content>
		</Card.Root>
	</Tabs.Content>

	<Tabs.Content value="movers">
		<UsageStreamedPanel state={movers.current} title="What changed" rows={6}>
			{#snippet children(value)}
				<UsageMovers movers={value} dim={analysis.groupBy} {rangeLabel} />
			{/snippet}
		</UsageStreamedPanel>
	</Tabs.Content>

	<Tabs.Content value="composition">
		<UsageStreamedPanel state={donuts.current} title="Composition">
			{#snippet skeleton()}
				<div class="grid gap-4 lg:grid-cols-3" aria-busy="true">
					{#each Array.from({ length: 3 }, (_, i) => i) as i (i)}
						<Card.Root>
							<Card.Header class="pb-2">
								<Skeleton class="h-4 w-28 rounded-md" />
							</Card.Header>
							<Card.Content class="flex justify-center">
								<Skeleton class="aspect-square w-40 rounded-full" />
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			{/snippet}
			{#snippet children(value)}
				<UsageDonutRow panels={value} scopeTotal={analysis.totals.costUsd} />
			{/snippet}
		</UsageStreamedPanel>
	</Tabs.Content>

	<Tabs.Content value="efficiency">
		<UsageStreamedPanel state={efficiency.current} title="Model efficiency" rows={8}>
			{#snippet children(value)}
				<UsageModelEfficiency rows={value} />
			{/snippet}
		</UsageStreamedPanel>
	</Tabs.Content>

	<Tabs.Content value="meters">
		<UsageStreamedPanel state={meters.current} title="Token meters" rows={6}>
			{#snippet children(value)}
				{#if value}
					<UsageTokenMeters breakdown={value} />
				{/if}
			{/snippet}
		</UsageStreamedPanel>
	</Tabs.Content>
</Tabs.Root>

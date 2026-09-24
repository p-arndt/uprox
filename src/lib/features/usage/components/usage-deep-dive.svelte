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
		comparedWith,
		rowLabel
	}: {
		analysis: UsageAnalysis;
		/** the previous window's exact dates, which "What changed" measures against */
		comparedWith: string;
		rowLabel?: Snippet<[DimensionUsageRow, UsageDimension]>;
	} = $props();

	// The secondary panels stream in after first paint.
	const movers = latest(() => analysis.movers);
	const donuts = latest(() => analysis.donuts);
	const efficiency = latest(() => analysis.efficiency);
	const meters = latest(() => analysis.meters);

	// The tab set is fixed. Hiding the tabs whose panel would be empty made the
	// bar reshuffle as the streams landed and whenever the grouping changed, so
	// a tab could vanish from under the pointer; an empty panel now says so
	// inside itself instead.
	const TABS = [
		{ key: 'breakdown', label: 'Breakdown' },
		{ key: 'movers', label: 'What changed' },
		{ key: 'composition', label: 'Composition' },
		{ key: 'efficiency', label: 'Model efficiency' },
		{ key: 'meters', label: 'Token meters' }
	];

	let active = $state('breakdown');
</script>

{#snippet emptyPanel(title: string, message: string)}
	<Card.Root>
		<Card.Header>
			<Card.Title>{title}</Card.Title>
		</Card.Header>
		<Card.Content>
			<p class="py-6 text-center text-sm text-muted-foreground">{message}</p>
		</Card.Content>
	</Card.Root>
{/snippet}

<Tabs.Root bind:value={active} class="min-w-0 gap-4">
	<Tabs.List class="max-w-full overflow-x-auto">
		{#each TABS as t (t.key)}
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
				<UsageMovers movers={value} dim={analysis.groupBy} {comparedWith} />
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
				{#if value.every((p) => p.rows.length === 0)}
					{@render emptyPanel('Composition', 'Nothing to break down in this window.')}
				{:else}
					<UsageDonutRow panels={value} scopeTotal={analysis.totals.costUsd} />
				{/if}
			{/snippet}
		</UsageStreamedPanel>
	</Tabs.Content>

	<Tabs.Content value="efficiency">
		<UsageStreamedPanel state={efficiency.current} title="Model efficiency" rows={8}>
			{#snippet children(value)}
				{#if value.length === 0}
					{@render emptyPanel('Model efficiency', 'No model traffic in this window.')}
				{:else}
					<UsageModelEfficiency rows={value} />
				{/if}
			{/snippet}
		</UsageStreamedPanel>
	</Tabs.Content>

	<Tabs.Content value="meters">
		<UsageStreamedPanel state={meters.current} title="Token meters" rows={6}>
			{#snippet children(value)}
				{#if value}
					<UsageTokenMeters breakdown={value} />
				{:else}
					{@render emptyPanel('Token meters', 'No token usage in this window.')}
				{/if}
			{/snippet}
		</UsageStreamedPanel>
	</Tabs.Content>
</Tabs.Root>

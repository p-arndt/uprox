<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import UsageDetailTable from '$lib/components/usage-detail-table.svelte';
	import UsageMovers from '$lib/components/usage-movers.svelte';
	import UsageDonutRow from '$lib/components/usage-donut-row.svelte';
	import UsageModelEfficiency from '$lib/components/usage-model-efficiency.svelte';
	import UsageTokenMeters from '$lib/components/usage-token-meters.svelte';
	import { dimensionLabel, type UsageDimension } from '$lib/usage-group';
	import type { UsageAnalysis } from '$lib/server/usage-analysis';
	import type { DimensionUsageRow } from '$lib/server/data';

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

	// A tab that would open onto an empty panel is not offered at all, so the bar
	// only ever advertises breakdowns this window can actually show.
	const tabs = $derived(
		[
			{ key: 'breakdown', label: 'Breakdown', show: true },
			{ key: 'movers', label: 'What changed', show: analysis.movers.length > 0 },
			{ key: 'composition', label: 'Composition', show: analysis.donuts.length > 0 },
			{ key: 'efficiency', label: 'Model efficiency', show: analysis.efficiency.length > 0 },
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
		<UsageMovers movers={analysis.movers} dim={analysis.groupBy} {rangeLabel} />
	</Tabs.Content>

	<Tabs.Content value="composition">
		<UsageDonutRow panels={analysis.donuts} scopeTotal={analysis.totals.costUsd} />
	</Tabs.Content>

	<Tabs.Content value="efficiency">
		<UsageModelEfficiency rows={analysis.efficiency} />
	</Tabs.Content>

	<Tabs.Content value="meters">
		<UsageTokenMeters breakdown={analysis.meters} />
	</Tabs.Content>
</Tabs.Root>

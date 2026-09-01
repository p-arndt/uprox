<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import UsageHeadline from '$lib/components/usage-headline.svelte';
	import UsageAnalysisToolbar from '$lib/components/usage-analysis-toolbar.svelte';
	import UsageAnalysisCard from '$lib/components/usage-analysis-card.svelte';
	import UsageDonutRow from '$lib/components/usage-donut-row.svelte';
	import UsageDetailTable from '$lib/components/usage-detail-table.svelte';
	import UsageTokenMeters from '$lib/components/usage-token-meters.svelte';
	import UsageMovers from '$lib/components/usage-movers.svelte';
	import UsageModelEfficiency from '$lib/components/usage-model-efficiency.svelte';
	import UsageReliability from '$lib/components/usage-reliability.svelte';
	import BudgetGauge from '$lib/components/budget-gauge.svelte';
	import { dimensionLabel, type UsageDimension, type UsageFilter } from '$lib/usage-group';
	import type { UsageAnalysis } from '$lib/server/usage-analysis';
	import type { DimensionUsageRow } from '$lib/server/data';
	import type { BudgetStatus } from '$lib/budget';
	import type { ResolvedPathname } from '$app/types';

	// The whole cost-analysis surface, shared verbatim by the org usage page and
	// the service / token detail pages. Those pages differ only in which
	// dimensions they allow and what identity header sits above — not in the
	// depth of analysis they offer, which is why this is one component and not
	// three near-copies.

	let {
		analysis,
		rangeLabel,
		bucketHref,
		onGroupBy,
		onFilters,
		rowLabel,
		leading,
		trailing,
		budgets = [],
		instanceBudget = null,
		budgetThreshold
	}: {
		analysis: UsageAnalysis;
		rangeLabel: string;
		bucketHref: (key: string) => ResolvedPathname;
		onGroupBy: (dim: UsageDimension) => void;
		onFilters: (next: UsageFilter[]) => void;
		/** renders a row's name cell, so each page owns its own drill-down links */
		rowLabel?: Snippet<[DimensionUsageRow, UsageDimension]>;
		/** page-owned controls at the start of the command bar (the range picker) */
		leading?: Snippet;
		/** page-owned actions at the end of the command bar (refresh, export) */
		trailing?: Snippet;
		budgets?: BudgetStatus[];
		instanceBudget?: BudgetStatus | null;
		budgetThreshold?: number;
	} = $props();

	const hasTraffic = $derived(analysis.totals.requests > 0 || analysis.breakdown.length > 0);
</script>

<!-- One command bar: window, grouping and filters on the left, page actions on
     the right. Every control here is the same height and shape, so the row reads
     as a single band of chrome instead of assorted buttons.

     It sticks below the app header (h-14) because every panel underneath is a
     rendering of the choices made here — the page is a loop of "change the
     window, read the result", and that loop breaks the moment the controls
     scroll away and you have to travel back up to adjust them. The negative
     margins let the opaque band bleed to the padding edge of the page so
     content passing underneath is covered rather than peeking out the side. -->
<div class="sticky top-14 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
	<div
		class="flex flex-col gap-2 rounded-xl border bg-card px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="flex flex-wrap items-center gap-2">
			{@render leading?.()}
			<UsageAnalysisToolbar
				groupBy={analysis.groupBy}
				filters={analysis.filters}
				dimensions={analysis.dimensions}
				options={analysis.filterOptions}
				{onGroupBy}
				{onFilters}
			/>
		</div>
		{#if trailing}
			<div class="flex shrink-0 items-center gap-2">{@render trailing()}</div>
		{/if}
	</div>
</div>

<!-- Budget headroom: instance ceiling and policy ceilings in ONE card, one row
     each. Two separate cards pushed the chart most of a screen below the command
     bar that drives it, which broke the loop the page exists for — change the
     grouping, see the chart move. It stays outside the traffic check because a
     ceiling belongs to the billing period, not to the window on screen, so it is
     still true (and worth seeing) on a day with no requests at all. That same
     mismatch is why it can't be a line on the chart — dividing a monthly ceiling
     down to an hourly bucket produces a threshold any single request clears. -->
{#snippet budgetHeadroom()}
	<BudgetGauge
		statuses={instanceBudget ? [instanceBudget, ...budgets] : budgets}
		threshold={budgetThreshold}
		showServiceName={true}
		title="Budget headroom"
		description="Spend against the instance and policy ceilings this period"
	/>
{/snippet}

{#if !hasTraffic}
	{@render budgetHeadroom()}
	<Card.Root>
		<Card.Content class="py-16 text-center text-sm text-muted-foreground">
			{#if analysis.filters.length > 0}
				No gateway traffic for {rangeLabel} matching these filters.
			{:else}
				No gateway traffic for {rangeLabel}.
			{/if}
		</Card.Content>
	</Card.Root>
{:else}
	<UsageHeadline
		totals={analysis.totals}
		prevTotals={analysis.prevTotals}
		series={analysis.series}
		{rangeLabel}
	/>

	<!-- Health sits with the headline, not at the foot of the page. Error rate,
	     denials and latency answer "is the gateway alright?", which is the
	     question asked before any question about cost — it read as an epilogue
	     when it was the last card below four charts. -->
	<UsageReliability totals={analysis.totals} />

	<UsageAnalysisCard
		grouped={analysis.grouped}
		groupBy={analysis.groupBy}
		{rangeLabel}
		bucket={analysis.bucket}
		{bucketHref}
	/>

	<!-- Two narrow ranked lists share a row. Both are short and neither has a
	     wide table inside, so stacking them full-width spent a screen of height
	     on two half-empty cards. -->
	{#if analysis.movers.length > 0}
		<div class="grid items-start gap-4 lg:grid-cols-2">
			{@render budgetHeadroom()}
			<UsageMovers movers={analysis.movers} dim={analysis.groupBy} {rangeLabel} />
		</div>
	{:else}
		{@render budgetHeadroom()}
	{/if}

	{#if analysis.donuts.length > 0}
		<UsageDonutRow panels={analysis.donuts} scopeTotal={analysis.totals.costUsd} />
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>Detail by {dimensionLabel(analysis.groupBy).toLowerCase()}</Card.Title>
			<Card.Description>
				{#if analysis.groupBy === 'line'}
					Every rate-card line in the window — model, the card it billed against, and the meter —
					ranked by spend. The unit price is derived from the line's own spend and volume, so it can
					be checked against the pricing page.
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

	<UsageModelEfficiency rows={analysis.efficiency} />

	<UsageTokenMeters breakdown={analysis.meters} />
{/if}

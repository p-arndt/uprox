<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import UsageHeadline from '$lib/components/usage-headline.svelte';
	import UsageAnalysisToolbar from '$lib/components/usage-analysis-toolbar.svelte';
	import UsageAnalysisCard from '$lib/components/usage-analysis-card.svelte';
	import UsageDeepDive from '$lib/components/usage-deep-dive.svelte';
	import BudgetGauge from '$lib/components/budget-gauge.svelte';
	import type { UsageDimension, UsageFilter } from '$lib/usage-group';
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

	<UsageAnalysisCard
		grouped={analysis.grouped}
		groupBy={analysis.groupBy}
		{rangeLabel}
		bucket={analysis.bucket}
		{bucketHref}
	/>

	<UsageDeepDive {analysis} {rangeLabel} {rowLabel} />

	<!-- Last, and deliberately: a ceiling belongs to the billing period, not to
	     the window on screen, so it answers a different question than everything
	     above it. budget-alert.svelte already interrupts at the top of the page
	     when one is actually being breached. -->
	{@render budgetHeadroom()}
{/if}

<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import UsageHeadline from '$lib/components/usage-headline.svelte';
	import UsageAnalysisToolbar from '$lib/components/usage-analysis-toolbar.svelte';
	import UsageAnalysisCard from '$lib/components/usage-analysis-card.svelte';
	import UsageDonutRow from '$lib/components/usage-donut-row.svelte';
	import UsageDetailTable from '$lib/components/usage-detail-table.svelte';
	import UsageTokenMeters from '$lib/components/usage-token-meters.svelte';
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
		budgetThreshold,
		budgetPerBucket = null
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
		budgetPerBucket?: number | null;
	} = $props();

	const hasTraffic = $derived(analysis.totals.requests > 0 || analysis.breakdown.length > 0);
</script>

<!-- One command bar: window, grouping and filters on the left, page actions on
     the right. Every control here is the same height and shape, so the row reads
     as a single band of chrome instead of assorted buttons. -->
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

{#if !hasTraffic}
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
		{budgetPerBucket}
	/>

	{#if analysis.donuts.length > 0}
		<UsageDonutRow panels={analysis.donuts} scopeTotal={analysis.totals.costUsd} />
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title>Detail by {dimensionLabel(analysis.groupBy).toLowerCase()}</Card.Title>
			<Card.Description>
				Every series in the window, ranked by spend. Share is of total spend in scope.
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

	<UsageTokenMeters breakdown={analysis.meters} />

	<UsageReliability totals={analysis.totals} />

	{#if instanceBudget}
		<BudgetGauge
			statuses={[instanceBudget]}
			threshold={budgetThreshold}
			showServiceName={false}
			title="Instance budget"
			description="Spend across all services this period"
		/>
	{/if}

	{#if budgets.length > 0}
		<BudgetGauge
			statuses={budgets}
			threshold={budgetThreshold}
			showServiceName={budgets.length > 1}
		/>
	{/if}
{/if}

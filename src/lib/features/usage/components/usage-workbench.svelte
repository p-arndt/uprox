<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import UsageHeadline from '$lib/features/usage/components/usage-headline.svelte';
	import UsageToolbarControls from '$lib/features/usage/components/usage-toolbar-controls.svelte';
	import UsageAnalysisCard from '$lib/features/usage/components/usage-analysis-card.svelte';
	import UsageDeepDive from '$lib/features/usage/components/usage-deep-dive.svelte';
	import BudgetGauge from '$lib/features/budget/components/budget-gauge.svelte';
	import type { UsageDimension } from '$lib/features/usage/group';
	import type { DimensionUsageRow, Streamed, UsageAnalysis } from '$lib/features/usage/types';
	import type { BudgetStatus } from '$lib/features/budget/budget';
	import { latest, type UsageView } from '$lib/features/usage/view.svelte';
	import type { ResolvedPathname } from '$app/types';

	// The whole cost-analysis surface, shared verbatim by the org usage page and
	// the service / token detail pages. Those pages differ only in which
	// dimensions they allow and what identity header sits above — not in the
	// depth of analysis they offer, which is why this is one component and not
	// three near-copies.

	let {
		analysis,
		view,
		exportPath,
		rowLabel,
		budgets,
		budgetThreshold
	}: {
		analysis: UsageAnalysis;
		/** the page's URL-state controller (window, grouping, filters, refresh) */
		view: UsageView;
		/** the page's resolved CSV export endpoint; omit to hide the export menu */
		exportPath?: ResolvedPathname;
		/** renders a row's name cell, so each page owns its own drill-down links */
		rowLabel?: Snippet<[DimensionUsageRow, UsageDimension]>;
		/** budget statuses (instance ceiling first), streamed after first paint */
		budgets?: Promise<Streamed<BudgetStatus[]>>;
		budgetThreshold?: number;
	} = $props();

	const hasTraffic = $derived(analysis.totals.requests > 0 || analysis.breakdown.length > 0);

	// streamed after first paint
	const prevTotals = latest(() => analysis.prevTotals);
	const budgetStatuses = latest(() => budgets);
	const comparison = $derived(
		prevTotals.current === undefined ? 'pending' : prevTotals.current.failed ? 'failed' : 'ready'
	);
</script>

<UsageToolbarControls {analysis} {view} {exportPath} />

<!-- Budget headroom: instance ceiling and policy ceilings in ONE card, one row
     each. Two separate cards pushed the chart most of a screen below the command
     bar that drives it, which broke the loop the page exists for — change the
     grouping, see the chart move. It stays outside the traffic check because a
     ceiling belongs to the billing period, not to the window on screen, so it is
     still true (and worth seeing) on a day with no requests at all. That same
     mismatch is why it can't be a line on the chart — dividing a monthly ceiling
     down to an hourly bucket produces a threshold any single request clears. -->
{#snippet budgetHeadroom()}
	<!-- no skeleton: most instances carry no ceiling, and the gauge renders
	     nothing then, so a placeholder would only flash and disappear -->
	{#if budgetStatuses.current?.failed}
		<p class="text-sm text-muted-foreground" role="status">Budget headroom could not be loaded.</p>
	{/if}
	<BudgetGauge
		statuses={budgetStatuses.current?.value ?? []}
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
				No gateway traffic for rangeLabel={view.rangeLabel} matching these filters.
			{:else}
				No gateway traffic for rangeLabel={view.rangeLabel}.
			{/if}
		</Card.Content>
	</Card.Root>
{:else}
	<UsageHeadline
		totals={analysis.totals}
		prevTotals={prevTotals.current?.value ?? null}
		{comparison}
		series={analysis.series}
		rangeLabel={view.rangeLabel}
	/>

	<UsageAnalysisCard
		grouped={analysis.grouped}
		groupBy={analysis.groupBy}
		rangeLabel={view.rangeLabel}
		bucket={analysis.bucket}
		bucketHref={(b) => view.hrefWith({ bucket: b })}
	/>

	<UsageDeepDive {analysis} rangeLabel={view.rangeLabel} {rowLabel} />

	<!-- Last, and deliberately: a ceiling belongs to the billing period, not to
	     the window on screen, so it answers a different question than everything
	     above it. budget-alert.svelte already interrupts at the top of the page
	     when one is actually being breached. -->
	{@render budgetHeadroom()}
{/if}

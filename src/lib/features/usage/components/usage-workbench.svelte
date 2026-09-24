<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import UsageHeadline from '$lib/features/usage/components/usage-headline.svelte';
	import UsageToolbarControls from '$lib/features/usage/components/usage-toolbar-controls.svelte';
	import UsageAnalysisCard from '$lib/features/usage/components/usage-analysis-card.svelte';
	import UsageDeepDive from '$lib/features/usage/components/usage-deep-dive.svelte';
	import UsageStreamedPanel from '$lib/features/usage/components/usage-streamed-panel.svelte';
	import BudgetGauge from '$lib/features/budget/components/budget-gauge.svelte';
	import type { UsageDimension } from '$lib/features/usage/group';
	import type { DimensionUsageRow, Streamed, UsageAnalysis } from '$lib/features/usage/types';
	import type { BudgetStatus } from '$lib/features/budget/budget';
	import { USAGE_RANGES, widerRanges } from '$lib/features/usage/range';
	import { formatWindow } from '$lib/features/usage/date-range';
	import { formatDateTime, relativeTime } from '$lib/format';
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
	const comparedWith = $derived(formatWindow(analysis.prevWindow.start, analysis.prevWindow.end));

	const widen = $derived(
		widerRanges(analysis.range).map((key) => ({
			key,
			label: USAGE_RANGES.find((r) => r.key === key)?.label ?? key
		}))
	);
</script>

<UsageToolbarControls {analysis} {view} {exportPath} />

<!-- Budget headroom: instance ceiling and policy ceilings in ONE card, one row
     each. It sits directly under the headline so spend-vs-limit is on screen at
     first paint, next to the spend figure it qualifies. It stays outside the
     traffic check because a ceiling belongs to the billing period, not to the
     window on screen, so it is still true (and worth seeing) on a day with no
     requests at all. That same mismatch is why it can't be a line on the chart —
     dividing a monthly ceiling down to an hourly bucket produces a threshold any
     single request clears. -->
{#snippet budgetHeadroom()}
	{#if budgets}
		<UsageStreamedPanel state={budgetStatuses.current} title="Budget headroom">
			<!-- no skeleton: most instances carry no ceiling, and the gauge renders
			     nothing then, so a placeholder would only flash and disappear -->
			{#snippet skeleton()}{/snippet}
			{#snippet children(value)}
				<BudgetGauge
					statuses={value}
					threshold={budgetThreshold}
					showServiceName={true}
					title="Budget headroom"
					description="Spend against the instance and policy ceilings this period"
				/>
			{/snippet}
		</UsageStreamedPanel>
	{/if}
{/snippet}

{#if !hasTraffic}
	{@render budgetHeadroom()}
	<Card.Root>
		<Card.Content class="flex flex-col items-center gap-3 py-12 text-center text-sm">
			<p class="font-medium">
				{#if view.filtered}
					No gateway traffic for {view.rangeLabel} matching these filters.
				{:else}
					No gateway traffic for {view.rangeLabel}.
				{/if}
			</p>
			<p class="text-muted-foreground">
				{#if analysis.lastRequestAt}
					Last request:
					<time datetime={analysis.lastRequestAt} title={formatDateTime(analysis.lastRequestAt)}>
						{relativeTime(analysis.lastRequestAt)}
					</time>
				{:else if view.filtered}
					No request on record matches these filters.
				{:else}
					No request on record yet.
				{/if}
			</p>
			{#if widen.length > 0 || view.filtered}
				<div class="flex flex-wrap justify-center gap-2 pt-1">
					{#each widen as w (w.key)}
						<Button
							href={view.hrefWith({ range: w.key })}
							variant="outline"
							size="sm"
							data-sveltekit-noscroll
						>
							Show {w.label.toLowerCase()}
						</Button>
					{/each}
					{#if view.filtered}
						<Button variant="ghost" size="sm" onclick={() => view.setFilters([])}>
							Clear filters
						</Button>
					{/if}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
{:else}
	<UsageHeadline
		totals={analysis.totals}
		prevTotals={prevTotals.current?.value ?? null}
		{comparison}
		{comparedWith}
		series={analysis.series}
	/>

	{@render budgetHeadroom()}

	<UsageAnalysisCard
		grouped={analysis.grouped}
		groupBy={analysis.groupBy}
		rangeLabel={view.rangeLabel}
		bucket={analysis.bucket}
		bucketHref={(b) => view.hrefWith({ bucket: b })}
		metric={view.metric}
		onMetric={view.setMetric}
	/>

	<UsageDeepDive {analysis} {comparedWith} {rowLabel} />
{/if}

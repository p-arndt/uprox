<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import BudgetAlert from '$lib/components/budget-alert.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import UsageRangePicker from '$lib/components/usage-range-picker.svelte';
	import UsageWorkbench from '$lib/components/usage-workbench.svelte';
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { buildUsageHref, type UsageUrlOverrides } from '$lib/usage-url';
	import { NULL_VALUE, type UsageDimension, type UsageFilter } from '$lib/usage-group';
	import type { DimensionUsageRow } from '$lib/server/data';
	import Download from '@lucide/svelte/icons/download';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import PageShell from '$lib/components/page-shell.svelte';
	import PageHeader from '$lib/components/page-header.svelte';

	let { data } = $props();

	// Re-runs the page load (re-querying usage) without a full reload, so operators
	// can pull fresh figures in place. invalidateAll resolves once the new data lands.
	let refreshing = $state(false);
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await invalidateAll();
		} finally {
			refreshing = false;
		}
	}

	const rangeLabel = $derived(
		data.range === 'custom'
			? `${data.customFrom} – ${data.customTo}`
			: (data.ranges.find((r) => r.key === data.range)?.label ?? data.range)
	);

	// Preserve the params we aren't explicitly changing. Stays page-owned so the
	// resolve()/navigation lint rule is satisfied at the source.
	function hrefWith(overrides: UsageUrlOverrides): ResolvedPathname {
		return buildUsageHref(
			resolve('/app/usage'),
			{
				range: data.range,
				bucket: data.bucket,
				customFrom: data.customFrom,
				customTo: data.customTo,
				groupBy: data.groupBy,
				filters: data.filters
			},
			overrides
		) as ResolvedPathname;
	}

	function applyCustom(from: string, to: string) {
		goto(hrefWith({ range: 'custom', from, to }), { noScroll: true });
	}

	// Group-by and filters are URL state, so every change is a navigation — which
	// also makes Back walk the analysis history rather than leaving the page.
	function setGroupBy(dim: UsageDimension) {
		goto(hrefWith({ groupBy: dim }), { noScroll: true, keepFocus: true });
	}
	function setFilters(filters: UsageFilter[]) {
		goto(hrefWith({ filters }), { noScroll: true, keepFocus: true });
	}

	// The export endpoint takes the page's own query string, so the download is
	// exactly the view on screen.
	const exportHref = (shape: 'breakdown' | 'timeseries') =>
		`${hrefWith({})}&shape=${shape}`.replace('/app/usage?', '/app/usage/export?');
</script>

{#snippet rowLabel(row: DimensionUsageRow, dim: UsageDimension)}
	{#if dim === 'service' && row.key !== NULL_VALUE}
		<a
			href={resolve('/app/services/[id]', { id: row.key })}
			class="truncate font-medium hover:underline"
			title={row.label}
		>
			{row.label}
		</a>
	{:else if dim === 'token' && row.key !== NULL_VALUE}
		<a
			href={resolve('/app/tokens/[id]', { id: row.key })}
			class="truncate font-medium hover:underline"
			title={row.label}
		>
			{row.label}
		</a>
	{:else if dim === 'model'}
		<span class="truncate font-mono text-[13px] font-medium" title={row.label}>{row.label}</span>
	{:else}
		<span class="truncate font-medium" title={row.label}>{row.label}</span>
	{/if}
{/snippet}

{#snippet leading()}
	<UsageRangePicker
		ranges={data.ranges}
		range={data.range}
		{hrefWith}
		customFrom={data.customFrom}
		customTo={data.customTo}
		onApplyCustom={applyCustom}
	/>
{/snippet}

{#snippet trailing()}
	<Button
		variant="ghost"
		size="icon"
		class="size-8"
		onclick={refresh}
		disabled={refreshing}
		aria-label="Refresh usage"
	>
		<RefreshCw class="size-4 {refreshing ? 'animate-spin' : ''}" />
	</Button>
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm" class="gap-1.5">
					<Download class="size-4" />
					Export
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end">
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a {...props} href={exportHref('breakdown')} download> Breakdown (CSV) </a>
				{/snippet}
			</DropdownMenu.Item>
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a {...props} href={exportHref('timeseries')} download> Time series (CSV) </a>
				{/snippet}
			</DropdownMenu.Item>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<PageShell width="wide">
	<PageHeader
		title="Cost analysis"
		description="Spend, requests and token volume — sliced by service, model, provider, machine token, or down to the individual rate-card line."
	/>

	<BudgetAlert
		statuses={data.instanceBudget ? [data.instanceBudget, ...data.budgets] : data.budgets}
		threshold={data.budgetThreshold}
	/>

	<!-- The setup checklist lives on /app and has no nav entry of its own, so an
	     unfiltered empty window is the one place that still has to point back at
	     it: on a fresh instance this page is where a new operator lands. -->
	{#if data.totals.requests === 0 && data.filters.length === 0}
		<a
			href={resolve('/app')}
			class="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
		>
			Nothing proxied yet — finish setting up the gateway
			<ArrowRight class="size-4" />
		</a>
	{/if}

	<UsageWorkbench
		analysis={data}
		{rangeLabel}
		bucketHref={(b) => hrefWith({ bucket: b })}
		onGroupBy={setGroupBy}
		onFilters={setFilters}
		{rowLabel}
		{leading}
		{trailing}
		budgets={data.budgets}
		instanceBudget={data.instanceBudget}
		budgetThreshold={data.budgetThreshold}
	/>
</PageShell>

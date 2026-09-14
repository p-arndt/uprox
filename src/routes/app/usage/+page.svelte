<script lang="ts">
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import BudgetAlert from '$lib/components/budget-alert.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import UsageRangePicker from '$lib/components/usage-range-picker.svelte';
	import UsageWorkbench from '$lib/components/usage-workbench.svelte';
	import { resolve } from '$app/paths';
	import { createUsageView } from '$lib/state/usage-view.svelte';
	import { NULL_VALUE, type UsageDimension } from '$lib/usage-group';
	import type { DimensionUsageRow } from '$lib/server/data';
	import Download from '@lucide/svelte/icons/download';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import PageShell from '$lib/components/page-shell.svelte';
	import PageHeader from '$lib/components/page-header.svelte';

	let { data } = $props();

	const view = createUsageView({ data: () => data, basePath: () => resolve('/app/usage') });
	const exportPath = resolve('/app/usage/export');
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
		hrefWith={view.hrefWith}
		customFrom={data.customFrom}
		customTo={data.customTo}
		onApplyCustom={view.applyCustom}
	/>
{/snippet}

{#snippet trailing()}
	<Button
		variant="ghost"
		size="icon"
		class="size-8"
		onclick={view.refresh}
		disabled={view.refreshing}
		aria-label="Refresh usage"
	>
		<RefreshCw class="size-4 {view.refreshing ? 'animate-spin' : ''}" />
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
					<a {...props} href={view.exportHref(exportPath, 'breakdown')} download>
						Breakdown (CSV)
					</a>
				{/snippet}
			</DropdownMenu.Item>
			<DropdownMenu.Item>
				{#snippet child({ props })}
					<a {...props} href={view.exportHref(exportPath, 'timeseries')} download>
						Time series (CSV)
					</a>
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
		rangeLabel={view.rangeLabel}
		bucketHref={(b) => view.hrefWith({ bucket: b })}
		onGroupBy={view.setGroupBy}
		onFilters={view.setFilters}
		{rowLabel}
		{leading}
		{trailing}
		budgets={data.budgets}
		instanceBudget={data.instanceBudget}
		budgetThreshold={data.budgetThreshold}
	/>
</PageShell>

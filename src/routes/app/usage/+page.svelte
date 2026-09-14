<script lang="ts">
	import BudgetAlert from '$lib/features/budget/components/budget-alert.svelte';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import UsageWorkbench from '$lib/features/usage/components/usage-workbench.svelte';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { createUsageView } from '$lib/features/usage/view.svelte';
	import { NULL_VALUE, type UsageDimension } from '$lib/features/usage/group';
	import type { DimensionUsageRow } from '$lib/features/usage/types';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import PageHeader from '$lib/components/layout/page-header.svelte';

	let { data } = $props();

	const view = createUsageView({ data: () => data, basePath: () => resolve('/app/usage') });
	const exportPath: ResolvedPathname = resolve('/app/usage/export');
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

<PageShell width="wide">
	<PageHeader
		title="Cost analysis"
		description="Spend, requests and token volume — sliced by service, model, provider, machine token, or down to the individual rate-card line."
	/>

	{#await data.budgets then budgets}
		<BudgetAlert statuses={budgets.value} threshold={data.budgetThreshold} />
	{/await}

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
		{view}
		{exportPath}
		{rowLabel}
		budgets={data.budgets}
		budgetThreshold={data.budgetThreshold}
	/>
</PageShell>

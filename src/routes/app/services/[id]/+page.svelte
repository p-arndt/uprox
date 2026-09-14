<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import UsageRangePicker from '$lib/components/usage-range-picker.svelte';
	import UsageWorkbench from '$lib/components/usage-workbench.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import { createUsageView } from '$lib/state/usage-view.svelte';
	import { NULL_VALUE, type UsageDimension } from '$lib/usage-group';
	import type { DimensionUsageRow } from '$lib/features/usage/types';
	import { relativeTime } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import DetailHeader from '$lib/components/detail-header.svelte';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import PageShell from '$lib/components/page-shell.svelte';

	let { data } = $props();

	const view = createUsageView({
		data: () => data,
		basePath: () => resolve('/app/services/[id]', { id: data.service.id })
	});
</script>

{#snippet rowLabel(row: DimensionUsageRow, dim: UsageDimension)}
	{#if dim === 'token' && row.key !== NULL_VALUE}
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
{/snippet}

<PageShell width="wide">
	<DetailHeader icon={Boxes} eyebrow="Service" title={data.service.name}>
		{#snippet badges()}
			<Badge variant="outline">{data.service.type}</Badge>
		{/snippet}
		{#snippet lede()}
			{#if data.service.description}
				<p class="text-sm text-muted-foreground">{data.service.description}</p>
			{/if}
		{/snippet}
		{#snippet meta()}
			Policy: {data.service.policyName ?? 'No policy (allow all)'} · created {relativeTime(
				data.service.createdAt
			)}
		{/snippet}
	</DetailHeader>

	<UsageWorkbench
		analysis={data}
		rangeLabel={view.rangeLabel}
		bucketHref={(b) => view.hrefWith({ bucket: b })}
		onGroupBy={view.setGroupBy}
		onFilters={view.setFilters}
		{rowLabel}
		{leading}
		{trailing}
		budgets={data.budget}
		budgetThreshold={data.budgetThreshold}
	/>
</PageShell>

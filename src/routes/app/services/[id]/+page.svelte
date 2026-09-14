<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import UsageWorkbench from '$lib/features/usage/components/usage-workbench.svelte';
	import { resolve } from '$app/paths';
	import { createUsageView } from '$lib/features/usage/view.svelte';
	import { NULL_VALUE, type UsageDimension } from '$lib/features/usage/group';
	import type { DimensionUsageRow } from '$lib/features/usage/types';
	import { relativeTime } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import DetailHeader from '$lib/components/layout/detail-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';

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
		{view}
		{rowLabel}
		budgets={data.budget}
		budgetThreshold={data.budgetThreshold}
	/>
</PageShell>

<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import BudgetAlert from '$lib/components/budget-alert.svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import UsageDashboard from '$lib/components/usage-dashboard.svelte';
	import UsageRangeToolbar from '$lib/components/usage-range-toolbar.svelte';
	import { type BreakdownSection } from '$lib/components/usage-breakdown.svelte';
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { buildUsageHref, type UsageUrlOverrides } from '$lib/usage-url';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Cpu from '@lucide/svelte/icons/cpu';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Server from '@lucide/svelte/icons/server';

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
	// resolve()/navigation lint rule is satisfied at the source; only the base path
	// differs from the service/token pages.
	function hrefWith(overrides: UsageUrlOverrides): ResolvedPathname {
		return buildUsageHref(
			resolve('/app/usage'),
			{
				range: data.range,
				bucket: data.bucket,
				customFrom: data.customFrom,
				customTo: data.customTo
			},
			overrides
		) as ResolvedPathname;
	}

	function applyCustom(from: string, to: string) {
		goto(hrefWith({ range: 'custom', from, to }), { noScroll: true });
	}

	const hasTraffic = $derived(data.byService.length > 0 || data.byModel.length > 0);

	// Breakdown dimensions for the tabbed panel. Provider/token only appear when
	// there's something to show.
	const sections = $derived.by(() => {
		const out: BreakdownSection[] = [
			{ key: 'service', label: 'Service', icon: Boxes, rows: data.byService },
			{
				key: 'model',
				label: 'Model',
				icon: Cpu,
				rows: data.byModel,
				truncated: data.byModel.length >= data.breakdownLimit
			}
		];
		if (data.byProvider.length > 0)
			out.push({ key: 'provider', label: 'Provider', icon: Server, rows: data.byProvider });
		if (data.byToken.length > 0)
			out.push({
				key: 'token',
				label: 'Token',
				icon: KeyRound,
				rows: data.byToken,
				truncated: data.byToken.length >= data.breakdownLimit
			});
		return out;
	});
</script>

{#snippet rowLabel(row: import('$lib/components/usage-breakdown.svelte').BreakdownRow, key: string)}
	{#if key === 'service'}
		{#if row.serviceId}
			<a
				href={resolve('/app/services/[id]', { id: row.serviceId })}
				class="truncate font-medium hover:underline"
			>
				{row.serviceName ?? 'Unnamed service'}
			</a>
		{:else}
			<span class="truncate font-medium text-muted-foreground">Deleted service</span>
		{/if}
	{:else if key === 'model'}
		<span class="truncate font-mono font-medium">{row.model}</span>
		{#if row.provider}
			<span class="shrink-0 text-xs text-muted-foreground">{row.provider}</span>
		{/if}
	{:else if key === 'provider'}
		<span class="truncate font-medium">{row.provider}</span>
	{:else if key === 'token'}
		{#if row.tokenId}
			<a
				href={resolve('/app/tokens/[id]', { id: row.tokenId })}
				class="truncate font-medium hover:underline"
			>
				{row.tokenName ?? 'Revoked token'}
			</a>
		{:else}
			<span class="truncate font-medium">{row.tokenName ?? 'Revoked token'}</span>
		{/if}
		{#if row.serviceName}
			<span class="shrink-0 text-xs text-muted-foreground">· {row.serviceName}</span>
		{/if}
		{#if row.tokenDisplay}
			<span class="shrink-0 font-mono text-xs text-muted-foreground">{row.tokenDisplay}</span>
		{/if}
	{/if}
{/snippet}

<div class="mx-auto max-w-7xl space-y-6">
	<PageHeader
		title="Usage"
		description="Spend, requests, and token volume by service, model, and machine token."
	>
		{#snippet action()}
			<!-- Date range. Granularity lives with the trend chart. -->
			<UsageRangeToolbar
				ranges={data.ranges}
				range={data.range}
				{hrefWith}
				customFrom={data.customFrom}
				customTo={data.customTo}
				onApplyCustom={applyCustom}
				onRefresh={refresh}
				{refreshing}
			/>
		{/snippet}
	</PageHeader>

	<BudgetAlert
		statuses={data.instanceBudget ? [data.instanceBudget, ...data.budgets] : data.budgets}
		threshold={data.budgetThreshold}
	/>

	{#if !hasTraffic}
		<Card.Root>
			<Card.Content class="py-16 text-center text-sm text-muted-foreground">
				No gateway traffic for {rangeLabel}.
			</Card.Content>
		</Card.Root>
	{:else}
		<UsageDashboard
			totals={data.totals}
			prevTotals={data.prevTotals}
			series={data.series}
			prevPoints={data.prevPoints}
			bucket={data.bucket}
			{rangeLabel}
			bucketHref={(b) => hrefWith({ bucket: b })}
			{sections}
			breakdownLimit={data.breakdownLimit}
			{rowLabel}
			showExcludeToggles
			budget={data.budgets}
			instanceBudget={data.instanceBudget}
			budgetThreshold={data.budgetThreshold}
		/>
	{/if}
</div>

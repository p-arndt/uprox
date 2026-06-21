<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import UsageDashboard from '$lib/components/usage-dashboard.svelte';
	import UsageRangeToolbar from '$lib/components/usage-range-toolbar.svelte';
	import { type BreakdownSection } from '$lib/components/usage-breakdown.svelte';
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { buildUsageHref, type UsageUrlOverrides } from '$lib/usage-url';
	import { relativeTime } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Cpu from '@lucide/svelte/icons/cpu';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Server from '@lucide/svelte/icons/server';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';

	let { data } = $props();

	const rangeLabel = $derived(
		data.range === 'custom'
			? `${data.customFrom} – ${data.customTo}`
			: (data.ranges.find((r) => r.key === data.range)?.label ?? data.range)
	);

	// Preserve the params we aren't explicitly changing. Page-owned so the
	// resolve()/navigation lint rule is satisfied at the source.
	function hrefWith(overrides: UsageUrlOverrides): ResolvedPathname {
		return buildUsageHref(
			resolve('/app/services/[id]', { id: data.service.id }),
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

	const hasTraffic = $derived(data.byModel.length > 0 || data.byToken.length > 0);

	const sections = $derived.by(() => {
		const out: BreakdownSection[] = [
			{
				key: 'model',
				label: 'Model',
				icon: Cpu,
				rows: data.byModel,
				truncated: data.byModel.length >= data.breakdownLimit
			},
			{
				key: 'token',
				label: 'Token',
				icon: KeyRound,
				rows: data.byToken,
				truncated: data.byToken.length >= data.breakdownLimit,
				emptyText: 'No per-token activity in this window.'
			}
		];
		if (data.byProvider.length > 1)
			out.push({ key: 'provider', label: 'Provider', icon: Server, rows: data.byProvider });
		return out;
	});
</script>

{#snippet rowLabel(row: import('$lib/components/usage-breakdown.svelte').BreakdownRow, key: string)}
	{#if key === 'model'}
		<span class="truncate font-mono font-medium">{row.model}</span>
		{#if row.provider}
			<span class="shrink-0 text-xs text-muted-foreground">{row.provider}</span>
		{/if}
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
		{#if row.tokenDisplay}
			<span class="shrink-0 font-mono text-xs text-muted-foreground">{row.tokenDisplay}</span>
		{/if}
	{:else if key === 'provider'}
		<span class="truncate font-medium">{row.provider}</span>
	{/if}
{/snippet}

<div class="mx-auto max-w-7xl space-y-6">
	<a
		href={resolve('/app/services')}
		class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
	>
		<ChevronLeft class="size-4" /> Services
	</a>

	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="flex items-start gap-3">
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
			>
				<Boxes class="size-5" />
			</span>
			<div class="space-y-1">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Service</p>
				<div class="flex items-center gap-2">
					<h2 class="text-lg font-semibold">{data.service.name}</h2>
					<Badge variant="outline">{data.service.type}</Badge>
				</div>
				{#if data.service.description}
					<p class="text-sm text-muted-foreground">{data.service.description}</p>
				{/if}
				<p class="text-xs text-muted-foreground">
					Policy: {data.service.policyName ?? 'No policy (allow all)'} · created {relativeTime(
						data.service.createdAt
					)}
				</p>
			</div>
		</div>
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
	</div>

	{#if !hasTraffic}
		<Card.Root>
			<Card.Content class="py-16 text-center text-sm text-muted-foreground">
				No gateway traffic from this service for {rangeLabel}.
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
			breakdownDescription="Where this service's spend and token volume land"
			budget={data.budget}
		/>
	{/if}
</div>

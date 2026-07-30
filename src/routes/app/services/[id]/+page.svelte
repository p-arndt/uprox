<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import UsageRangePicker from '$lib/components/usage-range-picker.svelte';
	import UsageWorkbench from '$lib/components/usage-workbench.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { buildUsageHref, type UsageUrlOverrides } from '$lib/usage-url';
	import { NULL_VALUE, type UsageDimension, type UsageFilter } from '$lib/usage-group';
	import type { DimensionUsageRow } from '$lib/server/data';
	import { relativeTime } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

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

	// Group-by and filters are URL state here too, so a drilled-in service view
	// is just as shareable as the org-wide one.
	function setGroupBy(dim: UsageDimension) {
		goto(hrefWith({ groupBy: dim }), { noScroll: true, keepFocus: true });
	}
	function setFilters(filters: UsageFilter[]) {
		goto(hrefWith({ filters }), { noScroll: true, keepFocus: true });
	}
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
	</div>

	<UsageWorkbench
		analysis={data}
		{rangeLabel}
		bucketHref={(b) => hrefWith({ bucket: b })}
		onGroupBy={setGroupBy}
		onFilters={setFilters}
		{rowLabel}
		{leading}
		{trailing}
		budgets={data.budget}
		budgetThreshold={data.budgetThreshold}
	/>
</div>

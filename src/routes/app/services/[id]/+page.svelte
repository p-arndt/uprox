<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import CustomRangePicker from '$lib/components/custom-range-picker.svelte';
	import DeltaPill from '$lib/components/delta-pill.svelte';
	import StatCard from '$lib/components/stat-card.svelte';
	import TokenSplit from '$lib/components/token-split.svelte';
	import UsageReliability from '$lib/components/usage-reliability.svelte';
	import UsageTrendCard from '$lib/components/usage-trend-card.svelte';
	import UsageBreakdown, { type BreakdownSection } from '$lib/components/usage-breakdown.svelte';
	import { resolve } from '$app/paths';
	import { goto, invalidateAll } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { formatUsd, formatTokens, relativeTime } from '$lib/format';
	import { cacheRate } from '$lib/cache-rate';
	import Boxes from '@lucide/svelte/icons/boxes';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Cpu from '@lucide/svelte/icons/cpu';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Server from '@lucide/svelte/icons/server';
	import Coins from '@lucide/svelte/icons/coins';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';

	let { data } = $props();

	const rangeLabel = $derived(
		data.range === 'custom'
			? `${data.customFrom} – ${data.customTo}`
			: (data.ranges.find((r) => r.key === data.range)?.label ?? data.range)
	);

	// Build a URL that preserves the params we aren't explicitly changing so
	// switching granularity keeps the range (and vice versa).
	function hrefWith(overrides: {
		range?: string;
		bucket?: string;
		from?: string | null;
		to?: string | null;
	}): ResolvedPathname {
		const p = new URLSearchParams();
		const range = overrides.range ?? data.range;
		p.set('range', range);
		if (range === 'custom') {
			const from = overrides.from ?? data.customFrom;
			const to = overrides.to ?? data.customTo;
			if (from) p.set('from', from);
			if (to) p.set('to', to);
		}
		const bucket = overrides.bucket ?? data.bucket;
		if (bucket && bucket !== 'auto') p.set('bucket', bucket);
		return `${resolve('/app/services/[id]', { id: data.service.id })}?${p}` as ResolvedPathname;
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

	const totals = $derived(data.totals);
	const prev = $derived(data.prevTotals);
	const totalTokens = $derived(totals.inputTokens + totals.outputTokens);
	const errorRate = $derived(totals.requests > 0 ? totals.errors / totals.requests : 0);
	const avgCostPerReq = $derived(totals.requests > 0 ? totals.costUsd / totals.requests : 0);

	const tokenCacheRate = $derived(cacheRate(totals).rate);

	function pctDelta(cur: number, prior: number): number | null {
		if (!prior || prior <= 0) return null;
		return ((cur - prior) / prior) * 100;
	}
	const spendDelta = $derived(pctDelta(totals.costUsd, prev.costUsd));
	const requestDelta = $derived(pctDelta(totals.requests, prev.requests));
	const tokenDelta = $derived(
		pctDelta(totals.inputTokens + totals.outputTokens, prev.inputTokens + prev.outputTokens)
	);

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
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex flex-wrap rounded-lg border p-0.5">
				{#each data.ranges as r (r.key)}
					<a
						href={hrefWith({ range: r.key })}
						data-sveltekit-noscroll
						class="rounded-md px-3 py-1 text-sm font-medium transition-colors {r.key === data.range
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						{r.label}
					</a>
				{/each}
			</div>
			<CustomRangePicker
				from={data.customFrom}
				to={data.customTo}
				active={data.range === 'custom'}
				onApply={applyCustom}
			/>
			<Button
				variant="outline"
				size="icon"
				onclick={refresh}
				disabled={refreshing}
				aria-label="Refresh usage"
				title="Refresh"
			>
				<RefreshCw class={refreshing ? 'animate-spin' : ''} />
			</Button>
		</div>
	</div>

	{#if !hasTraffic}
		<Card.Root>
			<Card.Content class="py-16 text-center text-sm text-muted-foreground">
				No gateway traffic from this service for {rangeLabel}.
			</Card.Content>
		</Card.Root>
	{:else}
		<!-- Cost-first headline with period-over-period deltas. -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<Card.Root class="border-accent-foreground/20 bg-accent/30">
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Spend</Card.Description>
					<Coins class="size-4 text-accent-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-3xl font-semibold tabular-nums">{formatUsd(totals.costUsd)}</div>
					<div class="mt-1 flex items-center gap-2">
						<DeltaPill value={spendDelta} tone="cost" />
						<span class="text-xs text-muted-foreground">vs prev {rangeLabel}</span>
					</div>
					<p class="mt-1 text-xs text-muted-foreground tabular-nums">
						{formatUsd(avgCostPerReq)} avg / request
					</p>
				</Card.Content>
			</Card.Root>

			<StatCard label="Requests">
				<div class="mt-1 text-2xl font-semibold tabular-nums">
					{totals.requests.toLocaleString()}
				</div>
				<div class="mt-1"><DeltaPill value={requestDelta} /></div>
				<p class="mt-1 text-xs text-muted-foreground tabular-nums">
					{(errorRate * 100).toFixed(1)}% errors · {totals.denied.toLocaleString()} denied
				</p>
			</StatCard>

			<StatCard label="Total tokens">
				<div class="mt-1 text-2xl font-semibold tabular-nums">{formatTokens(totalTokens)}</div>
				<div class="mt-1"><DeltaPill value={tokenDelta} /></div>
				<TokenSplit input={totals.inputTokens} output={totals.outputTokens} />
			</StatCard>

			<StatCard label="Token cache rate">
				<div class="mt-1 text-2xl font-semibold tabular-nums">
					{(tokenCacheRate * 100).toFixed(1)}%
				</div>
				<p class="mt-1 text-xs text-muted-foreground tabular-nums">
					{formatTokens(totals.savedInputTokens)} uprox · {formatTokens(
						totals.providerCachedTokens
					)} provider
				</p>
			</StatCard>
		</div>

		<UsageReliability {totals} />

		<UsageTrendCard
			points={data.series.points}
			unit={data.series.unit}
			prevPoints={data.prevPoints}
			{rangeLabel}
			bucket={data.bucket}
			bucketHref={(b) => hrefWith({ bucket: b })}
		/>

		<UsageBreakdown
			{sections}
			breakdownLimit={data.breakdownLimit}
			{rowLabel}
			description="Where this service's spend and token volume land"
		/>
	{/if}
</div>

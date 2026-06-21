<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import StatCard from '$lib/components/stat-card.svelte';
	import TokenSplit from '$lib/components/token-split.svelte';
	import DeltaPill from '$lib/components/delta-pill.svelte';
	import Sparkline from '$lib/components/sparkline.svelte';
	import BudgetGauge from '$lib/components/budget-gauge.svelte';
	import UsageReliability from '$lib/components/usage-reliability.svelte';
	import UsageTrendCard from '$lib/components/usage-trend-card.svelte';
	import UsageBreakdown, { type BreakdownSection } from '$lib/components/usage-breakdown.svelte';
	import type { BreakdownRow } from '$lib/components/usage-breakdown.svelte';
	import type { UsageTotals, UsageSeries, UsageSeriesPoint } from '$lib/server/data';
	import type { BudgetStatus } from '$lib/budget';
	import type { ResolvedPathname } from '$app/types';
	import { formatUsd, formatTokens } from '$lib/format';
	import { cacheRate } from '$lib/cache-rate';
	import Coins from '@lucide/svelte/icons/coins';

	// The whole analytics body shared by the usage, service-detail and token-detail
	// pages: headline cards (with sparklines + period-over-period deltas), the
	// optional embedding/cache exclude toggles, an always-on budget gauge, the
	// reliability strip, the trend chart, and the tabbed breakdown. Each page keeps
	// only its own identity header + the dimension-specific `rowLabel` snippet.

	let {
		totals,
		prevTotals,
		series,
		prevPoints,
		bucket,
		rangeLabel,
		bucketHref,
		sections,
		breakdownLimit,
		rowLabel,
		breakdownDescription,
		showExcludeToggles = false,
		budget,
		budgetThreshold
	}: {
		totals: UsageTotals;
		prevTotals: UsageTotals;
		series: UsageSeries;
		prevPoints: UsageSeriesPoint[];
		bucket: string;
		rangeLabel: string;
		bucketHref: (key: string) => ResolvedPathname;
		sections: BreakdownSection[];
		breakdownLimit: number;
		rowLabel: Snippet<[BreakdownRow, string]>;
		breakdownDescription?: string;
		/** show the embedding/cache headline toggles (org usage page only) */
		showExcludeToggles?: boolean;
		/** per-service spend ceilings; renders the budget gauge when non-empty */
		budget?: BudgetStatus[];
		budgetThreshold?: number;
	} = $props();

	// Embeddings are very high-volume but cheap, so they dominate the token count
	// while barely moving cost. Provider prompt-cache hits are already inside
	// inputTokens; an operator reconciling against a provider's billed figure can
	// drop them. Both only reshape the headline cards — the breakdowns are unchanged.
	// Only exposed when `showExcludeToggles`; otherwise they stay false (raw totals).
	let excludeEmbeddings = $state(false);
	let excludeCachedTokens = $state(false);

	const embeddingTokens = $derived(totals.embeddingInputTokens + totals.embeddingOutputTokens);
	const inputTokenTotal = $derived(
		totals.inputTokens -
			(excludeEmbeddings ? totals.embeddingInputTokens : 0) -
			(excludeCachedTokens ? totals.providerCachedTokens : 0)
	);
	const outputTokenTotal = $derived(
		excludeEmbeddings ? totals.outputTokens - totals.embeddingOutputTokens : totals.outputTokens
	);
	const totalTokens = $derived(inputTokenTotal + outputTokenTotal);

	const savedInputTotal = $derived(totals.savedInputTokens);
	const providerCachedTotal = $derived(totals.providerCachedTokens);
	const tokenCacheRate = $derived(cacheRate(totals).rate);

	const avgCostPerReq = $derived(totals.requests > 0 ? totals.costUsd / totals.requests : 0);
	const errorRate = $derived(totals.requests > 0 ? totals.errors / totals.requests : 0);

	// Period-over-period deltas against the immediately-preceding equal-length
	// window. Null when there's no prior baseline to divide by.
	function pctDelta(cur: number, prior: number): number | null {
		if (!prior || prior <= 0) return null;
		return ((cur - prior) / prior) * 100;
	}
	const spendDelta = $derived(pctDelta(totals.costUsd, prevTotals.costUsd));
	const requestDelta = $derived(pctDelta(totals.requests, prevTotals.requests));
	const tokenDelta = $derived(
		pctDelta(
			totals.inputTokens + totals.outputTokens,
			prevTotals.inputTokens + prevTotals.outputTokens
		)
	);

	// Which subsets the toggles dropped, for the token card subtitle.
	const excluded = $derived(
		[
			excludeEmbeddings ? `${formatTokens(embeddingTokens)} embedding` : null,
			excludeCachedTokens ? `${formatTokens(providerCachedTotal)} cached` : null
		].filter((v): v is string => v !== null)
	);

	// Per-bucket series feeding the headline sparklines (glanceable trend behind
	// each figure). The cache-rate card has no per-bucket series, so it stays text.
	const spendSpark = $derived(series.points.map((p) => p.costUsd));
	const requestSpark = $derived(series.points.map((p) => p.requests));
	const tokenSpark = $derived(series.points.map((p) => p.inputTokens + p.outputTokens));
</script>

<!-- Cost-first headline. Spend leads (featured card); requests, tokens and cache
     savings follow, each with a period-over-period delta and a trend sparkline. -->
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
			<Sparkline values={spendSpark} class="mt-2 h-7" />
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
		<Sparkline values={requestSpark} class="mt-2 h-7" />
	</StatCard>

	<StatCard label="Total tokens">
		<div class="mt-1 text-2xl font-semibold tabular-nums">{formatTokens(totalTokens)}</div>
		<div class="mt-1"><DeltaPill value={tokenDelta} /></div>
		<TokenSplit
			input={inputTokenTotal}
			output={outputTokenTotal}
			note={excluded.length > 0 ? `excludes ${excluded.join(' + ')}` : null}
		/>
		<Sparkline values={tokenSpark} class="mt-2 h-7" />
	</StatCard>

	<StatCard label="Token cache rate">
		<div class="mt-1 text-2xl font-semibold tabular-nums">
			{(tokenCacheRate * 100).toFixed(1)}%
		</div>
		<p class="mt-1 text-xs text-muted-foreground tabular-nums">
			{formatTokens(savedInputTotal)} uprox · {formatTokens(providerCachedTotal)} provider
		</p>
	</StatCard>
</div>

{#if showExcludeToggles}
	<!-- Token-headline adjustments. Subtle, since they only reshape the cards. -->
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<div class="flex items-center gap-2">
			<Switch
				id="exclude-embeddings"
				size="sm"
				bind:checked={excludeEmbeddings}
				disabled={embeddingTokens === 0}
			/>
			<Label for="exclude-embeddings" class="text-sm font-normal text-muted-foreground">
				Exclude embedding tokens{#if embeddingTokens === 0}
					<span class="opacity-60">(none in range)</span>{/if}
			</Label>
		</div>
		<div class="flex items-center gap-2">
			<Switch
				id="exclude-cached"
				size="sm"
				bind:checked={excludeCachedTokens}
				disabled={providerCachedTotal === 0}
			/>
			<Label for="exclude-cached" class="text-sm font-normal text-muted-foreground">
				Exclude cache hits{#if providerCachedTotal === 0}
					<span class="opacity-60">(none in range)</span>{/if}
			</Label>
		</div>
	</div>
{/if}

{#if budget && budget.length > 0}
	<BudgetGauge statuses={budget} threshold={budgetThreshold} showServiceName={budget.length > 1} />
{/if}

<UsageReliability {totals} />

<UsageTrendCard
	points={series.points}
	unit={series.unit}
	{prevPoints}
	{rangeLabel}
	{bucket}
	{bucketHref}
/>

{#if breakdownDescription}
	<UsageBreakdown {sections} {breakdownLimit} {rowLabel} description={breakdownDescription} />
{:else}
	<UsageBreakdown {sections} {breakdownLimit} {rowLabel} />
{/if}

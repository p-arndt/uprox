<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import StatCard from '$lib/components/stat-card.svelte';
	import TokenSplit from '$lib/components/token-split.svelte';
	import DeltaPill from '$lib/components/delta-pill.svelte';
	import Sparkline from '$lib/components/sparkline.svelte';
	import type { UsageTotals, UsageSeries } from '$lib/server/data';
	import { formatUsd, formatTokens, formatCount } from '$lib/format';
	import { cacheRate } from '$lib/cache-rate';
	import Coins from '@lucide/svelte/icons/coins';

	// The cost-first KPI row: spend leads as a featured card; requests, tokens and
	// cache rate follow, each with a period-over-period delta and a sparkline.
	// Extracted from usage-dashboard so the cost-analysis page and the
	// service/token detail pages render an identical headline.

	let {
		totals,
		prevTotals,
		series,
		rangeLabel
	}: {
		totals: UsageTotals;
		prevTotals: UsageTotals;
		series: UsageSeries;
		rangeLabel: string;
	} = $props();

	// Raw totals. The composition — what's embedding, what came from a cache —
	// is the token-meters card's job now; this card states the headline figure
	// without editorialising it.
	const inputTokenTotal = $derived(totals.inputTokens);
	const outputTokenTotal = $derived(totals.outputTokens);
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

	const spendSpark = $derived(series.points.map((p) => p.costUsd));
	const requestSpark = $derived(series.points.map((p) => p.requests));
	const tokenSpark = $derived(series.points.map((p) => p.inputTokens + p.outputTokens));
</script>

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
			{formatCount(totals.requests)}
		</div>
		<div class="mt-1"><DeltaPill value={requestDelta} /></div>
		<p class="mt-1 text-xs text-muted-foreground tabular-nums">
			{(errorRate * 100).toFixed(1)}% errors · {formatCount(totals.denied)} denied
		</p>
		<Sparkline values={requestSpark} class="mt-2 h-7" />
	</StatCard>

	<StatCard label="Total tokens">
		<div class="mt-1 text-2xl font-semibold tabular-nums">{formatTokens(totalTokens)}</div>
		<div class="mt-1"><DeltaPill value={tokenDelta} /></div>
		<TokenSplit input={inputTokenTotal} output={outputTokenTotal} />
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

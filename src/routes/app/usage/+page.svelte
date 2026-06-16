<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import BudgetAlert from '$lib/components/budget-alert.svelte';
	import CustomRangePicker from '$lib/components/custom-range-picker.svelte';
	import DeltaPill from '$lib/components/delta-pill.svelte';
	import TokenSplit from '$lib/components/token-split.svelte';
	import UsageReliability from '$lib/components/usage-reliability.svelte';
	import UsageTrendCard from '$lib/components/usage-trend-card.svelte';
	import UsageBreakdown, { type BreakdownSection } from '$lib/components/usage-breakdown.svelte';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { formatUsd, formatTokens } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Cpu from '@lucide/svelte/icons/cpu';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Server from '@lucide/svelte/icons/server';
	import Coins from '@lucide/svelte/icons/coins';
	import Activity from '@lucide/svelte/icons/activity';
	import Sigma from '@lucide/svelte/icons/sigma';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';

	let { data } = $props();

	const rangeLabel = $derived(
		data.range === 'custom'
			? `${data.customFrom} – ${data.customTo}`
			: (data.ranges.find((r) => r.key === data.range)?.label ?? data.range)
	);

	// Build a usage URL that preserves the params we aren't explicitly changing, so
	// switching granularity keeps the range (and vice versa). Cast back to
	// ResolvedPathname so the navigation lint rule is satisfied.
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
		return `${resolve('/app/usage')}?${p}` as ResolvedPathname;
	}

	function applyCustom(from: string, to: string) {
		goto(hrefWith({ range: 'custom', from, to }), { noScroll: true });
	}

	// Embeddings are very high-volume but cheap, so they dominate the token count
	// while barely moving cost. Let the operator drop them from the headline for a
	// clearer view of chat/completion consumption. Only affects the cards below;
	// the breakdowns keep showing embedding models.
	let excludeEmbeddings = $state(false);

	// Provider prompt-cache hits are part of prompt_tokens, so they're already in
	// inputTokens — the full volume uprox processed. A provider's billed/net token
	// metric (e.g. the Azure portal) discounts that cached subset, so operators
	// reconciling the two figures can drop it here. Input-only; output isn't cached.
	let excludeCachedTokens = $state(false);

	// Window-wide token totals come straight from the totals aggregate, so they
	// stay exact even past the per-breakdown row limits. The toggle subtracts the
	// embedding subset from the input/total cards.
	const totals = $derived(data.totals);
	const prev = $derived(data.prevTotals);
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
	// Saved by either uprox's response cache (replayed entire request) or the
	// upstream provider's prompt cache (discounted subset of input). The rate is
	// computed on actual input tokens only (always the full figure, regardless of
	// the embedding toggle) — the provider cache discount applies to input, so
	// mixing in output would inflate the headline meaninglessly.
	const savedInputTotal = $derived(totals.savedInputTokens);
	const providerCachedTotal = $derived(totals.providerCachedTokens);
	const cacheableInput = $derived(totals.inputTokens + savedInputTotal);
	const cachedInput = $derived(savedInputTotal + providerCachedTotal);
	const tokenCacheRate = $derived(cacheableInput > 0 ? cachedInput / cacheableInput : 0);

	// Average spend per request — the unit-economics number a cost owner watches.
	const avgCostPerReq = $derived(totals.requests > 0 ? totals.costUsd / totals.requests : 0);

	// Period-over-period deltas against the immediately-preceding equal-length
	// window. Null when there's no prior baseline to divide by.
	function pctDelta(cur: number, prior: number): number | null {
		if (!prior || prior <= 0) return null;
		return ((cur - prior) / prior) * 100;
	}
	const spendDelta = $derived(pctDelta(totals.costUsd, prev.costUsd));
	const requestDelta = $derived(pctDelta(totals.requests, prev.requests));
	const tokenDelta = $derived(
		pctDelta(totals.inputTokens + totals.outputTokens, prev.inputTokens + prev.outputTokens)
	);

	// Subtitle for the token card: which subsets the toggles dropped, if any.
	const excluded = $derived(
		[
			excludeEmbeddings ? `${formatTokens(embeddingTokens)} embedding` : null,
			excludeCachedTokens ? `${formatTokens(providerCachedTotal)} cached` : null
		].filter((v): v is string => v !== null)
	);

	const errorRate = $derived(totals.requests > 0 ? totals.errors / totals.requests : 0);

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
	<div class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h2 class="text-lg font-semibold">Usage</h2>
			<p class="text-sm text-muted-foreground">
				Spend, requests, and token volume by service, model, and machine token.
			</p>
		</div>
		<!-- Date range. Granularity lives with the trend chart. -->
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex shrink-0 flex-wrap gap-1 rounded-lg border p-0.5">
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
		</div>
	</div>

	<BudgetAlert statuses={data.budgets} threshold={data.budgetThreshold} />

	{#if !hasTraffic}
		<Card.Root>
			<Card.Content class="py-16 text-center text-sm text-muted-foreground">
				No gateway traffic for {rangeLabel}.
			</Card.Content>
		</Card.Root>
	{:else}
		<!-- Cost-first headline. Spend leads (featured card); requests, tokens and
		     cache savings follow, each with a period-over-period delta. -->
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

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Requests</Card.Description>
					<Activity class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{totals.requests.toLocaleString()}</div>
					<div class="mt-1"><DeltaPill value={requestDelta} /></div>
					<p class="mt-1 text-xs text-muted-foreground tabular-nums">
						{(errorRate * 100).toFixed(1)}% errors · {totals.denied.toLocaleString()} denied
					</p>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Total tokens</Card.Description>
					<Sigma class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{formatTokens(totalTokens)}</div>
					<div class="mt-1"><DeltaPill value={tokenDelta} /></div>
					<TokenSplit
						input={inputTokenTotal}
						output={outputTokenTotal}
						note={excluded.length > 0 ? `excludes ${excluded.join(' + ')}` : null}
					/>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Token cache rate</Card.Description>
					<DatabaseZap class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">
						{(tokenCacheRate * 100).toFixed(1)}%
					</div>
					<p class="mt-1 text-xs text-muted-foreground tabular-nums">
						{formatTokens(savedInputTotal)} uprox · {formatTokens(providerCachedTotal)} provider
					</p>
				</Card.Content>
			</Card.Root>
		</div>

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

		<UsageReliability {totals} />

		<UsageTrendCard
			points={data.series.points}
			unit={data.series.unit}
			prevPoints={data.prevPoints}
			{rangeLabel}
			bucket={data.bucket}
			bucketHref={(b) => hrefWith({ bucket: b })}
		/>

		<UsageBreakdown {sections} breakdownLimit={data.breakdownLimit} {rowLabel} />
	{/if}
</div>

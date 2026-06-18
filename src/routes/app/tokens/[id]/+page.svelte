<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import CustomRangePicker from '$lib/components/custom-range-picker.svelte';
	import DeltaPill from '$lib/components/delta-pill.svelte';
	import TokenSplit from '$lib/components/token-split.svelte';
	import UsageReliability from '$lib/components/usage-reliability.svelte';
	import UsageTrendCard from '$lib/components/usage-trend-card.svelte';
	import UsageBreakdown, { type BreakdownSection } from '$lib/components/usage-breakdown.svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { formatUsd, formatTokens, relativeTime } from '$lib/format';
	import { cacheRate } from '$lib/cache-rate';
	import Cpu from '@lucide/svelte/icons/cpu';
	import Server from '@lucide/svelte/icons/server';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Coins from '@lucide/svelte/icons/coins';
	import Activity from '@lucide/svelte/icons/activity';
	import Sigma from '@lucide/svelte/icons/sigma';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
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
		return `${resolve('/app/tokens/[id]', { id: data.token.id })}?${p}` as ResolvedPathname;
	}

	function applyCustom(from: string, to: string) {
		goto(hrefWith({ range: 'custom', from, to }), { noScroll: true });
	}

	// Active / expired / revoked, mirroring the tokens list badge.
	const tokenStatus = $derived.by(() => {
		const t = data.token;
		if (t.revokedAt) return { label: 'revoked', dot: 'bg-red-500' };
		if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now())
			return { label: 'expired', dot: 'bg-amber-500' };
		return { label: 'active', dot: 'bg-emerald-500', pulse: true };
	});

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

	const hasTraffic = $derived(data.byModel.length > 0);

	// A token belongs to one service, so by-service/by-token collapse to a single
	// row — model is the dimension that varies, plus provider when it spans more
	// than one upstream.
	const sections = $derived.by(() => {
		const out: BreakdownSection[] = [
			{
				key: 'model',
				label: 'Model',
				icon: Cpu,
				rows: data.byModel,
				truncated: data.byModel.length >= data.breakdownLimit
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
	{:else if key === 'provider'}
		<span class="truncate font-medium">{row.provider}</span>
	{/if}
{/snippet}

<div class="mx-auto max-w-7xl space-y-6">
	<a
		href={resolve('/app/tokens')}
		class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
	>
		<ChevronLeft class="size-4" /> Tokens
	</a>

	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="flex items-start gap-3">
			<span
				class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"
			>
				<KeyRound class="size-5" />
			</span>
			<div class="space-y-1">
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Machine token
				</p>
				<div class="flex flex-wrap items-center gap-2">
					<h2 class="text-lg font-semibold">{data.token.name}</h2>
					<span class="inline-flex items-center gap-1.5 text-sm capitalize text-muted-foreground">
						<span
							class="size-1.5 rounded-full {tokenStatus.dot} {tokenStatus.pulse ? 'dot-pulse' : ''}"
						></span>
						{tokenStatus.label}
					</span>
					<span
						title="Token prefix (the full token is shown only once at creation)"
						class="inline-flex items-center rounded-md bg-muted/60 px-2 py-0.5 font-mono text-xs text-muted-foreground"
					>
						{data.token.display}
					</span>
				</div>
				<p class="text-xs text-muted-foreground">
					Service:
					<a
						href={resolve('/app/services/[id]', { id: data.token.serviceId })}
						class="font-medium hover:underline"
					>
						{data.token.serviceName}
					</a>
					· Policy: {data.token.policyId
						? (data.token.policyName ?? 'No policy')
						: 'inherits service policy'} · created {relativeTime(data.token.createdAt)} · last used {relativeTime(
						data.token.lastUsedAt
					)}
				</p>
				{#if data.token.scopes.length > 0}
					<div class="flex flex-wrap gap-1 pt-0.5">
						{#each data.token.scopes as s (s)}<Badge variant="outline">{s}</Badge>{/each}
					</div>
				{/if}
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
		</div>
	</div>

	{#if !hasTraffic}
		<Card.Root>
			<Card.Content class="py-16 text-center text-sm text-muted-foreground">
				No gateway traffic from this token for {rangeLabel}.
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
					<TokenSplit input={totals.inputTokens} output={totals.outputTokens} />
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
						{formatTokens(totals.savedInputTokens)} uprox · {formatTokens(
							totals.providerCachedTokens
						)} provider
					</p>
				</Card.Content>
			</Card.Root>
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
			description="Requests, cost, and tokens for this token"
		/>
	{/if}
</div>

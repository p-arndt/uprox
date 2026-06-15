<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import BudgetAlert from '$lib/components/budget-alert.svelte';
	import CustomRangePicker from '$lib/components/custom-range-picker.svelte';
	import UsageChart from '$lib/components/usage-chart.svelte';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { BUCKET_OPTIONS } from '$lib/usage-range';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { formatUsd, formatTokens } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Cpu from '@lucide/svelte/icons/cpu';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Server from '@lucide/svelte/icons/server';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
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

	// Trend chart metric toggle. Spend is the headline most operators reach for.
	type Metric = 'cost' | 'requests' | 'tokens';
	let metric = $state<Metric>('cost');
	const METRICS: { key: Metric; label: string }[] = [
		{ key: 'cost', label: 'Spend' },
		{ key: 'requests', label: 'Requests' },
		{ key: 'tokens', label: 'Tokens' }
	];

	// Chart shape controls — pure client state, no reload needed.
	type ChartType = 'bar' | 'line' | 'area';
	let chartType = $state<ChartType>('bar');
	const CHART_TYPES: { key: ChartType; label: string }[] = [
		{ key: 'bar', label: 'Bars' },
		{ key: 'line', label: 'Line' },
		{ key: 'area', label: 'Area' }
	];
	let cumulative = $state(false);
	let compare = $state(false);

	// Human-readable bucket adverb for the chart caption (no awkward "per month
	// across 30 days"). Driven by the *effective* unit the server resolved.
	const UNIT_ADVERB: Record<string, string> = {
		hour: 'hourly',
		day: 'daily',
		week: 'weekly',
		month: 'monthly'
	};
	const metricLabel = $derived(
		metric === 'cost' ? 'Spend' : metric === 'requests' ? 'Requests' : 'Tokens'
	);

	// Embeddings are very high-volume but cheap, so they dominate the token count
	// while barely moving cost. Let the operator drop them from the headline for a
	// clearer view of chat/completion consumption. Only affects the cards below;
	// the breakdowns keep showing embedding models.
	let excludeEmbeddings = $state(false);

	// Breakdown view metric — drives the row ORDER, the headline number, and the
	// bar length together, so toggling it visibly re-renders every breakdown (even
	// when the ranking happens to be the same across metrics).
	type SortKey = 'cost' | 'requests' | 'tokens';
	let sortBy = $state<SortKey>('cost');
	const SORTS: { key: SortKey; label: string }[] = [
		{ key: 'cost', label: 'Spend' },
		{ key: 'requests', label: 'Requests' },
		{ key: 'tokens', label: 'Tokens' }
	];

	type BreakdownRow = {
		costUsd: number;
		requests: number;
		inputTokens: number;
		outputTokens: number;
	};
	const tokensOf = (r: BreakdownRow) => r.inputTokens + r.outputTokens;
	const metricOf = (r: BreakdownRow) =>
		sortBy === 'cost' ? r.costUsd : sortBy === 'requests' ? r.requests : tokensOf(r);

	function sortRows<T extends BreakdownRow>(rows: readonly T[]): T[] {
		return [...rows].sort((a, b) => metricOf(b) - metricOf(a));
	}

	/** The headline number shown per row, following the selected view metric. */
	function primaryValue(r: BreakdownRow): string {
		if (sortBy === 'cost') return formatUsd(r.costUsd);
		if (sortBy === 'requests') return `${r.requests.toLocaleString()} req`;
		return `${formatTokens(tokensOf(r))} tok`;
	}
	/** Bar width as a share of the breakdown's total for the selected view metric. */
	function barPct(r: BreakdownRow, total: number): number {
		const v = metricOf(r);
		return Math.max(2, Math.round((total > 0 ? v / total : 0) * 100));
	}

	const sortedServices = $derived(sortRows(data.byService));
	const sortedModels = $derived(sortRows(data.byModel));
	const sortedProviders = $derived(sortRows(data.byProvider));
	const sortedTokens = $derived(sortRows(data.byToken));

	// Per-breakdown total for the active view metric, used to scale the bars.
	const serviceTotal = $derived(data.byService.reduce((s, r) => s + metricOf(r), 0));
	const modelTotal = $derived(data.byModel.reduce((s, r) => s + metricOf(r), 0));
	const providerTotal = $derived(data.byProvider.reduce((s, r) => s + metricOf(r), 0));
	const tokenTotal = $derived(data.byToken.reduce((s, r) => s + metricOf(r), 0));

	// Window-wide token totals come straight from the totals aggregate, so they
	// stay exact even past the per-breakdown row limits. The toggle subtracts the
	// embedding subset from the input/total cards.
	const totals = $derived(data.totals);
	const embeddingTokens = $derived(totals.embeddingInputTokens + totals.embeddingOutputTokens);
	const inputTokenTotal = $derived(
		excludeEmbeddings ? totals.inputTokens - totals.embeddingInputTokens : totals.inputTokens
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

	// Error rate over all gateway requests in the window (errors only — denials are
	// shown separately since they're a policy outcome, not a failure).
	const errorRate = $derived(totals.requests > 0 ? totals.errors / totals.requests : 0);

	function formatMs(ms: number | null): string {
		if (ms == null) return '—';
		return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
	}

	const hasTraffic = $derived(data.byService.length > 0 || data.byModel.length > 0);
	const modelsTruncated = $derived(data.byModel.length >= data.breakdownLimit);
	const tokensTruncated = $derived(data.byToken.length >= data.breakdownLimit);
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<div class="space-y-4">
		<div>
			<h2 class="text-lg font-semibold">Usage</h2>
			<p class="text-sm text-muted-foreground">
				Spend, requests, and token volume by service, model, and machine token.
			</p>
		</div>
		<!-- Date range (left) and the headline-card embedding toggle (right). The
		     time-series granularity lives with the trend chart, not here, since it
		     only affects that chart. -->
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex flex-wrap items-center gap-2">
				<div class="flex shrink-0 flex-wrap gap-1 rounded-lg border p-0.5">
					{#each data.ranges as r (r.key)}
						<a
							href={hrefWith({ range: r.key })}
							data-sveltekit-noscroll
							class="rounded-md px-3 py-1 text-sm font-medium transition-colors {r.key ===
							data.range
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
			{#if hasTraffic}
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
			{/if}
		</div>
		<!-- Trend granularity: time-bucketing for the chart below. (Breakdowns are
		     totals over the whole range, so bucketing can't reshape them.) -->
		<div class="flex flex-wrap items-center gap-2">
			<span class="text-xs font-medium text-muted-foreground">Trend granularity</span>
			<div class="flex shrink-0 flex-wrap gap-1 rounded-lg border p-0.5">
				{#each BUCKET_OPTIONS as b (b.key)}
					<a
						href={hrefWith({ bucket: b.key })}
						data-sveltekit-noscroll
						class="rounded-md px-3 py-1 text-sm font-medium transition-colors {b.key === data.bucket
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						{b.label}
					</a>
				{/each}
			</div>
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
		<!-- Token consumption headline -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Total tokens</Card.Description>
					<Sigma class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{formatTokens(totalTokens)}</div>
					<p class="text-xs text-muted-foreground">
						{excludeEmbeddings
							? `excludes ${formatTokens(embeddingTokens)} embedding`
							: 'prompt + completion combined'}
					</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Input tokens</Card.Description>
					<ArrowUpFromLine class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{formatTokens(inputTokenTotal)}</div>
					<p class="text-xs text-muted-foreground">
						{excludeEmbeddings ? 'embeddings excluded' : 'sent to the upstream model'}
					</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Output tokens</Card.Description>
					<ArrowDownToLine class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{formatTokens(outputTokenTotal)}</div>
					<p class="text-xs text-muted-foreground">generated by the model</p>
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
					<p class="text-xs text-muted-foreground tabular-nums">
						{formatTokens(savedInputTotal)} uprox · {formatTokens(providerCachedTotal)} provider
					</p>
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Reliability & latency -->
		<Card.Root>
			<Card.Content class="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
				<div>
					<div class="text-xs text-muted-foreground">Error rate</div>
					<div class="text-xl font-semibold tabular-nums">{(errorRate * 100).toFixed(1)}%</div>
					<p class="text-xs text-muted-foreground tabular-nums">
						{totals.errors.toLocaleString()} of {totals.requests.toLocaleString()}
					</p>
				</div>
				<div>
					<div class="text-xs text-muted-foreground">Denied</div>
					<div class="text-xl font-semibold tabular-nums">{totals.denied.toLocaleString()}</div>
					<p class="text-xs text-muted-foreground">blocked by policy or budget</p>
				</div>
				<div>
					<div class="text-xs text-muted-foreground">Latency p50</div>
					<div class="text-xl font-semibold tabular-nums">{formatMs(totals.latencyP50)}</div>
					<p class="text-xs text-muted-foreground">median upstream round-trip</p>
				</div>
				<div>
					<div class="text-xs text-muted-foreground">Latency p95</div>
					<div class="text-xl font-semibold tabular-nums">{formatMs(totals.latencyP95)}</div>
					<p class="text-xs text-muted-foreground">95th percentile</p>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Trend over time -->
		<Card.Root>
			<Card.Header class="flex flex-row items-start justify-between space-y-0">
				<div>
					<Card.Title>Trend over time</Card.Title>
					<Card.Description>
						{metricLabel} · {cumulative
							? 'cumulative'
							: (UNIT_ADVERB[data.series.unit] ?? data.series.unit)} · {rangeLabel}
					</Card.Description>
				</div>
				<div class="flex shrink-0 gap-1 rounded-lg border p-0.5">
					{#each METRICS as m (m.key)}
						<button
							type="button"
							onclick={() => (metric = m.key)}
							class="rounded-md px-3 py-1 text-sm font-medium transition-colors {m.key === metric
								? 'bg-accent text-accent-foreground'
								: 'text-muted-foreground hover:text-foreground'}"
						>
							{m.label}
						</button>
					{/each}
				</div>
			</Card.Header>
			<Card.Content class="space-y-3">
				<div class="flex flex-wrap items-center gap-3">
					<div class="flex shrink-0 gap-1 rounded-lg border p-0.5">
						{#each CHART_TYPES as c (c.key)}
							<button
								type="button"
								onclick={() => (chartType = c.key)}
								class="rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors {c.key ===
								chartType
									? 'bg-accent text-accent-foreground'
									: 'text-muted-foreground hover:text-foreground'}"
							>
								{c.label}
							</button>
						{/each}
					</div>
					<div class="flex items-center gap-2">
						<Switch id="cumulative" size="sm" bind:checked={cumulative} />
						<Label for="cumulative" class="text-sm font-normal text-muted-foreground"
							>Cumulative</Label
						>
					</div>
					<div class="flex items-center gap-2">
						<Switch id="compare" size="sm" bind:checked={compare} />
						<Label for="compare" class="text-sm font-normal text-muted-foreground">
							Compare to previous period
						</Label>
					</div>
				</div>
				<UsageChart
					points={data.series.points}
					unit={data.series.unit}
					{metric}
					type={chartType}
					{cumulative}
					comparePoints={compare ? data.prevPoints : null}
				/>
			</Card.Content>
		</Card.Root>

		<!-- Breakdown sort control -->
		<div class="flex items-center gap-2">
			<span class="text-xs font-medium text-muted-foreground">View breakdowns by</span>
			<div class="flex shrink-0 gap-1 rounded-lg border p-0.5">
				{#each SORTS as s (s.key)}
					<button
						type="button"
						onclick={() => (sortBy = s.key)}
						class="rounded-md px-2.5 py-0.5 text-xs font-medium transition-colors {s.key === sortBy
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						{s.label}
					</button>
				{/each}
			</div>
		</div>

		<div class="grid gap-4 lg:grid-cols-2">
			<!-- Spend by service -->
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title>By service</Card.Title>
						<Card.Description>Which workloads are driving cost and token volume</Card.Description>
					</div>
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<Boxes class="size-4" />
					</span>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#each sortedServices as row (row.serviceId ?? 'deleted')}
						<div>
							<div class="flex items-baseline justify-between gap-2 text-sm">
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
								<span class="shrink-0 tabular-nums">{primaryValue(row)}</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-accent-foreground/70"
									style="width: {barPct(row, serviceTotal)}%"
								></div>
							</div>
							<div class="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
								<span>{row.requests.toLocaleString()} requests</span>
								<span class="flex items-center gap-2">
									{#if row.inputTokens > 0 || row.outputTokens > 0}
										<span title="input / output tokens">
											{formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out
										</span>
									{/if}
									{#if row.denied > 0}
										<span class="text-destructive">{row.denied.toLocaleString()} denied</span>
									{/if}
								</span>
							</div>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>

			<!-- Usage by model -->
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title>By model</Card.Title>
						<Card.Description>Requests, cost, and tokens per model</Card.Description>
					</div>
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<Cpu class="size-4" />
					</span>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#each sortedModels as row (row.model)}
						<div>
							<div class="flex items-baseline justify-between gap-2 text-sm">
								<span class="flex min-w-0 items-baseline gap-2">
									<span class="truncate font-mono font-medium">{row.model}</span>
									{#if row.provider}
										<span class="shrink-0 text-xs text-muted-foreground">{row.provider}</span>
									{/if}
								</span>
								<span class="shrink-0 tabular-nums">{primaryValue(row)}</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-accent-foreground/70"
									style="width: {barPct(row, modelTotal)}%"
								></div>
							</div>
							<div class="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
								<span>{row.requests.toLocaleString()} requests</span>
								<span class="flex items-center gap-2">
									{#if row.inputTokens > 0 || row.outputTokens > 0}
										<span title="input / output tokens">
											{formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out
										</span>
									{/if}
									{#if row.denied > 0}
										<span class="text-destructive">{row.denied.toLocaleString()} denied</span>
									{/if}
								</span>
							</div>
						</div>
					{/each}
					{#if modelsTruncated}
						<p class="pt-1 text-xs text-muted-foreground">
							Showing the top {data.breakdownLimit} models by request volume.
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>

		{#if data.byProvider.length > 0}
			<!-- Spend by provider: the coarsest view — where the traffic is landing. -->
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title>By provider</Card.Title>
						<Card.Description>Cost and volume per upstream provider</Card.Description>
					</div>
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<Server class="size-4" />
					</span>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#each sortedProviders as row (row.provider)}
						<div>
							<div class="flex items-baseline justify-between gap-2 text-sm">
								<span class="truncate font-medium">{row.provider}</span>
								<span class="shrink-0 tabular-nums">{primaryValue(row)}</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-accent-foreground/70"
									style="width: {barPct(row, providerTotal)}%"
								></div>
							</div>
							<div class="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
								<span>{row.requests.toLocaleString()} requests</span>
								<span class="flex items-center gap-2">
									{#if row.inputTokens > 0 || row.outputTokens > 0}
										<span title="input / output tokens">
											{formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out
										</span>
									{/if}
									{#if row.denied > 0}
										<span class="text-destructive">{row.denied.toLocaleString()} denied</span>
									{/if}
								</span>
							</div>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if data.byToken.length > 0}
			<!-- Spend by machine token: drills one level below "by service" so a
			     leaked or runaway API key surfaces before its parent service total
			     looks unusual. -->
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title>By machine token</Card.Title>
						<Card.Description>
							Per-token activity — useful for spotting a single noisy key inside a busy service
						</Card.Description>
					</div>
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<KeyRound class="size-4" />
					</span>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#each sortedTokens as row (row.tokenId)}
						<div>
							<div class="flex items-baseline justify-between gap-2 text-sm">
								<span class="flex min-w-0 items-baseline gap-2">
									<span class="truncate font-medium">
										{row.tokenName ?? 'Revoked token'}
									</span>
									{#if row.serviceName}
										<span class="shrink-0 text-xs text-muted-foreground">
											· {row.serviceName}
										</span>
									{/if}
									{#if row.tokenDisplay}
										<span class="shrink-0 font-mono text-xs text-muted-foreground">
											{row.tokenDisplay}
										</span>
									{/if}
								</span>
								<span class="shrink-0 tabular-nums">{primaryValue(row)}</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-accent-foreground/70"
									style="width: {barPct(row, tokenTotal)}%"
								></div>
							</div>
							<div class="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
								<span>{row.requests.toLocaleString()} requests</span>
								<span class="flex items-center gap-2">
									{#if row.inputTokens > 0 || row.outputTokens > 0}
										<span title="input / output tokens">
											{formatTokens(row.inputTokens)} in · {formatTokens(row.outputTokens)} out
										</span>
									{/if}
									{#if row.denied > 0}
										<span class="text-destructive">{row.denied.toLocaleString()} denied</span>
									{/if}
								</span>
							</div>
						</div>
					{/each}
					{#if tokensTruncated}
						<p class="pt-1 text-xs text-muted-foreground">
							Showing the top {data.breakdownLimit} tokens by request volume.
						</p>
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>

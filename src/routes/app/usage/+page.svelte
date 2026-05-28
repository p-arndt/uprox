<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import BudgetAlert from '$lib/components/budget-alert.svelte';
	import { resolve } from '$app/paths';
	import { formatUsd, formatTokens } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Cpu from '@lucide/svelte/icons/cpu';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import Sigma from '@lucide/svelte/icons/sigma';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';

	let { data } = $props();

	const rangeLabel: Record<number, string> = { 7: '7 days', 30: '30 days', 90: '90 days' };

	// Share bars are weighted by spend, falling back to request count when the
	// whole window billed $0 (e.g. only cache hits or denials), so the bars still
	// convey relative volume.
	const serviceCostTotal = $derived(data.byService.reduce((s, r) => s + r.costUsd, 0));
	const serviceReqTotal = $derived(data.byService.reduce((s, r) => s + r.requests, 0));
	const modelCostTotal = $derived(data.byModel.reduce((s, r) => s + r.costUsd, 0));
	const modelReqTotal = $derived(data.byModel.reduce((s, r) => s + r.requests, 0));
	const tokenCostTotal = $derived(data.byToken.reduce((s, r) => s + r.costUsd, 0));
	const tokenReqTotal = $derived(data.byToken.reduce((s, r) => s + r.requests, 0));

	// Window-wide token totals — surface them above the breakdowns so the user
	// sees the consumption headline before drilling into per-service detail.
	const inputTokenTotal = $derived(data.byService.reduce((s, r) => s + r.inputTokens, 0));
	const outputTokenTotal = $derived(data.byService.reduce((s, r) => s + r.outputTokens, 0));
	const totalTokens = $derived(inputTokenTotal + outputTokenTotal);
	// Saved by either uprox's response cache (replayed entire request) or the
	// upstream provider's prompt cache (discounted subset of input). The rate
	// is computed on input tokens only — the provider cache discount applies to
	// input, so mixing in output would inflate the headline meaninglessly.
	const savedInputTotal = $derived(data.byService.reduce((s, r) => s + r.savedInputTokens, 0));
	const providerCachedTotal = $derived(
		data.byService.reduce((s, r) => s + r.providerCachedTokens, 0)
	);
	const cacheableInput = $derived(inputTokenTotal + savedInputTotal);
	const cachedInput = $derived(savedInputTotal + providerCachedTotal);
	const tokenCacheRate = $derived(cacheableInput > 0 ? cachedInput / cacheableInput : 0);

	function share(cost: number, requests: number, costTotal: number, reqTotal: number) {
		const f = costTotal > 0 ? cost / costTotal : reqTotal > 0 ? requests / reqTotal : 0;
		return Math.max(2, Math.round(f * 100));
	}

	const hasTraffic = $derived(data.byService.length > 0 || data.byModel.length > 0);
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<div>
			<h2 class="text-lg font-semibold">Usage</h2>
			<p class="text-sm text-muted-foreground">
				Spend, requests, and token volume by service, model, and machine token over the last {rangeLabel[
					data.days
				]}.
			</p>
		</div>
		<div class="flex rounded-lg border p-0.5">
			{#each data.ranges as n (n)}
				<a
					href="{resolve('/app/usage')}?days={n}"
					data-sveltekit-noscroll
					class="rounded-md px-3 py-1 text-sm font-medium transition-colors {n === data.days
						? 'bg-accent text-accent-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					{rangeLabel[n]}
				</a>
			{/each}
		</div>
	</div>

	<BudgetAlert statuses={data.budgets} threshold={data.budgetThreshold} />

	{#if !hasTraffic}
		<Card.Root>
			<Card.Content class="py-16 text-center text-sm text-muted-foreground">
				No gateway traffic in the last {rangeLabel[data.days]}.
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
					<p class="text-xs text-muted-foreground">prompt + completion combined</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Input tokens</Card.Description>
					<ArrowUpFromLine class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{formatTokens(inputTokenTotal)}</div>
					<p class="text-xs text-muted-foreground">sent to the upstream model</p>
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

		<div class="grid gap-4 lg:grid-cols-2">
			<!-- Spend by service -->
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title>Spend by service</Card.Title>
						<Card.Description>Which workloads are driving cost and token volume</Card.Description>
					</div>
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<Boxes class="size-4" />
					</span>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#each data.byService as row (row.serviceId ?? 'deleted')}
						<div>
							<div class="flex items-baseline justify-between gap-2 text-sm">
								<span class="truncate font-medium">
									{row.serviceName ?? 'Deleted service'}
								</span>
								<span class="shrink-0 tabular-nums">{formatUsd(row.costUsd)}</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-accent-foreground/70"
									style="width: {share(
										row.costUsd,
										row.requests,
										serviceCostTotal,
										serviceReqTotal
									)}%"
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
						<Card.Title>Usage by model</Card.Title>
						<Card.Description>Requests, cost, and tokens per model</Card.Description>
					</div>
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<Cpu class="size-4" />
					</span>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#each data.byModel as row (row.model)}
						<div>
							<div class="flex items-baseline justify-between gap-2 text-sm">
								<span class="flex min-w-0 items-baseline gap-2">
									<span class="truncate font-mono font-medium">{row.model}</span>
									{#if row.provider}
										<span class="shrink-0 text-xs text-muted-foreground">{row.provider}</span>
									{/if}
								</span>
								<span class="shrink-0 tabular-nums">{formatUsd(row.costUsd)}</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-accent-foreground/70"
									style="width: {share(row.costUsd, row.requests, modelCostTotal, modelReqTotal)}%"
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
		</div>

		{#if data.byToken.length > 0}
			<!-- Spend by machine token: drills one level below "by service" so a
			     leaked or runaway API key surfaces before its parent service total
			     looks unusual. -->
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title>Spend by machine token</Card.Title>
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
					{#each data.byToken as row (row.tokenId)}
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
								<span class="shrink-0 tabular-nums">{formatUsd(row.costUsd)}</span>
							</div>
							<div class="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
								<div
									class="h-full rounded-full bg-accent-foreground/70"
									style="width: {share(row.costUsd, row.requests, tokenCostTotal, tokenReqTotal)}%"
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
	{/if}
</div>

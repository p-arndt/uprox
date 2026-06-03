<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { resolve } from '$app/paths';
	import { formatUsd, formatTokens, relativeTime } from '$lib/format';
	import Cpu from '@lucide/svelte/icons/cpu';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ArrowDownToLine from '@lucide/svelte/icons/arrow-down-to-line';
	import ArrowUpFromLine from '@lucide/svelte/icons/arrow-up-from-line';
	import Sigma from '@lucide/svelte/icons/sigma';
	import CircleDollarSign from '@lucide/svelte/icons/circle-dollar-sign';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';

	let { data } = $props();

	const rangeLabel = $derived(data.ranges.find((r) => r.key === data.range)?.label ?? data.range);
	const totals = $derived(data.totals);
	const totalTokens = $derived(totals.inputTokens + totals.outputTokens);

	const modelCostTotal = $derived(data.byModel.reduce((s, r) => s + r.costUsd, 0));
	const modelReqTotal = $derived(data.byModel.reduce((s, r) => s + r.requests, 0));
	const tokenCostTotal = $derived(data.byToken.reduce((s, r) => s + r.costUsd, 0));
	const tokenReqTotal = $derived(data.byToken.reduce((s, r) => s + r.requests, 0));

	// Bars weighted by spend, falling back to request count when the window billed
	// $0 (only cache hits or denials) so they still convey relative volume.
	function share(cost: number, requests: number, costTotal: number, reqTotal: number) {
		const f = costTotal > 0 ? cost / costTotal : reqTotal > 0 ? requests / reqTotal : 0;
		return Math.max(2, Math.round(f * 100));
	}

	const hasTraffic = $derived(data.byModel.length > 0 || data.byToken.length > 0);
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<a
		href={resolve('/app/services')}
		class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
	>
		<ChevronLeft class="size-4" /> Services
	</a>

	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="space-y-1">
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
		<div class="flex flex-wrap rounded-lg border p-0.5">
			{#each data.ranges as r (r.key)}
				<a
					href="{resolve('/app/services/[id]', { id: data.service.id })}?range={r.key}"
					data-sveltekit-noscroll
					class="rounded-md px-3 py-1 text-sm font-medium transition-colors {r.key === data.range
						? 'bg-accent text-accent-foreground'
						: 'text-muted-foreground hover:text-foreground'}"
				>
					{r.label}
				</a>
			{/each}
		</div>
	</div>

	{#if !hasTraffic}
		<Card.Root>
			<Card.Content class="py-16 text-center text-sm text-muted-foreground">
				No gateway traffic from this service for {rangeLabel}.
			</Card.Content>
		</Card.Root>
	{:else}
		<!-- Token + spend headline -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Total spend</Card.Description>
					<CircleDollarSign class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{formatUsd(totals.costUsd)}</div>
					<p class="text-xs text-muted-foreground tabular-nums">
						{totals.requests.toLocaleString()} requests
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
					<p class="text-xs text-muted-foreground">prompt + completion combined</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Input tokens</Card.Description>
					<ArrowUpFromLine class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{formatTokens(totals.inputTokens)}</div>
					<p class="text-xs text-muted-foreground">sent to the upstream model</p>
				</Card.Content>
			</Card.Root>
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Description>Output tokens</Card.Description>
					<ArrowDownToLine class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-2xl font-semibold tabular-nums">{formatTokens(totals.outputTokens)}</div>
					<p class="text-xs text-muted-foreground">generated by the model</p>
				</Card.Content>
			</Card.Root>
		</div>

		<div class="grid gap-4 lg:grid-cols-2">
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

			<!-- Spend by machine token -->
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title>Spend by machine token</Card.Title>
						<Card.Description>Which individual key drives this service's spend</Card.Description>
					</div>
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<KeyRound class="size-4" />
					</span>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#if data.byToken.length === 0}
						<p class="py-6 text-center text-sm text-muted-foreground">
							No per-token activity in this window.
						</p>
					{/if}
					{#each data.byToken as row (row.tokenId)}
						<div>
							<div class="flex items-baseline justify-between gap-2 text-sm">
								<span class="flex min-w-0 items-baseline gap-2">
									<span class="truncate font-medium">{row.tokenName ?? 'Revoked token'}</span>
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
		</div>
	{/if}
</div>

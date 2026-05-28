<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import BudgetAlert from '$lib/components/budget-alert.svelte';
	import { resolve } from '$app/paths';
	import { formatUsd } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Cpu from '@lucide/svelte/icons/cpu';

	let { data } = $props();

	const rangeLabel: Record<number, string> = { 7: '7 days', 30: '30 days', 90: '90 days' };

	// Share bars are weighted by spend, falling back to request count when the
	// whole window billed $0 (e.g. only cache hits or denials), so the bars still
	// convey relative volume.
	const serviceCostTotal = $derived(data.byService.reduce((s, r) => s + r.costUsd, 0));
	const serviceReqTotal = $derived(data.byService.reduce((s, r) => s + r.requests, 0));
	const modelCostTotal = $derived(data.byModel.reduce((s, r) => s + r.costUsd, 0));
	const modelReqTotal = $derived(data.byModel.reduce((s, r) => s + r.requests, 0));

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
				Spend and request volume by service and model over the last {rangeLabel[data.days]}.
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
		<div class="grid gap-4 lg:grid-cols-2">
			<!-- Spend by service -->
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0">
					<div>
						<Card.Title>Spend by service</Card.Title>
						<Card.Description>Which workloads are driving cost</Card.Description>
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
								{#if row.denied > 0}
									<span class="text-destructive">{row.denied.toLocaleString()} denied</span>
								{/if}
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
						<Card.Description>Requests and cost per model</Card.Description>
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
								{#if row.denied > 0}
									<span class="text-destructive">{row.denied.toLocaleString()} denied</span>
								{/if}
							</div>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		</div>
	{/if}
</div>

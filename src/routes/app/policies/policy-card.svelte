<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import ShieldHalf from '@lucide/svelte/icons/shield-half';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Gauge from '@lucide/svelte/icons/gauge';
	import Wallet from '@lucide/svelte/icons/wallet';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import { formatBudget } from './budget-label';
	import type { PageData } from './$types';

	// One preset: its access lists and a one-line summary of limits, cache and tracing.

	let {
		policy: p,
		canManage,
		onEdit
	}: {
		policy: PageData['policies'][number];
		canManage: boolean;
		onEdit: () => void;
	} = $props();
</script>

{#snippet badgeList(label: string, items: string[])}
	<div>
		<div class="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
		{#if items.length === 0}
			<Badge variant="outline">all</Badge>
		{:else}
			<div class="flex flex-wrap gap-1">
				{#each items as item (item)}<Badge variant="secondary">{item}</Badge>{/each}
			</div>
		{/if}
	</div>
{/snippet}

<Card.Root>
	<Card.Header class="flex flex-row items-start justify-between space-y-0">
		<div class="flex items-center gap-3">
			<div class="flex size-9 items-center justify-center rounded-lg border bg-muted">
				<ShieldHalf class="size-4" />
			</div>
			<Card.Title class="text-base">{p.name}</Card.Title>
		</div>
		{#if canManage}
			<div class="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon"
					class="size-8 text-muted-foreground"
					title="Edit policy"
					onclick={onEdit}
				>
					<Pencil class="size-4" />
				</Button>
				<ConfirmAction
					action="?/delete"
					title={`Delete “${p.name}”?`}
					description="Services assigned to this policy will no longer be governed by it. This can't be undone."
					actionLabel="Delete policy"
				>
					{#snippet trigger({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class="size-8 text-muted-foreground hover:text-destructive"
							title="Delete policy"
						>
							<Trash2 class="size-4" />
						</Button>
					{/snippet}
					{#snippet fields()}
						<input type="hidden" name="id" value={p.id} />
					{/snippet}
				</ConfirmAction>
			</div>
		{/if}
	</Card.Header>
	<Card.Content class="space-y-3 text-sm">
		{@render badgeList('Providers', p.allowedProviders)}
		{@render badgeList('Models', p.allowedModels)}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
			<span class="flex items-center gap-1.5">
				<Gauge class="size-3.5" />
				{p.rateLimitPerMinute === 0 ? 'Unlimited' : `${p.rateLimitPerMinute} req/min`}
			</span>
			<span class="flex items-center gap-1.5">
				<Wallet class="size-3.5" />
				{formatBudget(p.dailyBudgetUsd, p.monthlyBudgetUsd)}
			</span>
			<span class="flex items-center gap-1.5">
				<DatabaseZap class="size-3.5" />
				{p.cacheTtlSeconds == null
					? 'Cache: inherit'
					: p.cacheTtlSeconds === 0
						? 'Cache: off'
						: `Cache ${p.cacheTtlSeconds}s`}
			</span>
			<span class="flex items-center gap-1.5">
				<Waypoints class="size-3.5" />
				{p.tracingEnabled == null
					? 'Trace: inherit'
					: p.tracingEnabled
						? 'Trace: on'
						: 'Trace: off'}
			</span>
		</div>
	</Card.Content>
</Card.Root>

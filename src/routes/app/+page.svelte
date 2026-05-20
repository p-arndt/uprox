<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { relativeTime, formatUsd } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Activity from '@lucide/svelte/icons/activity';
	import ShieldX from '@lucide/svelte/icons/shield-x';
	import DollarSign from '@lucide/svelte/icons/dollar-sign';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	let { data } = $props();

	const cards = $derived<{ label: string; value: number; icon: typeof Boxes; href: Pathname }[]>([
		{ label: 'Services', value: data.stats.services, icon: Boxes, href: '/app/services' },
		{ label: 'Active tokens', value: data.stats.activeTokens, icon: KeyRound, href: '/app/tokens' },
		{ label: 'Gateway requests', value: data.stats.requests, icon: Activity, href: '/app/audit' },
		{ label: 'Denied', value: data.stats.denied, icon: ShieldX, href: '/app/audit' }
	]);

	function statusVariant(s: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (s === 'deny') return 'destructive';
		if (s === 'error') return 'destructive';
		if (s === 'ok' || s === 'allow') return 'secondary';
		return 'outline';
	}
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each cards as c (c.label)}
			<a href={resolve(c.href)} class="block">
				<Card.Root class="transition-colors hover:border-foreground/20">
					<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
						<Card.Title class="text-sm font-medium text-muted-foreground">{c.label}</Card.Title>
						<c.icon class="size-4 text-muted-foreground" />
					</Card.Header>
					<Card.Content>
						<div class="text-3xl font-semibold tabular-nums">{c.value}</div>
					</Card.Content>
				</Card.Root>
			</a>
		{/each}
	</div>

	<div class="grid gap-4 lg:grid-cols-3">
		<div class="space-y-4 lg:col-span-1">
			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium text-muted-foreground">Estimated spend</Card.Title>
					<DollarSign class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-3xl font-semibold tabular-nums">{formatUsd(data.stats.costUsd)}</div>
					<p class="mt-1 text-xs text-muted-foreground">Across all proxied requests</p>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium text-muted-foreground">Cache hit rate</Card.Title>
					<DatabaseZap class="size-4 text-muted-foreground" />
				</Card.Header>
				<Card.Content>
					<div class="text-3xl font-semibold tabular-nums">
						{(data.stats.cacheHitRate * 100).toFixed(1)}%
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						{data.stats.cacheHits} hits · {formatUsd(data.stats.cacheSavedUsd)} saved
					</p>
				</Card.Content>
			</Card.Root>
		</div>

		<Card.Root class="lg:col-span-2">
			<Card.Header class="flex flex-row items-center justify-between">
				<div>
					<Card.Title>Recent activity</Card.Title>
					<Card.Description>Latest gateway and admin events</Card.Description>
				</div>
				<Button href="/app/audit" variant="ghost" size="sm">
					View all <ArrowRight class="size-4" />
				</Button>
			</Card.Header>
			<Card.Content>
				{#if data.recent.length === 0}
					<p class="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
				{:else}
					<ul class="divide-y">
						{#each data.recent as e (e.id)}
							<li class="flex items-center gap-3 py-2.5 text-sm">
								<Badge variant={statusVariant(e.status)} class="shrink-0">{e.status}</Badge>
								<span class="font-medium">{e.action}</span>
								<span class="truncate text-muted-foreground">
									{e.model ?? e.serviceName ?? e.detail ?? ''}
								</span>
								<span class="ml-auto shrink-0 text-xs text-muted-foreground">
									{relativeTime(e.createdAt)}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>

<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { base } from '$app/paths';
	import type { Pathname } from '$app/types';
	import { relativeTime, formatUsd } from '$lib/format';
	import Boxes from '@lucide/svelte/icons/boxes';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Activity from '@lucide/svelte/icons/activity';
	import ShieldX from '@lucide/svelte/icons/shield-x';
	import DollarSign from '@lucide/svelte/icons/dollar-sign';
	import DatabaseZap from '@lucide/svelte/icons/database-zap';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Check from '@lucide/svelte/icons/check';

	let { data } = $props();

	type Step = { done: boolean; title: string; desc: string; href: Pathname; cta: string };
	const steps = $derived<Step[]>([
		{
			done: data.stats.providers > 0,
			title: 'Connect a provider',
			desc: 'Add an upstream API key (OpenAI, Anthropic, Azure…).',
			href: '/app/providers',
			cta: 'Add key'
		},
		{
			done: data.stats.services > 0,
			title: 'Create a service',
			desc: 'A machine identity for an app, agent or workload.',
			href: '/app/services',
			cta: 'New service'
		},
		{
			done: data.stats.activeTokens > 0,
			title: 'Issue a machine token',
			desc: 'How a service authenticates to the gateway.',
			href: '/app/tokens',
			cta: 'New token'
		},
		{
			done: data.stats.requests > 0,
			title: 'Make your first request',
			desc: 'Proxy a call through the gateway and watch it land here.',
			href: '/app/audit',
			cta: 'View audit log'
		}
	]);
	const completed = $derived(steps.filter((s) => s.done).length);
	const firstIncomplete = $derived(steps.findIndex((s) => !s.done));
	// Fresh org: no gateway traffic yet. Once a request lands, show the live dashboard.
	const showOnboarding = $derived(data.stats.requests === 0);

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
	{#if showOnboarding}
		<Card.Root>
			<Card.Header>
				<Card.Title>Get started with uprox</Card.Title>
				<Card.Description>
					Four steps to your first proxied request — {completed} of {steps.length} done.
				</Card.Description>
				<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full bg-accent-foreground transition-all duration-500"
						style="width: {(completed / steps.length) * 100}%"
					></div>
				</div>
			</Card.Header>
			<Card.Content class="space-y-2">
				{#each steps as s, i (s.title)}
					<div
						class="flex items-center gap-3 rounded-xl border p-3 transition-colors {s.done
							? 'border-transparent bg-muted/40'
							: i === firstIncomplete
								? 'border-accent-foreground/30 bg-accent/40'
								: ''}"
					>
						{#if s.done}
							<span
								class="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-foreground text-background"
							>
								<Check class="size-4" />
							</span>
						{:else}
							<span
								class="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-medium {i ===
								firstIncomplete
									? 'border-accent-foreground text-accent-foreground'
									: 'text-muted-foreground'}"
							>
								{i + 1}
							</span>
						{/if}
						<div class="flex-1">
							<p class="text-sm font-medium {s.done ? 'text-muted-foreground line-through' : ''}">
								{s.title}
							</p>
							<p class="text-xs text-muted-foreground">{s.desc}</p>
						</div>
						{#if !s.done}
							<Button
								href={s.href}
								size="sm"
								variant={i === firstIncomplete ? 'default' : 'outline'}
							>
								{s.cta} <ArrowRight class="size-4" />
							</Button>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{:else}
	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each cards as c (c.label)}
			<a href={`${base}${c.href}`} class="block">
				<Card.Root
					class="transition-all hover:-translate-y-0.5 hover:border-accent-foreground/30 hover:shadow-md"
				>
					<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
						<Card.Title class="text-sm font-medium text-muted-foreground">{c.label}</Card.Title>
						<span
							class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
						>
							<c.icon class="size-4" />
						</span>
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
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<DollarSign class="size-4" />
					</span>
				</Card.Header>
				<Card.Content>
					<div class="text-3xl font-semibold tabular-nums">{formatUsd(data.stats.costUsd)}</div>
					<p class="mt-1 text-xs text-muted-foreground">Across all proxied requests</p>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
					<Card.Title class="text-sm font-medium text-muted-foreground">Cache hit rate</Card.Title>
					<span
						class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
					>
						<DatabaseZap class="size-4" />
					</span>
				</Card.Header>
				<Card.Content>
					<div class="text-3xl font-semibold tabular-nums">
						{(data.stats.cacheHitRate * 100).toFixed(1)}%
					</div>
					<p class="mt-1 text-xs text-muted-foreground">
						{data.stats.cacheHits} hits · {formatUsd(data.stats.cacheSavedUsd)} saved
					</p>
					{#if data.stats.providerCachedTokens > 0}
						<p class="text-xs text-muted-foreground">
							+ {data.stats.providerCachedTokens.toLocaleString()} input tokens from provider cache
						</p>
					{/if}
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
	{/if}
</div>

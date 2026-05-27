<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import BudgetAlert from '$lib/components/budget-alert.svelte';
	import { resolve } from '$app/paths';
	import type { Pathname, ResolvedPathname } from '$app/types';
	import { relativeTime, formatDateTime, formatUsd } from '$lib/format';
	import { eventTone, toneDot, toneText, actionIcon } from '$lib/events';
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

	type Metric = {
		label: string;
		value: number;
		icon: typeof Boxes;
		href: ResolvedPathname;
		alert?: boolean;
	};
	const cards = $derived<Metric[]>([
		{ label: 'Services', value: data.stats.services, icon: Boxes, href: resolve('/app/services') },
		{
			label: 'Active tokens',
			value: data.stats.activeTokens,
			icon: KeyRound,
			href: resolve('/app/tokens')
		},
		{
			label: 'Gateway requests',
			value: data.stats.requests,
			icon: Activity,
			href: resolve('/app/audit')
		},
		{
			label: 'Denied',
			value: data.stats.denied,
			icon: ShieldX,
			href: resolve('/app/audit'),
			alert: data.stats.denied > 0
		}
	]);

	// Sparkline: scale each day's request count against the busiest day in the window.
	const peak = $derived(Math.max(1, ...data.daily.map((d) => d.requests)));
	const last7Requests = $derived(data.daily.slice(-7).reduce((sum, d) => sum + d.requests, 0));
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<BudgetAlert statuses={data.budgets} />

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
								{s.cta}
								<ArrowRight class="size-4" />
							</Button>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each cards as c, i (c.label)}
				<a
					href={c.href}
					class="group block animate-in fade-in slide-in-from-bottom-2"
					style="animation-delay: {i * 60}ms; animation-fill-mode: both;"
				>
					<Card.Root
						class="h-full transition-all group-hover:-translate-y-0.5 group-hover:border-accent-foreground/40 group-hover:shadow-md"
					>
						<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
							<Card.Title class="text-sm font-medium text-muted-foreground">{c.label}</Card.Title>
							<span
								class="flex size-8 items-center justify-center rounded-lg transition-colors {c.alert
									? 'bg-destructive/10 text-destructive'
									: 'bg-accent text-accent-foreground'}"
							>
								<c.icon class="size-4" />
							</span>
						</Card.Header>
						<Card.Content>
							<div class="text-3xl font-semibold tabular-nums {c.alert ? 'text-destructive' : ''}">
								{c.value.toLocaleString()}
							</div>
						</Card.Content>
					</Card.Root>
				</a>
			{/each}
		</div>

		<div class="grid gap-4 lg:grid-cols-3">
			<div class="space-y-4 lg:col-span-1">
				<Card.Root>
					<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
						<Card.Title class="text-sm font-medium text-muted-foreground"
							>Estimated spend</Card.Title
						>
						<span
							class="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground"
						>
							<DollarSign class="size-4" />
						</span>
					</Card.Header>
					<Card.Content>
						<div class="text-3xl font-semibold tracking-tight tabular-nums">
							{formatUsd(data.stats.costUsd)}
						</div>
						<p class="mt-1 text-xs text-muted-foreground">Across all proxied requests</p>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
						<Card.Title class="text-sm font-medium text-muted-foreground">Cache hit rate</Card.Title
						>
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
						<div class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
							<div
								class="h-full rounded-full bg-accent-foreground transition-all duration-700"
								style="width: {Math.min(100, data.stats.cacheHitRate * 100)}%"
							></div>
						</div>
						<p class="mt-2 text-xs text-muted-foreground">
							{data.stats.cacheHits.toLocaleString()} hits · {formatUsd(data.stats.cacheSavedUsd)} saved
						</p>
						{#if data.stats.providerCachedTokens > 0}
							<p class="text-xs text-muted-foreground">
								+ {data.stats.providerCachedTokens.toLocaleString()} input tokens from provider cache
							</p>
						{/if}
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
						<Card.Title class="text-sm font-medium text-muted-foreground"
							>Requests · 14 days</Card.Title
						>
						<span class="text-xs text-muted-foreground tabular-nums"
							>{last7Requests.toLocaleString()} this week</span
						>
					</Card.Header>
					<Card.Content>
						<div class="flex h-16 items-end gap-1">
							{#each data.daily as d (d.date)}
								<div
									class="flex-1 rounded-sm transition-colors hover:opacity-80 {d.denied > 0
										? 'bg-destructive/50'
										: d.requests > 0
											? 'bg-accent-foreground/60'
											: 'bg-muted'}"
									style="height: {d.requests > 0 ? Math.max(8, (d.requests / peak) * 100) : 6}%"
									title="{formatDateTime(d.date)} — {d.requests} requests{d.denied
										? `, ${d.denied} denied`
										: ''}"
								></div>
							{/each}
						</div>
						<p class="mt-2 text-xs text-muted-foreground">Daily gateway requests</p>
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
				<Card.Content class="px-2">
					{#if data.recent.length === 0}
						<p class="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
					{:else}
						<ul>
							{#each data.recent as e, i (e.id)}
								{@const tone = eventTone(e.status)}
								{@const Icon = actionIcon(e.action)}
								<li
									class="animate-in fade-in slide-in-from-bottom-1"
									style="animation-delay: {i * 40}ms; animation-fill-mode: both;"
								>
									<a
										href={resolve('/app/audit')}
										class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60"
									>
										<span
											class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
										>
											<Icon class="size-4" />
										</span>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-2">
												<span class="font-mono text-sm font-medium">{e.action}</span>
												{#if tone !== 'ok' && tone !== 'neutral'}
													<span class="text-xs font-medium {toneText[tone]} capitalize"
														>{e.status}</span
													>
												{/if}
											</div>
											{#if e.model ?? e.serviceName ?? e.detail}
												<p class="truncate text-xs text-muted-foreground">
													{e.model ?? e.serviceName ?? e.detail}
												</p>
											{/if}
										</div>
										<div class="flex shrink-0 items-center gap-2">
											<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
											<time
												class="text-xs text-muted-foreground tabular-nums"
												title={formatDateTime(e.createdAt)}
											>
												{relativeTime(e.createdAt)}
											</time>
										</div>
									</a>
								</li>
							{/each}
						</ul>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>
	{/if}
</div>

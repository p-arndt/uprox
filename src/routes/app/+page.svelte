<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { Pathname } from '$app/types';
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
			done: data.stats.activeTokens > 0,
			title: 'Issue a machine token',
			desc: 'How your app authenticates to the gateway. Set a budget and go — organise tokens into services later.',
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
</script>

<div class="mx-auto max-w-3xl space-y-6">
	<div>
		<h1 class="text-xl font-semibold tracking-tight">Welcome to uprox</h1>
		<p class="text-sm text-muted-foreground">
			Three steps to your first proxied request. Once one lands, this page hands over to the cost
			analysis.
		</p>
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title>Get started with uprox</Card.Title>
			<Card.Description>{completed} of {steps.length} done.</Card.Description>
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
						<Button href={s.href} size="sm" variant={i === firstIncomplete ? 'default' : 'outline'}>
							{s.cta}
							<ArrowRight class="size-4" />
						</Button>
					{/if}
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>

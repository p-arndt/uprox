<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Check from '@lucide/svelte/icons/check';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import PageHeader from '$lib/components/layout/page-header.svelte';

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
			desc: 'Point your client at the gateway with the token and send a request.',
			href: '/app/connect',
			cta: 'Connect a client'
		}
	]);
	const completed = $derived(steps.filter((s) => s.done).length);
	const firstIncomplete = $derived(steps.findIndex((s) => !s.done));
</script>

<PageShell width="narrow">
	<PageHeader
		title="Get started with uprox"
		description="Three steps to your first proxied request. After your first request, this page shows your costs."
	/>

	<Card.Root>
		<Card.Header>
			<Card.Description id="setup-progress-label">
				{completed} of {steps.length} steps done
			</Card.Description>
			<div
				class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
				role="progressbar"
				aria-labelledby="setup-progress-label"
				aria-valuemin={0}
				aria-valuemax={steps.length}
				aria-valuenow={completed}
				aria-valuetext="{completed} of {steps.length} steps done"
			>
				<div
					class="h-full rounded-full bg-accent-foreground transition-all duration-500"
					style="width: {(completed / steps.length) * 100}%"
				></div>
			</div>
		</Card.Header>
		<Card.Content class="space-y-2">
			{#each steps as s, i (s.title)}
				<div
					class="flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors {s.done
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
							<span class="sr-only">Done:</span>
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
					<div class="min-w-0 flex-1">
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
		{#if completed === steps.length}
			<Card.Footer>
				<Button href={resolve('/app/usage')} variant="outline">
					Open cost analysis
					<ArrowRight class="size-4" />
				</Button>
			</Card.Footer>
		{/if}
	</Card.Root>
</PageShell>

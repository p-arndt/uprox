<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { Streamed } from '$lib/features/usage/types';
	import { Button } from '$lib/components/ui/button/index.js';
	import { invalidateAll } from '$app/navigation';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	// Renders a secondary cost-analysis panel whose data is streamed in after
	// first paint: a skeleton card while pending, a small inline error if the
	// query failed, the panel itself once it lands.

	let {
		state: stream,
		title,
		rows = 5,
		children,
		skeleton
	}: {
		/** the resolved stream, or undefined while it is still pending */
		state: Streamed<T> | undefined;
		/** heading shown above the error state, matching the panel it replaces */
		title: string;
		/** placeholder row count for the default skeleton */
		rows?: number;
		children: Snippet<[T]>;
		/** a layout-specific placeholder, when the default card doesn't fit */
		skeleton?: Snippet;
	} = $props();

	// Re-runs the page load in place: the streamed promises are re-issued, and a
	// failure is never cached, so the retried query really runs again.
	let retrying = $state(false);
	async function retry() {
		retrying = true;
		try {
			await invalidateAll();
		} finally {
			retrying = false;
		}
	}
</script>

{#if stream === undefined}
	{#if skeleton}
		{@render skeleton()}
	{:else}
		<Card.Root aria-busy="true">
			<Card.Header>
				<Skeleton class="h-5 w-40 rounded-md" />
				<Skeleton class="h-4 w-72 max-w-full rounded-md" />
			</Card.Header>
			<Card.Content class="space-y-3">
				{#each Array.from({ length: rows }, (_, i) => i) as i (i)}
					<Skeleton class="h-6 w-full rounded-md" />
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}
{:else if stream.failed}
	<Card.Root>
		<Card.Header>
			<Card.Title>{title}</Card.Title>
		</Card.Header>
		<Card.Content class="flex flex-wrap items-center justify-between gap-3 py-2">
			<p class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
				<TriangleAlert class="size-4 text-amber-600 dark:text-amber-400" />
				This panel could not be loaded.
			</p>
			<Button variant="outline" size="sm" onclick={retry} disabled={retrying}>
				<RefreshCw class="size-4 {retrying ? 'animate-spin' : ''}" />
				Retry
			</Button>
		</Card.Content>
	</Card.Root>
{:else}
	{@render children(stream.value)}
{/if}

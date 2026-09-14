<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import type { Streamed } from '$lib/features/usage/types';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

	// Renders a secondary cost-analysis panel whose data is streamed in after
	// first paint: a skeleton card while pending, a small inline error if the
	// query failed, the panel itself once it lands.

	let {
		state,
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
</script>

{#if state === undefined}
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
{:else if state.failed}
	<Card.Root>
		<Card.Header>
			<Card.Title>{title}</Card.Title>
		</Card.Header>
		<Card.Content>
			<p class="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status">
				<TriangleAlert class="size-4 text-amber-600" />
				This panel could not be loaded. Refresh to try again.
			</p>
		</Card.Content>
	</Card.Root>
{:else}
	{@render children(state.value)}
{/if}

<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import Search from '@lucide/svelte/icons/search';
	import TraceFeedRow from './trace-feed-row.svelte';
	import { feedKey, feedTone } from './feed-filter';
	import type { PageData } from './$types';

	// The filtered gateway-call feed with its count line and no-match state.

	let {
		items,
		total,
		onReset
	}: {
		items: PageData['feed'];
		/** size of the unfiltered feed */
		total: number;
		onReset: () => void;
	} = $props();
</script>

<div class="flex items-center justify-between text-xs text-muted-foreground">
	<span>
		Showing <span class="font-medium text-foreground tabular-nums">{items.length}</span>
		of {total} entries
	</span>
</div>

<div class="overflow-hidden rounded-xl border">
	<div class="overflow-x-auto">
		<Table.Root>
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head class="bg-muted/40">Time</Table.Head>
					<Table.Head class="bg-muted/40">Status</Table.Head>
					<Table.Head class="bg-muted/40">ID</Table.Head>
					<Table.Head class="bg-muted/40">Service</Table.Head>
					<Table.Head class="bg-muted/40">Model</Table.Head>
					<Table.Head class="bg-muted/40 text-right">Tokens</Table.Head>
					<Table.Head class="bg-muted/40 text-right">Cost</Table.Head>
					<Table.Head class="bg-muted/40 text-right">Latency</Table.Head>
					<Table.Head class="bg-muted/40"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each items as it (feedKey(it))}
					<TraceFeedRow item={it} tone={feedTone(it)} />
				{/each}
			</Table.Body>
		</Table.Root>
	</div>

	{#if items.length === 0}
		<div class="flex flex-col items-center justify-center py-16">
			<Search class="size-7 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No matching traces</p>
			<p class="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
			<Button variant="outline" size="sm" onclick={onReset} class="mt-4">Clear filters</Button>
		</div>
	{/if}
</div>

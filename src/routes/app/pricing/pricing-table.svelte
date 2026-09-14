<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import * as Table from '$lib/components/ui/table/index.js';
	import PriceRow from '$lib/features/pricing/components/price-row.svelte';
	import type { TableState } from '$lib/state/table.svelte';
	import { LONG_CONTEXT_MIN_PROMPT_TOKENS, type PriceTier } from '$lib/features/pricing/pricing';
	import Search from '@lucide/svelte/icons/search';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';

	// The sortable model price table, with the long-context note and the count line.

	let {
		table,
		total,
		customCount,
		tier,
		showProvider,
		canManage
	}: {
		table: TableState<ComponentProps<typeof PriceRow>['price']>;
		/** number of models before filtering */
		total: number;
		/** number of org-specific (custom) prices */
		customCount: number;
		tier: PriceTier;
		showProvider: boolean;
		canManage: boolean;
	} = $props();

	const longThresholdLabel = `${Math.round(LONG_CONTEXT_MIN_PROMPT_TOKENS / 1000)}k`;
</script>

{#snippet sortHead(label: string, key: string, align: 'left' | 'right')}
	<button
		type="button"
		onclick={() => table.toggleSort(key)}
		class="inline-flex items-center gap-1 hover:text-foreground {align === 'right'
			? 'flex-row-reverse'
			: ''} {table.sortKey === key ? 'text-foreground' : ''}"
	>
		{label}
		{#if table.sortKey === key}
			{#if table.sortDir === 'asc'}<ArrowUp class="size-3.5" />{:else}<ArrowDown
					class="size-3.5"
				/>{/if}
		{:else}
			<ChevronsUpDown class="size-3.5 opacity-40" />
		{/if}
	</button>
{/snippet}

{#if tier === 'long'}
	<p class="text-xs text-muted-foreground">
		Long-context rates bill the whole request — input, cache traffic and output — once its prompt
		reaches {longThresholdLabel} tokens. Models showing “—” have a single rate card and always bill the
		short-context prices.
	</p>
{/if}

<div class="rounded-xl border">
	<Table.Root>
		<Table.Header>
			<Table.Row class="hover:bg-transparent">
				<Table.Head>{@render sortHead('Model', 'model', 'left')}</Table.Head>
				{#if showProvider}
					<Table.Head>Provider</Table.Head>
				{/if}
				<Table.Head class="text-right">
					{@render sortHead('Input / 1M', 'input', 'right')}
				</Table.Head>
				<Table.Head class="text-right">
					{@render sortHead('Output / 1M', 'output', 'right')}
				</Table.Head>
				<Table.Head class="text-right">
					{@render sortHead('Cache read / 1M', 'cacheRead', 'right')}
				</Table.Head>
				<Table.Head class="text-right">
					{@render sortHead('Cache write / 1M', 'cacheWrite', 'right')}
				</Table.Head>
				<Table.Head class="w-[1%]">Source</Table.Head>
				<Table.Head class="w-[1%]"></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each table.visible as p (p.model)}
				<PriceRow price={p} {showProvider} {canManage} {tier} />
			{/each}
		</Table.Body>
	</Table.Root>

	{#if table.visible.length === 0}
		<div class="flex flex-col items-center justify-center py-12">
			<Search class="size-6 text-muted-foreground" />
			<p class="mt-2 text-sm text-muted-foreground">
				No models match {table.query ? `“${table.query}”` : 'this filter'}.
			</p>
		</div>
	{/if}
</div>

<p class="text-xs text-muted-foreground">
	Showing {table.visible.length} of {total} models{customCount > 0
		? ` · ${customCount} custom`
		: ''}.
</p>

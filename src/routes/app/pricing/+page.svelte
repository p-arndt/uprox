<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PageHeader from '$lib/components/page-header.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import SearchInput from '$lib/components/search-input.svelte';
	import PriceRow from '$lib/components/price-row.svelte';
	import AddModelDialog from '$lib/components/add-model-dialog.svelte';
	import { createTableState } from '$lib/state/table.svelte';
	import { inferProviderId } from '$lib/pricing';
	import { can } from '$lib/permissions';
	import Coins from '@lucide/svelte/icons/coins';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';

	let { data, form } = $props();

	const OTHER_KEY = '__other';

	const providerLabel = $derived(new Map(data.providers.map((p) => [p.id, p.label] as const)));

	/** Every price tagged with its provider (explicit, else inferred from name). */
	const rows = $derived(
		data.prices.map((p) => {
			const id = p.provider || inferProviderId(p.model);
			return {
				...p,
				providerKey: id ?? OTHER_KEY,
				providerLabel: id ? (providerLabel.get(id) ?? id) : 'Other'
			};
		})
	);

	// One filter tab per provider that actually has models, in declared order,
	// with "Other" last. Each carries its count for an at-a-glance badge.
	const tabs = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const r of rows) counts.set(r.providerKey, (counts.get(r.providerKey) ?? 0) + 1);
		const order = data.providers.map((p) => p.id);
		const keys = [...counts.keys()].sort((a, b) => {
			const ra = a === OTHER_KEY ? order.length : order.indexOf(a);
			const rb = b === OTHER_KEY ? order.length : order.indexOf(b);
			return (ra === -1 ? order.length : ra) - (rb === -1 ? order.length : rb);
		});
		return keys.map((key) => ({
			key,
			label: key === OTHER_KEY ? 'Other' : (providerLabel.get(key) ?? key),
			count: counts.get(key) ?? 0
		}));
	});

	let providerFilter = $state('all');

	const num = (a: number | null, b: number | null) => (a ?? 0) - (b ?? 0);
	const table = createTableState({
		rows: () => rows,
		matches: (r, q) => r.model.toLowerCase().includes(q),
		predicate: () => (r) => providerFilter === 'all' || r.providerKey === providerFilter,
		sorters: {
			model: (a, b) => a.model.localeCompare(b.model),
			inputPerMtok: (a, b) => num(a.inputPerMtok, b.inputPerMtok),
			outputPerMtok: (a, b) => num(a.outputPerMtok, b.outputPerMtok),
			// cache prices can be null (fall back to the input multiplier); sort those last
			cacheReadPerMtok: (a, b) => num(a.cacheReadPerMtok, b.cacheReadPerMtok),
			cacheWritePerMtok: (a, b) => num(a.cacheWritePerMtok, b.cacheWritePerMtok)
		},
		initialSort: 'model',
		dirFor: (key) => (key === 'model' ? 'asc' : 'desc')
	});

	const customCount = $derived(data.prices.filter((p) => p.source === 'custom').length);
	const showProviderCol = $derived(providerFilter === 'all');
	const canManage = $derived(can(data.role, 'pricing:manage', data.memberPermissions));

	let addOpen = $state(false);
	const addProvider = $derived(
		providerFilter !== 'all' && providerFilter !== OTHER_KEY ? providerFilter : ''
	);
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

<div class="mx-auto max-w-5xl space-y-5">
	<PageHeader title="Model Prices">
		{#snippet description()}
			Token prices in USD per 1M tokens, used to estimate request cost for spend tracking and
			budgets. Platform defaults apply unless your organization sets its own price.
		{/snippet}
		{#snippet action()}
			{#if canManage}
				<Button onclick={() => (addOpen = true)}>
					<Plus class="size-4" />
					Add model
				</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.prices.length === 0}
		<EmptyState
			icon={Coins}
			title="No model prices"
			description="Add a model to start tracking its cost."
		/>
	{:else}
		<div class="flex flex-wrap items-center justify-between gap-3">
			<Tabs.Root bind:value={providerFilter}>
				<Tabs.List>
					<Tabs.Trigger value="all">
						All
						<span class="ml-1.5 text-xs text-muted-foreground">{rows.length}</span>
					</Tabs.Trigger>
					{#each tabs as t (t.key)}
						<Tabs.Trigger value={t.key}>
							{t.label}
							<span class="ml-1.5 text-xs text-muted-foreground">{t.count}</span>
						</Tabs.Trigger>
					{/each}
				</Tabs.List>
			</Tabs.Root>

			<SearchInput
				bind:value={table.query}
				placeholder="Search models…"
				class="w-full max-w-xs sm:w-64"
				ariaLabel="Search models"
			/>
		</div>

		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>{@render sortHead('Model', 'model', 'left')}</Table.Head>
						{#if showProviderCol}
							<Table.Head>Provider</Table.Head>
						{/if}
						<Table.Head class="text-right">
							{@render sortHead('Input / 1M', 'inputPerMtok', 'right')}
						</Table.Head>
						<Table.Head class="text-right">
							{@render sortHead('Output / 1M', 'outputPerMtok', 'right')}
						</Table.Head>
						<Table.Head class="text-right">
							{@render sortHead('Cache read / 1M', 'cacheReadPerMtok', 'right')}
						</Table.Head>
						<Table.Head class="text-right">
							{@render sortHead('Cache write / 1M', 'cacheWritePerMtok', 'right')}
						</Table.Head>
						<Table.Head class="w-[1%]">Source</Table.Head>
						<Table.Head class="w-[1%]"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each table.visible as p (p.model)}
						<PriceRow price={p} showProvider={showProviderCol} {canManage} />
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
			Showing {table.visible.length} of {rows.length} models{customCount > 0
				? ` · ${customCount} custom`
				: ''}.
		</p>
	{/if}
</div>

<AddModelDialog
	bind:open={addOpen}
	providers={data.providers}
	defaultProvider={addProvider}
	message={form?.message}
/>

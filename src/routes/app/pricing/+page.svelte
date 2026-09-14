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
	import {
		providerTabs,
		tagPriceProviders,
		tierValues,
		LONG_CONTEXT_MIN_PROMPT_TOKENS,
		OTHER_PROVIDER_KEY,
		type PriceTier
	} from '$lib/pricing';
	import { can } from '$lib/permissions';
	import Coins from '@lucide/svelte/icons/coins';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import PageShell from '$lib/components/page-shell.svelte';

	let { data, form } = $props();

	/** Every price tagged with its provider (explicit, else inferred from name). */
	const rows = $derived(tagPriceProviders(data.prices, data.providers));
	// One filter tab per provider that actually has models, "Other" last.
	const tabs = $derived(providerTabs(rows, data.providers));

	let providerFilter = $state('all');
	// Which rate card the four price columns show. Long context is what a request
	// bills at once its prompt reaches LONG_CONTEXT_MIN_PROMPT_TOKENS; models
	// without one show "—" and bill the standard card at any size.
	let tier = $state<PriceTier>('standard');

	const num = (a: number | null, b: number | null) => (a ?? 0) - (b ?? 0);
	// Sorters read the *shown* tier, so switching cards re-sorts on the visible
	// numbers rather than the standard ones underneath.
	type Row = (typeof rows)[number];
	const by = (pick: (v: ReturnType<typeof tierValues>) => number | null) => (a: Row, b: Row) =>
		num(pick(tierValues(a, tier)), pick(tierValues(b, tier)));
	const table = createTableState({
		rows: () => rows,
		matches: (r, q) => r.model.toLowerCase().includes(q),
		predicate: () => (r) => providerFilter === 'all' || r.providerKey === providerFilter,
		sorters: {
			model: (a, b) => a.model.localeCompare(b.model),
			input: by((v) => v.input),
			output: by((v) => v.output),
			// cache prices can be null (fall back to the input multiplier); sort those last
			cacheRead: by((v) => v.cacheRead),
			cacheWrite: by((v) => v.cacheWrite)
		},
		initialSort: 'model',
		dirFor: (key) => (key === 'model' ? 'asc' : 'desc')
	});

	const customCount = $derived(data.prices.filter((p) => p.source === 'custom').length);
	const longCount = $derived(data.prices.filter((p) => p.longInputPerMtok !== null).length);
	const longThresholdLabel = `${Math.round(LONG_CONTEXT_MIN_PROMPT_TOKENS / 1000)}k`;
	const showProviderCol = $derived(providerFilter === 'all');
	const canManage = $derived(can(data.role, 'pricing:manage', data.memberPermissions));

	let addOpen = $state(false);
	const addProvider = $derived(
		providerFilter !== 'all' && providerFilter !== OTHER_PROVIDER_KEY ? providerFilter : ''
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

<PageShell width="default">
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
			<Tabs.Root bind:value={providerFilter} class="min-w-0">
				<Tabs.List class="max-w-full overflow-x-auto">
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

			<div class="flex flex-wrap items-center gap-3">
				<Tabs.Root bind:value={tier} class="min-w-0">
					<Tabs.List class="max-w-full overflow-x-auto">
						<Tabs.Trigger value="standard">Short context</Tabs.Trigger>
						<Tabs.Trigger value="long">
							Long context
							<span class="ml-1.5 text-xs text-muted-foreground">{longCount}</span>
						</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>

				<SearchInput
					bind:value={table.query}
					placeholder="Search models…"
					class="w-full max-w-xs sm:w-64"
					ariaLabel="Search models"
				/>
			</div>
		</div>

		{#if tier === 'long'}
			<p class="text-xs text-muted-foreground">
				Long-context rates bill the whole request — input, cache traffic and output — once its
				prompt reaches {longThresholdLabel} tokens. Models showing “—” have a single rate card and always
				bill the short-context prices.
			</p>
		{/if}

		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row class="hover:bg-transparent">
						<Table.Head>{@render sortHead('Model', 'model', 'left')}</Table.Head>
						{#if showProviderCol}
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
						<PriceRow price={p} showProvider={showProviderCol} {canManage} {tier} />
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
</PageShell>

<AddModelDialog
	bind:open={addOpen}
	providers={data.providers}
	defaultProvider={addProvider}
	message={form?.message}
/>

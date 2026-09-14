<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import AddModelDialog from '$lib/features/pricing/components/add-model-dialog.svelte';
	import { createTableState } from '$lib/state/table.svelte';
	import {
		providerTabs,
		tagPriceProviders,
		tierValues,
		OTHER_PROVIDER_KEY,
		type PriceTier
	} from '$lib/features/pricing/pricing';
	import { can } from '$lib/permissions';
	import Coins from '@lucide/svelte/icons/coins';
	import Plus from '@lucide/svelte/icons/plus';
	import PricingToolbar from './pricing-toolbar.svelte';
	import PricingTable from './pricing-table.svelte';

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
	const canManage = $derived(can(data.role, 'pricing:manage', data.memberPermissions));

	let addOpen = $state(false);
	const addProvider = $derived(
		providerFilter !== 'all' && providerFilter !== OTHER_PROVIDER_KEY ? providerFilter : ''
	);
</script>

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
		<PricingToolbar
			bind:providerFilter
			bind:tier
			bind:query={table.query}
			{tabs}
			total={rows.length}
			{longCount}
		/>
		<PricingTable
			{table}
			total={rows.length}
			{customCount}
			{tier}
			showProvider={providerFilter === 'all'}
			{canManage}
		/>
	{/if}
</PageShell>

<AddModelDialog
	bind:open={addOpen}
	providers={data.providers}
	defaultProvider={addProvider}
	message={form?.message}
/>

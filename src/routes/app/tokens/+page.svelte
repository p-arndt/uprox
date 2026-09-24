<script lang="ts">
	import { untrack } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import SearchInput from '$lib/components/form/search-input.svelte';
	import SortableHeader from '$lib/components/form/sortable-header.svelte';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import StatCard from '$lib/components/layout/stat-card.svelte';
	import TokenRow from '$lib/features/tokens/components/token-row.svelte';
	import CreateTokenDialog from '$lib/features/tokens/components/create-token-dialog.svelte';
	import EditTokenDialog from '$lib/features/tokens/components/edit-token-dialog.svelte';
	import SecretDialog from '$lib/features/tokens/components/secret-dialog.svelte';
	import { type TokenFormValues } from '$lib/features/tokens/components/token-form.svelte';
	import { tokenStats, type RevealedSecret, type Token } from '$lib/features/tokens/tokens';
	import { inlineLimitsFromRow } from '$lib/features/policies/inline-limits';
	import {
		GROUPING_OPTIONS,
		STATUS_FILTER_OPTIONS,
		TOKEN_SORTERS,
		groupTokens,
		matchesQuery,
		matchesStatus,
		type TokenGrouping,
		type TokenStatusFilter
	} from '$lib/features/tokens/token-table';
	import { createTableState } from '$lib/state/table.svelte';
	import { relativeTime } from '$lib/format';
	import { can } from '$lib/permissions';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import X from '@lucide/svelte/icons/x';
	import PageShell from '$lib/components/layout/page-shell.svelte';

	let { data, form } = $props();
	let createOpen = $state(false);
	// `recopyable` switches the dialog copy between "stored only as a hash, gone
	// forever" and "you can reveal this again later".
	let secret = $state<RevealedSecret | null>(null);
	let editing = $state<TokenFormValues | null>(null);

	const canManage = $derived(can(data.role, 'tokens:manage', data.memberPermissions));
	const canManageServices = $derived(can(data.role, 'services:manage', data.memberPermissions));

	// ?service=<id> (linked from a service page) opens the create dialog on that service
	const requestedService = $derived(page.url.searchParams.get('service'));
	$effect(() => {
		if (requestedService && untrack(() => canManage)) createOpen = true;
	});

	// Surface action results: a fresh secret from create is revealed once (and the
	// create dialog closes), a re-copy reveal shows the stored secret again, and a
	// successful update closes the edit dialog and refreshes the list.
	$effect(() => {
		if (form?.created) {
			secret = form.created;
			createOpen = false;
		}
		if (form?.revealed) {
			secret = { ...form.revealed, recopyable: true };
		}
		if (form?.success) {
			editing = null;
			invalidateAll();
		}
	});

	const stats = $derived(tokenStats(data.tokens));

	let statusFilter = $state<TokenStatusFilter>('current');
	let serviceFilter = $state('all');
	let grouping = $state<TokenGrouping>('none');

	const table = createTableState({
		rows: () => data.tokens,
		matches: matchesQuery,
		predicate: () => {
			const status = statusFilter;
			const service = serviceFilter;
			return (t) => matchesStatus(t, status) && (service === 'all' || t.serviceId === service);
		},
		sorters: TOKEN_SORTERS,
		initialSort: 'created',
		initialDir: 'desc',
		dirFor: (key) => (key === 'lastUsed' || key === 'created' ? 'desc' : 'asc')
	});
	const groups = $derived(groupTokens(table.visible, grouping));

	const serviceOptions = $derived([
		{ value: 'all', label: 'All services' },
		...data.services.map((s) => ({ value: s.id, label: s.name }))
	]);
	const labelOf = (options: { value: string; label: string }[], value: string) =>
		options.find((o) => o.value === value)?.label ?? '';

	const hasFilters = $derived(
		table.query.trim() !== '' || statusFilter !== 'current' || serviceFilter !== 'all'
	);
	function clearFilters() {
		table.query = '';
		statusFilter = 'current';
		serviceFilter = 'all';
	}

	const COLUMNS = [
		{ key: 'name', label: 'Name' },
		{ key: null, label: 'Token' },
		{ key: 'service', label: 'Service' },
		{ key: null, label: 'Scopes' },
		{ key: null, label: 'Preset / Models' },
		{ key: 'lastUsed', label: 'Last used' },
		{ key: 'status', label: 'Status' }
	] as const;

	function startEdit(t: Token) {
		editing = {
			id: t.id,
			name: t.name,
			serviceId: t.serviceId,
			scopes: [...t.scopes],
			policyId: t.policyId ?? '',
			...inlineLimitsFromRow(t)
		};
	}
</script>

<PageShell width="default">
	<PageHeader
		title="Machine Tokens"
		description="Opaque bearer tokens your services use to authenticate to the gateway. Stored as a hash, plus an encrypted copy only if re-copying is allowed."
	>
		{#snippet action()}
			{#if canManage}
				<CreateTokenDialog
					bind:open={createOpen}
					services={data.services}
					canCreateService={canManageServices}
					policies={data.policies}
					providers={data.providers}
					recopyDefault={data.recopyDefault}
					message={form?.message}
				/>
			{/if}
		{/snippet}
	</PageHeader>

	{#if data.tokens.length === 0}
		<EmptyState
			icon={KeyRound}
			title="No tokens yet"
			description="Issue a token to start calling the gateway. New tokens land in the Default service — organise them into services later."
		/>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<StatCard label="Total" value={stats.total} />
			<StatCard label="Active">
				<p class="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums">
					<span class="dot-pulse size-2 rounded-full bg-emerald-500"></span>
					{stats.active}
				</p>
			</StatCard>
			<StatCard
				label="Inactive"
				value={stats.inactive}
				valueClass="text-2xl text-muted-foreground"
			/>
			<StatCard
				label="Last used"
				value={relativeTime(stats.lastUsed ? new Date(stats.lastUsed) : null)}
				valueClass="text-lg"
			/>
		</div>

		<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
			<SearchInput
				bind:value={table.query}
				placeholder="Search name, service, preset, model…"
				class="flex-1"
			/>
			<Select.Root type="single" bind:value={serviceFilter}>
				<Select.Trigger class="w-full sm:w-44"
					>{labelOf(serviceOptions, serviceFilter)}</Select.Trigger
				>
				<Select.Content>
					{#each serviceOptions as o (o.value)}
						<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Select.Root type="single" bind:value={statusFilter}>
				<Select.Trigger class="w-full sm:w-36">
					{labelOf(STATUS_FILTER_OPTIONS, statusFilter)}
				</Select.Trigger>
				<Select.Content>
					{#each STATUS_FILTER_OPTIONS as o (o.value)}
						<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Select.Root type="single" bind:value={grouping}>
				<Select.Trigger class="w-full sm:w-44">{labelOf(GROUPING_OPTIONS, grouping)}</Select.Trigger
				>
				<Select.Content>
					{#each GROUPING_OPTIONS as o (o.value)}
						<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if hasFilters}
				<Button variant="ghost" size="sm" onclick={clearFilters} class="shrink-0">
					<X class="size-4" /> Clear
				</Button>
			{/if}
		</div>

		<p class="text-xs text-muted-foreground">
			Showing <span class="font-medium text-foreground tabular-nums">{table.visible.length}</span>
			of {data.tokens.length} tokens
		</p>

		<div class="overflow-hidden rounded-xl border">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							{#each COLUMNS as c (c.label)}
								{#if c.key}
									{@const key = c.key}
									<SortableHeader
										label={c.label}
										active={table.sortKey === key}
										dir={table.sortDir}
										class="h-12 px-3 whitespace-nowrap"
										onclick={() => table.toggleSort(key)}
									/>
								{:else}
									<Table.Head>{c.label}</Table.Head>
								{/if}
							{/each}
							<Table.Head class="w-10"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if table.visible.length === 0}
							<Table.Row class="hover:bg-transparent">
								<Table.Cell
									colspan={COLUMNS.length + 1}
									class="py-8 text-center text-sm text-muted-foreground"
								>
									No tokens match these filters.
									<Button variant="link" size="sm" onclick={clearFilters}>Clear filters</Button>
								</Table.Cell>
							</Table.Row>
						{/if}
						{#each groups as g (g.key)}
							{#if grouping !== 'none'}
								<Table.Row class="bg-muted/40 hover:bg-muted/40">
									<Table.Cell colspan={COLUMNS.length + 1} class="py-2 text-xs font-medium">
										{#if g.serviceId}
											<a
												href={resolve('/app/services/[id]', { id: g.serviceId })}
												class="hover:underline">{g.label}</a
											>
										{:else}
											<span class="capitalize">{g.label}</span>
										{/if}
										<span class="ml-1 text-muted-foreground tabular-nums">· {g.tokens.length}</span>
									</Table.Cell>
								</Table.Row>
							{/if}
							{#each g.tokens as t (t.id)}
								<TokenRow token={t} {canManage} onEdit={startEdit} />
							{/each}
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	{/if}
</PageShell>

<!-- one-time secret reveal -->
<SecretDialog
	{secret}
	onClose={() => {
		secret = null;
		invalidateAll();
	}}
/>

<EditTokenDialog
	{editing}
	onClose={() => (editing = null)}
	policies={data.policies}
	providers={data.providers}
	services={data.services}
	canCreateService={canManageServices}
	message={form?.action === 'update' ? form.message : undefined}
/>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { NativeSelect } from '$lib/components/ui/native-select/index.js';
	import { formatUsd } from '$lib/format';
	import Coins from '@lucide/svelte/icons/coins';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';

	let { data, form } = $props();

	type Price = (typeof data.prices)[number];
	type Row = Price & { providerKey: string; providerLabel: string };

	const OTHER_KEY = '__other';

	const providerLabel = $derived(new Map(data.providers.map((p) => [p.id, p.label] as const)));

	/** Best-effort provider id from a model name, for rows without an explicit one. */
	function inferProviderId(model: string): string | null {
		const m = model.toLowerCase();
		if (m.startsWith('claude')) return 'anthropic';
		if (m.startsWith('gpt') || /^o\d/.test(m)) return 'openai';
		return null;
	}

	/** Every price tagged with its provider (explicit, else inferred from name). */
	const rows = $derived<Row[]>(
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
	let query = $state('');
	let sortKey = $state<'model' | 'inputPerMtok' | 'outputPerMtok'>('model');
	let sortDir = $state<'asc' | 'desc'>('asc');

	function toggleSort(key: typeof sortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = key === 'model' ? 'asc' : 'desc';
		}
	}

	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		let out = rows.filter((r) => {
			if (providerFilter !== 'all' && r.providerKey !== providerFilter) return false;
			if (q && !r.model.toLowerCase().includes(q)) return false;
			return true;
		});
		const dir = sortDir === 'asc' ? 1 : -1;
		out = [...out].sort((a, b) => {
			if (sortKey === 'model') return a.model.localeCompare(b.model) * dir;
			return ((a[sortKey] as number) - (b[sortKey] as number)) * dir;
		});
		return out;
	});

	const customCount = $derived(data.prices.filter((p) => p.source === 'custom').length);
	const showProviderCol = $derived(providerFilter === 'all');

	type Editing = {
		id: string | null;
		model: string;
		modelLocked: boolean;
		provider: string;
		inputPerMtok: string;
		outputPerMtok: string;
		title: string;
	};
	let editing = $state<Editing | null>(null);

	function openAdd() {
		editing = {
			id: null,
			model: '',
			modelLocked: false,
			provider: providerFilter !== 'all' && providerFilter !== OTHER_KEY ? providerFilter : '',
			inputPerMtok: '',
			outputPerMtok: '',
			title: 'Add model price'
		};
	}

	function openEdit(p: Price) {
		editing = {
			id: p.id,
			model: p.model,
			modelLocked: true,
			provider: p.provider ?? '',
			inputPerMtok: String(p.inputPerMtok),
			outputPerMtok: String(p.outputPerMtok),
			title: p.source === 'custom' ? `Edit ${p.model}` : `Override ${p.model}`
		};
	}

	$effect(() => {
		if (form?.success) {
			editing = null;
			invalidateAll();
		}
	});
</script>

{#snippet sortHead(label: string, key: typeof sortKey, align: 'left' | 'right')}
	<button
		type="button"
		onclick={() => toggleSort(key)}
		class="inline-flex items-center gap-1 hover:text-foreground {align === 'right'
			? 'flex-row-reverse'
			: ''} {sortKey === key ? 'text-foreground' : ''}"
	>
		{label}
		{#if sortKey === key}
			{#if sortDir === 'asc'}<ArrowUp class="size-3.5" />{:else}<ArrowDown class="size-3.5" />{/if}
		{:else}
			<ChevronsUpDown class="size-3.5 opacity-40" />
		{/if}
	</button>
{/snippet}

<div class="mx-auto max-w-5xl space-y-5">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold tracking-tight">Model Prices</h2>
			<p class="text-sm text-muted-foreground">
				Token prices in USD per 1M tokens, used to estimate request cost for spend tracking and
				budgets. Platform defaults apply unless your organization sets its own price.
			</p>
		</div>
		<Button onclick={openAdd}>
			<Plus class="size-4" />
			Add model
		</Button>
	</div>

	{#if data.prices.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<Coins class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No model prices</p>
			<p class="text-sm text-muted-foreground">Add a model to start tracking its cost.</p>
		</div>
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

			<div class="relative w-full max-w-xs sm:w-64">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={query}
					placeholder="Search models…"
					class="pl-9"
					aria-label="Search models"
				/>
			</div>
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
						<Table.Head class="w-[1%]">Source</Table.Head>
						<Table.Head class="w-[1%]"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each visible as p (p.model)}
						<Table.Row class="group">
							<Table.Cell class="font-medium">{p.model}</Table.Cell>
							{#if showProviderCol}
								<Table.Cell class="text-muted-foreground">{p.providerLabel}</Table.Cell>
							{/if}
							<Table.Cell class="text-right tabular-nums">
								{formatUsd(p.inputPerMtok)}
								{#if p.source === 'custom' && p.defaultInputPerMtok !== null && p.defaultInputPerMtok !== p.inputPerMtok}
									<div class="text-xs text-muted-foreground line-through">
										{formatUsd(p.defaultInputPerMtok)}
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{formatUsd(p.outputPerMtok)}
								{#if p.source === 'custom' && p.defaultOutputPerMtok !== null && p.defaultOutputPerMtok !== p.outputPerMtok}
									<div class="text-xs text-muted-foreground line-through">
										{formatUsd(p.defaultOutputPerMtok)}
									</div>
								{/if}
							</Table.Cell>
							<Table.Cell>
								{#if p.source === 'custom'}
									<Badge variant="secondary">custom</Badge>
								{:else}
									<Badge variant="outline" class="text-muted-foreground">default</Badge>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-right whitespace-nowrap">
								<div
									class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
								>
									<Button
										variant="ghost"
										size="icon"
										class="size-8"
										title={p.source === 'custom' ? 'Edit price' : 'Override default'}
										onclick={() => openEdit(p)}
									>
										<Pencil class="size-4" />
									</Button>
									{#if p.source === 'custom'}
										<form
											method="post"
											action="?/delete"
											class="inline"
											use:enhance={() =>
												async ({ update }) =>
													update()}
										>
											<input type="hidden" name="id" value={p.id} />
											<Button
												type="submit"
												variant="ghost"
												size="icon"
												class="size-8 text-muted-foreground hover:text-destructive"
												title={p.defaultInputPerMtok !== null
													? 'Reset to platform default'
													: 'Remove price'}
											>
												<RotateCcw class="size-4" />
											</Button>
										</form>
									{/if}
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>

			{#if visible.length === 0}
				<div class="flex flex-col items-center justify-center py-12">
					<Search class="size-6 text-muted-foreground" />
					<p class="mt-2 text-sm text-muted-foreground">
						No models match {query ? `“${query}”` : 'this filter'}.
					</p>
				</div>
			{/if}
		</div>

		<p class="text-xs text-muted-foreground">
			Showing {visible.length} of {rows.length} models{customCount > 0
				? ` · ${customCount} custom`
				: ''}.
		</p>
	{/if}
</div>

<Dialog.Root
	open={editing !== null}
	onOpenChange={(v) => {
		if (!v) editing = null;
	}}
>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{editing?.title}</Dialog.Title>
			<Dialog.Description>Prices are in USD per 1,000,000 tokens.</Dialog.Description>
		</Dialog.Header>
		<form
			method="post"
			action={editing?.id ? '?/update' : '?/create'}
			class="space-y-4"
			use:enhance={() =>
				async ({ update }) =>
					update()}
		>
			{#if editing?.id}
				<input type="hidden" name="id" value={editing.id} />
			{/if}
			<div class="space-y-2">
				<Label for="model">Model</Label>
				<Input
					id="model"
					name="model"
					placeholder="gpt-4o"
					value={editing?.model ?? ''}
					readonly={editing?.modelLocked}
					required
				/>
				{#if !editing?.modelLocked}
					<p class="text-xs text-muted-foreground">
						Matched by longest prefix, e.g. <code>gpt-4o</code> covers
						<code>gpt-4o-2024-08-06</code>.
					</p>
				{/if}
			</div>
			<div class="space-y-2">
				<Label for="provider">Provider (optional)</Label>
				<NativeSelect id="provider" name="provider" value={editing?.provider ?? ''} class="w-full">
					<option value="">—</option>
					{#each data.providers as prov (prov.id)}
						<option value={prov.id}>{prov.label}</option>
					{/each}
				</NativeSelect>
			</div>
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="inputPerMtok">Input $ / 1M</Label>
					<Input
						id="inputPerMtok"
						name="inputPerMtok"
						type="number"
						step="0.0001"
						min="0"
						placeholder="2.5"
						value={editing?.inputPerMtok ?? ''}
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for="outputPerMtok">Output $ / 1M</Label>
					<Input
						id="outputPerMtok"
						name="outputPerMtok"
						type="number"
						step="0.0001"
						min="0"
						placeholder="10"
						value={editing?.outputPerMtok ?? ''}
						required
					/>
				</div>
			</div>
			{#if form?.message}
				<p class="text-sm text-destructive">{form.message}</p>
			{/if}
			<Dialog.Footer>
				<Button type="submit">Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
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
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	let { data, form } = $props();

	type Price = (typeof data.prices)[number];

	type Editing = {
		// present => editing an existing org row (update); absent => create
		id: string | null;
		model: string;
		// lock the model field when overriding a known model
		modelLocked: boolean;
		provider: string;
		inputPerMtok: string;
		outputPerMtok: string;
		title: string;
	};
	let editing = $state<Editing | null>(null);
	let query = $state('');

	/** Map a provider id to its display label. */
	const providerLabel = $derived(new Map(data.providers.map((p) => [p.id, p.label] as const)));

	/** Best-effort provider id from a model name, for rows without an explicit one. */
	function inferProviderId(model: string): string | null {
		const m = model.toLowerCase();
		if (m.startsWith('claude')) return 'anthropic';
		if (m.startsWith('gpt') || /^o\d/.test(m)) return 'openai';
		return null;
	}

	const OTHER_KEY = '__other';

	/** Prices grouped by provider, filtered by the search query, in a stable order. */
	const groups = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const rows = q ? data.prices.filter((p) => p.model.toLowerCase().includes(q)) : data.prices;

		const byKey = new Map<
			string,
			{ key: string; id: string | null; label: string; rows: Price[] }
		>();
		for (const p of rows) {
			const id = p.provider || inferProviderId(p.model);
			const key = id ?? OTHER_KEY;
			let g = byKey.get(key);
			if (!g) {
				g = { key, id, label: id ? (providerLabel.get(id) ?? id) : 'Other models', rows: [] };
				byKey.set(key, g);
			}
			g.rows.push(p);
		}

		// Known providers first (in their declared order), then "Other" last.
		const order = data.providers.map((p) => p.id);
		const rank = (id: string | null) => {
			if (!id) return Number.MAX_SAFE_INTEGER;
			const i = order.indexOf(id);
			return i === -1 ? order.length : i;
		};
		return [...byKey.values()].sort((a, b) => rank(a.id) - rank(b.id));
	});

	const customCount = $derived(data.prices.filter((p) => p.source === 'custom').length);

	// Per-group expanded state. Collapsed by default so the page stays short;
	// an active search force-expands every matching group so results are visible.
	let expanded = $state<Record<string, boolean>>({});
	const searching = $derived(query.trim().length > 0);
	const isOpen = (key: string) => searching || (expanded[key] ?? false);

	function setAll(open: boolean) {
		const next: Record<string, boolean> = {};
		for (const g of groups) next[g.key] = open;
		expanded = next;
	}
	const allOpen = $derived(groups.length > 0 && groups.every((g) => expanded[g.key]));

	function openAdd() {
		editing = {
			id: null,
			model: '',
			modelLocked: false,
			provider: '',
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

<div class="mx-auto max-w-5xl space-y-6">
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

	<div class="flex flex-wrap items-center justify-between gap-3">
		<div class="relative w-full max-w-xs">
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
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<Badge variant="outline">{data.prices.length} models</Badge>
			{#if customCount > 0}
				<Badge variant="secondary">{customCount} custom</Badge>
			{/if}
			{#if !searching && groups.length > 1}
				<Button variant="outline" size="sm" onclick={() => setAll(!allOpen)}>
					{allOpen ? 'Collapse all' : 'Expand all'}
				</Button>
			{/if}
		</div>
	</div>

	{#if data.prices.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<Coins class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No model prices</p>
			<p class="text-sm text-muted-foreground">Add a model to start tracking its cost.</p>
		</div>
	{:else if groups.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<Search class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No models match “{query}”</p>
			<p class="text-sm text-muted-foreground">Try a different search.</p>
		</div>
	{:else}
		<div class="space-y-6">
			{#each groups as group (group.key)}
				{@const open = isOpen(group.key)}
				{@const groupCustom = group.rows.filter((p) => p.source === 'custom').length}
				<Card.Root class="overflow-hidden py-0">
					<Collapsible.Root
						{open}
						onOpenChange={(v) => (expanded = { ...expanded, [group.key]: v })}
					>
						<Collapsible.Trigger
							disabled={searching}
							class="flex w-full items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/70 disabled:cursor-default disabled:hover:bg-muted/40"
						>
							<div class="flex items-center gap-2">
								<ChevronDown
									class="size-4 text-muted-foreground transition-transform duration-200 {open
										? ''
										: '-rotate-90'}"
								/>
								<span class="text-sm font-semibold">{group.label}</span>
								<Badge variant="outline" class="font-normal">{group.rows.length}</Badge>
								{#if groupCustom > 0}
									<Badge variant="secondary" class="font-normal">{groupCustom} custom</Badge>
								{/if}
							</div>
						</Collapsible.Trigger>
						<Collapsible.Content>
							<Table.Root>
						<Table.Header>
							<Table.Row class="hover:bg-transparent">
								<Table.Head>Model</Table.Head>
								<Table.Head class="text-right">Input / 1M</Table.Head>
								<Table.Head class="text-right">Output / 1M</Table.Head>
								<Table.Head class="w-[1%]">Source</Table.Head>
								<Table.Head class="w-[1%]"></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each group.rows as p (p.model)}
								<Table.Row>
									<Table.Cell class="font-medium">{p.model}</Table.Cell>
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
											<Badge variant="outline">default</Badge>
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right whitespace-nowrap">
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
									</Table.Cell>
								</Table.Row>
							{/each}
							</Table.Body>
						</Table.Root>
						</Collapsible.Content>
					</Collapsible.Root>
				</Card.Root>
			{/each}
		</div>
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

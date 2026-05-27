<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { NativeSelect } from '$lib/components/ui/native-select/index.js';
	import { formatUsd } from '$lib/format';
	import Coins from '@lucide/svelte/icons/coins';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	let { data, form } = $props();

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

	function openEdit(p: (typeof data.prices)[number]) {
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
		<Button onclick={openAdd}>Add model</Button>
	</div>

	<div class="rounded-xl border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Model</Table.Head>
					<Table.Head>Provider</Table.Head>
					<Table.Head class="text-right">Input / 1M</Table.Head>
					<Table.Head class="text-right">Output / 1M</Table.Head>
					<Table.Head>Source</Table.Head>
					<Table.Head class="w-[1%]"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each data.prices as p (p.model)}
					<Table.Row>
						<Table.Cell class="font-medium">{p.model}</Table.Cell>
						<Table.Cell class="text-muted-foreground">{p.provider ?? '—'}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{formatUsd(p.inputPerMtok)}</Table.Cell>
						<Table.Cell class="text-right tabular-nums">{formatUsd(p.outputPerMtok)}</Table.Cell>
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
	</div>

	{#if data.prices.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<Coins class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No model prices</p>
			<p class="text-sm text-muted-foreground">Add a model to start tracking its cost.</p>
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

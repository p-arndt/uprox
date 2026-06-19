<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PriceRow } from '$lib/pricing';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/confirm-action.svelte';
	import { formatUsd } from '$lib/format';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';

	let {
		price,
		showProvider,
		canManage
	}: {
		price: PriceRow;
		showProvider: boolean;
		canManage: boolean;
	} = $props();

	// Inline editing is row-local: the pencil swaps this row's price cells for
	// number inputs. Works for custom rows (update) and default rows (override
	// via create); the provider is carried through unchanged.
	let editing = $state(false);
	let draftIn = $state('');
	let draftOut = $state('');
	let draftCacheRead = $state('');
	let draftCacheWrite = $state('');

	function startEdit() {
		draftIn = String(price.inputPerMtok);
		draftOut = String(price.outputPerMtok);
		draftCacheRead = price.cacheReadPerMtok != null ? String(price.cacheReadPerMtok) : '';
		draftCacheWrite = price.cacheWritePerMtok != null ? String(price.cacheWritePerMtok) : '';
		editing = true;
	}

	// HTML forms can't wrap table cells, so the inputs associate with the actions-cell
	// form by id.
	const fid = $derived(`edit-${price.model.replace(/[^a-z0-9]+/gi, '-')}`);
	const isReset = $derived(price.defaultInputPerMtok !== null);
</script>

<Table.Row class="group">
	<Table.Cell class="font-medium">{price.model}</Table.Cell>
	{#if showProvider}
		<Table.Cell class="text-muted-foreground">{price.providerLabel}</Table.Cell>
	{/if}
	<Table.Cell class="text-right tabular-nums">
		{#if editing}
			<Input
				form={fid}
				name="inputPerMtok"
				type="number"
				step="0.0001"
				min="0"
				bind:value={draftIn}
				required
				aria-label="Input price per 1M tokens"
				class="ml-auto h-8 w-28 text-right"
			/>
		{:else}
			{formatUsd(price.inputPerMtok)}
			{#if price.source === 'custom' && price.defaultInputPerMtok !== null && price.defaultInputPerMtok !== price.inputPerMtok}
				<div class="text-xs text-muted-foreground line-through">
					{formatUsd(price.defaultInputPerMtok)}
				</div>
			{/if}
		{/if}
	</Table.Cell>
	<Table.Cell class="text-right tabular-nums">
		{#if editing}
			<Input
				form={fid}
				name="outputPerMtok"
				type="number"
				step="0.0001"
				min="0"
				bind:value={draftOut}
				required
				aria-label="Output price per 1M tokens"
				class="ml-auto h-8 w-28 text-right"
			/>
		{:else}
			{formatUsd(price.outputPerMtok)}
			{#if price.source === 'custom' && price.defaultOutputPerMtok !== null && price.defaultOutputPerMtok !== price.outputPerMtok}
				<div class="text-xs text-muted-foreground line-through">
					{formatUsd(price.defaultOutputPerMtok)}
				</div>
			{/if}
		{/if}
	</Table.Cell>
	<Table.Cell class="text-right tabular-nums">
		{#if editing}
			<Input
				form={fid}
				name="cacheReadPerMtok"
				type="number"
				step="0.0001"
				min="0"
				placeholder="auto"
				bind:value={draftCacheRead}
				aria-label="Cache read price per 1M tokens"
				class="ml-auto h-8 w-28 text-right"
			/>
		{:else if price.cacheReadPerMtok !== null}
			{formatUsd(price.cacheReadPerMtok)}
		{:else}
			<span class="text-muted-foreground">—</span>
		{/if}
	</Table.Cell>
	<Table.Cell class="text-right tabular-nums">
		{#if editing}
			<Input
				form={fid}
				name="cacheWritePerMtok"
				type="number"
				step="0.0001"
				min="0"
				placeholder="auto"
				bind:value={draftCacheWrite}
				aria-label="Cache write price per 1M tokens"
				class="ml-auto h-8 w-28 text-right"
			/>
		{:else if price.cacheWritePerMtok !== null}
			{formatUsd(price.cacheWritePerMtok)}
		{:else}
			<span class="text-muted-foreground">—</span>
		{/if}
	</Table.Cell>
	<Table.Cell>
		{#if price.source === 'custom'}
			<Badge variant="secondary">custom</Badge>
		{:else}
			<Badge variant="outline" class="text-muted-foreground">default</Badge>
		{/if}
	</Table.Cell>
	<Table.Cell class="text-right whitespace-nowrap">
		{#if canManage}
			{#if editing}
				<form
					id={fid}
					method="post"
					action={price.id ? '?/update' : '?/create'}
					class="flex justify-end gap-1"
					use:enhance={() =>
						async ({ result, update }) => {
							await update();
							if (result.type === 'success') editing = false;
						}}
				>
					{#if price.id}
						<input type="hidden" name="id" value={price.id} />
					{:else}
						<input type="hidden" name="model" value={price.model} />
					{/if}
					<input type="hidden" name="provider" value={price.provider ?? ''} />
					<Button type="submit" variant="ghost" size="icon" class="size-8" title="Save">
						<Check class="size-4 text-primary" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-8 text-muted-foreground"
						title="Cancel"
						onclick={() => (editing = false)}
					>
						<X class="size-4" />
					</Button>
				</form>
			{:else}
				<div
					class="flex justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
				>
					<Button
						variant="ghost"
						size="icon"
						class="size-8"
						title={price.source === 'custom' ? 'Edit price' : 'Override default'}
						onclick={startEdit}
					>
						<Pencil class="size-4" />
					</Button>
					{#if price.source === 'custom'}
						<ConfirmAction
							action="?/delete"
							title={isReset ? 'Reset to platform default?' : 'Remove this price?'}
							description={isReset
								? 'Your custom price is discarded and the platform default is restored.'
								: 'The custom price is deleted. Requests for this model may be rejected until a price exists.'}
							actionLabel={isReset ? 'Reset' : 'Remove'}
						>
							{#snippet trigger({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									class="size-8 text-muted-foreground hover:text-destructive"
									title={isReset ? 'Reset to platform default' : 'Remove price'}
								>
									<RotateCcw class="size-4" />
								</Button>
							{/snippet}
							{#snippet fields()}
								<input type="hidden" name="id" value={price.id} />
							{/snippet}
						</ConfirmAction>
					{/if}
				</div>
			{/if}
		{/if}
	</Table.Cell>
</Table.Row>

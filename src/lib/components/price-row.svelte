<script lang="ts">
	import { enhance } from '$app/forms';
	import { TIER_FIELDS, tierValues, type PriceRow, type PriceTier } from '$lib/pricing';
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
		canManage,
		/** which rate card this row is showing — the table switches all rows at once */
		tier = 'standard'
	}: {
		price: PriceRow;
		showProvider: boolean;
		canManage: boolean;
		tier?: PriceTier;
	} = $props();

	const shown = $derived(tierValues(price, tier));
	const field = $derived(TIER_FIELDS[tier]);
	// The tier that isn't on screen still has to survive the round-trip, so its
	// four rates ride along as hidden inputs — the actions submit the whole row.
	const hidden = $derived(
		(Object.keys(TIER_FIELDS) as PriceTier[])
			.filter((t) => t !== tier)
			.flatMap((t) => {
				const v = tierValues(price, t);
				return [
					[TIER_FIELDS[t].input, v.input],
					[TIER_FIELDS[t].output, v.output],
					[TIER_FIELDS[t].cacheRead, v.cacheRead],
					[TIER_FIELDS[t].cacheWrite, v.cacheWrite]
				] as const;
			})
			.map(([name, v]) => ({ name, value: v == null ? '' : String(v) }))
	);

	// Inline editing is row-local: the pencil swaps this row's price cells for
	// number inputs. Works for custom rows (update) and default rows (override
	// via create); the provider is carried through unchanged.
	let editing = $state(false);
	let draftIn = $state('');
	let draftOut = $state('');
	let draftCacheRead = $state('');
	let draftCacheWrite = $state('');

	const str = (v: number | null) => (v != null ? String(v) : '');

	function startEdit() {
		draftIn = str(shown.input);
		draftOut = str(shown.output);
		draftCacheRead = str(shown.cacheRead);
		draftCacheWrite = str(shown.cacheWrite);
		editing = true;
	}

	// Leaving edit mode on a tier switch avoids carrying one card's drafts into
	// the other's inputs.
	$effect(() => {
		tier;
		editing = false;
	});

	// HTML forms can't wrap table cells, so the inputs associate with the actions-cell
	// form by id.
	const fid = $derived(`edit-${price.model.replace(/[^a-z0-9]+/gi, '-')}`);
	const isReset = $derived(price.defaultInputPerMtok !== null);
	/** the long card is optional, so its inputs aren't required and can be blanked */
	const required = $derived(tier === 'standard');
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
				name={field.input}
				type="number"
				step="0.0001"
				min="0"
				placeholder={required ? undefined : 'none'}
				bind:value={draftIn}
				{required}
				aria-label="Input price per 1M tokens"
				class="ml-auto h-8 w-28 text-right"
			/>
		{:else if shown.input !== null}
			{formatUsd(shown.input)}
			{#if price.source === 'custom' && shown.defaultInput !== null && shown.defaultInput !== shown.input}
				<div class="text-xs text-muted-foreground line-through">
					{formatUsd(shown.defaultInput)}
				</div>
			{/if}
		{:else}
			<span class="text-muted-foreground">—</span>
		{/if}
	</Table.Cell>
	<Table.Cell class="text-right tabular-nums">
		{#if editing}
			<Input
				form={fid}
				name={field.output}
				type="number"
				step="0.0001"
				min="0"
				placeholder={required ? undefined : 'none'}
				bind:value={draftOut}
				{required}
				aria-label="Output price per 1M tokens"
				class="ml-auto h-8 w-28 text-right"
			/>
		{:else if shown.output !== null}
			{formatUsd(shown.output)}
			{#if price.source === 'custom' && shown.defaultOutput !== null && shown.defaultOutput !== shown.output}
				<div class="text-xs text-muted-foreground line-through">
					{formatUsd(shown.defaultOutput)}
				</div>
			{/if}
		{:else}
			<span class="text-muted-foreground">—</span>
		{/if}
	</Table.Cell>
	<Table.Cell class="text-right tabular-nums">
		{#if editing}
			<Input
				form={fid}
				name={field.cacheRead}
				type="number"
				step="0.0001"
				min="0"
				placeholder="auto"
				bind:value={draftCacheRead}
				aria-label="Cache read price per 1M tokens"
				class="ml-auto h-8 w-28 text-right"
			/>
		{:else if shown.cacheRead !== null}
			{formatUsd(shown.cacheRead)}
		{:else}
			<span class="text-muted-foreground">—</span>
		{/if}
	</Table.Cell>
	<Table.Cell class="text-right tabular-nums">
		{#if editing}
			<Input
				form={fid}
				name={field.cacheWrite}
				type="number"
				step="0.0001"
				min="0"
				placeholder="auto"
				bind:value={draftCacheWrite}
				aria-label="Cache write price per 1M tokens"
				class="ml-auto h-8 w-28 text-right"
			/>
		{:else if shown.cacheWrite !== null}
			{formatUsd(shown.cacheWrite)}
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
					{#each hidden as h (h.name)}
						<input type="hidden" name={h.name} value={h.value} />
					{/each}
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

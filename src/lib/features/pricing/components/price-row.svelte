<script lang="ts">
	import { enhance } from '$app/forms';
	import { toast } from 'svelte-sonner';
	import {
		TIER_FIELDS,
		tierValues,
		type PriceRow,
		type PriceTier
	} from '$lib/features/pricing/pricing';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ConfirmAction from '$lib/components/form/confirm-action.svelte';
	import PriceCell from '$lib/features/pricing/components/price-cell.svelte';
	import Pencil from '@lucide/svelte/icons/pencil';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
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
	// Leaving edit mode on a tier switch avoids carrying one card's drafts into
	// the other's inputs, so `editing` resets whenever the tier changes.
	let editing = $derived.by(() => {
		void tier;
		return false;
	});
	let draftIn = $state('');
	let draftOut = $state('');
	let draftCacheRead = $state('');
	let draftCacheWrite = $state('');
	let saving = $state(false);

	const str = (v: number | null) => (v != null ? String(v) : '');

	function startEdit() {
		draftIn = str(shown.input);
		draftOut = str(shown.output);
		draftCacheRead = str(shown.cacheRead);
		draftCacheWrite = str(shown.cacheWrite);
		editing = true;
	}

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
	<PriceCell
		{editing}
		form={fid}
		name={field.input}
		bind:value={draftIn}
		amount={shown.input}
		previous={price.source === 'custom' ? shown.defaultInput : null}
		{required}
		placeholder={required ? undefined : 'none'}
		ariaLabel="Input price per 1M tokens"
	/>
	<PriceCell
		{editing}
		form={fid}
		name={field.output}
		bind:value={draftOut}
		amount={shown.output}
		previous={price.source === 'custom' ? shown.defaultOutput : null}
		{required}
		placeholder={required ? undefined : 'none'}
		ariaLabel="Output price per 1M tokens"
	/>
	<PriceCell
		{editing}
		form={fid}
		name={field.cacheRead}
		bind:value={draftCacheRead}
		amount={shown.cacheRead}
		placeholder="auto"
		ariaLabel="Cache read price per 1M tokens"
	/>
	<PriceCell
		{editing}
		form={fid}
		name={field.cacheWrite}
		bind:value={draftCacheWrite}
		amount={shown.cacheWrite}
		placeholder="auto"
		ariaLabel="Cache write price per 1M tokens"
	/>
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
					use:enhance={() => {
						saving = true;
						// Each row reports its own outcome: routing it through the page's
						// `form` would land it in the add-model dialog, which shares ?/create.
						return async ({ result, update }) => {
							saving = false;
							if (result.type === 'success') {
								await update();
								editing = false;
								toast.success(`Saved price for ${price.model}`);
							} else if (result.type === 'failure') {
								toast.error(String(result.data?.message ?? 'Could not save the price'));
							} else if (result.type === 'error') {
								toast.error(result.error?.message ?? 'Something went wrong');
							} else {
								await update();
							}
						};
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
					<Button
						type="submit"
						variant="ghost"
						size="icon"
						class="size-8"
						title="Save"
						aria-label="Save price for {price.model}"
						disabled={saving}
					>
						<Check class="size-4 text-primary" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-8 text-muted-foreground"
						title="Cancel"
						aria-label="Cancel editing {price.model}"
						disabled={saving}
						onclick={() => (editing = false)}
					>
						<X class="size-4" />
					</Button>
				</form>
			{:else}
				<div
					class="flex justify-end transition-opacity focus-within:opacity-100 md:opacity-60 md:group-hover:opacity-100"
				>
					<Button
						variant="ghost"
						size="icon"
						class="size-8"
						title={price.source === 'custom' ? 'Edit price' : 'Override default'}
						aria-label="{price.source === 'custom'
							? 'Edit price'
							: 'Override default'} for {price.model}"
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
									aria-label="{isReset
										? 'Reset to platform default'
										: 'Remove price'} for {price.model}"
								>
									{#if isReset}
										<RotateCcw class="size-4" />
									{:else}
										<Trash2 class="size-4" />
									{/if}
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

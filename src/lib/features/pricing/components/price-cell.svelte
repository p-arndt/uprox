<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { formatUsd } from '$lib/format';

	// One rate cell of a pricing row: the formatted price, or a number input while
	// the row is being edited. Inputs join the row's action form by id, because
	// HTML forms can't wrap table cells.

	let {
		editing,
		form,
		name,
		value = $bindable(''),
		amount,
		previous = null,
		required = false,
		placeholder,
		ariaLabel
	}: {
		editing: boolean;
		/** id of the form the input submits with */
		form: string;
		name: string;
		/** draft value while editing */
		value?: string;
		/** the price shown when not editing; null renders a dash */
		amount: number | null;
		/** the overridden default, struck through beneath a differing amount */
		previous?: number | null;
		required?: boolean;
		placeholder?: string;
		ariaLabel: string;
	} = $props();
</script>

<Table.Cell class="text-right tabular-nums">
	{#if editing}
		<Input
			{form}
			{name}
			type="number"
			step="0.0001"
			min="0"
			{placeholder}
			bind:value
			{required}
			aria-label={ariaLabel}
			class="ml-auto h-8 w-28 text-right"
		/>
	{:else if amount !== null}
		{formatUsd(amount)}
		{#if previous != null && previous !== amount}
			<div class="text-xs text-muted-foreground line-through">
				{formatUsd(previous)}
			</div>
		{/if}
	{:else}
		<span class="text-muted-foreground">—</span>
	{/if}
</Table.Cell>

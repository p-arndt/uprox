<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import type { SelectOption } from '$lib/components/form-options';

	// A single-value select that submits with its form under `name` and shows the
	// selected option's label in the trigger.

	let {
		id,
		name,
		value = $bindable(''),
		options,
		fallback,
		class: className = 'w-full'
	}: {
		id?: string;
		name: string;
		value?: string;
		options: SelectOption[];
		/** trigger text when the value matches no option; defaults to the raw value */
		fallback?: string;
		/** classes for the trigger */
		class?: string;
	} = $props();

	const triggerLabel = $derived(options.find((o) => o.value === value)?.label ?? fallback ?? value);
</script>

<Select.Root type="single" {name} bind:value>
	<Select.Trigger {id} class={className}>{triggerLabel}</Select.Trigger>
	<Select.Content>
		{#each options as o (o.value)}
			<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>

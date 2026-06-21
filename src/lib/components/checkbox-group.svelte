<script lang="ts">
	import { untrack } from 'svelte';
	import { Checkbox as CheckboxPrimitive } from 'bits-ui';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';

	let {
		name,
		options,
		selected,
		idPrefix,
		layout = 'wrap'
	}: {
		/** form field name — checked values post under it (formData.getAll) */
		name: string;
		options: { value: string; label: string }[];
		/** initially-checked values */
		selected: string[];
		/** namespaces the checkbox ids so multiple groups don't collide in the DOM */
		idPrefix: string;
		/** 'wrap' flows inline; 'grid' lays out two even columns */
		layout?: 'wrap' | 'grid';
	} = $props();

	// The bits-ui group owns the selection and renders the hidden native inputs,
	// so submission stays native. Seed it once — the dialogs remount this per row
	// when editing, so re-seeding happens naturally on mount.
	let value = $state(untrack(() => [...selected]));
</script>

<CheckboxPrimitive.Group
	{name}
	bind:value
	class={layout === 'grid'
		? 'grid grid-cols-2 gap-x-4 gap-y-2.5'
		: 'flex flex-wrap gap-x-5 gap-y-2.5'}
>
	{#each options as o (o.value)}
		<div class="flex items-center gap-2">
			<Checkbox id={`${idPrefix}-${o.value}`} value={o.value} />
			<Label for={`${idPrefix}-${o.value}`} class="font-normal">{o.label}</Label>
		</div>
	{/each}
</CheckboxPrimitive.Group>

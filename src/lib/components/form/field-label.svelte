<script lang="ts">
	import { Label } from '$lib/components/ui/label/index.js';
	import FieldHint from '$lib/components/form/field-hint.svelte';

	// A form label with an optional inline info hint beside it.

	let {
		for: htmlFor,
		label,
		hint,
		class: className = ''
	}: {
		/** id of the control the label names */
		for?: string;
		label: string;
		hint?: string;
		/** classes for the header row */
		class?: string;
	} = $props();
</script>

{#if hint}
	<div class="flex items-center gap-1.5 {className}">
		<Label for={htmlFor}>{label}</Label>
		<FieldHint text={hint} />
	</div>
{:else}
	<Label for={htmlFor} class={className}>{label}</Label>
{/if}

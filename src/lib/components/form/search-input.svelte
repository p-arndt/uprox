<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import Search from '@lucide/svelte/icons/search';

	let {
		value = $bindable(''),
		placeholder = 'Search…',
		class: className,
		ariaLabel
	}: {
		value?: string;
		placeholder?: string;
		/** width / layout classes for the wrapper */
		class?: string;
		ariaLabel?: string;
	} = $props();
</script>

<div class="relative {className ?? ''}">
	<Search
		class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
	/>
	<Input bind:value {placeholder} class="pl-9" aria-label={ariaLabel ?? placeholder} />
</div>

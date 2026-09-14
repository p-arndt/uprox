<script lang="ts">
	import type { Snippet } from 'svelte';

	// One labelled figure in a trace's summary row.

	let {
		label,
		class: valueClass = '',
		children
	}: {
		label: string;
		/** classes for the value line */
		class?: string;
		children: Snippet;
	} = $props();
</script>

<div>
	<div class="text-xs text-muted-foreground">{label}</div>
	<div class={valueClass}>{@render children()}</div>
</div>

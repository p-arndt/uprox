<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		value,
		valueClass = 'text-2xl',
		children
	}: {
		label: string;
		/** the figure; omit and pass `children` to render a custom value */
		value?: string | number;
		/** override the value typography (e.g. 'text-lg' or a muted colour) */
		valueClass?: string;
		/** custom value content, replacing the default number (e.g. with a status dot) */
		children?: Snippet;
	} = $props();
</script>

<div class="rounded-xl border bg-card p-4">
	<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
	{#if children}
		{@render children()}
	{:else}
		<p class="mt-1 font-semibold tabular-nums {valueClass}">{value}</p>
	{/if}
</div>

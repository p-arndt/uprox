<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		icon: Icon,
		title,
		description,
		children
	}: {
		icon: LucideIcon;
		title: string;
		description?: string;
		/** optional call-to-action rendered below the copy (e.g. a button) */
		children?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
	<Icon class="size-8 text-muted-foreground" />
	<p class="mt-3 text-sm font-medium">{title}</p>
	{#if description}
		<p class="text-sm text-muted-foreground">{description}</p>
	{/if}
	{#if children}
		<div class="mt-4">{@render children()}</div>
	{/if}
</div>

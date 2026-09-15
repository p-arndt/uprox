<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	// Progressive disclosure: children stay mounted (toggling visibility, not the
	// DOM) so form fields inside always submit — bits-ui Collapsible would
	// unmount them and silently drop values.

	let {
		title,
		summary,
		active = false,
		open = $bindable(false),
		children
	}: {
		title: string;
		/** muted status text next to the title, e.g. "Inherited" / "Custom" */
		summary?: string;
		/** the section holds custom values */
		active?: boolean;
		open?: boolean;
		children: Snippet;
	} = $props();
</script>

<div>
	<button
		type="button"
		class="flex w-full items-center justify-between text-sm font-medium text-foreground"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="flex items-center gap-2">
			{title}
			{#if active}
				<span class="size-1.5 rounded-full bg-primary" title="Has custom values"></span>
			{/if}
			{#if summary}
				<span class="text-xs font-normal text-muted-foreground">{summary}</span>
			{/if}
		</span>
		<ChevronDown
			class="size-4 text-muted-foreground transition-transform duration-200 {open
				? 'rotate-180'
				: ''}"
		/>
	</button>

	<div class="space-y-4 pt-3" class:hidden={!open}>
		{@render children()}
	</div>
</div>

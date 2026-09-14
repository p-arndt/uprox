<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/ui/dialog/index.js';

	// A dialog whose open state is "an entity is selected": the page holds the
	// entity (or null) and gets told when the dialog is dismissed, so it can clear
	// the selection. Saves each edit/rotate/reveal dialog re-deriving `open` and
	// re-wiring onOpenChange.

	let {
		open,
		onClose,
		title,
		description,
		class: className,
		children
	}: {
		open: boolean;
		onClose: () => void;
		title: string;
		/** plain text, or a snippet when the description needs markup */
		description?: string | Snippet;
		/** classes for the dialog content (e.g. width, scroll) */
		class?: string;
		children: Snippet;
	} = $props();
</script>

<Dialog.Root
	{open}
	onOpenChange={(v) => {
		if (!v) onClose();
	}}
>
	<Dialog.Content class={className}>
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			{#if typeof description === 'string'}
				<Dialog.Description>{description}</Dialog.Description>
			{:else if description}
				<Dialog.Description>{@render description()}</Dialog.Description>
			{/if}
		</Dialog.Header>
		{@render children()}
	</Dialog.Content>
</Dialog.Root>

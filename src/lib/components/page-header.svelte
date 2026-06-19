<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		action
	}: {
		title: string;
		/** plain text, or a snippet when the copy needs inline markup (e.g. <code>) */
		description?: string | Snippet;
		/** right-aligned control (button, dialog trigger, …) */
		action?: Snippet;
	} = $props();
</script>

<div class="flex items-start justify-between gap-4">
	<div>
		<h2 class="text-xl font-semibold tracking-tight">{title}</h2>
		{#if description}
			<p class="text-sm text-muted-foreground">
				{#if typeof description === 'string'}{description}{:else}{@render description()}{/if}
			</p>
		{/if}
	</div>
	{#if action}{@render action()}{/if}
</div>

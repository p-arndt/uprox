<script lang="ts">
	import Filter from '@lucide/svelte/icons/filter';
	import X from '@lucide/svelte/icons/x';

	// The active server-side metadata filter, with a control to clear it.

	let {
		filter,
		onclear
	}: {
		filter: { key: string; value?: string | null };
		onclear: () => void;
	} = $props();
</script>

<div class="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
	<Filter class="size-4 shrink-0 text-muted-foreground" />
	<span class="text-muted-foreground">Metadata filter</span>
	<span class="rounded-md border bg-background px-2 py-0.5 font-mono text-xs">
		{filter.key}{filter.value != null ? `: ${filter.value}` : ''}
	</span>
	<button
		type="button"
		onclick={onclear}
		class="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
	>
		<X class="size-3.5" /> Clear
	</button>
</div>

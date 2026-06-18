<script lang="ts">
	// Renders caller-supplied trace metadata (the generic jsonb bag) as key/value
	// chips. Accepts anything; shows nothing unless it's a non-empty object.
	let { metadata }: { metadata: unknown } = $props();

	const entries = $derived(
		metadata && typeof metadata === 'object' && !Array.isArray(metadata)
			? Object.entries(metadata as Record<string, unknown>)
			: []
	);
	const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
</script>

{#if entries.length}
	<div class="flex flex-wrap gap-1.5">
		{#each entries as [k, v] (k)}
			<span class="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs">
				<span class="font-medium text-muted-foreground">{k}</span>
				<span class="font-mono break-all">{fmt(v)}</span>
			</span>
		{/each}
	</div>
{/if}

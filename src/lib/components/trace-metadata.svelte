<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';

	// Renders caller-supplied trace metadata (the generic jsonb bag) as key/value
	// chips. Accepts anything; shows nothing unless it's a non-empty object. Each
	// chip links to the traces list filtered by that key/value.
	let { metadata }: { metadata: unknown } = $props();

	const entries = $derived(
		metadata && typeof metadata === 'object' && !Array.isArray(metadata)
			? Object.entries(metadata as Record<string, unknown>)
			: []
	);
	const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
	const filterHref = (k: string, v: unknown) =>
		`${resolve('/app/traces')}?meta=${encodeURIComponent(`${k}:${fmt(v)}`)}` as ResolvedPathname;
</script>

{#if entries.length}
	<div class="flex flex-wrap gap-1.5">
		{#each entries as [k, v] (k)}
			<a
				href={filterHref(k, v)}
				title="Filter traces by {k}"
				class="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-0.5 text-xs transition-colors hover:border-primary/40 hover:bg-muted"
			>
				<span class="font-medium text-muted-foreground">{k}</span>
				<span class="font-mono break-all">{fmt(v)}</span>
			</a>
		{/each}
	</div>
{/if}

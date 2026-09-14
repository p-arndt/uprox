<script lang="ts">
	import {
		countFilterValues,
		dimensionLabel,
		removeFilterValue,
		type UsageDimension,
		type UsageFilter,
		type UsageFilterOptions
	} from '$lib/usage-group';
	import X from '@lucide/svelte/icons/x';

	// Active filter pills. Each removes just its own value; "Clear all" only
	// appears once there's more than one, so it can't be mistaken for undo.

	let {
		filters,
		options,
		onFilters
	}: {
		filters: UsageFilter[];
		options: UsageFilterOptions;
		onFilters: (next: UsageFilter[]) => void;
	} = $props();

	const activeCount = $derived(countFilterValues(filters));

	/** Label for a pill — resolved through the options so it isn't a bare uuid. */
	function labelFor(dim: UsageDimension, value: string): string {
		return options[dim]?.find((o) => o.value === value)?.label ?? value;
	}
</script>

{#each filters as f (f.dim)}
	{#each f.values as v (v)}
		<span
			class="inline-flex items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-2.5 text-xs"
		>
			<span class="text-muted-foreground">{dimensionLabel(f.dim)}:</span>
			<span class="max-w-40 truncate font-medium">{labelFor(f.dim, v)}</span>
			<button
				type="button"
				class="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onclick={() => onFilters(removeFilterValue(filters, f.dim, v))}
				aria-label="Remove filter {dimensionLabel(f.dim)}: {labelFor(f.dim, v)}"
			>
				<X class="size-3" />
			</button>
		</span>
	{/each}
{/each}

{#if activeCount > 1}
	<button
		type="button"
		class="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
		onclick={() => onFilters([])}
	>
		Clear all
	</button>
{/if}

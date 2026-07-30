<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		USAGE_DIMENSIONS,
		addFilterValue,
		countFilterValues,
		dimensionLabel,
		removeFilterValue,
		type UsageDimension,
		type UsageFilter,
		type UsageFilterOptions
	} from '$lib/usage-group';
	import ListFilter from '@lucide/svelte/icons/list-filter';
	import Layers from '@lucide/svelte/icons/layers';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';

	// "Group by" + "Add filter", both as fixed-width dropdowns so the command row
	// keeps its shape no matter how many dimensions a page allows. Both live in
	// the URL, so a configured view is shareable and Back walks the analysis
	// history rather than leaving the page.

	let {
		groupBy,
		filters,
		options,
		dimensions,
		onGroupBy,
		onFilters
	}: {
		groupBy: UsageDimension;
		filters: UsageFilter[];
		/** selectable values per dimension, derived from traffic in the window */
		options: UsageFilterOptions;
		/** which dimensions this page allows; a scoped page hides the ones that
		 *  would collapse to a single row (service, on a service-detail page) */
		dimensions: readonly UsageDimension[];
		onGroupBy: (dim: UsageDimension) => void;
		onFilters: (next: UsageFilter[]) => void;
	} = $props();

	const dims = $derived(USAGE_DIMENSIONS.filter((d) => dimensions.includes(d.key)));

	let groupOpen = $state(false);
	let filterOpen = $state(false);
	// Which dimension the filter popover lists values for; defaults to whatever
	// this page actually allows rather than a hard-coded 'service'.
	let picked = $state<UsageDimension | null>(null);
	const pickerDim = $derived(picked ?? dimensions[0]);

	const activeCount = $derived(countFilterValues(filters));

	function isSelected(dim: UsageDimension, value: string): boolean {
		return filters.some((f) => f.dim === dim && f.values.includes(value));
	}

	function toggle(dim: UsageDimension, value: string) {
		onFilters(
			isSelected(dim, value)
				? removeFilterValue(filters, dim, value)
				: addFilterValue(filters, dim, value)
		);
	}

	/** Label for a pill — resolved through the options so it isn't a bare uuid. */
	function labelFor(dim: UsageDimension, value: string): string {
		return options[dim]?.find((o) => o.value === value)?.label ?? value;
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<!-- Group by -->
	<Popover.Root bind:open={groupOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm" class="gap-1.5 font-medium">
					<Layers class="size-4 text-muted-foreground" />
					<span class="font-normal text-muted-foreground">Group by</span>
					{dimensionLabel(groupBy)}
					<ChevronDown class="size-3.5 text-muted-foreground" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="start" class="w-52 p-1">
			{#each dims as d (d.key)}
				<button
					type="button"
					onclick={() => {
						groupOpen = false;
						onGroupBy(d.key);
					}}
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
				>
					<Check class="size-4 shrink-0 {d.key === groupBy ? '' : 'invisible'}" />
					{d.label}
				</button>
			{/each}
		</Popover.Content>
	</Popover.Root>

	<!-- Add filter -->
	<Popover.Root bind:open={filterOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" size="sm" class="gap-1.5">
					<ListFilter class="size-4 text-muted-foreground" />
					Add filter
					{#if activeCount > 0}
						<span
							class="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-foreground tabular-nums"
						>
							{activeCount}
						</span>
					{/if}
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="start" class="w-80 p-0">
			<!-- dimension switcher for the value list below -->
			<div class="flex flex-wrap gap-1 border-b p-2">
				{#each dims as d (d.key)}
					<button
						type="button"
						onclick={() => (picked = d.key)}
						class="rounded-md px-2 py-1 text-xs font-medium transition-colors {d.key === pickerDim
							? 'bg-accent text-accent-foreground'
							: 'text-muted-foreground hover:text-foreground'}"
					>
						{d.label}
					</button>
				{/each}
			</div>
			<Command.Root>
				<Command.Input placeholder="Search {dimensionLabel(pickerDim).toLowerCase()}…" />
				<Command.List>
					<Command.Empty>No {dimensionLabel(pickerDim).toLowerCase()} in this window.</Command.Empty
					>
					{#each options[pickerDim] ?? [] as opt (opt.value)}
						<Command.Item
							value="{opt.label} {opt.hint ?? ''}"
							onSelect={() => toggle(pickerDim, opt.value)}
						>
							<span
								class="flex size-4 shrink-0 items-center justify-center rounded border {isSelected(
									pickerDim,
									opt.value
								)
									? 'border-transparent bg-primary text-primary-foreground'
									: 'border-input'}"
							>
								{#if isSelected(pickerDim, opt.value)}
									<Check class="size-3" />
								{/if}
							</span>
							<span class="min-w-0 flex-1 truncate">{opt.label}</span>
							{#if opt.hint}
								<span class="shrink-0 text-xs text-muted-foreground">{opt.hint}</span>
							{/if}
						</Command.Item>
					{/each}
				</Command.List>
			</Command.Root>
		</Popover.Content>
	</Popover.Root>

	<!-- Active filter pills. Each removes just its own value; "Clear all" only
	     appears once there's more than one, so it can't be mistaken for undo. -->
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
</div>

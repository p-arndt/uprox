<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import {
		addFilterValue,
		countFilterValues,
		dimensionLabel,
		removeFilterValue,
		type UsageDimension,
		type UsageFilter,
		type UsageFilterOptions
	} from '$lib/features/usage/group';
	import ListFilter from '@lucide/svelte/icons/list-filter';
	import Check from '@lucide/svelte/icons/check';

	// The "Add filter" dropdown of the usage analysis toolbar: a dimension
	// switcher over a searchable, multi-select value list.

	let {
		filters,
		options,
		dims,
		defaultDim,
		onFilters
	}: {
		filters: UsageFilter[];
		/** selectable values per dimension, derived from traffic in the window */
		options: UsageFilterOptions;
		/** the filterable dimensions this page allows */
		dims: { key: UsageDimension; label: string }[];
		/** the dimension listed before the user picks one */
		defaultDim: UsageDimension;
		onFilters: (next: UsageFilter[]) => void;
	} = $props();

	let open = $state(false);
	let picked = $state<UsageDimension | null>(null);
	const pickerDim = $derived(picked ?? defaultDim);

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
</script>

<Popover.Root bind:open>
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
				<Command.Empty>No {dimensionLabel(pickerDim).toLowerCase()} in this window.</Command.Empty>
				{#each options[pickerDim] ?? [] as opt (opt.value)}
					{@const selected = isSelected(pickerDim, opt.value)}
					<Command.Item
						value="{opt.label} {opt.hint ?? ''}"
						onSelect={() => toggle(pickerDim, opt.value)}
					>
						<span
							class="flex size-4 shrink-0 items-center justify-center rounded border {selected
								? 'border-transparent bg-primary text-primary-foreground'
								: 'border-input'}"
						>
							{#if selected}
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

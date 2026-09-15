<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { dimensionLabel, type UsageDimension } from '$lib/features/usage/group';
	import Layers from '@lucide/svelte/icons/layers';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';

	// The "Group by" dropdown of the usage analysis toolbar.

	let {
		groupBy,
		dims,
		onGroupBy
	}: {
		groupBy: UsageDimension;
		/** the dimensions this page allows grouping by */
		dims: { key: UsageDimension; label: string }[];
		onGroupBy: (dim: UsageDimension) => void;
	} = $props();

	let open = $state(false);
</script>

<Popover.Root bind:open>
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
					open = false;
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

<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';

	// A clickable column header for client-sorted tables, paired with
	// createTableState: shows the arrow on the active column and exposes the
	// current order to assistive tech via aria-sort.

	let {
		label,
		active,
		dir,
		numeric = false,
		hint,
		onclick
	}: {
		label: string;
		/** whether the table is currently sorted by this column */
		active: boolean;
		dir: 'asc' | 'desc';
		/** right-aligns the header to sit over numeric cells */
		numeric?: boolean;
		/** tooltip explaining the column */
		hint?: string;
		onclick: () => void;
	} = $props();
</script>

<th
	scope="col"
	class="py-2 font-medium {numeric ? 'text-right' : 'text-left'}"
	aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
>
	<button
		type="button"
		{onclick}
		title={hint}
		class="inline-flex items-center gap-1 transition-colors hover:text-foreground {active
			? 'text-foreground'
			: ''}"
	>
		{label}
		{#if active}
			{#if dir === 'desc'}<ArrowDown class="size-3" />{:else}<ArrowUp class="size-3" />{/if}
		{/if}
	</button>
</th>

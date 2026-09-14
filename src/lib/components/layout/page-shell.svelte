<script lang="ts">
	import type { Snippet } from 'svelte';

	// One place that decides how wide a page is and how far apart its blocks sit.
	// Before this every page picked its own max-width between 2xl and 7xl, so the
	// content's left edge jumped sideways on each nav click; three named widths
	// keep that edge still while still letting a table breathe wider than a form.

	let {
		width = 'default',
		children
	}: {
		/** narrow: forms and single-column reading. default: lists and tables.
		 *  wide: analysis surfaces, where charts need the horizontal room. */
		width?: 'narrow' | 'default' | 'wide';
		children: Snippet;
	} = $props();

	const WIDTHS = {
		narrow: 'max-w-3xl',
		default: 'max-w-6xl',
		wide: 'max-w-7xl'
	} as const;
</script>

<div class="mx-auto w-full space-y-6 {WIDTHS[width]}">
	{@render children()}
</div>

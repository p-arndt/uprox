<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';

	// A list of spans laid on a shared time axis. Rows are links (`href`) or
	// in-page selections (`onselect`); the caller renders each row's label and
	// computes the bar geometry, this owns the row chrome, bar and duration.
	//
	// `inline` puts label, bar and duration on one line; `stacked` puts the label
	// line (with the duration at its end) above a thin full-width bar.

	let {
		rows,
		key,
		active,
		bar,
		duration,
		label,
		href,
		onselect,
		header,
		layout = 'inline',
		rowClass = '',
		inactiveBarClass = 'bg-primary/55',
		durationClass = 'w-14'
	}: {
		rows: T[];
		key: (row: T) => string;
		active: (row: T) => boolean;
		bar: (row: T) => { left: number; width: number };
		duration: (row: T) => string;
		/** the row's label area; receives the row, whether it's active and its index */
		label: Snippet<[T, boolean, number]>;
		href?: (row: T) => ResolvedPathname;
		onselect?: (row: T) => void;
		/** a leading row above the spans */
		header?: Snippet;
		layout?: 'inline' | 'stacked';
		rowClass?: string;
		inactiveBarClass?: string;
		/** width class of the inline duration column */
		durationClass?: string;
	} = $props();
</script>

{#snippet content(row: T, i: number, isActive: boolean)}
	{@const geo = bar(row)}
	{#if layout === 'stacked'}
		<span class="flex items-center gap-2">
			{@render label(row, isActive, i)}
			<span class="ml-auto shrink-0 text-muted-foreground tabular-nums">{duration(row)}</span>
		</span>
		<span class="relative h-1.5 w-full rounded bg-muted/50">
			<span
				class="absolute top-0 h-1.5 rounded {isActive ? 'bg-primary' : inactiveBarClass}"
				style="left:{geo.left}%;width:{geo.width}%"
			></span>
		</span>
	{:else}
		{@render label(row, isActive, i)}
		<span class="relative h-3 flex-1 rounded bg-muted/40">
			<span
				class="absolute top-0 h-3 rounded {isActive ? 'bg-primary' : inactiveBarClass}"
				style="left:{geo.left}%;width:{geo.width}%"
			></span>
		</span>
		<span class="{durationClass} shrink-0 text-right text-muted-foreground tabular-nums">
			{duration(row)}
		</span>
	{/if}
{/snippet}

<div class="overflow-hidden rounded-xl border text-xs">
	{@render header?.()}
	{#each rows as row, i (key(row))}
		{@const isActive = active(row)}
		{@const base =
			layout === 'stacked'
				? 'flex w-full flex-col gap-1.5 px-3 py-2.5 text-left'
				: 'flex items-center gap-3 px-3 py-2'}
		{@const cls = `${base} transition-colors hover:bg-muted/50 ${rowClass} ${isActive ? 'bg-muted/60' : ''}`}
		{#if href}
			<a href={href(row)} class={cls}>{@render content(row, i, isActive)}</a>
		{:else}
			<button type="button" onclick={() => onselect?.(row)} class="w-full text-left {cls}">
				{@render content(row, i, isActive)}
			</button>
		{/if}
	{/each}
</div>

<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { RangeCalendar } from '$lib/components/ui/range-calendar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { parseDate, type DateValue } from '@internationalized/date';
	import type { ResolvedPathname } from '$app/types';
	import type { UsageUrlOverrides } from '$lib/usage-url';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	// One control for the whole time window: the current range is the button
	// label, the presets are a checked list inside, and the custom calendar sits
	// behind a hairline in the footer.
	//
	// This replaced a row of nine preset pills plus a separate custom-range
	// button. At nine options the pill bar was wider than the space beside the
	// page title, so it wrapped into two or three ragged rows and shoved the
	// refresh and export buttons out of alignment. A dropdown is fixed-width
	// whatever the option count, which is why every cost tool uses one here.

	let {
		ranges,
		range,
		hrefWith,
		customFrom,
		customTo,
		onApplyCustom
	}: {
		ranges: readonly { key: string; label: string }[];
		range: string;
		hrefWith: (overrides: UsageUrlOverrides) => ResolvedPathname;
		customFrom: string | null;
		customTo: string | null;
		onApplyCustom: (from: string, to: string) => void;
	} = $props();

	type DateRange = { start: DateValue | undefined; end: DateValue | undefined };

	function toCalendar(v: string | null): DateValue | undefined {
		if (!v) return undefined;
		try {
			return parseDate(v);
		} catch {
			return undefined;
		}
	}

	let open = $state(false);
	let showCalendar = $state(false);
	let value = $state<DateRange>({ start: undefined, end: undefined });

	// Seed the calendar from the applied window each time it opens, so reopening
	// after a navigation reflects the current range rather than a stale edit.
	$effect(() => {
		if (open) value = { start: toCalendar(customFrom), end: toCalendar(customTo) };
		if (!open) showCalendar = false;
	});

	const isCustom = $derived(range === 'custom');
	const label = $derived(
		isCustom && customFrom && customTo
			? `${customFrom} → ${customTo}`
			: (ranges.find((r) => r.key === range)?.label ?? range)
	);

	const canApply = $derived(!!value.start && !!value.end);
	function apply() {
		if (!value.start || !value.end) return;
		onApplyCustom(value.start.toString(), value.end.toString());
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="sm" class="gap-1.5 font-medium">
				<CalendarIcon class="size-4 text-muted-foreground" />
				{label}
				<ChevronDown class="size-3.5 text-muted-foreground" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content align="end" class="w-auto p-0">
		{#if showCalendar}
			<RangeCalendar bind:value />
			<div class="flex items-center justify-between gap-2 border-t p-3">
				<Button variant="ghost" size="sm" onclick={() => (showCalendar = false)}>Back</Button>
				<Button size="sm" disabled={!canApply} onclick={apply}>Apply</Button>
			</div>
		{:else}
			<ul class="w-56 p-1">
				{#each ranges as r (r.key)}
					<li>
						<a
							href={hrefWith({ range: r.key })}
							data-sveltekit-noscroll
							onclick={() => (open = false)}
							class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
						>
							<Check class="size-4 shrink-0 {r.key === range && !isCustom ? '' : 'invisible'}" />
							{r.label}
						</a>
					</li>
				{/each}
			</ul>
			<div class="border-t p-1">
				<button
					type="button"
					onclick={() => (showCalendar = true)}
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
				>
					<Check class="size-4 shrink-0 {isCustom ? '' : 'invisible'}" />
					Custom range…
				</button>
			</div>
		{/if}
	</Popover.Content>
</Popover.Root>

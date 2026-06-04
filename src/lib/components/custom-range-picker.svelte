<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { RangeCalendar } from '$lib/components/ui/range-calendar/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { parseDate, type DateValue } from '@internationalized/date';
	import CalendarIcon from '@lucide/svelte/icons/calendar';

	let {
		from,
		to,
		active,
		onApply
	}: {
		/** currently-applied custom start (YYYY-MM-DD), or null when a preset is active */
		from: string | null;
		to: string | null;
		/** whether the custom window is the active range */
		active: boolean;
		/** parent owns navigation so the resolve() call stays at the call site */
		onApply: (from: string, to: string) => void;
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
	let value = $state<DateRange>({ start: undefined, end: undefined });

	// Seed the calendar from the applied window each time the popover opens (the
	// calendar only renders while open), so reopening after a navigation reflects
	// the current range rather than a stale edit.
	$effect(() => {
		if (open) value = { start: toCalendar(from), end: toCalendar(to) };
	});

	const canApply = $derived(!!value.start && !!value.end);
	const label = $derived(active && from && to ? `${from} → ${to}` : 'Custom range');

	function apply() {
		if (!value.start || !value.end) return;
		onApply(value.start.toString(), value.end.toString());
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors {active
			? 'bg-accent text-accent-foreground'
			: 'text-muted-foreground hover:text-foreground'}"
	>
		<CalendarIcon class="size-4" />
		{label}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-0" align="end">
		<RangeCalendar bind:value />
		<div class="flex items-center justify-end gap-2 border-t p-3">
			<Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
			<Button size="sm" disabled={!canApply} onclick={apply}>Apply</Button>
		</div>
	</Popover.Content>
</Popover.Root>

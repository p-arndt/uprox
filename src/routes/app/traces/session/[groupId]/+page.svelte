<script lang="ts">
	import TraceWaterfall from '$lib/features/traces/components/trace-waterfall.svelte';
	import PageShell from '$lib/components/layout/page-shell.svelte';
	import { formatDuration } from '$lib/format';
	import { eventTone, toneDot } from '$lib/events';
	import { callSpan, callsWindow, waterfallBar } from '$lib/features/traces/trace';
	import SessionSummary from './session-summary.svelte';
	import SessionViewToggle from './session-view-toggle.svelte';
	import SessionTranscript from './session-transcript.svelte';
	import SessionCallDetail from './session-call-detail.svelte';
	import { callLabel } from './session';

	let { data } = $props();
	const calls = $derived(data.calls);

	// 'explore' = two-pane inspector; 'transcript' = whole run on one page.
	let mode = $state<'explore' | 'transcript'>('explore');

	// inline selection — no page reloads. Default to the last call (the final answer).
	let selectedId = $state<string | null>(null);
	const selected = $derived(calls.find((c) => c.id === selectedId) ?? calls[calls.length - 1]);

	type Call = (typeof calls)[number];
	const win = $derived(callsWindow(calls));
	const callBar = (c: Call) => waterfallBar(callSpan(c).start, c.latencyMs ?? 0, win, 2);
</script>

<PageShell width="default">
	<SessionSummary {calls} groupId={data.groupId} durationMs={win.end - win.start} />

	<SessionViewToggle bind:mode />

	{#if mode === 'transcript'}
		<SessionTranscript {calls} />
	{:else}
		<div class="grid gap-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
			<!-- Left: call list / waterfall (sticky) -->
			<div class="lg:sticky lg:top-20 lg:self-start">
				<TraceWaterfall
					rows={calls}
					key={(c) => c.id}
					active={(c) => selected?.id === c.id}
					bar={callBar}
					duration={(c) => formatDuration(c.latencyMs)}
					onselect={(c) => (selectedId = c.id)}
					layout="stacked"
					rowClass="border-b last:border-b-0"
				>
					{#snippet header()}
						<div class="border-b bg-muted/40 px-3 py-2 font-medium">Calls</div>
					{/snippet}
					{#snippet label(c, active, i)}
						<span class="text-muted-foreground tabular-nums">{i + 1}.</span>
						<span
							class="size-1.5 shrink-0 rounded-full {toneDot[eventTone(c.status)]}"
							aria-hidden="true"
						></span>
						<span
							class="truncate font-mono {active
								? 'font-semibold text-foreground'
								: 'text-muted-foreground'}"
						>
							{callLabel(c)}
						</span>
					{/snippet}
				</TraceWaterfall>
				<p class="mt-2 text-xs text-muted-foreground">
					Each row is one gateway call sharing this session id. Select one to inspect it.
				</p>
			</div>

			<!-- Right: selected call detail -->
			{#if selected}
				<SessionCallDetail call={selected} />
			{/if}
		</div>
	{/if}
</PageShell>

<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { prettyJson, waterfallBar } from '$lib/features/traces/trace';
	import {
		buildSpanTree,
		flattenTree,
		traceWindow,
		spanKind,
		spanDetail,
		spanKindAccent
	} from '$lib/features/traces/otel';
	import { formatDuration, formatTokens } from '$lib/format';
	import { toneDot } from '$lib/events';
	import TraceWaterfall from '$lib/features/traces/components/trace-waterfall.svelte';
	import DetailHeader from '$lib/components/layout/detail-header.svelte';
	import Network from '@lucide/svelte/icons/network';
	import PageShell from '$lib/components/layout/page-shell.svelte';

	let { data } = $props();

	const flat = $derived(flattenTree(buildSpanTree(data.spans)));
	const win = $derived(traceWindow(data.spans));

	// the selected span's detail; default to the first LLM span, else the root
	let selectedId = $state<string | null>(null);
	const selected = $derived(
		flat.find((s) => s.spanId === selectedId) ?? flat.find((s) => spanKind(s) === 'LLM') ?? flat[0]
	);
	const detail = $derived(selected ? spanDetail(selected) : null);

	type Span = (typeof flat)[number];
	const spanBar = (s: Span) =>
		waterfallBar(new Date(s.startedAt).getTime(), s.durationMs || 0, win, 0.5);

	const statusTone = (s: string) => (s === 'error' ? 'error' : s === 'ok' ? 'ok' : 'neutral');
</script>

<PageShell width="default">
	<DetailHeader icon={Network} eyebrow="Distributed trace" title={flat[0]?.name ?? 'Trace'}>
		{#snippet badges()}
			<Badge variant="secondary">{data.spans.length} spans</Badge>
			<span class="font-mono text-xs text-muted-foreground">{data.traceId}</span>
		{/snippet}
	</DetailHeader>

	<div class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
		<!-- Span tree / waterfall -->
		<TraceWaterfall
			rows={flat}
			key={(s) => s.spanId}
			active={(s) => selected?.spanId === s.spanId}
			bar={spanBar}
			duration={(s) => formatDuration(s.durationMs)}
			onselect={(s) => (selectedId = s.spanId)}
			rowClass="border-b last:border-b-0"
		>
			{#snippet label(s, active)}
				{@const kind = spanKind(s)}
				<span
					class="flex min-w-0 items-center gap-2"
					style="width:16rem;padding-left:{s.depth * 14}px"
				>
					<span
						class="size-1.5 shrink-0 rounded-full {toneDot[statusTone(s.status)]}"
						aria-hidden="true"
					></span>
					<span class="truncate font-mono {active ? 'font-semibold text-foreground' : ''}">
						{s.name}
					</span>
					{#if kind}
						<span class="shrink-0 text-[10px] font-medium {spanKindAccent(kind)}">
							{kind}
						</span>
					{/if}
				</span>
			{/snippet}
		</TraceWaterfall>

		<!-- Selected span detail -->
		{#if selected && detail}
			<div class="space-y-3 rounded-xl border p-4">
				<div>
					<div class="flex items-center gap-2">
						<h3 class="font-mono text-sm font-semibold break-all">{selected.name}</h3>
						{#if detail.kind}<Badge variant="outline">{detail.kind}</Badge>{/if}
					</div>
					<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
						<span>{formatDuration(selected.durationMs)}</span>
						<span>status: {selected.status}</span>
						{#if detail.model}<span class="font-mono">{detail.model}</span>{/if}
						{#if detail.tokensIn != null || detail.tokensOut != null}
							<span class="tabular-nums">
								{formatTokens(detail.tokensIn)} → {formatTokens(detail.tokensOut)} tok
							</span>
						{/if}
					</div>
				</div>

				{#if detail.input}
					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Input</div>
						<pre
							class="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{detail.input}</pre>
					</div>
				{/if}
				{#if detail.output}
					<div>
						<div class="mb-1 text-xs font-medium text-muted-foreground">Output</div>
						<pre
							class="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-2 text-xs whitespace-pre-wrap">{detail.output}</pre>
					</div>
				{/if}

				<div>
					<div class="mb-1 text-xs font-medium text-muted-foreground">Attributes</div>
					<pre class="max-h-64 overflow-auto rounded-lg border bg-muted/40 p-2 text-xs">{prettyJson(
							JSON.stringify(selected.attributes ?? {})
						)}</pre>
				</div>
			</div>
		{/if}
	</div>
</PageShell>

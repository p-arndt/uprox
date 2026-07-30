<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { prettyJson } from '$lib/trace';
	import { buildSpanTree, flattenTree, traceWindow, spanKind, spanDetail } from '$lib/otel';
	import { formatTokens } from '$lib/format';
	import { toneDot } from '$lib/events';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Network from '@lucide/svelte/icons/network';

	let { data } = $props();

	const flat = $derived(flattenTree(buildSpanTree(data.spans)));
	const win = $derived(traceWindow(data.spans));
	const span = $derived(win.end - win.start);

	// the selected span's detail; default to the first LLM span, else the root
	let selectedId = $state<string | null>(null);
	const selected = $derived(
		flat.find((s) => s.spanId === selectedId) ?? flat.find((s) => spanKind(s) === 'LLM') ?? flat[0]
	);
	const detail = $derived(selected ? spanDetail(selected) : null);

	const startMs = (s: { startedAt: string | Date }) => new Date(s.startedAt).getTime();
	const barLeft = (s: (typeof flat)[number]) => ((startMs(s) - win.start) / span) * 100;
	const barWidth = (s: (typeof flat)[number]) => Math.max(0.5, ((s.durationMs || 0) / span) * 100);
	const fmtDur = (ms: number) =>
		ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

	const statusTone = (s: string) => (s === 'error' ? 'error' : s === 'ok' ? 'ok' : 'neutral');

	// OpenInference span-kind → accent colour for the tree node dot/label.
	const kindAccent: Record<string, string> = {
		LLM: 'text-emerald-600 dark:text-emerald-400',
		RETRIEVER: 'text-sky-600 dark:text-sky-400',
		EMBEDDING: 'text-violet-600 dark:text-violet-400',
		RERANKER: 'text-amber-600 dark:text-amber-400',
		TOOL: 'text-orange-600 dark:text-orange-400',
		AGENT: 'text-pink-600 dark:text-pink-400',
		CHAIN: 'text-muted-foreground'
	};
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<a
		href={resolve('/app/traces')}
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
	>
		<ArrowLeft class="size-4" /> Back to traces
	</a>

	<div class="flex flex-wrap items-center gap-3">
		<Network class="size-5 text-muted-foreground" />
		<h2 class="text-lg font-semibold tracking-tight">{flat[0]?.name ?? 'Trace'}</h2>
		<Badge variant="secondary">{data.spans.length} spans</Badge>
		<span class="font-mono text-xs text-muted-foreground">{data.traceId}</span>
	</div>

	<div class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
		<!-- Span tree / waterfall -->
		<div class="overflow-hidden rounded-xl border text-xs">
			{#each flat as s (s.spanId)}
				{@const active = selected?.spanId === s.spanId}
				{@const kind = spanKind(s)}
				<button
					type="button"
					onclick={() => (selectedId = s.spanId)}
					class="flex w-full items-center gap-3 border-b px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50 {active
						? 'bg-muted/60'
						: ''}"
				>
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
							<span
								class="shrink-0 text-[10px] font-medium {kindAccent[kind] ??
									'text-muted-foreground'}"
							>
								{kind}
							</span>
						{/if}
					</span>
					<span class="relative h-3 flex-1 rounded bg-muted/40">
						<span
							class="absolute top-0 h-3 rounded {active ? 'bg-primary' : 'bg-primary/55'}"
							style="left:{barLeft(s)}%;width:{barWidth(s)}%"
						></span>
					</span>
					<span class="w-14 shrink-0 text-right text-muted-foreground tabular-nums">
						{fmtDur(s.durationMs)}
					</span>
				</button>
			{/each}
		</div>

		<!-- Selected span detail -->
		{#if selected && detail}
			<div class="space-y-3 rounded-xl border p-4">
				<div>
					<div class="flex items-center gap-2">
						<h3 class="font-mono text-sm font-semibold break-all">{selected.name}</h3>
						{#if detail.kind}<Badge variant="outline">{detail.kind}</Badge>{/if}
					</div>
					<div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
						<span>{fmtDur(selected.durationMs)}</span>
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
</div>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import TraceConversation from '$lib/components/trace-conversation.svelte';
	import { formatUsd, formatTokens } from '$lib/format';
	import { eventTone, toneDot, toneText } from '$lib/events';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Waypoints from '@lucide/svelte/icons/waypoints';

	let { data } = $props();
	const calls = $derived(data.calls);

	const endMs = (c: (typeof calls)[number]) => new Date(c.createdAt).getTime();
	const startMs = (c: (typeof calls)[number]) => endMs(c) - (c.latencyMs ?? 0);
	const windowStart = $derived(Math.min(...calls.map(startMs)));
	const windowEnd = $derived(Math.max(...calls.map(endMs)));
	const windowDur = $derived(Math.max(1, windowEnd - windowStart));
	const barLeft = (c: (typeof calls)[number]) => ((startMs(c) - windowStart) / windowDur) * 100;
	const barWidth = (c: (typeof calls)[number]) => Math.max(1.5, ((c.latencyMs ?? 0) / windowDur) * 100);

	const fmtMs = (ms: number | null | undefined) =>
		ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
	const callLabel = (c: (typeof calls)[number]) =>
		c.model || c.action?.replace(/^gateway\./, '') || 'request';

	const totalCost = $derived(calls.reduce((sum, c) => sum + Number(c.costUsd ?? 0), 0));
	const totalIn = $derived(calls.reduce((sum, c) => sum + (c.inputTokens ?? 0), 0));
	const totalOut = $derived(calls.reduce((sum, c) => sum + (c.outputTokens ?? 0), 0));
	const serviceName = $derived(calls.find((c) => c.serviceName)?.serviceName ?? null);
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<a
		href={resolve('/app/traces')}
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
	>
		<ArrowLeft class="size-4" /> Back to traces
	</a>

	<!-- Header -->
	<div class="space-y-3">
		<div class="flex flex-wrap items-center gap-3">
			<Waypoints class="size-5 text-muted-foreground" />
			<h2 class="text-lg font-semibold tracking-tight">Session</h2>
			<Badge variant="secondary">{calls.length} calls</Badge>
			<span class="font-mono text-xs text-muted-foreground">{data.groupId}</span>
		</div>
		<div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
			<div>
				<div class="text-xs text-muted-foreground">Service</div>
				<div class="truncate">{serviceName ?? '—'}</div>
			</div>
			<div>
				<div class="text-xs text-muted-foreground">Tokens (in → out)</div>
				<div class="tabular-nums">{formatTokens(totalIn)} → {formatTokens(totalOut)}</div>
			</div>
			<div>
				<div class="text-xs text-muted-foreground">Total cost</div>
				<div class="tabular-nums">{totalCost ? formatUsd(totalCost) : '—'}</div>
			</div>
			<div>
				<div class="text-xs text-muted-foreground">Duration</div>
				<div class="tabular-nums">{fmtMs(windowEnd - windowStart)}</div>
			</div>
		</div>
	</div>

	<!-- Waterfall — rows jump to each call's section below -->
	<div class="overflow-hidden rounded-xl border text-xs">
		<div class="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
			<Waypoints class="size-3.5 text-muted-foreground" />
			<span class="font-medium">Timeline</span>
			<span class="ml-auto tabular-nums text-muted-foreground">{fmtMs(windowEnd - windowStart)}</span>
		</div>
		{#each calls as c, i (c.id)}
			{@const tone = eventTone(c.status)}
			<a
				href={`#call-${c.id}`}
				class="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
			>
				<span class="flex w-44 shrink-0 items-center gap-2 truncate pl-4">
					<span class="text-muted-foreground tabular-nums">{i + 1}.</span>
					<span class="size-1.5 shrink-0 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
					<span class="truncate font-mono text-muted-foreground">{callLabel(c)}</span>
				</span>
				<span class="relative h-3 flex-1 rounded bg-muted/40">
					<span
						class="absolute top-0 h-3 rounded bg-primary/60"
						style="left:{barLeft(c)}%;width:{barWidth(c)}%"
					></span>
				</span>
				<span class="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
					{fmtMs(c.latencyMs)}
				</span>
			</a>
		{/each}
	</div>

	<!-- Every call's conversation, stitched in order -->
	{#each calls as c, i (c.id)}
		{@const tone = eventTone(c.status)}
		<section id={`call-${c.id}`} class="scroll-mt-20 space-y-3">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-4">
				<span class="text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}.</span>
				<span class="font-mono text-sm font-semibold">{callLabel(c)}</span>
				<span class="flex items-center gap-1.5">
					<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
					<span class="text-xs font-medium {toneText[tone]}">
						{c.status}{c.statusCode ? ` ${c.statusCode}` : ''}
					</span>
				</span>
				{#if c.provider}<Badge variant="secondary">{c.provider}</Badge>{/if}
				<span class="ml-auto flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
					<span>{formatTokens(c.inputTokens)} → {formatTokens(c.outputTokens)}</span>
					{#if c.costUsd}<span>{formatUsd(c.costUsd)}</span>{/if}
					<span>{fmtMs(c.latencyMs)}</span>
					<a
						href={resolve('/app/traces/[id]', { id: c.id })}
						class="underline hover:text-foreground"
					>
						details
					</a>
				</span>
			</div>
			<TraceConversation requestBody={c.requestBody} responseBody={c.responseBody} format={c.format} />
		</section>
	{/each}

	<p class="text-xs text-muted-foreground">
		The full run, one section per gateway call (oldest first). Open a call's
		<em>details</em> for its raw request/response.
	</p>
</div>

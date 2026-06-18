<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import TraceConversation from '$lib/components/trace-conversation.svelte';
	import { formatUsd, formatTokens, formatDateTime } from '$lib/format';
	import { eventTone, toneDot, toneText } from '$lib/events';
	import { prettyJson } from '$lib/trace';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';

	let { data } = $props();
	const calls = $derived(data.calls);

	// 'explore' = two-pane inspector; 'transcript' = whole run on one page.
	let mode = $state<'explore' | 'transcript'>('explore');

	// inline selection — no page reloads. Default to the last call (the final answer).
	let selectedId = $state<string | null>(null);
	const selected = $derived(calls.find((c) => c.id === selectedId) ?? calls[calls.length - 1]);

	type Call = (typeof calls)[number];
	const endMs = (c: Call) => new Date(c.createdAt).getTime();
	const startMs = (c: Call) => endMs(c) - (c.latencyMs ?? 0);
	const windowStart = $derived(Math.min(...calls.map(startMs)));
	const windowEnd = $derived(Math.max(...calls.map(endMs)));
	const windowDur = $derived(Math.max(1, windowEnd - windowStart));
	const barLeft = (c: Call) => ((startMs(c) - windowStart) / windowDur) * 100;
	const barWidth = (c: Call) => Math.max(2, ((c.latencyMs ?? 0) / windowDur) * 100);

	const fmtMs = (ms: number | null | undefined) =>
		ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
	const callLabel = (c: Call) => c.model || c.action?.replace(/^gateway\./, '') || 'request';

	const totalCost = $derived(calls.reduce((s, c) => s + Number(c.costUsd ?? 0), 0));
	const totalIn = $derived(calls.reduce((s, c) => s + (c.inputTokens ?? 0), 0));
	const totalOut = $derived(calls.reduce((s, c) => s + (c.outputTokens ?? 0), 0));
	const serviceName = $derived(calls.find((c) => c.serviceName)?.serviceName ?? null);

	let rawTab = $state('request');
	const rawRequest = $derived(prettyJson(selected?.requestBody));
	const rawResponse = $derived(
		selected?.format === 'sse' ? (selected?.responseBody ?? '') : prettyJson(selected?.responseBody)
	);

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | undefined;
	function copyRaw() {
		const text = rawTab === 'request' ? rawRequest : rawResponse;
		if (!text) return;
		navigator.clipboard.writeText(text);
		copied = true;
		clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 1200);
	}
</script>

<div class="mx-auto max-w-6xl space-y-5">
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
		<div class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
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

	<!-- View toggle: inspect call-by-call, or read the whole run -->
	<div class="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs font-medium">
		<button
			type="button"
			onclick={() => (mode = 'explore')}
			class="rounded-md px-3 py-1.5 transition-colors {mode === 'explore'
				? 'bg-background shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
		>
			Explore
		</button>
		<button
			type="button"
			onclick={() => (mode = 'transcript')}
			class="rounded-md px-3 py-1.5 transition-colors {mode === 'transcript'
				? 'bg-background shadow-sm'
				: 'text-muted-foreground hover:text-foreground'}"
		>
			Full transcript
		</button>
	</div>

	{#if mode === 'transcript'}
		<!-- Whole run, every call's conversation stitched top-to-bottom -->
		<div class="space-y-4">
			{#each calls as c, i (c.id)}
				{@const tone = eventTone(c.status)}
				<section class="space-y-3">
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
						</span>
					</div>
					<TraceConversation
						requestBody={c.requestBody}
						responseBody={c.responseBody}
						format={c.format}
					/>
				</section>
			{/each}
			<p class="text-xs text-muted-foreground">
				The full run, one section per gateway call (oldest first). Switch to
				<strong>Explore</strong> to inspect a single call with its raw payloads.
			</p>
		</div>
	{:else}
	<div class="grid gap-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
		<!-- Left: call list / waterfall (sticky) -->
		<div class="lg:sticky lg:top-20 lg:self-start">
			<div class="overflow-hidden rounded-xl border text-xs">
				<div class="border-b bg-muted/40 px-3 py-2 font-medium">Calls</div>
				{#each calls as c, i (c.id)}
					{@const active = selected?.id === c.id}
					{@const tone = eventTone(c.status)}
					<button
						type="button"
						onclick={() => (selectedId = c.id)}
						class="flex w-full flex-col gap-1.5 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50 {active
							? 'bg-muted/60'
							: ''}"
					>
						<span class="flex items-center gap-2">
							<span class="text-muted-foreground tabular-nums">{i + 1}.</span>
							<span class="size-1.5 shrink-0 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
							<span
								class="truncate font-mono {active
									? 'font-semibold text-foreground'
									: 'text-muted-foreground'}"
							>
								{callLabel(c)}
							</span>
							<span class="ml-auto shrink-0 tabular-nums text-muted-foreground">
								{fmtMs(c.latencyMs)}
							</span>
						</span>
						<span class="relative h-1.5 w-full rounded bg-muted/50">
							<span
								class="absolute top-0 h-1.5 rounded {active ? 'bg-primary' : 'bg-primary/55'}"
								style="left:{barLeft(c)}%;width:{barWidth(c)}%"
							></span>
						</span>
					</button>
				{/each}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">
				Each row is one gateway call sharing this session id. Select one to inspect it.
			</p>
		</div>

		<!-- Right: selected call detail -->
		{#if selected}
			{@const tone = eventTone(selected.status)}
			<div class="min-w-0 space-y-4">
				<div class="space-y-1">
					<div class="flex flex-wrap items-center gap-3">
						<h3 class="font-mono text-base font-semibold">{callLabel(selected)}</h3>
						<span class="flex items-center gap-1.5">
							<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
							<span class="text-xs font-medium {toneText[tone]}">
								{selected.status}{selected.statusCode ? ` ${selected.statusCode}` : ''}
							</span>
						</span>
						{#if selected.provider}<Badge variant="secondary">{selected.provider}</Badge>{/if}
						{#if selected.format === 'sse'}<Badge variant="outline">streamed</Badge>{/if}
						<a
							href={resolve('/app/traces/[id]', { id: selected.id })}
							class="ml-auto text-xs font-medium text-primary hover:underline"
						>
							Open call →
						</a>
					</div>
					<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
						<span>{formatTokens(selected.inputTokens)} → {formatTokens(selected.outputTokens)} tok</span>
						{#if selected.costUsd}<span>{formatUsd(selected.costUsd)}</span>{/if}
						<span>{fmtMs(selected.latencyMs)}</span>
						<span>{formatDateTime(selected.createdAt)}</span>
						{#if selected.detail}<span>· {selected.detail}</span>{/if}
					</div>
				</div>

				<TraceConversation
					requestBody={selected.requestBody}
					responseBody={selected.responseBody}
					format={selected.format}
				/>

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h4 class="text-sm font-semibold">Raw payloads</h4>
						<Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" onclick={copyRaw}>
							{#if copied}<Check class="size-3.5" /> Copied{:else}<Copy class="size-3.5" /> Copy{/if}
						</Button>
					</div>
					<Tabs.Root bind:value={rawTab}>
						<Tabs.List>
							<Tabs.Trigger value="request">Request</Tabs.Trigger>
							<Tabs.Trigger value="response">Response</Tabs.Trigger>
						</Tabs.List>
						<Tabs.Content value="request">
							{#if rawRequest}
								<pre
									class="max-h-[24rem] overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">{rawRequest}</pre>
							{:else}
								<p class="text-sm text-muted-foreground">No request body was captured.</p>
							{/if}
						</Tabs.Content>
						<Tabs.Content value="response">
							{#if rawResponse}
								<pre
									class="max-h-[24rem] overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">{rawResponse}</pre>
							{:else}
								<p class="text-sm text-muted-foreground">No response body was captured.</p>
							{/if}
						</Tabs.Content>
					</Tabs.Root>
				</div>
			</div>
		{/if}
	</div>
	{/if}
</div>

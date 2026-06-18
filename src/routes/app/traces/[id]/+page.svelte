<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatDateTime, formatUsd, formatTokens } from '$lib/format';
	import { eventTone, toneDot, toneText } from '$lib/events';
	import { requestMessages, responseMessage, prettyJson } from '$lib/trace';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Waypoints from '@lucide/svelte/icons/waypoints';

	let { data } = $props();
	const t = $derived(data.trace);

	const messages = $derived(requestMessages(t.requestBody));
	const reply = $derived(responseMessage(t.responseBody, t.format));
	// the assistant reply is just another message in the transcript, appended
	// after the prompt when it carries text or tool calls.
	const conversation = $derived(
		reply.text || reply.toolCalls ? [...messages, reply] : messages
	);
	const tone = $derived(eventTone(t.status));

	const rawRequest = $derived(prettyJson(t.requestBody));
	const rawResponse = $derived(t.format === 'sse' ? (t.responseBody ?? '') : prettyJson(t.responseBody));

	// Role → label + accent, so the conversation reads like a chat transcript.
	const roleMeta: Record<string, { label: string; accent: string }> = {
		system: { label: 'System', accent: 'border-l-amber-500' },
		developer: { label: 'Developer', accent: 'border-l-amber-500' },
		user: { label: 'User', accent: 'border-l-sky-500' },
		assistant: { label: 'Assistant', accent: 'border-l-emerald-500' },
		model: { label: 'Model', accent: 'border-l-emerald-500' },
		tool: { label: 'Tool', accent: 'border-l-violet-500' }
	};
	const meta = (role: string) =>
		roleMeta[role] ?? { label: role, accent: 'border-l-muted-foreground/40' };

	// ---- Session tree / waterfall ------------------------------------------------
	// The proxy observes each call as a flat span; we lay them on a shared time
	// axis (end = createdAt, start = end − latency) to read like a trace waterfall.
	type Span = (typeof data.group)[number];
	const spans = $derived(data.group ?? []);
	const showSession = $derived(spans.length > 1);

	const endMs = (s: Span) => new Date(s.createdAt).getTime();
	const startMs = (s: Span) => endMs(s) - (s.latencyMs ?? 0);
	const windowStart = $derived(showSession ? Math.min(...spans.map(startMs)) : 0);
	const windowEnd = $derived(showSession ? Math.max(...spans.map(endMs)) : 0);
	const windowDur = $derived(Math.max(1, windowEnd - windowStart));

	const barLeft = (s: Span) => ((startMs(s) - windowStart) / windowDur) * 100;
	const barWidth = (s: Span) => Math.max(1.5, ((s.latencyMs ?? 0) / windowDur) * 100);

	const fmtMs = (ms: number | null | undefined) =>
		ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
	const spanLabel = (s: Span) => s.model || s.action?.replace(/^gateway\./, '') || 'request';
</script>

<div class="mx-auto max-w-4xl space-y-6">
	<a
		href={resolve('/app/traces')}
		class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
	>
		<ArrowLeft class="size-4" /> Back to traces
	</a>

	<!-- Header / metadata -->
	<div class="space-y-3">
		<div class="flex flex-wrap items-center gap-3">
			<Waypoints class="size-5 text-muted-foreground" />
			<h2 class="font-mono text-lg font-semibold tracking-tight">{t.model ?? 'request'}</h2>
			<span class="flex items-center gap-1.5">
				<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
				<span class="text-xs font-medium {toneText[tone]}">
					{t.status}{t.statusCode ? ` ${t.statusCode}` : ''}
				</span>
			</span>
			{#if t.provider}<Badge variant="secondary">{t.provider}</Badge>{/if}
			{#if t.format === 'sse'}<Badge variant="outline">streamed</Badge>{/if}
		</div>

		<div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
			<div>
				<div class="text-xs text-muted-foreground">Service</div>
				<div class="truncate">{t.serviceName ?? '—'}</div>
			</div>
			<div>
				<div class="text-xs text-muted-foreground">Tokens (in → out)</div>
				<div class="tabular-nums">{formatTokens(t.inputTokens)} → {formatTokens(t.outputTokens)}</div>
			</div>
			<div>
				<div class="text-xs text-muted-foreground">Cost</div>
				<div class="tabular-nums">{t.costUsd ? formatUsd(t.costUsd) : '—'}</div>
			</div>
			<div>
				<div class="text-xs text-muted-foreground">Latency</div>
				<div class="tabular-nums">{t.latencyMs != null ? `${t.latencyMs}ms` : '—'}</div>
			</div>
		</div>
		<div class="text-xs text-muted-foreground">
			{formatDateTime(t.createdAt)}{t.detail ? ` · ${t.detail}` : ''}
		</div>
	</div>

	<!-- Session tree / waterfall -->
	{#if showSession}
		<div class="space-y-2">
			<h3 class="text-sm font-semibold">Session</h3>
			<div class="overflow-hidden rounded-xl border text-xs">
				<!-- root span -->
				<div class="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
					<Waypoints class="size-3.5 text-muted-foreground" />
					<span class="font-medium">Session</span>
					<span class="truncate font-mono text-muted-foreground">{t.groupId}</span>
					<span class="ml-auto tabular-nums text-muted-foreground">{fmtMs(windowEnd - windowStart)}</span>
				</div>
				{#each spans as s (s.id)}
					{@const active = s.id === t.id}
					{@const stone = eventTone(s.status)}
					<a
						href={resolve('/app/traces/[id]', { id: s.id })}
						class="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/50 {active
							? 'bg-muted/60'
							: ''}"
					>
						<span class="flex w-44 shrink-0 items-center gap-2 truncate pl-4">
							<span class="size-1.5 shrink-0 rounded-full {toneDot[stone]}" aria-hidden="true"></span>
							<span
								class="truncate font-mono {active
									? 'font-semibold text-foreground'
									: 'text-muted-foreground'}"
							>
								{spanLabel(s)}
							</span>
						</span>
						<span class="relative h-3 flex-1 rounded bg-muted/40">
							<span
								class="absolute top-0 h-3 rounded {active ? 'bg-primary' : 'bg-primary/60'}"
								style="left:{barLeft(s)}%;width:{barWidth(s)}%"
							></span>
						</span>
						<span class="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
							{fmtMs(s.latencyMs)}
						</span>
					</a>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
				Calls sharing this <code>x-uprox-trace-id</code>. Each row is one gateway request on a shared
				time axis — select one to inspect it.
			</p>
		</div>
	{/if}

	<!-- Conversation -->
	<div class="space-y-3">
		<h3 class="text-sm font-semibold">Conversation</h3>
		{#if conversation.length === 0}
			<p class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
				No conversation could be parsed from this payload — see the raw view below.
			</p>
		{:else}
			{#each conversation as m, i (i)}
				{@const mm = meta(m.role)}
				<div class="rounded-lg border border-l-2 {mm.accent} bg-card p-3">
					<div class="mb-1 text-xs font-medium text-muted-foreground">{mm.label}</div>
					{#if m.text}
						<div class="text-sm whitespace-pre-wrap break-words">{m.text}</div>
					{/if}
					{#if m.toolCalls}
						{#each m.toolCalls as call, j (j)}
							<div class="mt-2 rounded-md bg-muted/60 p-2 font-mono text-xs break-words">
								<span class="font-medium text-foreground">{call.name}(</span>{call.args}<span
									class="font-medium text-foreground">)</span
								>
							</div>
						{/each}
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<!-- Raw payloads -->
	<div class="space-y-3">
		<h3 class="text-sm font-semibold">Raw payloads</h3>
		<Tabs.Root value="request">
			<Tabs.List>
				<Tabs.Trigger value="request">Request</Tabs.Trigger>
				<Tabs.Trigger value="response">Response</Tabs.Trigger>
			</Tabs.List>
			<Tabs.Content value="request">
				{#if rawRequest}
					<pre
						class="max-h-[28rem] overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">{rawRequest}</pre>
				{:else}
					<p class="text-sm text-muted-foreground">No request body was captured.</p>
				{/if}
			</Tabs.Content>
			<Tabs.Content value="response">
				{#if rawResponse}
					<pre
						class="max-h-[28rem] overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">{rawResponse}</pre>
				{:else}
					<p class="text-sm text-muted-foreground">
						No response body was captured (the request was rejected before reaching a provider).
					</p>
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	</div>
</div>

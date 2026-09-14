<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatDateTime, formatDuration, formatUsd, formatTokens } from '$lib/format';
	import { eventTone, toneDot, toneText } from '$lib/events';
	import { callSpan, callsWindow, prettyJson, rawResponseBody, waterfallBar } from '$lib/trace';
	import TraceConversation from '$lib/components/trace-conversation.svelte';
	import TraceMetadata from '$lib/components/trace-metadata.svelte';
	import TraceWaterfall from '$lib/components/trace-waterfall.svelte';
	import RawPayloadTabs from '$lib/components/raw-payload-tabs.svelte';
	import DetailHeader from '$lib/components/detail-header.svelte';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import PageShell from '$lib/components/page-shell.svelte';

	let { data } = $props();
	const t = $derived(data.trace);
	const tone = $derived(eventTone(t.status));

	const rawRequest = $derived(prettyJson(t.requestBody));
	const rawResponse = $derived(rawResponseBody(t.responseBody, t.format));

	// ---- Session tree / waterfall ------------------------------------------------
	// The proxy observes each call as a flat span; we lay them on a shared time
	// axis (end = createdAt, start = end − latency) to read like a trace waterfall.
	type Span = (typeof data.group)[number];
	const spans = $derived(data.group ?? []);
	const showSession = $derived(spans.length > 1);
	const win = $derived(callsWindow(showSession ? spans : []));

	const spanBar = (s: Span) => waterfallBar(callSpan(s).start, s.latencyMs ?? 0, win, 1.5);
	const spanLabel = (s: Span) => s.model || s.action?.replace(/^gateway\./, '') || 'request';
</script>

<PageShell width="default">
	<!-- Header / metadata -->
	<div class="space-y-3">
		<DetailHeader icon={Waypoints} eyebrow="Trace" title={t.model ?? 'request'} mono>
			{#snippet badges()}
				<span class="flex items-center gap-1.5">
					<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
					<span class="text-xs font-medium {toneText[tone]}">
						{t.status}{t.statusCode ? ` ${t.statusCode}` : ''}
					</span>
				</span>
				{#if t.provider}<Badge variant="secondary">{t.provider}</Badge>{/if}
				{#if t.format === 'sse'}<Badge variant="outline">streamed</Badge>{/if}
			{/snippet}
			{#snippet meta()}
				{formatDateTime(t.createdAt)}{t.detail ? ` · ${t.detail}` : ''}
			{/snippet}
		</DetailHeader>

		<div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
			<div>
				<div class="text-xs text-muted-foreground">Service</div>
				<div class="truncate">{t.serviceName ?? '—'}</div>
			</div>
			<div>
				<div class="text-xs text-muted-foreground">Tokens (in → out)</div>
				<div class="tabular-nums">
					{formatTokens(t.inputTokens)} → {formatTokens(t.outputTokens)}
				</div>
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
		<TraceMetadata metadata={t.metadata} />
	</div>

	<!-- Session tree / waterfall -->
	{#if showSession}
		<div class="space-y-2">
			<div class="flex items-center justify-between gap-2">
				<h3 class="text-sm font-semibold">Session</h3>
				{#if t.groupId}
					<a
						href={resolve('/app/traces/session/[groupId]', { groupId: t.groupId })}
						class="text-xs font-medium text-primary hover:underline"
					>
						View full session →
					</a>
				{/if}
			</div>
			<TraceWaterfall
				rows={spans}
				key={(s) => s.id}
				active={(s) => s.id === t.id}
				bar={spanBar}
				duration={(s) => formatDuration(s.latencyMs)}
				href={(s) => resolve('/app/traces/[id]', { id: s.id })}
				inactiveBarClass="bg-primary/60"
				durationClass="w-12"
			>
				{#snippet header()}
					<!-- root span -->
					<div class="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
						<Waypoints class="size-3.5 text-muted-foreground" />
						<span class="font-medium">Session</span>
						<span class="truncate font-mono text-muted-foreground">{t.groupId}</span>
						<span class="ml-auto text-muted-foreground tabular-nums"
							>{formatDuration(win.end - win.start)}</span
						>
					</div>
				{/snippet}
				{#snippet label(s, active)}
					<span class="flex w-44 shrink-0 items-center gap-2 truncate pl-4">
						<span
							class="size-1.5 shrink-0 rounded-full {toneDot[eventTone(s.status)]}"
							aria-hidden="true"
						></span>
						<span
							class="truncate font-mono {active
								? 'font-semibold text-foreground'
								: 'text-muted-foreground'}"
						>
							{spanLabel(s)}
						</span>
					</span>
				{/snippet}
			</TraceWaterfall>
			<p class="text-xs text-muted-foreground">
				This call is one of several sharing a session id. The waterfall lays them on a shared time
				axis — open a row to inspect it, or
				<strong>View full session</strong> to read the whole run on one page.
			</p>
		</div>
	{/if}

	<!-- Conversation (this call only; the full run is on the session page) -->
	<div class="space-y-3">
		<h3 class="text-sm font-semibold">Conversation</h3>
		<TraceConversation
			requestBody={t.requestBody}
			responseBody={t.responseBody}
			format={t.format}
		/>
	</div>

	<!-- Raw payloads -->
	<div class="space-y-3">
		<h3 class="text-sm font-semibold">Raw payloads</h3>
		<RawPayloadTabs
			request={rawRequest}
			response={rawResponse}
			emptyResponse="No response body was captured (the request was rejected before reaching a provider)."
		/>
	</div>
</PageShell>

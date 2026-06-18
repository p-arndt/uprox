<script lang="ts">
	import { resolve } from '$app/paths';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatDateTime, formatUsd, formatTokens } from '$lib/format';
	import { eventTone, toneDot, toneText } from '$lib/events';
	import { requestMessages, responseText, prettyJson } from '$lib/trace';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Waypoints from '@lucide/svelte/icons/waypoints';

	let { data } = $props();
	const t = $derived(data.trace);

	const messages = $derived(requestMessages(t.requestBody));
	const reply = $derived(responseText(t.responseBody, t.format));
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

	<!-- Conversation -->
	<div class="space-y-3">
		<h3 class="text-sm font-semibold">Conversation</h3>
		{#if messages.length === 0 && !reply}
			<p class="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
				No conversation could be parsed from this payload — see the raw view below.
			</p>
		{:else}
			{#each messages as m, i (i)}
				{@const mm = meta(m.role)}
				<div class="rounded-lg border border-l-2 {mm.accent} bg-card p-3">
					<div class="mb-1 text-xs font-medium text-muted-foreground">{mm.label}</div>
					{#if m.text}
						<div class="text-sm whitespace-pre-wrap break-words">{m.text}</div>
					{/if}
					{#if m.toolCalls}
						{#each m.toolCalls as call (call.name)}
							<div class="mt-2 rounded-md bg-muted/60 p-2 font-mono text-xs">
								<span class="font-medium">{call.name}(</span>{call.args}<span class="font-medium"
									>)</span
								>
							</div>
						{/each}
					{/if}
				</div>
			{/each}
			{#if reply}
				{@const mm = meta('assistant')}
				<div class="rounded-lg border border-l-2 {mm.accent} bg-card p-3">
					<div class="mb-1 text-xs font-medium text-muted-foreground">{mm.label}</div>
					<div class="text-sm whitespace-pre-wrap break-words">{reply}</div>
				</div>
			{/if}
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

<script lang="ts">
	import { resolve } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import TraceConversation from '$lib/features/traces/components/trace-conversation.svelte';
	import TraceMetadata from '$lib/features/traces/components/trace-metadata.svelte';
	import RawPayloadTabs from '$lib/features/traces/components/raw-payload-tabs.svelte';
	import { formatDateTime, formatDuration, formatTokens, formatUsd } from '$lib/format';
	import { prettyJson, rawResponseBody } from '$lib/features/traces/trace';
	import Copy from '@lucide/svelte/icons/copy';
	import Check from '@lucide/svelte/icons/check';
	import CallStatus from '../../call-status.svelte';
	import { callLabel } from './session';
	import type { PageData } from './$types';

	// The selected call of a session: headline, conversation and raw payloads.

	let { call }: { call: PageData['calls'][number] } = $props();

	let rawTab = $state('request');
	const rawRequest = $derived(prettyJson(call.requestBody));
	const rawResponse = $derived(rawResponseBody(call.responseBody, call.format));

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

<div class="min-w-0 space-y-4">
	<div class="space-y-1">
		<div class="flex flex-wrap items-center gap-3">
			<h3 class="font-mono text-base font-semibold">{callLabel(call)}</h3>
			<CallStatus status={call.status} statusCode={call.statusCode} />
			{#if call.provider}<Badge variant="secondary">{call.provider}</Badge>{/if}
			{#if call.format === 'sse'}<Badge variant="outline">streamed</Badge>{/if}
			<a
				href={resolve('/app/traces/[id]', { id: call.id })}
				class="ml-auto text-xs font-medium text-primary hover:underline"
			>
				Open call →
			</a>
		</div>
		<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
			<span>{formatTokens(call.inputTokens)} → {formatTokens(call.outputTokens)} tok</span>
			{#if call.costUsd}<span>{formatUsd(call.costUsd)}</span>{/if}
			<span>{formatDuration(call.latencyMs)}</span>
			<span>{formatDateTime(call.createdAt)}</span>
			{#if call.detail}<span>· {call.detail}</span>{/if}
		</div>
		<TraceMetadata metadata={call.metadata} />
	</div>

	<TraceConversation
		requestBody={call.requestBody}
		responseBody={call.responseBody}
		format={call.format}
	/>

	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<h4 class="text-sm font-semibold">Raw payloads</h4>
			<Button variant="ghost" size="sm" class="h-7 gap-1.5 text-xs" onclick={copyRaw}>
				{#if copied}<Check class="size-3.5" /> Copied{:else}<Copy class="size-3.5" /> Copy{/if}
			</Button>
		</div>
		<RawPayloadTabs
			request={rawRequest}
			response={rawResponse}
			preClass="max-h-[24rem]"
			bind:value={rawTab}
		/>
	</div>
</div>

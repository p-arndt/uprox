<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import TraceConversation from '$lib/features/traces/components/trace-conversation.svelte';
	import { formatDuration, formatTokens, formatUsd } from '$lib/format';
	import CallStatus from '../../call-status.svelte';
	import { callLabel } from './session';
	import type { PageData } from './$types';

	// The whole run, every call's conversation stitched top-to-bottom.

	let { calls }: { calls: PageData['calls'] } = $props();
</script>

<div class="space-y-4">
	{#each calls as c, i (c.id)}
		<section class="space-y-3">
			<div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-4">
				<span class="text-sm font-semibold text-muted-foreground tabular-nums">{i + 1}.</span>
				<span class="font-mono text-sm font-semibold">{callLabel(c)}</span>
				<CallStatus status={c.status} statusCode={c.statusCode} />
				{#if c.provider}<Badge variant="secondary">{c.provider}</Badge>{/if}
				<span class="ml-auto flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
					<span>{formatTokens(c.inputTokens)} → {formatTokens(c.outputTokens)}</span>
					{#if c.costUsd}<span>{formatUsd(c.costUsd)}</span>{/if}
					<span>{formatDuration(c.latencyMs)}</span>
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

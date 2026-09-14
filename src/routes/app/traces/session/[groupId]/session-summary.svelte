<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import DetailHeader from '$lib/components/detail-header.svelte';
	import { formatDuration, formatTokens, formatUsd } from '$lib/format';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import SummaryStat from '../../summary-stat.svelte';
	import { sessionTotals } from './session';
	import type { PageData } from './$types';

	// The session page header: call count, id and the run's totals.

	let {
		calls,
		groupId,
		durationMs
	}: {
		calls: PageData['calls'];
		groupId: string;
		/** wall-clock span from the first call's start to the last call's end */
		durationMs: number;
	} = $props();

	const totals = $derived(sessionTotals(calls));
</script>

<div class="space-y-3">
	<DetailHeader icon={Waypoints} eyebrow="Trace" title="Session">
		{#snippet badges()}
			<Badge variant="secondary">{calls.length} calls</Badge>
			<span class="font-mono text-xs text-muted-foreground">{groupId}</span>
		{/snippet}
	</DetailHeader>
	<div class="flex flex-wrap gap-x-8 gap-y-2 text-sm">
		<SummaryStat label="Service" class="truncate">{totals.serviceName ?? '—'}</SummaryStat>
		<SummaryStat label="Tokens (in → out)" class="tabular-nums">
			{formatTokens(totals.tokensIn)} → {formatTokens(totals.tokensOut)}
		</SummaryStat>
		<SummaryStat label="Total cost" class="tabular-nums">
			{totals.cost ? formatUsd(totals.cost) : '—'}
		</SummaryStat>
		<SummaryStat label="Duration" class="tabular-nums">{formatDuration(durationMs)}</SummaryStat>
	</div>
</div>

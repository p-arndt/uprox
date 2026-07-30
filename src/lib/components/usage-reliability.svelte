<script lang="ts">
	import { formatCount } from '$lib/format';
	import * as Card from '$lib/components/ui/card/index.js';
	import type { UsageTotals } from '$lib/server/data';

	let { totals }: { totals: UsageTotals } = $props();

	const errorRate = $derived(totals.requests > 0 ? totals.errors / totals.requests : 0);

	function formatMs(ms: number | null): string {
		if (ms == null) return '—';
		return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms} ms`;
	}
</script>

<Card.Root>
	<Card.Content class="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
		<div>
			<div class="text-xs text-muted-foreground">Error rate</div>
			<div class="text-xl font-semibold tabular-nums">{(errorRate * 100).toFixed(1)}%</div>
			<p class="text-xs text-muted-foreground tabular-nums">
				{formatCount(totals.errors)} of {formatCount(totals.requests)}
			</p>
		</div>
		<div>
			<div class="text-xs text-muted-foreground">Denied</div>
			<div class="text-xl font-semibold tabular-nums">{formatCount(totals.denied)}</div>
			<p class="text-xs text-muted-foreground">blocked by policy or budget</p>
		</div>
		<div>
			<div class="text-xs text-muted-foreground">Latency p50</div>
			<div class="text-xl font-semibold tabular-nums">{formatMs(totals.latencyP50)}</div>
			<p class="text-xs text-muted-foreground">median upstream round-trip</p>
		</div>
		<div>
			<div class="text-xs text-muted-foreground">Latency p95</div>
			<div class="text-xl font-semibold tabular-nums">{formatMs(totals.latencyP95)}</div>
			<p class="text-xs text-muted-foreground">95th percentile</p>
		</div>
	</Card.Content>
</Card.Root>

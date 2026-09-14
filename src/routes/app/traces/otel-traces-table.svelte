<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import * as Table from '$lib/components/ui/table/index.js';
	import { formatDateTime, formatDuration, relativeTime } from '$lib/format';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Network from '@lucide/svelte/icons/network';
	import type { PageData } from './$types';

	// Distributed traces ingested over OTLP, each row opening its span tree.

	let { traces }: { traces: PageData['otelTraces'] } = $props();
</script>

<div class="space-y-2">
	<h3 class="flex items-center gap-2 text-sm font-semibold">
		<Network class="size-4 text-muted-foreground" /> Distributed traces
	</h3>
	<p class="text-xs text-muted-foreground">
		Full span trees ingested from your apps via OpenTelemetry (<code>POST /v1/traces</code>).
	</p>
	<div class="overflow-hidden rounded-xl border">
		<Table.Root>
			<Table.Header>
				<Table.Row class="hover:bg-transparent">
					<Table.Head class="bg-muted/40">Time</Table.Head>
					<Table.Head class="bg-muted/40">Trace</Table.Head>
					<Table.Head class="bg-muted/40">Service</Table.Head>
					<Table.Head class="bg-muted/40 text-right">Spans</Table.Head>
					<Table.Head class="bg-muted/40 text-right">Duration</Table.Head>
					<Table.Head class="bg-muted/40"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each traces as tr (tr.traceId)}
					<Table.Row
						class="group cursor-pointer"
						onclick={() => goto(resolve('/app/traces/otel/[traceId]', { traceId: tr.traceId }))}
					>
						<Table.Cell class="whitespace-nowrap text-muted-foreground">
							<span class="text-xs" title={formatDateTime(tr.startedAt)}>
								{relativeTime(tr.startedAt)}
							</span>
						</Table.Cell>
						<Table.Cell>
							<span class="flex items-center gap-1.5">
								{#if tr.errorCount > 0}
									<span class="size-1.5 rounded-full bg-destructive" aria-hidden="true"></span>
								{/if}
								<span class="font-mono text-xs">{tr.rootName}</span>
							</span>
						</Table.Cell>
						<Table.Cell class="text-muted-foreground">{tr.serviceName ?? '—'}</Table.Cell>
						<Table.Cell class="text-right text-muted-foreground tabular-nums">
							{tr.spanCount}
						</Table.Cell>
						<Table.Cell class="text-right text-muted-foreground tabular-nums">
							{formatDuration(tr.durationMs)}
						</Table.Cell>
						<Table.Cell class="text-right">
							<ArrowRight
								class="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
							/>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</div>

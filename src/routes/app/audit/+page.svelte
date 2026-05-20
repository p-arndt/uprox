<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { formatDateTime, formatUsd } from '$lib/format';
	import ScrollText from '@lucide/svelte/icons/scroll-text';

	let { data } = $props();

	function statusVariant(s: string): 'secondary' | 'destructive' | 'outline' {
		if (s === 'deny' || s === 'error') return 'destructive';
		if (s === 'ok' || s === 'allow') return 'secondary';
		return 'outline';
	}
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<h2 class="text-xl font-semibold tracking-tight">Audit Log</h2>
		<p class="text-sm text-muted-foreground">
			Append-only record of gateway requests and administrative actions.
		</p>
	</div>

	{#if data.entries.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<ScrollText class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">No events yet</p>
			<p class="text-sm text-muted-foreground">Activity will appear here as it happens.</p>
		</div>
	{:else}
		<div class="rounded-xl border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Time</Table.Head>
						<Table.Head>Action</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Service</Table.Head>
						<Table.Head>Model</Table.Head>
						<Table.Head class="text-right">Cost</Table.Head>
						<Table.Head class="text-right">Latency</Table.Head>
						<Table.Head>Detail</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.entries as e (e.id)}
						<Table.Row>
							<Table.Cell class="text-xs whitespace-nowrap text-muted-foreground">
								{formatDateTime(e.createdAt)}
							</Table.Cell>
							<Table.Cell class="font-medium">{e.action}</Table.Cell>
							<Table.Cell>
								<Badge variant={statusVariant(e.status)}>
									{e.status}{e.statusCode ? ` ${e.statusCode}` : ''}
								</Badge>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{e.serviceName ?? '—'}</Table.Cell>
							<Table.Cell class="text-muted-foreground">{e.model ?? '—'}</Table.Cell>
							<Table.Cell class="text-right text-muted-foreground tabular-nums">
								{e.costUsd ? formatUsd(e.costUsd) : '—'}
							</Table.Cell>
							<Table.Cell class="text-right text-muted-foreground tabular-nums">
								{e.latencyMs != null ? `${e.latencyMs}ms` : '—'}
							</Table.Cell>
							<Table.Cell class="max-w-[240px] truncate text-xs text-muted-foreground">
								{e.detail ?? ''}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{/if}
</div>

<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import * as Table from '$lib/components/ui/table/index.js';
	import { formatDateTime, relativeTime, formatUsd, formatTokens } from '$lib/format';
	import { toneDot, toneText, type EventTone } from '$lib/events';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Layers from '@lucide/svelte/icons/layers';
	import type { PageData } from './$types';

	// One row of the gateway-call feed: either a clustered session or a single call.

	let { item, tone }: { item: PageData['feed'][number]; tone: EventTone } = $props();

	const shortId = (s: string) => (s.length > 14 ? `${s.slice(0, 10)}…` : s);

	const href = $derived(
		item.kind === 'session'
			? resolve('/app/traces/session/[groupId]', { groupId: item.groupId ?? '' })
			: resolve('/app/traces/[id]', { id: item.id })
	);
</script>

<Table.Row class="group cursor-pointer" onclick={() => goto(href)}>
	<Table.Cell class="whitespace-nowrap text-muted-foreground">
		<span class="block text-xs" title={formatDateTime(item.at)}>{relativeTime(item.at)}</span>
		<span class="block text-[10px] text-muted-foreground/60">
			{formatDateTime(item.at)}
		</span>
	</Table.Cell>
	{#if item.kind === 'session'}
		<Table.Cell>
			<span class="flex items-center gap-1.5 whitespace-nowrap">
				<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
				<span class="flex items-center gap-1 text-xs font-medium {toneText[tone]}">
					<Layers class="size-3" /> session
				</span>
				<span class="text-xs text-muted-foreground">· {item.calls} calls</span>
			</span>
		</Table.Cell>
		<Table.Cell class="font-mono text-xs text-muted-foreground">
			<span title={item.groupId ?? ''}>{item.groupId ? shortId(item.groupId) : '—'}</span>
		</Table.Cell>
		<Table.Cell class="text-muted-foreground">{item.serviceName ?? '—'}</Table.Cell>
		<Table.Cell class="max-w-[220px]">
			<span class="block truncate font-mono text-xs text-muted-foreground">
				{(item.models ?? []).join(', ') || '—'}
			</span>
		</Table.Cell>
		<Table.Cell class="text-right text-muted-foreground tabular-nums">
			{formatTokens(item.inputTokens)} → {formatTokens(item.outputTokens)}
		</Table.Cell>
		<Table.Cell class="text-right text-muted-foreground tabular-nums">
			{Number(item.costUsd) ? formatUsd(item.costUsd) : '—'}
		</Table.Cell>
		<Table.Cell class="text-right text-muted-foreground tabular-nums">—</Table.Cell>
	{:else}
		<Table.Cell>
			<span class="flex items-center gap-1.5 whitespace-nowrap">
				<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
				<span class="text-xs font-medium {toneText[tone]}">
					{item.status}{item.statusCode ? ` ${item.statusCode}` : ''}
				</span>
			</span>
		</Table.Cell>
		<Table.Cell class="font-mono text-xs text-muted-foreground">
			<span title={item.id}>{shortId(item.id)}</span>
		</Table.Cell>
		<Table.Cell class="text-muted-foreground">{item.serviceName ?? '—'}</Table.Cell>
		<Table.Cell class="font-mono text-xs text-muted-foreground">{item.model ?? '—'}</Table.Cell>
		<Table.Cell class="text-right text-muted-foreground tabular-nums">
			{#if item.inputTokens != null || item.outputTokens != null}
				{formatTokens(item.inputTokens)} → {formatTokens(item.outputTokens)}
			{:else}
				—
			{/if}
		</Table.Cell>
		<Table.Cell class="text-right text-muted-foreground tabular-nums">
			{item.costUsd ? formatUsd(item.costUsd) : '—'}
		</Table.Cell>
		<Table.Cell class="text-right text-muted-foreground tabular-nums">
			{item.latencyMs != null ? `${item.latencyMs}ms` : '—'}
		</Table.Cell>
	{/if}
	<Table.Cell class="text-right">
		<ArrowRight
			class="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
		/>
	</Table.Cell>
</Table.Row>

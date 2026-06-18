<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { formatDateTime, relativeTime, formatUsd, formatTokens } from '$lib/format';
	import { eventTone, toneDot, toneText } from '$lib/events';
	import Waypoints from '@lucide/svelte/icons/waypoints';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
	import Filter from '@lucide/svelte/icons/filter';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Layers from '@lucide/svelte/icons/layers';
	import Network from '@lucide/svelte/icons/network';

	let { data } = $props();

	const fmtDur = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
	const shortId = (s: string) => (s.length > 14 ? `${s.slice(0, 10)}…` : s);

	let query = $state('');
	let status = $state('all');

	// metadata filter is server-side (jsonb), driven by the ?meta= URL param so it
	// also matches inside clustered sessions. Seeded from the active filter.
	let metaInput = $state(
		untrack(() =>
			data.metaFilter
				? data.metaFilter.value != null
					? `${data.metaFilter.key}:${data.metaFilter.value}`
					: data.metaFilter.key
				: ''
		)
	);
	const applyMeta = () => {
		const v = metaInput.trim();
		goto(
			v
				? (`${resolve('/app/traces')}?meta=${encodeURIComponent(v)}` as ResolvedPathname)
				: resolve('/app/traces')
		);
	};
	const clearMeta = () => {
		metaInput = '';
		goto(resolve('/app/traces'));
	};

	const statusOptions = [
		{ value: 'all', label: 'All statuses' },
		{ value: 'ok', label: 'Succeeded' },
		{ value: 'denied', label: 'Denied' },
		{ value: 'error', label: 'Errors' }
	];
	const statusLabel = $derived(statusOptions.find((o) => o.value === status)?.label ?? '');

	// the feed mixes clustered sessions and standalone calls (discriminated by `kind`)
	type FeedItem = (typeof data.feed)[number];
	const itemTone = (it: FeedItem) =>
		it.kind === 'session' ? (it.errorCount > 0 ? 'error' : 'ok') : eventTone(it.status);
	const itemHaystack = (it: FeedItem) =>
		(it.kind === 'session'
			? ['session', it.groupId, it.serviceName, ...(it.models ?? [])]
			: [
					it.action,
					it.status,
					it.model,
					it.serviceName,
					it.provider,
					it.detail,
					it.metadata ? JSON.stringify(it.metadata) : null
				]
		)
			.filter(Boolean)
			.join(' ')
			.toLowerCase();
	const itemKey = (it: FeedItem) => (it.kind === 'session' ? `g:${it.groupId}` : `c:${it.id}`);

	const filtered = $derived(
		data.feed.filter((it) => {
			const tone = itemTone(it);
			if (status === 'ok' && tone !== 'ok') return false;
			if (status === 'denied' && tone !== 'denied') return false;
			if (status === 'error' && tone !== 'error') return false;
			if (query.trim() && !itemHaystack(it).includes(query.trim().toLowerCase())) return false;
			return true;
		})
	);

	const hasFilters = $derived(query.trim() !== '' || status !== 'all');

	function reset() {
		query = '';
		status = 'all';
	}
</script>

<div class="mx-auto max-w-6xl space-y-6">
	<div>
		<h2 class="text-xl font-semibold tracking-tight">Traces</h2>
		<p class="text-sm text-muted-foreground">
			Captured request &amp; response payloads for gateway calls. Open a trace to inspect the
			prompt, the model's reply, and token usage.
		</p>
	</div>

	{#if data.metaFilter}
		<div class="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
			<Filter class="size-4 shrink-0 text-muted-foreground" />
			<span class="text-muted-foreground">Metadata filter</span>
			<span class="rounded-md border bg-background px-2 py-0.5 font-mono text-xs">
				{data.metaFilter.key}{data.metaFilter.value != null ? `: ${data.metaFilter.value}` : ''}
			</span>
			<button
				type="button"
				onclick={clearMeta}
				class="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<X class="size-3.5" /> Clear
			</button>
		</div>
	{/if}

	{#if data.otelTraces.length > 0}
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
						{#each data.otelTraces as tr (tr.traceId)}
							<Table.Row
								class="group cursor-pointer"
								onclick={() =>
									(window.location.href = resolve('/app/traces/otel/[traceId]', {
										traceId: tr.traceId
									}))}
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
									{fmtDur(tr.durationMs)}
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
	{/if}

	{#if !data.tracingEnabled && data.feed.length === 0 && data.otelTraces.length === 0}
		<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
			<Waypoints class="size-8 text-muted-foreground" />
			<p class="mt-3 text-sm font-medium">Tracing is off</p>
			<p class="max-w-sm text-center text-sm text-muted-foreground">
				Enable request tracing in Settings (or per policy) to start capturing prompts and responses
				here.
			</p>
			<Button href={resolve('/app/settings')} variant="outline" size="sm" class="mt-4">
				Go to Settings
			</Button>
		</div>
	{:else if data.feed.length === 0}
		{#if data.otelTraces.length === 0}
			<div class="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
				<Waypoints class="size-8 text-muted-foreground" />
				<p class="mt-3 text-sm font-medium">No traces yet</p>
				<p class="text-sm text-muted-foreground">
					Traced requests will appear here as they happen.
				</p>
			</div>
		{/if}
	{:else}
		<h3 class="text-sm font-semibold">Gateway calls</h3>
		<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
			<div class="relative flex-1">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input bind:value={query} placeholder="Search model, service, provider…" class="pl-9" />
			</div>
			<div class="relative sm:w-60">
				<Filter
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={metaInput}
					onkeydown={(e) => e.key === 'Enter' && applyMeta()}
					placeholder="metadata e.g. user_id:u_42"
					class="pl-9"
				/>
			</div>
			<Select.Root type="single" bind:value={status}>
				<Select.Trigger class="w-full sm:w-40">{statusLabel}</Select.Trigger>
				<Select.Content>
					{#each statusOptions as o (o.value)}
						<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			{#if hasFilters}
				<Button variant="ghost" size="sm" onclick={reset} class="shrink-0">
					<X class="size-4" /> Clear
				</Button>
			{/if}
		</div>

		<div class="flex items-center justify-between text-xs text-muted-foreground">
			<span>
				Showing <span class="font-medium text-foreground tabular-nums">{filtered.length}</span>
				of {data.feed.length} entries
			</span>
		</div>

		<div class="overflow-hidden rounded-xl border">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							<Table.Head class="bg-muted/40">Time</Table.Head>
							<Table.Head class="bg-muted/40">Status</Table.Head>
							<Table.Head class="bg-muted/40">ID</Table.Head>
							<Table.Head class="bg-muted/40">Service</Table.Head>
							<Table.Head class="bg-muted/40">Model</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Tokens</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Cost</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Latency</Table.Head>
							<Table.Head class="bg-muted/40"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filtered as it (itemKey(it))}
							{@const tone = itemTone(it)}
							{#if it.kind === 'session'}
								<Table.Row
									class="group cursor-pointer"
									onclick={() =>
										(window.location.href = resolve('/app/traces/session/[groupId]', {
											groupId: it.groupId ?? ''
										}))}
								>
									<Table.Cell class="whitespace-nowrap text-muted-foreground">
										<span class="block text-xs" title={formatDateTime(it.at)}>{relativeTime(it.at)}</span>
										<span class="block text-[10px] text-muted-foreground/60">
											{formatDateTime(it.at)}
										</span>
									</Table.Cell>
									<Table.Cell>
										<span class="flex items-center gap-1.5 whitespace-nowrap">
											<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
											<span class="flex items-center gap-1 text-xs font-medium {toneText[tone]}">
												<Layers class="size-3" /> session
											</span>
											<span class="text-xs text-muted-foreground">· {it.calls} calls</span>
										</span>
									</Table.Cell>
									<Table.Cell class="font-mono text-xs text-muted-foreground">
										<span title={it.groupId ?? ''}>{it.groupId ? shortId(it.groupId) : '—'}</span>
									</Table.Cell>
									<Table.Cell class="text-muted-foreground">{it.serviceName ?? '—'}</Table.Cell>
									<Table.Cell class="max-w-[220px]">
										<span class="block truncate font-mono text-xs text-muted-foreground">
											{(it.models ?? []).join(', ') || '—'}
										</span>
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{formatTokens(it.inputTokens)} → {formatTokens(it.outputTokens)}
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{Number(it.costUsd) ? formatUsd(it.costUsd) : '—'}
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">—</Table.Cell>
									<Table.Cell class="text-right">
										<ArrowRight
											class="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
										/>
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									class="group cursor-pointer"
									onclick={() => (window.location.href = resolve('/app/traces/[id]', { id: it.id }))}
								>
									<Table.Cell class="whitespace-nowrap text-muted-foreground">
										<span class="block text-xs" title={formatDateTime(it.at)}>{relativeTime(it.at)}</span>
										<span class="block text-[10px] text-muted-foreground/60">
											{formatDateTime(it.at)}
										</span>
									</Table.Cell>
									<Table.Cell>
										<span class="flex items-center gap-1.5 whitespace-nowrap">
											<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
											<span class="text-xs font-medium {toneText[tone]}">
												{it.status}{it.statusCode ? ` ${it.statusCode}` : ''}
											</span>
										</span>
									</Table.Cell>
									<Table.Cell class="font-mono text-xs text-muted-foreground">
										<span title={it.id}>{shortId(it.id)}</span>
									</Table.Cell>
									<Table.Cell class="text-muted-foreground">{it.serviceName ?? '—'}</Table.Cell>
									<Table.Cell class="font-mono text-xs text-muted-foreground">{it.model ?? '—'}</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{#if it.inputTokens != null || it.outputTokens != null}
											{formatTokens(it.inputTokens)} → {formatTokens(it.outputTokens)}
										{:else}
											—
										{/if}
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{it.costUsd ? formatUsd(it.costUsd) : '—'}
									</Table.Cell>
									<Table.Cell class="text-right text-muted-foreground tabular-nums">
										{it.latencyMs != null ? `${it.latencyMs}ms` : '—'}
									</Table.Cell>
									<Table.Cell class="text-right">
										<ArrowRight
											class="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
										/>
									</Table.Cell>
								</Table.Row>
							{/if}
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			{#if filtered.length === 0}
				<div class="flex flex-col items-center justify-center py-16">
					<Search class="size-7 text-muted-foreground" />
					<p class="mt-3 text-sm font-medium">No matching traces</p>
					<p class="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
					<Button variant="outline" size="sm" onclick={reset} class="mt-4">Clear filters</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>

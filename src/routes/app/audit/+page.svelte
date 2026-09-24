<script lang="ts">
	import { goto } from '$app/navigation';
	import type { ResolvedPathname } from '$app/types';
	import { toast } from 'svelte-sonner';
	import * as Table from '$lib/components/ui/table/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import PageHeader from '$lib/components/layout/page-header.svelte';
	import EmptyState from '$lib/components/layout/empty-state.svelte';
	import SearchInput from '$lib/components/form/search-input.svelte';
	import { formatDateTime, relativeTime, formatUsd, formatCount } from '$lib/format';
	import { eventTone, toneDot, toneText, actionIcon, isGatewayAction } from '$lib/events';
	import { actionLabel, auditFilterParams, type AuditFilter } from '$lib/audit-view';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import Search from '@lucide/svelte/icons/search';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import X from '@lucide/svelte/icons/x';
	import PageShell from '$lib/components/layout/page-shell.svelte';

	let { data } = $props();

	type Entry = (typeof data.entries)[number];

	const statusOptions = [
		{ value: 'all', label: 'All statuses' },
		{ value: 'ok', label: 'Succeeded' },
		{ value: 'denied', label: 'Denied' },
		{ value: 'error', label: 'Errors' }
	];
	const kindOptions = [
		{ value: 'all', label: 'All events' },
		{ value: 'gateway', label: 'Gateway' },
		{ value: 'admin', label: 'Admin' }
	];
	const rangeOptions = [
		{ value: 'all', label: 'All time' },
		{ value: '1h', label: 'Last hour' },
		{ value: '24h', label: 'Last 24 hours' },
		{ value: '7d', label: 'Last 7 days' },
		{ value: '30d', label: 'Last 30 days' }
	];
	const labelOf = (options: { value: string; label: string }[], value: string) =>
		options.find((o) => o.value === value)?.label ?? '';

	// The filter lives in the URL and is applied by the server, so it covers the
	// whole log rather than only the rows already loaded.
	const filter = $derived(data.filter as AuditFilter);
	const hasFilters = $derived(Boolean(filter.q || filter.status || filter.kind || filter.range));

	// Writable derived: the typed text runs ahead of the URL while debouncing,
	// and a navigation re-syncs it.
	let query = $derived(filter.q ?? '');

	function applyFilter(next: AuditFilter) {
		const params = auditFilterParams({ ...next, cursor: undefined }).toString();
		goto(`/app/audit${params ? `?${params}` : ''}` as ResolvedPathname, {
			noScroll: true,
			keepFocus: true,
			replaceState: true
		});
	}

	function setSelect(key: 'status' | 'kind' | 'range', value: string) {
		applyFilter({ ...filter, [key]: value === 'all' ? undefined : value });
	}

	let searchTimer: ReturnType<typeof setTimeout> | undefined;
	function setQuery(value: string) {
		query = value;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => applyFilter({ ...filter, q: value.trim() || undefined }), 300);
	}

	function reset() {
		clearTimeout(searchTimer);
		applyFilter({});
	}

	// Rows appended by "Load more"; a new filter (new page data) starts over.
	let loaded = $derived({ entries: data.entries as Entry[], nextCursor: data.nextCursor });
	let loadingMore = $state(false);

	async function loadMore() {
		if (!loaded.nextCursor || loadingMore) return;
		loadingMore = true;
		try {
			const params = auditFilterParams({ ...filter, cursor: loaded.nextCursor });
			const res = await fetch(`/app/audit/entries?${params}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const next: { entries: Entry[]; nextCursor: string | null } = await res.json();
			loaded = { entries: [...loaded.entries, ...next.entries], nextCursor: next.nextCursor };
		} catch {
			toast.error('Could not load more events');
		} finally {
			loadingMore = false;
		}
	}

	let expanded = $state<Record<string, boolean>>({});
</script>

<PageShell width="default">
	<PageHeader
		title="Audit Log"
		description="Append-only record of gateway requests and administrative actions."
	/>

	{#if loaded.entries.length === 0 && !hasFilters}
		<EmptyState
			icon={ScrollText}
			title="No events yet"
			description="Activity will appear here as it happens."
		/>
	{:else}
		<div class="flex flex-col gap-3 lg:flex-row lg:items-center">
			<SearchInput
				bind:value={() => query, setQuery}
				placeholder="Search action, model, service, token, IP…"
				class="flex-1"
			/>
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex">
				<Select.Root
					type="single"
					value={filter.range ?? 'all'}
					onValueChange={(v) => setSelect('range', v)}
				>
					<Select.Trigger class="w-full lg:w-40" aria-label="Time range">
						{labelOf(rangeOptions, filter.range ?? 'all')}
					</Select.Trigger>
					<Select.Content>
						{#each rangeOptions as o (o.value)}
							<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Select.Root
					type="single"
					value={filter.kind ?? 'all'}
					onValueChange={(v) => setSelect('kind', v)}
				>
					<Select.Trigger class="w-full lg:w-36" aria-label="Event kind">
						{labelOf(kindOptions, filter.kind ?? 'all')}
					</Select.Trigger>
					<Select.Content>
						{#each kindOptions as o (o.value)}
							<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Select.Root
					type="single"
					value={filter.status ?? 'all'}
					onValueChange={(v) => setSelect('status', v)}
				>
					<Select.Trigger class="w-full lg:w-36" aria-label="Status">
						{labelOf(statusOptions, filter.status ?? 'all')}
					</Select.Trigger>
					<Select.Content>
						{#each statusOptions as o (o.value)}
							<Select.Item value={o.value} label={o.label}>{o.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			{#if hasFilters}
				<Button variant="ghost" size="sm" onclick={reset} class="shrink-0">
					<X class="size-4" /> Clear
				</Button>
			{/if}
		</div>

		<div class="text-xs text-muted-foreground">
			<!-- No total: counting a large log on every filter change is expensive,
			     so say whether more exist instead of claiming a number. -->
			Showing
			<span class="font-medium text-foreground tabular-nums"
				>{formatCount(loaded.entries.length)}</span
			>
			{loaded.entries.length === 1 ? 'event' : 'events'}{#if loaded.nextCursor}, newest first — more
				available{/if}
		</div>

		<div class="overflow-hidden rounded-xl border">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="hover:bg-transparent">
							<Table.Head class="bg-muted/40">Time</Table.Head>
							<Table.Head class="bg-muted/40">Action</Table.Head>
							<Table.Head class="bg-muted/40">Status</Table.Head>
							<Table.Head class="bg-muted/40">Who</Table.Head>
							<Table.Head class="bg-muted/40">Service</Table.Head>
							<Table.Head class="bg-muted/40">Provider / model</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Cost</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Provider cache</Table.Head>
							<Table.Head class="bg-muted/40 text-right">Latency</Table.Head>
							<Table.Head class="bg-muted/40">Detail</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each loaded.entries as e (e.id)}
							{@const tone = eventTone(e.status)}
							{@const Icon = actionIcon(e.action)}
							<Table.Row>
								<Table.Cell class="whitespace-nowrap text-muted-foreground">
									<span class="text-xs" title={formatDateTime(e.createdAt)}>
										{relativeTime(e.createdAt)}
									</span>
									<span class="hidden text-xs text-muted-foreground/70 xl:block">
										{formatDateTime(e.createdAt)}
									</span>
								</Table.Cell>
								<Table.Cell>
									<span class="flex items-center gap-2 whitespace-nowrap" title={e.action}>
										<Icon class="size-3.5 shrink-0 text-muted-foreground" />
										<span class="text-xs font-medium">{actionLabel(e.action)}</span>
									</span>
								</Table.Cell>
								<Table.Cell>
									<span class="flex items-center gap-1.5 whitespace-nowrap">
										<span class="size-1.5 rounded-full {toneDot[tone]}" aria-hidden="true"></span>
										<span class="text-xs font-medium {toneText[tone]}">
											{e.status}{e.statusCode ? ` ${e.statusCode}` : ''}
										</span>
									</span>
								</Table.Cell>
								<Table.Cell class="text-xs whitespace-nowrap text-muted-foreground">
									{#if isGatewayAction(e.action) && e.tokenName}
										<span class="flex items-center gap-1.5" title="Machine token">
											<KeyRound class="size-3.5 shrink-0" />
											{e.tokenName}
										</span>
									{:else if isGatewayAction(e.action)}
										<span title="No token recorded">—</span>
									{:else}
										<!-- Admin rows don't store who acted yet, and a member with
										     token rights can write them too, so don't guess a role. -->
										<span title="The acting user isn't recorded for admin events">—</span>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-muted-foreground">{e.serviceName ?? '—'}</Table.Cell>
								<Table.Cell class="text-muted-foreground">
									{#if e.model || e.provider}
										<span class="block text-xs whitespace-nowrap">{e.provider ?? '—'}</span>
										<span class="block whitespace-nowrap">{e.model ?? '—'}</span>
									{:else}
										—
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{e.costUsd ? formatUsd(e.costUsd) : '—'}
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{e.providerCachedTokens ? `${formatCount(e.providerCachedTokens)} tok` : '—'}
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{e.latencyMs != null ? `${e.latencyMs}ms` : '—'}
								</Table.Cell>
								<Table.Cell class="max-w-[280px] text-xs text-muted-foreground">
									{#if e.detail}
										<button
											type="button"
											class="block w-full text-left {expanded[e.id]
												? 'break-words whitespace-pre-wrap'
												: 'truncate'}"
											title={expanded[e.id] ? 'Collapse' : e.detail}
											aria-expanded={expanded[e.id] ?? false}
											onclick={() => (expanded[e.id] = !expanded[e.id])}
										>
											{e.detail}
										</button>
									{/if}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			{#if loaded.entries.length === 0}
				<div class="flex flex-col items-center justify-center py-16">
					<Search class="size-7 text-muted-foreground" />
					<p class="mt-3 text-sm font-medium">No matching events</p>
					<p class="text-sm text-muted-foreground">Try adjusting your search or filters.</p>
					<Button variant="outline" size="sm" onclick={reset} class="mt-4">Clear filters</Button>
				</div>
			{/if}
		</div>

		{#if loaded.nextCursor}
			<div class="flex justify-center">
				<Button variant="outline" onclick={loadMore} disabled={loadingMore}>
					{loadingMore ? 'Loading…' : 'Load more'}
				</Button>
			</div>
		{/if}
	{/if}
</PageShell>
